import os
import json
import logging
import re
from flask import Flask, request, jsonify, render_template
import pandas as pd
import numpy as np

# Initialize the Flask App
app = Flask(__name__)
VERSION = "1.6.0"
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

logging.basicConfig(level=logging.INFO)

# --- Data Processing and Helper Functions ---

def make_json_serializable(data):
    if isinstance(data, dict): return {k: make_json_serializable(v) for k, v in data.items()}
    if isinstance(data, list): return [make_json_serializable(i) for i in data]
    if isinstance(data, (np.int_, np.intc, np.intp, np.int8, np.int16, np.int32, np.int64, np.uint8, np.uint16, np.uint32, np.uint64)): return int(data)
    if isinstance(data, (np.float_, np.float16, np.float32, np.float64)): return float(data)
    if isinstance(data, np.bool_): return bool(data)
    return data

def calculate_health(series):
    if series.empty or series.isnull().all(): return "N/A", "grey", 0.0
    valid_entries = series.dropna()
    if len(valid_entries) == 0: return "N/A", "grey", 0.0
    succeeded_count = valid_entries.str.contains('Succeeded', na=False).sum()
    success_rate = (succeeded_count / len(valid_entries)) * 100
    if success_rate >= 90: status, color = "Excellent", "green"
    elif 75 <= success_rate < 90: status, color = "Good", "gold"
    elif 40 <= success_rate < 75: status, color = "Warning", "orange"
    else: status, color = "Error", "red"
    return status, color, round(success_rate, 1)

# ADDED: Function to parse status strings according to v1.6.0 logic
def parse_status_column(series):
    def extract(text):
        try:
            if pd.isna(text): return "Not Available"
            text = str(text)
            status_match = re.search(r'status\s*=\s*(\w+)', text)
            status = status_match.group(1) if status_match else "Unknown"
            if status == "Succeeded": return "Succeeded"
            all_messages = re.findall(r'\(([^)]+)\)', text)
            if all_messages: return all_messages[-1].strip()
            return f"{status} (No message)"
        except Exception: return "Parsing Error"
    return series.apply(extract)

def remove_outliers(series, level):
    series = pd.to_numeric(series, errors='coerce')
    if series.count() < 3: return series
    corrected_series = series.copy()
    for i in range(1, len(series) - 1):
        p_before, p_current, p_after = corrected_series.iloc[i-1], corrected_series.iloc[i], corrected_series.iloc[i+1]
        if pd.isna(p_before) or pd.isna(p_current) or pd.isna(p_after): continue
        try:
            avg_neighbor_check = (p_before + p_after) / 2.0
            if abs(avg_neighbor_check) < 1e-9 and abs(p_current) < 1e-9: continue
            factor = 10**level
            if abs(p_current) > abs(avg_neighbor_check) * factor:
                corrected_series.iloc[i] = (p_before + p_after) // 2
        except (ValueError, TypeError): continue
    return corrected_series

