import os
import json
import logging
from flask import Flask, request, jsonify, render_template
import pandas as pd
import numpy as np

# Initialize the Flask App
app = Flask(__name__)
# Setting a temporary upload folder
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# --- Setup Logging ---
logging.basicConfig(level=logging.INFO)

# --- Data Processing and Helper Functions ---

def make_json_serializable(data):
    """
    Recursively iterates through data to convert numpy types to standard
    Python types, making it safe for JSON serialization.
    """
    if isinstance(data, dict):
        return {k: make_json_serializable(v) for k, v in data.items()}
    if isinstance(data, list):
        return [make_json_serializable(i) for i in data]
    if isinstance(data, (np.int_, np.intc, np.intp, np.int8,
                        np.int16, np.int32, np.int64, np.uint8,
                        np.uint16, np.uint32, np.uint64)):
        return int(data)
    if isinstance(data, (np.float_, np.float16, np.float32, np.float64)):
        return float(data)
    if isinstance(data, np.bool_):
        return bool(data)
    return data

def calculate_health(series):
    """Calculates a health status, color, and percentage based on success rate."""
    if series.empty or series.isnull().all():
        return "N/A", "grey", 0.0
    
    valid_entries = series.dropna()
    if len(valid_entries) == 0:
        return "N/A", "grey", 0.0
        
    succeeded_count = valid_entries.str.contains('Succeeded', na=False).sum()
    success_rate = (succeeded_count / len(valid_entries)) * 100
    
    if success_rate >= 90:
        status, color = "Excellent", "green"
    elif 75 <= success_rate < 90:
        status, color = "Good", "gold"
    elif 40 <= success_rate < 75:
        status, color = "Warning", "orange"
    else:
        status, color = "Error", "red"
        
    return status, color, round(success_rate, 1)

def remove_outliers(series, level):
    """Detects and replaces outliers with an integer-based neighbor average."""
    if len(series) < 3: return series
    corrected_series = series.copy()
    for i in range(1, len(series) - 1):
        p_before = corrected_series.iloc[i-1]
        p_current = corrected_series.iloc[i]
        p_after = corrected_series.iloc[i+1]
        try:
            avg_neighbor_check = (p_before + p_after) / 2.0
            if abs(avg_neighbor_check) < 1e-9 and abs(p_current) < 1e-9: continue
            factor = 10**level
            if abs(p_current) > abs(avg_neighbor_check) * factor:
                neighbor_sum = p_before + p_after
                if neighbor_sum % 2 != 0: neighbor_sum += 1
                replacement_value = neighbor_sum // 2
                corrected_series.iloc[i] = replacement_value
        except (ValueError, TypeError): continue
    return corrected_series

# --- Flask Routes ---

