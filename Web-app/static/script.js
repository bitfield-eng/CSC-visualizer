document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    let state = {
        filename: null,
        pressData: null,
        isMultiPress: false,
    };

    // --- DOM Elements ---
    const views = {
        initial: document.getElementById('initialView'),
        pressSelection: document.getElementById('pressSelectionView'),
        mainApp: document.getElementById('mainAppView'),
    };
    const fileInput = document.getElementById('csvFileInput');
    const fileNameLabel = document.getElementById('fileNameLabel');
    const loader = document.getElementById('loader');
    const uploadError = document.getElementById('uploadError');
    const pressTableBody = document.querySelector('#pressTable tbody');
    const viewPressDataBtn = document.getElementById('viewPressDataBtn');
    const startTimeDropdown = document.getElementById('startTimeDropdown');
    const plotsContainer = document.getElementById('plotsContainer');
    const mainInfoLabel = document.getElementById('mainInfoLabel');
    const overallHealthLabel = document.getElementById('overallHealthLabel');
    const blanketIdLabel = document.getElementById('blanketIdLabel');
    const outliersCheckbox = document.getElementById('outliersCheckbox');
    const outliersLevel = document.getElementById('outliersLevel');
    const trendsCheckbox = document.getElementById('trendsCheckbox');

    // --- Utility Functions ---
    const showView = (viewName) => {
        Object.values(views).forEach(v => v.style.display = 'none');
        views[viewName].style.display = 'block';
    };
    
    const setHealthLabel = (element, healthText, color) => {
        element.textContent = healthText;
        element.style.backgroundColor = `var(--health-${color}, #6c757d)`;
        element.style.color = (color === 'gold') ? 'black' : 'white';
        element.dataset.color = color;
    };

    // --- Event Handlers ---
    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            fileNameLabel.textContent = fileInput.files[0].name;
            handleFileUpload();
        }
    });
    
    [...document.querySelectorAll('#loadNewFileBtn1, #loadNewFileBtn2')].forEach(btn => {
        btn.addEventListener('click', () => window.location.reload());
    });
    
    document.getElementById('exitButton').addEventListener('click', () => {
        document.body.innerHTML = '<h1 style="text-align: center; margin-top: 5rem;">Application Closed</h1><p style="text-align: center;">You can close this browser tab.</p>';
    });

    const handleFileUpload = async () => {
        loader.style.display = 'block';
        uploadError.textContent = '';
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            const data = await response.json();

            if (!response.ok) throw new Error(data.error || 'Unknown error occurred.');

            state.filename = data.filename;

            if (data.view === 'multi_press') {
                state.isMultiPress = true;
                displayPressSelection(data.summary);
            } else {
                state.isMultiPress = false;
                state.pressData = {
                    sn: data.sn,
                    startTimes: data.startTimes,
                    overallHealth: data.overallHealth,
                    sessions: data.sessions 
                };
                setupMainView(data.sn, data.startTimes, data.overallHealth);
            }
        } catch (error) {
            uploadError.textContent = `Error: ${error.message}`;
        } finally {
            loader.style.display = 'none';
        }
    };

    const displayPressSelection = (summary) => {
        pressTableBody.innerHTML = '';
        summary.forEach(press => {
            const row = document.createElement('tr');
            row.dataset.sn = press.sn;
            row.innerHTML = `
                <td>${press.sn}</td>
                <td>${press.cycles}</td>
                <td>${press.scalingHealth}</td>
                <td>${press.scalingHealthPercent}%</td>
                <td>${press.gapHealth}</td>
                <td>${press.gapHealthPercent}%</td>
                <td>${press.overallHealth}</td>
                <td>${press.overallHealthPercent}%</td>
            `;
            row.style.borderLeft = `5px solid var(--health-${press.color}, #ccc)`;
            pressTableBody.appendChild(row);
        });
        showView('pressSelection');
    };
    
    pressTableBody.addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        document.querySelectorAll('#pressTable tbody tr').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        viewPressDataBtn.disabled = false;
    });

    pressTableBody.addEventListener('dblclick', (e) => {
        const row = e.target.closest('tr');
        if (!row) return;
        viewPressDataBtn.disabled = false;
        viewPressDataBtn.click();
    });

    viewPressDataBtn.addEventListener('click', async () => {
        const selectedRow = document.querySelector('#pressTable tbody tr.selected');
        if (!selectedRow) return;
        const sn = selectedRow.dataset.sn;
        loader.style.display = 'block';
        await setupMainViewForSelectedPress(sn);
        loader.style.display = 'none';
    });
    
    const setupMainViewForSelectedPress = async (sn) => {
        try {
            const response = await fetch('/get_press_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: state.filename, sn: sn })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            state.pressData = data;
            setupMainView(sn, data.startTimes, data.overallHealth);
        } catch (error) {
            uploadError.textContent = `Error: ${error.message}`;
            showView('initial');
        }
    };

    const setupMainView = (sn, startTimes, overallHealth) => {
        startTimeDropdown.innerHTML = '<option value="">Select a time...</option>';
        const healthEmojiMap = {
            green: '🟢',
            gold: '🟡',
            orange: '🟠',
            red: '🔴',
            grey: '⚪️'
        };
        
        startTimes.forEach(st => {
            const option = document.createElement('option');
            option.value = st.short_time;
            const emoji = healthEmojiMap[st.health_color] || '⚪️';
            option.textContent = `${emoji} ${st.short_time} (${st.health_status})`;
            startTimeDropdown.appendChild(option);
        });
        
        setHealthLabel(overallHealthLabel, `Overall Health: ${overallHealth}`, overallHealth.toLowerCase());
        mainInfoLabel.textContent = `Displaying Data for Press SN: ${sn}. Please select a Start Time.`;
        document.getElementById('backToPressesBtn').style.display = state.isMultiPress ? 'inline-block' : 'none';
        showView('mainApp');
    };
    
    document.getElementById('backToPressesBtn').addEventListener('click', () => {
        plotsContainer.innerHTML = '';
        showView('pressSelection');
    });
    
    startTimeDropdown.addEventListener('change', async () => {
        const selectedTime = startTimeDropdown.value;
        if (!selectedTime) return;
        
        const sessionInfo = state.pressData.sessions[selectedTime][0] || {};
        blanketIdLabel.textContent = `Blanket Cycles: ${Math.max(...state.pressData.sessions[selectedTime].map(r => r.blanketid))}`;
        mainInfoLabel.textContent = `Press SN: ${state.pressData.sn} | Start Time: ${selectedTime} | Substrate: ${sessionInfo.substratename}`;
        
        await renderPlot(selectedTime);
    });
    
    [outliersCheckbox, outliersLevel, trendsCheckbox].forEach(el => {
        el.addEventListener('change', () => {
             _updateAllPlots();
        });
    });
    
    document.getElementById('clearAllBtn').addEventListener('click', () => {
        plotsContainer.innerHTML = '';
    });

    const renderPlot = async (selectedTime) => {
        const plotFrame = document.createElement('div');
        plotFrame.classList.add('plot-frame');
        plotFrame.dataset.time = selectedTime;
        plotFrame.innerHTML = `
            <div class="plot-header">
                <div class="plot-title-group">
                    <span class="plot-title">Session: ${selectedTime}</span>
                    <span class="health-label" id="sessionHealth-${selectedTime}"></span>
                </div>
                <button class="app-button danger">Clear</button>
            </div>
            <div class="plot-graphs-area">
                <div id="plotScaling-${selectedTime}" class="plot-graph"></div>
                <div id="plotGap-${selectedTime}" class="plot-graph"></div>
            </div>
        `;
        
        plotFrame.querySelector('button.danger').addEventListener('click', () => plotFrame.remove());
        plotsContainer.prepend(plotFrame);
        await redrawPlot(plotFrame);
    };

    const redrawPlot = async (plotFrame) => {
        const selectedTime = plotFrame.dataset.time;
        const sessionData = state.pressData.sessions[selectedTime];
        
        const totalRows = sessionData.length;
        const succeeded = sessionData.filter(r => r.statusforhistory && r.statusforhistory.includes('Succeeded')).length;
        const rate = totalRows > 0 ? (succeeded / totalRows) * 100 : 0;
        let healthText = "Error", color="red";
        if (rate >= 90) { healthText = "Excellent"; color="green"; }
        else if (rate >= 75) { healthText = "Good"; color="gold"; }
        else if (rate >= 40) { healthText = "Warning"; color="orange"; }
        setHealthLabel(plotFrame.querySelector('.health-label'), `Session Health: ${healthText}`, color);

        const response = await fetch('/process_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionData: sessionData,
                removeOutliers: outliersCheckbox.checked,
                outlierLevel: outliersLevel.value
            })
        });
        const processedData = await response.json();
        const blanketIds = processedData.map(r => r.blanketid);

        const desertColors = { scaling: '#D2B48C', gap: '#A0522D', trend: '#8F9779' };
        const layout = {
            margin: { t: 40, b: 40, l: 60, r: 60 },
            xaxis: { title: 'Blanket ID' },
            legend: { x: 0, y: 1.1, orientation: 'h' }
        };
        
        const scalingTrace = { x: blanketIds, y: processedData.map(r => r.imagescalingerrorupm), type: 'scatter', mode: 'lines', name: 'Scaling Error', line: { color: desertColors.scaling } };
        const scalingLayout = { ...layout, title: 'Scaling Error Graph', yaxis: { title: 'Scaling Error (µm/m)', color: 'black' } };
        const plotData = [scalingTrace];

        if (trendsCheckbox.checked) {
            const trendTrace = { x: blanketIds, y: processedData.map(r => r.imagescalingusedupm + 14000), type: 'scatter', mode: 'lines', name: 'Normalized Trend', line: { color: desertColors.trend, dash: 'dot'}, yaxis: 'y2' };
            plotData.push(trendTrace);
            scalingLayout.yaxis2 = { title: 'Normalized scaling µm/meter', overlaying: 'y', side: 'right', color: 'black' };
        }
        Plotly.newPlot(`plotScaling-${selectedTime}`, plotData, scalingLayout, {responsive: true});

        const gapTrace = { x: blanketIds, y: processedData.map(r => r.gaperrorfinalum), type: 'scatter', mode: 'lines', name: 'Gap Error', line: { color: desertColors.gap } };
        const gapLayout = { ...layout, title: 'Gap Error Graph', yaxis: { title: 'Gap Error (µm)', color: 'black' } };
        Plotly.newPlot(`plotGap-${selectedTime}`, [gapTrace], gapLayout, {responsive: true});
    }
    
    const _updateAllPlots = async () => {
        for (const frame of plotsContainer.querySelectorAll('.plot-frame')) {
            await redrawPlot(frame);
        }
    };
});
