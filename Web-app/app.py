import os
import json
from flask import Flask, request, jsonify, render_template
import pandas as pd

# Initialize the Flask App
app = Flask(__name__)
# Setting a temporary upload folder
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# --- Data Processing Functions ---

def calculate_health(series):
    """Calculates a health status and color based on success percentage."""
    if series.empty or series.isnull().all():
        return "N/A", "grey"
    
    valid_entries = series.dropna()
    if len(valid_entries) == 0:
        return "N/A", "grey"
        
    succeeded_count = valid_entries.str.contains('Succeeded', na=False).sum()
    success_rate = (succeeded_count / len(valid_entries)) * 100
    
    if success_rate >= 90: return "Excellent", "green"
    if 75 <= success_rate < 90: return "Good", "gold"
    if 40 <= success_rate < 75: return "Warning", "orange"
    return "Error", "red"

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
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    """Handles file upload and initial analysis."""
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    try:
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        df = pd.read_csv(filepath)
        
        required_cols = ["sn", "calibrationname", "substratename", "statusforhistory", "scalingstatus", "gapstatus", "imagescalingusedupm", "blanketid", "calibrationid", "gaperrorfinalum", "imagescalingerrorupm"]
        for col in required_cols:
            if col not in df.columns:
                return jsonify({"error": f'Required column "{col}" is missing.'}), 400

        unique_sns = df['sn'].unique()

        if len(unique_sns) > 1:
            summary_data = []
            for sn in sorted(unique_sns):
                sn_df = df[df['sn'] == sn]
                total_cycles = sn_df.groupby('calibrationid')['blanketid'].max().sum()
                scaling_health, _ = calculate_health(sn_df['scalingstatus'])
                gap_health, _ = calculate_health(sn_df['gapstatus'])
                overall_health, o_color = calculate_health(sn_df['statusforhistory'])
                summary_data.append({
                    "sn": int(sn),
                    "cycles": int(total_cycles),
                    "scalingHealth": scaling_health,
                    "gapHealth": gap_health,
                    "overallHealth": overall_health,
                    "color": o_color
                })
            return jsonify({"view": "multi_press", "summary": summary_data, "filename": file.filename})

        else:
            sn = unique_sns[0]
            start_times = {s.split('.')[0]: s for s in df['starttime'].unique()}
            overall_health, _ = calculate_health(df['statusforhistory'])
            return jsonify({
                "view": "single_press", 
                "filename": file.filename,
                "sn": int(sn),
                "startTimes": start_times,
                "overallHealth": overall_health
            })
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/process_data', methods=['POST'])
def process_data_endpoint():
    """Processes session data with optional outlier removal for plotting."""
    data = request.json
    session_data = pd.DataFrame(data['sessionData'])
    
    if data.get('removeOutliers', False):
        level = int(data.get('outlierLevel', 1))
        for col in ['gaperrorfinalum', 'imagescalingerrorupm', 'imagescalingusedupm']:
            if col in session_data.columns:
                session_data[col] = remove_outliers(session_data[col], level)

    json_string = session_data.to_json(orient='records')
    clean_data = json.loads(json_string)
    return jsonify(clean_data)


@app.route('/get_press_data', methods=['POST'])
def get_press_data():
    """Gets all data for a selected press."""
    data = request.json
    filename = data.get('filename')
    sn = int(data.get('sn'))
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    try:
        df = pd.read_csv(filepath)
        press_df = df[df['sn'] == sn]
        start_times = {s.split('.')[0]: s for s in press_df['starttime'].unique()}
        overall_health, _ = calculate_health(press_df['statusforhistory'])
        
        session_data_storage = {}
        for st_short, st_full in start_times.items():
            session_data_df = press_df[press_df['starttime'] == st_full]
            json_string = session_data_df.to_json(orient='records')
            clean_session_data = json.loads(json_string)
            session_data_storage[st_short] = clean_session_data

        return jsonify({
            "sn": int(sn),
            "startTimes": start_times,
            "overallHealth": overall_health,
            "sessions": session_data_storage
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True)