@app.route('/')
def index():
    """Serves the main HTML page."""
    app.logger.info("Serving index.html")
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handles file upload and initial analysis."""
    app.logger.info("Received request to /upload")
    if 'file' not in request.files:
        app.logger.error("No file part in request")
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        app.logger.error("No selected file in request")
        return jsonify({"error": "No selected file"}), 400

    try:
        app.logger.info(f"Processing file: {file.filename}")
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        df = pd.read_csv(filepath, dtype={'sn': str})
        
        required_cols = ["sn", "calibrationname", "substratename", "statusforhistory", "scalingstatus", "gapstatus", "imagescalingusedupm", "blanketid", "calibrationid", "gaperrorfinalum", "imagescalingerrorupm"]
        for col in required_cols:
            if col not in df.columns:
                app.logger.error(f"Missing required column: {col}")
                return jsonify({"error": f'Required column "{col}" is missing.'}), 400

        unique_sns = df['sn'].unique()
        app.logger.info(f"Found {len(unique_sns)} unique serial numbers.")

        if len(unique_sns) > 1:
            app.logger.info("Multi-press mode detected. Building summary table.")
            summary_data = []
            for sn in sorted(unique_sns):
                sn_df = df[df['sn'] == sn]
                total_cycles = sn_df.groupby('calibrationid')['blanketid'].max().sum()
                scaling_health, _, scaling_percent = calculate_health(sn_df['scalingstatus'])
                gap_health, _, gap_percent = calculate_health(sn_df['gapstatus'])
                overall_health, o_color, overall_percent = calculate_health(sn_df['statusforhistory'])
                
                summary_data.append({
                    "sn": sn,
                    "cycles": total_cycles,
                    "scalingHealth": scaling_health,
                    "scalingHealthPercent": scaling_percent,
                    "gapHealth": gap_health,
                    "gapHealthPercent": gap_percent,
                    "overallHealth": overall_health,
                    "overallHealthPercent": overall_percent,
                    "color": o_color
                })
            
            clean_summary_data = make_json_serializable(summary_data)
            app.logger.info(f"Clean summary data to be sent for multi-press view.")
            return jsonify({"view": "multi_press", "summary": clean_summary_data, "filename": file.filename})

        else:
            app.logger.info("Single-press mode detected.")
            sn = unique_sns[0]
            health_by_time = []
            session_data_storage = {}
            for st_full in sorted(df['starttime'].unique()):
                short_time = st_full.split('.')[0]
                session_df = df[df['starttime'] == st_full]
                health_status, health_color, percent = calculate_health(session_df['statusforhistory'])
                max_blanket_id = session_df["blanketid"].max()
                health_by_time.append({
                    "short_time": short_time,
                    "full_time": st_full,
                    "health_status": health_status,
                    "health_color": health_color,
                    "percent": percent,
                    "cycles": int(max_blanket_id)
                })
                json_string = session_df.to_json(orient='records')
                session_data_storage[short_time] = json.loads(json_string)

            overall_health, _, _ = calculate_health(df['statusforhistory'])
            app.logger.info(f"Single press data successfully created. Sending to frontend.")
            return jsonify({
                "view": "single_press", 
                "filename": file.filename,
                "sn": sn,
                "startTimes": health_by_time,
                "overallHealth": overall_health,
                "sessions": session_data_storage
            })
            
    except Exception as e:
        app.logger.error(f"An error occurred during file upload: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred. Please check the server logs."}), 500

@app.route('/process_data', methods=['POST'])
def process_data_endpoint():
    data = request.json
    session_data = pd.DataFrame(data['sessionData'])
    
    if data.get('removeOutliers', False):
        level = int(data.get('outlierLevel', 1))
        for col in ['gaperrorfinalum', 'imagescalingerrorupm', 'imagescalingusedupm']:
            if col in session_data.columns:
                session_data[col] = remove_outliers(session_data[col], level)

    scaling_std = round(session_data['imagescalingerrorupm'].std(), 2)
    gap_std = round(session_data['gaperrorfinalum'].std(), 2)

    json_string = session_data.to_json(orient='records')
    clean_data = json.loads(json_string)
    
    return jsonify({
        "plotData": clean_data,
        "scalingStdDev": scaling_std,
        "gapStdDev": gap_std
    })


@app.route('/get_press_data', methods=['POST'])
def get_press_data():
    data = request.json
    filename = data.get('filename')
    sn = str(data.get('sn'))
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    try:
        df = pd.read_csv(filepath, dtype={'sn': str})
        press_df = df[df['sn'] == sn]
        
        health_by_time = []
        for st_full in sorted(press_df['starttime'].unique()):
            session_df = press_df[press_df['starttime'] == st_full]
            health_status, health_color, percent = calculate_health(session_df['statusforhistory'])
            max_blanket_id = session_df["blanketid"].max()
            health_by_time.append({
                "short_time": st_full.split('.')[0],
                "full_time": st_full,
                "health_status": health_status,
                "health_color": health_color,
                "percent": percent,
                "cycles": int(max_blanket_id)
            })

        overall_health, _, _ = calculate_health(press_df['statusforhistory'])
        
        session_data_storage = {}
        for session in health_by_time:
            session_data_df = press_df[press_df['starttime'] == session['full_time']]
            json_string = session_data_df.to_json(orient='records')
            clean_session_data = json.loads(json_string)
            session_data_storage[session['short_time']] = clean_session_data

        return jsonify({
            "sn": sn,
            "startTimes": health_by_time,
            "overallHealth": overall_health,
            "sessions": session_data_storage
        })

    except Exception as e:
        app.logger.error(f"An error occurred during get_press_data: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True)