# --- Flask Routes ---
@app.route('/')
def index():
    return render_template('index.html', version=VERSION)

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    try:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        df = pd.read_csv(filepath, dtype={'sn': str})
        
        required_cols = ["sn", "calibrationname", "substratename", "statusforhistory", "scalingstatus", "gapstatus", "imagescalingusedupm", "blanketid", "calibrationid", "gaperrorfinalum", "imagescalingerrorupm"]
        for col in required_cols:
            if col not in df.columns: return jsonify({"error": f'Required column "{col}" is missing.'}), 400

        unique_sns = df['sn'].unique()
        if len(unique_sns) > 1:
            summary_data = []
            for sn in sorted(unique_sns):
                sn_df = df[df['sn'] == sn]
                sh, sc, sp = calculate_health(sn_df['scalingstatus'])
                gh, gc, gp = calculate_health(sn_df['gapstatus'])
                oh, oc, op = calculate_health(sn_df['statusforhistory'])
                summary_data.append({
                    "sn": sn, "cycles": sn_df.groupby('calibrationid')['blanketid'].max().sum(),
                    "scalingHealth": sh, "scalingHealthPercent": sp, "gapHealth": gh, 
                    "gapHealthPercent": gp, "overallHealth": oh, "overallHealthPercent": op, "color": oc
                })
            return jsonify({"view": "multi_press", "summary": make_json_serializable(summary_data), "filename": file.filename})
        else:
            sn = unique_sns[0]
            df['starttime'] = df['starttime'].str.split('.').str[0]
            health_by_time, session_data_storage = [], {}
            for st_short in sorted(df['starttime'].unique()):
                session_df = df[df['starttime'] == st_short]
                status, color, percent = calculate_health(session_df['statusforhistory'])
                health_by_time.append({
                    "short_time": st_short, "full_time": st_short,
                    "health_status": status, "health_color": color, "percent": percent,
                    "cycles": int(session_df["blanketid"].max())
                })
                session_data_storage[st_short] = json.loads(session_df.to_json(orient='records'))
            overall_health, _, _ = calculate_health(df['statusforhistory'])
            return jsonify({
                "view": "single_press", "filename": file.filename, "sn": sn,
                "startTimes": health_by_time, "overallHealth": overall_health,
                "sessions": session_data_storage
            })
    except Exception as e:
        app.logger.error(f"Upload failed: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred."}), 500

@app.route('/get_press_data', methods=['POST'])
def get_press_data():
    data = request.json
    filename, sn = data.get('filename'), str(data.get('sn'))
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    try:
        df = pd.read_csv(filepath, dtype={'sn': str})
        df['starttime'] = df['starttime'].str.split('.').str[0]
        press_df = df[df['sn'] == sn]
        
        health_by_time, session_data_storage = [], {}
        for st_short in sorted(press_df['starttime'].unique()):
            session_df = press_df[press_df['starttime'] == st_short]
            status, color, percent = calculate_health(session_df['statusforhistory'])
            health_by_time.append({
                "short_time": st_short, "full_time": st_short,
                "health_status": status, "health_color": color, "percent": percent,
                "cycles": int(session_df["blanketid"].max())
            })
            session_data_storage[st_short] = json.loads(session_df.to_json(orient='records'))
        overall_health, _, _ = calculate_health(press_df['statusforhistory'])
        return jsonify({
            "sn": sn, "startTimes": health_by_time,
            "overallHealth": overall_health, "sessions": session_data_storage
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/process_data', methods=['POST'])
def process_data_endpoint():
    data = request.json
    session_data = pd.DataFrame(data['sessionData'])
    if data.get('removeOutliers', False):
        level = int(data.get('outlierLevel', 1))
        for col in ['gaperrorfinalum', 'imagescalingerrorupm', 'imagescalingusedupm']:
            if col in session_data.columns:
                session_data[col] = remove_outliers(session_data[col], level)
    return jsonify({
        "plotData": json.loads(session_data.to_json(orient='records')),
        "scalingStdDev": round(pd.to_numeric(session_data['imagescalingerrorupm'], errors='coerce').std(), 2),
        "gapStdDev": round(pd.to_numeric(session_data['gaperrorfinalum'], errors='coerce').std(), 2)
    })

# NEW ENDPOINT
@app.route('/api/error_stats', methods=['POST'])
def get_error_stats():
    data = request.json
    session_data = pd.DataFrame(data['sessionData'])
    scaling_statuses = parse_status_column(session_data['scalingstatus'])
    scaling_counts = scaling_statuses.value_counts()
    gap_statuses = parse_status_column(session_data['gapstatus'])
    gap_counts = gap_statuses.value_counts()
    return jsonify({
        "scalingStats": json.loads(scaling_counts.to_json()),
        "gapStats": json.loads(gap_counts.to_json())
    })

if __name__ == '__main__':
    app.run(debug=True, use_reloader=False)
