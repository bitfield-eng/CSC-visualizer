document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    let state = {
        filename: null,
        pressData: null,
        currentSessionData: null,
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
    const showErrorStatsBtn = document.getElementById('showErrorStatsBtn');
    const errorStatsContainer = document.getElementById('errorStatsContainer');

    // --- Utility Functions ---
    const showView = (viewName) => {
        Object.values(views).forEach(v => v.style.display = 'none');
        if (views[viewName]) {
            views[viewName].style.display = 'block';
        }
    };

    const setHealthLabel = (element, healthText, color) => {
        element.textContent = healthText;
        element.style.backgroundColor = `var(--health-${color}, #6c757d)`;
        element.style.color = (color === 'gold') ? 'black' : 'white';
    };

    // --- Event Listeners ---
    fileInput.addEventListener('change', (event) => {
        if (event.target.files.length > 0) {
            fileNameLabel.textContent = event.target.files[0].name;
            handleFileUpload(event.target.files[0]);
        }
    });

    [...document.querySelectorAll('#loadNewFileBtn1, #loadNewFileBtn2')].forEach(btn => {
        btn.addEventListener('click', () => fileInput.click());
    });

    document.getElementById('exitButton').addEventListener('click', () => {
        if (confirm("Are you sure? This will reset the application.")) {
            window.location.reload();
        }
    });

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
        row.classList.add('selected');
        viewPressDataBtn.click();
    });

    viewPressDataBtn.addEventListener('click', () => {
        const selectedRow = document.querySelector('#pressTable tbody tr.selected');
        if (!selectedRow) return;
        const sn = selectedRow.dataset.sn;
        fetchPressData(sn);
    });

    startTimeDropdown.addEventListener('change', updateDisplay);
    [outliersCheckbox, outliersLevel, trendsCheckbox].forEach(el => {
        el.addEventListener('change', updateDisplay);
    });

    showErrorStatsBtn.addEventListener('click', () => {
        const container = errorStatsContainer;
        if (container.style.display === 'block') {
            container.style.display = 'none';
        } else {
            updateErrorStats();
        }
    });

    document.getElementById('clearAllBtn').addEventListener('click', () => {
        plotsContainer.innerHTML = '';
        errorStatsContainer.style.display = 'none';
    });


    // --- Core Logic ---
    async function handleFileUpload(file) {
        loader.style.display = 'block';
        uploadError.textContent = '';
        showView('initial');

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            state.filename = data.filename;
            if (data.view === 'multi_press') {
                state.isMultiPress = true;
                displayPressSelection(data.summary);
            } else {
                state.isMultiPress = false;
                await fetchPressData(data.sn);
            }
        } catch (error) {
            uploadError.textContent = `Error: ${error.message}`;
        } finally {
            loader.style.display = 'none';
        }
    }

    function displayPressSelection(summary) {
        pressTableBody.innerHTML = '';
        summary.forEach(press => {
            const row = document.createElement('tr');
            row.dataset.sn = press.sn;
            row.innerHTML = `
                <td>${press.sn}</td> <td>${press.cycles}</td>
                <td>${press.scalingHealth}</td> <td>${press.scalingHealthPercent}%</td>
                <td>${press.gapHealth}</td> <td>${press.gapHealthPercent}%</td>
                <td>${press.overallHealth}</td> <td>${press.overallHealthPercent}%</td>`;
            row.style.borderLeft = `5px solid var(--health-${press.color}, #ccc)`;
            pressTableBody.appendChild(row);
        });
        showView('pressSelection');
    }

    async function fetchPressData(sn) {
        loader.style.display = 'block';
        showView('initial');
        try {
            const response = await fetch('/get_press_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: state.filename, sn: sn })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);

            state.pressData = data;
            setupMainViewUI(sn);
            showView('mainApp');
        } catch (error) {
            uploadError.textContent = `Error: ${error.message}`;
            showView('initial');
        } finally {
            loader.style.display = 'none';
        }
    }

    function setupMainViewUI(sn) {
        const { startTimes, overallHealth } = state.pressData;
        startTimeDropdown.innerHTML = '';
        const healthEmojiMap = { green: '🟢', gold: '🟡', orange: '🟠', red: '🔴', grey: '⚪️' };
        
        startTimes.forEach(st => {
            const option = document.createElement('option');
            option.value = st.short_time;
            const emoji = healthEmojiMap[st.health_color] || '⚪️';
            option.textContent = `${emoji} ${st.short_time} (${st.health_status} - ${st.percent}%)`;
            startTimeDropdown.appendChild(option);
        });

        setHealthLabel(overallHealthLabel, `Overall Health: ${overallHealth}`, overallHealth.toLowerCase());
        mainInfoLabel.textContent = `Displaying Data for Press SN: ${sn}.`;
        document.getElementById('backToPressesBtn').style.display = state.isMultiPress ? 'inline-block' : 'none';
        
        // Trigger update for the first session
        updateDisplay();
    }

    async function updateDisplay() {
        const selectedTime = startTimeDropdown.value;
        if (!selectedTime || !state.pressData) {
            plotsContainer.innerHTML = '';
            errorStatsContainer.style.display = 'none';
            return;
        }

        plotsContainer.innerHTML = `<div class="loader"></div>`;
        errorStatsContainer.style.display = 'none';

        const sessionData = state.pressData.sessions[selectedTime];
        state.currentSessionData = sessionData; // Save current session data
        const sessionInfo = sessionData[0] || {};
        blanketIdLabel.textContent = `Blanket Cycles: ${Math.max(...sessionData.map(r => r.blanketid))}`;

        try {
            const response = await fetch('/process_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionData: sessionData,
                    removeOutliers: outliersCheckbox.checked,
                    outlierLevel: outliersLevel.value
                })
            });
            const data = await response.json();
            const processedData = data.plotData;
            const blanketIds = processedData.map(r => r.blanketid);

            plotsContainer.innerHTML = `
                <div class="plot-frame">
                    <div class="plot-graphs-area">
                        <div class="plot-wrapper">
                            <div id="plotScaling" class="plot-graph"></div>
                            <div class="std-dev-label">STD error µm/m: ${data.scalingStdDev}</div>
                        </div>
                        <div class="plot-wrapper">
                            <div id="plotGap" class="plot-graph"></div>
                            <div class="std-dev-label">STD error µm: ${data.gapStdDev}</div>
                        </div>
                    </div>
                </div>`;
            
            const layout = { margin: { t: 40, b: 40, l: 60, r: 60 }, xaxis: { title: 'Blanket ID' } };
            const scalingTrace = { x: blanketIds, y: processedData.map(r => r.imagescalingerrorupm), name: 'Scaling Error', line: { color: '#D2B48C' } };
            const scalingLayout = { ...layout, title: 'Scaling Error Graph', yaxis: { title: 'Scaling Error (µm/m)' } };
            
            const plotDataScaling = [scalingTrace];
            if (trendsCheckbox.checked) {
                const trendTrace = { x: blanketIds, y: processedData.map(r => r.imagescalingusedupm + 14000), name: 'Normalized Trend', line: { color: '#8F9779', dash: 'dot'}, yaxis: 'y2' };
                plotDataScaling.push(trendTrace);
                scalingLayout.yaxis2 = { title: 'Normalized scaling µm/meter', overlaying: 'y', side: 'right' };
            }
            Plotly.newPlot('plotScaling', plotDataScaling, scalingLayout, {responsive: true});

            const gapTrace = { x: blanketIds, y: processedData.map(r => r.gaperrorfinalum), name: 'Gap Error', line: { color: '#A0522D' } };
            const gapLayout = { ...layout, title: 'Gap Error Graph', yaxis: { title: 'Gap Error (µm)' } };
            Plotly.newPlot('plotGap', [gapTrace], gapLayout, {responsive: true});

        } catch (error) {
            plotsContainer.innerHTML = `<div class="error-message">Failed to render plots: ${error.message}</div>`;
        }
    }
    
    async function updateErrorStats() {
        if (!state.currentSessionData) return;
        errorStatsContainer.innerHTML = `<div class="loader"></div>`;
        errorStatsContainer.style.display = 'block';

        try {
            const response = await fetch('/api/error_stats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionData: state.currentSessionData })
            });
            const data = await response.json();
            
            errorStatsContainer.innerHTML = `
                <div class="plot-frame">
                    <h3 class="plot-title">Error Statistics</h3>
                    <div class="plot-graphs-area">
                        <div class="plot-wrapper"><div id="scalingStatusPlot" class="plot-graph"></div></div>
                        <div class="plot-wrapper"><div id="gapStatusPlot" class="plot-graph"></div></div>
                    </div>
                    <div class="legend-box" id="legendBox"></div>
                </div>`;

            renderBarPlot('scalingStatusPlot', 'Scaling Status', data.scalingStats);
            renderBarPlot('gapStatusPlot', 'Gap Status', data.gapStats);

        } catch (error) {
            errorStatsContainer.innerHTML = `<div class="error-message">Failed to render error stats: ${error.message}</div>`;
        }
    }
    
    function renderBarPlot(divId, title, stats) {
        const succeeded = { 'Succeeded': stats['Succeeded'] || 0 };
        delete stats['Succeeded'];
        const others = stats;

        const legend = {};
        const otherLabels = Object.keys(others).map((key, i) => {
            const numLabel = `[${i+1}]`;
            legend[numLabel] = key;
            return numLabel;
        });

        const trace1 = { x: ['Succeeded'], y: [succeeded['Succeeded']], type: 'bar', name: 'Succeeded', marker: { color: 'var(--health-green)' } };
        const trace2 = { x: otherLabels, y: Object.values(others), type: 'bar', name: 'Others', marker: { color: 'var(--primary-color)' }, yaxis: 'y2' };

        const layout = {
            title: title,
            margin: { t: 40, b: 40, l: 60, r: 60 },
            xaxis: { automargin: true },
            yaxis: { title: 'Succeeded Count', type: 'log', automargin: true },
            yaxis2: { title: 'Other Statuses Count', overlaying: 'y', side: 'right', automargin: true, showgrid: false },
            showlegend: false
        };
        Plotly.newPlot(divId, [trace1, trace2], layout, {responsive: true});

        const legendBox = document.getElementById('legendBox');
        let legendHTML = `<h4>${title} Legend</h4>`;
        if (Object.keys(legend).length === 0) {
            legendHTML += 'No other statuses to report.';
        } else {
            for(const [key, value] of Object.entries(legend)) {
                legendHTML += `<div><strong>${key}:</strong> ${value}</div>`;
            }
        }
        
        const legendDiv = document.createElement('div');
        legendDiv.id = `legend-${divId}`;
        const oldLegend = document.getElementById(legendDiv.id);
        if(oldLegend) oldLegend.remove();
        
        legendDiv.innerHTML = legendHTML;
        legendBox.appendChild(legendDiv);
    }
});
