/* ═══════════════════════════════════════════════════════════════════
   UniCurriculum — App Logic (Dashboard, Comparison, Chatbot)
   ═══════════════════════════════════════════════════════════════════ */

const API = '';
let universities = [];
let activeMetric = null;
let chartInstances = {};

// ── Section Navigation ──
function switchSection(section) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${section}`).classList.add('active');
    document.querySelector(`.nav-btn[data-section="${section}"]`).classList.add('active');
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════

async function loadDashboard() {
    try {
        const res = await fetch(`${API}/api/dashboard/stats`);
        const stats = await res.json();
        document.getElementById('st-uni').textContent = stats.university_count;
        document.getElementById('st-course').textContent = stats.course_count;
        document.getElementById('st-ects').textContent = stats.total_ects;
        document.getElementById('st-avg').textContent = stats.avg_ects;
        document.getElementById('st-po').textContent = stats.program_outcome_count;
        document.getElementById('st-lo').textContent = stats.learning_outcome_count;
    } catch (e) { console.error('Dashboard stats error:', e); }
}

async function loadKGStats() {
    try {
        const res = await fetch(`${API}/api/dashboard/kg-stats`);
        const data = await res.json();
        document.getElementById('st-nodes').textContent = data.total_nodes;
        document.getElementById('st-rels').textContent = data.total_relationships;
        document.getElementById('st-labels').textContent = data.node_labels.length;
        document.getElementById('st-reltypes').textContent = data.relationship_types.length;
    } catch (e) { console.error('KG stats error:', e); }
}

const CHART_COLORS = ['#6366f1', '#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#fb923c', '#e879f9'];
const RADAR_COLORS = [
    { bg: 'rgba(99,102,241,0.2)', border: '#6366f1' },
    { bg: 'rgba(34,211,238,0.2)', border: '#22d3ee' },
    { bg: 'rgba(167,139,250,0.2)', border: '#a78bfa' },
    { bg: 'rgba(52,211,153,0.2)', border: '#34d399' },
    { bg: 'rgba(251,191,36,0.2)', border: '#fbbf24' },
];

function destroyChart(id) {
    if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

// ── Heatmap ──
async function loadHeatmap() {
    try {
        const res = await fetch(`${API}/api/dashboard/heatmap`);
        const data = await res.json();
        const wrap = document.getElementById('heatmapWrap');
        const unis = data.universities.map(u => u.replace(' Üniversitesi', '').replace(' Ekonomi ve Teknoloji', ' ETÜ'));
        let html = '<table class="heatmap-table"><tr><th></th>';
        unis.forEach(u => html += `<th>${u}</th>`);
        html += '</tr>';
        data.matrix.forEach((row, i) => {
            html += `<tr><th>${unis[i]}</th>`;
            row.forEach((val, j) => {
                const color = i === j ? 'rgba(99,102,241,0.3)' : heatColor(val);
                html += `<td class="heatmap-cell" style="background:${color};color:#fff">${val}%</td>`;
            });
            html += '</tr>';
        });
        html += '</table>';
        wrap.innerHTML = html;
    } catch (e) { console.error('Heatmap error:', e); }
}

function heatColor(val) {
    if (val >= 80) return 'rgba(52,211,153,0.6)';
    if (val >= 65) return 'rgba(34,211,238,0.5)';
    if (val >= 50) return 'rgba(99,102,241,0.5)';
    if (val >= 35) return 'rgba(251,191,36,0.45)';
    return 'rgba(248,113,113,0.4)';
}

// ── Radar Chart ──
async function loadRadar() {
    try {
        const res = await fetch(`${API}/api/dashboard/radar`);
        const data = await res.json();
        destroyChart('chartRadar');
        const datasets = data.datasets.map((ds, i) => ({
            label: ds.name.replace(' Üniversitesi', '').replace(' Ekonomi ve Teknoloji', ' ETÜ'),
            data: ds.values,
            backgroundColor: RADAR_COLORS[i % RADAR_COLORS.length].bg,
            borderColor: RADAR_COLORS[i % RADAR_COLORS.length].border,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: RADAR_COLORS[i % RADAR_COLORS.length].border,
        }));
        chartInstances.chartRadar = new Chart(document.getElementById('chartRadar'), {
            type: 'radar',
            data: { labels: data.labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    r: {
                        beginAtZero: true, max: 100,
                        ticks: { color: '#94a3b8', backdropColor: 'transparent', font: { size: 9 } },
                        grid: { color: 'rgba(30,41,59,0.5)' },
                        pointLabels: { color: '#94a3b8', font: { size: 10 } },
                    }
                },
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, padding: 12 } } }
            }
        });
    } catch (e) { console.error('Radar error:', e); }
}

// ── University Charts ──
async function loadCharts(uniName) {
    try {
        const res = await fetch(`${API}/api/dashboard/charts/${encodeURIComponent(uniName)}`);
        const data = await res.json();

        // 1. Type Distribution (Doughnut)
        destroyChart('chartType');
        chartInstances.chartType = new Chart(document.getElementById('chartType'), {
            type: 'doughnut',
            data: {
                labels: data.type_distribution.map(d => d.label),
                datasets: [{ data: data.type_distribution.map(d => d.value), backgroundColor: CHART_COLORS, borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } } } }
        });

        // 2. Semester ECTS (Bar)
        destroyChart('chartSemester');
        chartInstances.chartSemester = new Chart(document.getElementById('chartSemester'), {
            type: 'bar',
            data: {
                labels: data.semester_distribution.map(d => d.label),
                datasets: [{
                    label: 'Toplam AKTS', data: data.semester_distribution.map(d => d.ects),
                    backgroundColor: 'rgba(99,102,241,0.6)', borderColor: '#6366f1', borderWidth: 1, borderRadius: 6
                }, {
                    label: 'Ders Sayısı', data: data.semester_distribution.map(d => d.count),
                    backgroundColor: 'rgba(34,211,238,0.5)', borderColor: '#22d3ee', borderWidth: 1, borderRadius: 6
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(30,41,59,0.5)' } } }, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } } }
        });

        // 3. Language (Pie)
        destroyChart('chartLang');
        chartInstances.chartLang = new Chart(document.getElementById('chartLang'), {
            type: 'pie',
            data: {
                labels: data.language_distribution.map(d => d.label),
                datasets: [{ data: data.language_distribution.map(d => d.value), backgroundColor: CHART_COLORS.slice(2), borderWidth: 0 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 } } } } }
        });

        // 4. ECTS Histogram (Bar)
        destroyChart('chartEcts');
        chartInstances.chartEcts = new Chart(document.getElementById('chartEcts'), {
            type: 'bar',
            data: {
                labels: data.ects_histogram.map(d => `${d.ects} AKTS`),
                datasets: [{ label: 'Ders Sayısı', data: data.ects_histogram.map(d => d.count), backgroundColor: 'rgba(167,139,250,0.6)', borderColor: '#a78bfa', borderWidth: 1, borderRadius: 6 }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(30,41,59,0.5)' } } }, plugins: { legend: { display: false } } }
        });
    } catch (e) { console.error('Charts error:', e); }
}

// ══════════════════════════════════════════════════════════════════
// CHATBOT
// ══════════════════════════════════════════════════════════════════

function sendSuggestion(btn) {
    document.getElementById('chatInput').value = btn.textContent;
    sendChat();
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    const container = document.getElementById('chatMessages');
    container.innerHTML += `<div class="chat-msg user"><div class="msg-avatar">👤</div><div class="msg-bubble">${escapeHtml(msg)}</div></div>`;

    const typingId = 'typing-' + Date.now();
    container.innerHTML += `<div class="chat-msg bot" id="${typingId}"><div class="msg-avatar">🤖</div><div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div></div>`;
    container.scrollTop = container.scrollHeight;

    document.getElementById('chatSuggestions').style.display = 'none';
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = true;

    try {
        const res = await fetch(`${API}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        document.getElementById(typingId)?.remove();
        const formatted = formatBotMessage(data.answer);
        container.innerHTML += `<div class="chat-msg bot"><div class="msg-avatar">🤖</div><div class="msg-bubble">${formatted}</div></div>`;
    } catch (e) {
        document.getElementById(typingId)?.remove();
        container.innerHTML += `<div class="chat-msg bot"><div class="msg-avatar">🤖</div><div class="msg-bubble">Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.</div></div>`;
    }

    sendBtn.disabled = false;
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function formatBotMessage(text) {
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/((?:^|<br>)[-•] .+(?:<br>[-•] .+)*)/g, (match) => {
        const items = match.split('<br>').filter(s => s.trim()).map(s => `<li>${s.replace(/^[-•]\s*/, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
    });
    return html;
}

// ══════════════════════════════════════════════════════════════════
// COMPARISON
// ══════════════════════════════════════════════════════════════════

const METRICS = [
    { id: 'composite', label: '🏆 Genel Skor', endpoint: '/api/compare/composite' },
    { id: 'courses', label: '📊 Ders Benzerliği', endpoint: '/api/compare/courses' },
    { id: 'staff', label: '👥 Akademik Kadro', endpoint: '/api/compare/staff' },
    { id: 'workload', label: '⚖️ İş Yükü', endpoint: '/api/compare/workload' },
    { id: 'program-outcomes', label: '🎯 Program Çıktıları', endpoint: '/api/compare/program-outcomes' },
    { id: 'learning-outcomes', label: '📝 Öğrenim Çıktıları', endpoint: '/api/compare/learning-outcomes' },
    { id: 'curriculum-coverage', label: '📚 Müfredat Kapsamı', endpoint: '/api/compare/curriculum-coverage' },
    { id: 'prerequisites', label: '🔗 Önkoşullar', endpoint: '/api/compare/prerequisites' },
    { id: 'semester-distribution', label: '📅 Dönem Dağılımı', endpoint: '/api/compare/semester-distribution' },
    { id: 'mandatory-elective', label: '📋 Zorunlu/Seçmeli', endpoint: '/api/compare/mandatory-elective' },
    { id: 'language-distribution', label: '🌐 Eğitim Dili', endpoint: '/api/compare/language-distribution' },
    { id: 'resources', label: '📖 Kaynak Örtüşmesi', endpoint: '/api/compare/resources' },
];

function populateDropdowns() {
    ['uni1', 'uni2'].forEach(id => {
        const s = document.getElementById(id);
        s.innerHTML = '<option value="">Üniversite seçin</option>';
        universities.forEach(u => { s.innerHTML += `<option value="${u.name}">${u.name}</option>`; });
        s.disabled = false;
        s.addEventListener('change', onSelectionChange);
    });
    const cs = document.getElementById('chartUni');
    cs.innerHTML = '<option value="">Üniversite seçin</option>';
    universities.forEach(u => { cs.innerHTML += `<option value="${u.name}">${u.name}</option>`; });
    cs.disabled = false;
    cs.addEventListener('change', () => { if (cs.value) loadCharts(cs.value); });
}

function onSelectionChange() {
    const s1 = document.getElementById('uni1'), s2 = document.getElementById('uni2');
    const v1 = s1.value, v2 = s2.value;
    Array.from(s2.options).forEach(o => { o.disabled = o.value !== '' && o.value === v1; });
    Array.from(s1.options).forEach(o => { o.disabled = o.value !== '' && o.value === v2; });
    if (v1 && v2 && v1 === v2) { s2.value = ''; showError('Aynı üniversiteyi iki tarafta da seçemezsiniz.'); return; }
    clearError(); updateTabState();
    if (v1 && v2 && activeMetric) loadMetric(activeMetric);
}

function buildTabs() {
    const container = document.getElementById('tabs');
    METRICS.forEach(m => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn'; btn.textContent = m.label; btn.dataset.id = m.id; btn.disabled = true;
        btn.addEventListener('click', () => {
            if (!getSelection().valid) return;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active'); activeMetric = m.id; loadMetric(m.id);
        });
        container.appendChild(btn);
    });
}

function updateTabState() {
    const valid = getSelection().valid;
    document.querySelectorAll('.tab-btn').forEach(b => { b.disabled = !valid; });
}

function getSelection() {
    const v1 = document.getElementById('uni1').value, v2 = document.getElementById('uni2').value;
    return { uni1: v1, uni2: v2, valid: v1 && v2 && v1 !== v2 };
}

function showError(msg) { const el = document.getElementById('errorMsg'); el.textContent = msg; el.classList.add('show'); }
function clearError() { document.getElementById('errorMsg').classList.remove('show'); }

async function loadMetric(id) {
    const { uni1, uni2 } = getSelection();
    const metric = METRICS.find(m => m.id === id);
    const container = document.getElementById('results');
    container.innerHTML = `<div class="loading"><div class="spinner"></div><p>Yükleniyor...</p></div>`;

    // Show export bar
    document.getElementById('exportBar').style.display = 'block';

    try {
        let url, data;
        if (id === 'learning-outcomes') {
            // Special handling — needs course codes, show course selector
            container.innerHTML = renderers['learning-outcomes'](null, uni1, uni2);
            return;
        }
        const params = new URLSearchParams({ uni1, uni2 });
        if (['courses', 'program-outcomes', 'curriculum-coverage'].includes(id)) params.set('top_n', '15');
        const res = await fetch(`${API}${metric.endpoint}?${params}`);
        data = await res.json();
        container.innerHTML = '';
        const card = document.createElement('div');
        card.className = 'result-card';
        card.innerHTML = renderers[id](data, uni1, uni2);
        container.appendChild(card);

        // Post-render charts for metrics
        if (id === 'staff') renderStaffChart(data);
        if (id === 'workload') renderWorkloadChart(data);
        if (id === 'mandatory-elective') renderMandatoryElectiveChart(data);
        if (id === 'language-distribution') renderLanguageChart(data);
        if (id === 'semester-distribution') renderSemesterChart(data);
        if (id === 'composite') renderCompositeRing(data);
    } catch (e) { container.innerHTML = `<div class="placeholder-msg">Veri yüklenirken hata oluştu.</div>`; }
}

// ── Helpers ──
function simColor(p) { return p >= 80 ? 'var(--green)' : p >= 50 ? 'var(--yellow)' : 'var(--red)'; }
function simBar(p) {
    return `<div class="sim-bar-wrap"><div class="sim-bar"><div class="sim-bar-fill" style="width:${p}%;background:${simColor(p)}"></div></div><span class="sim-pct" style="color:${simColor(p)}">${p}%</span></div>`;
}
function diffSpan(v, s = '') { return v > 0 ? `<span class="diff-pos">+${v}${s}</span>` : v < 0 ? `<span class="diff-neg">${v}${s}</span>` : `<span class="diff-zero">0${s}</span>`; }
function sn(n) { return n.replace(' Üniversitesi', '').replace(' Ekonomi ve Teknoloji', ' ETÜ'); }

// ══════════════════════════════════════════════════════════════════
// METRIC CHART RENDERERS (in-metric charts)
// ══════════════════════════════════════════════════════════════════

function renderStaffChart(d) {
    const s1 = d.university1?.staff || {}, s2 = d.university2?.staff || {};
    const labels = ['Profesör', 'Doçent', 'Dr. Öğr. Üyesi', 'Öğr. Gör.', 'Arş. Gör.'];
    const keys = ['professor', 'associate_professor', 'assistant_professor', 'lecturer', 'research_assistant'];
    destroyChart('metricChart');
    const canvas = document.getElementById('metricChart');
    if (!canvas) return;
    chartInstances.metricChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: sn(d.university1.name), data: keys.map(k => s1[k] || 0), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 6 },
                { label: sn(d.university2.name), data: keys.map(k => s2[k] || 0), backgroundColor: 'rgba(34,211,238,0.7)', borderRadius: 6 },
            ]
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(30,41,59,0.5)' } }, y: { ticks: { color: '#94a3b8' }, grid: { display: false } } }, plugins: { legend: { labels: { color: '#94a3b8' } } } }
    });
}

function renderWorkloadChart(d) {
    const w1 = d.university1, w2 = d.university2;
    destroyChart('metricChart');
    const canvas = document.getElementById('metricChart');
    if (!canvas) return;
    chartInstances.metricChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: ['Ort. AKTS', 'Ort. Teori', 'Ort. Uygulama'],
            datasets: [
                { label: sn(w1.name), data: [w1.avg_ects, w1.avg_theory_hours, w1.avg_practice_hours], backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 6 },
                { label: sn(w2.name), data: [w2.avg_ects, w2.avg_theory_hours, w2.avg_practice_hours], backgroundColor: 'rgba(34,211,238,0.7)', borderRadius: 6 },
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(30,41,59,0.5)' } } }, plugins: { legend: { labels: { color: '#94a3b8' } } } }
    });
}

function renderMandatoryElectiveChart(d) {
    const m1 = d.university1, m2 = d.university2;
    destroyChart('metricChart');
    const canvas = document.getElementById('metricChart');
    if (!canvas) return;
    chartInstances.metricChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: [sn(m1.name), sn(m2.name)],
            datasets: [
                { label: 'Zorunlu', data: [m1.mandatory, m2.mandatory], backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 6 },
                { label: 'Seçmeli', data: [m1.elective, m2.elective], backgroundColor: 'rgba(34,211,238,0.7)', borderRadius: 6 },
                { label: 'Diğer', data: [m1.other, m2.other], backgroundColor: 'rgba(167,139,250,0.5)', borderRadius: 6 },
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(30,41,59,0.5)' } } }, plugins: { legend: { labels: { color: '#94a3b8' } } } }
    });
}

function renderLanguageChart(d) {
    const l1 = d.university1, l2 = d.university2;
    destroyChart('metricChart');
    const canvas = document.getElementById('metricChart');
    if (!canvas) return;
    const allLangs = new Set();
    (l1.languages || []).forEach(l => allLangs.add(l.language));
    (l2.languages || []).forEach(l => allLangs.add(l.language));
    const labels = [...allLangs];
    chartInstances.metricChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: [sn(l1.name), sn(l2.name)],
            datasets: labels.map((lang, i) => ({
                label: lang,
                data: [
                    (l1.languages || []).find(l => l.language === lang)?.count || 0,
                    (l2.languages || []).find(l => l.language === lang)?.count || 0,
                ],
                backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + 'b3',
                borderRadius: 6,
            }))
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(30,41,59,0.5)' } } }, plugins: { legend: { labels: { color: '#94a3b8' } } } }
    });
}

function renderSemesterChart(d) {
    const d1 = d.university1.distribution || [], d2 = d.university2.distribution || [];
    destroyChart('metricChart');
    const canvas = document.getElementById('metricChart');
    if (!canvas) return;
    const keys = new Set();
    d1.forEach(x => keys.add(`${x.year}-${x.semester}`));
    d2.forEach(x => keys.add(`${x.year}-${x.semester}`));
    const sortedKeys = [...keys].sort();
    const labels = sortedKeys.map(k => { const [yr, sem] = k.split('-'); return `${yr}/${sem}`; });
    chartInstances.metricChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: sn(d.university1.name) + ' AKTS', data: sortedKeys.map(k => { const [yr, sem] = k.split('-').map(Number); return (d1.find(x => x.year === yr && x.semester === sem) || {}).total_ects || 0; }), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 6 },
                { label: sn(d.university2.name) + ' AKTS', data: sortedKeys.map(k => { const [yr, sem] = k.split('-').map(Number); return (d2.find(x => x.year === yr && x.semester === sem) || {}).total_ects || 0; }), backgroundColor: 'rgba(34,211,238,0.7)', borderRadius: 6 },
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { color: '#94a3b8' }, grid: { display: false } }, y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(30,41,59,0.5)' } } }, plugins: { legend: { labels: { color: '#94a3b8' } } } }
    });
}

function renderCompositeRing(d) {
    destroyChart('compositeRing');
    const canvas = document.getElementById('compositeRing');
    if (!canvas) return;
    const score = d.composite_score;
    chartInstances.compositeRing = new Chart(canvas, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [score, 100 - score],
                backgroundColor: [
                    score >= 70 ? '#34d399' : score >= 40 ? '#fbbf24' : '#f87171',
                    'rgba(30,41,59,0.5)'
                ],
                borderWidth: 0,
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '78%', plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });
}

// ══════════════════════════════════════════════════════════════════
// METRIC RENDERERS
// ══════════════════════════════════════════════════════════════════

const renderers = {
    composite(d) {
        const items = Object.values(d.breakdown).map(b => {
            const col = b.value >= 70 ? 'var(--green)' : b.value >= 40 ? 'var(--yellow)' : 'var(--red)';
            return `<div class="breakdown-item">
                <div class="breakdown-label">${b.label}</div>
                <div class="breakdown-bar"><div class="breakdown-fill" style="width:${b.value}%;background:${col}"></div></div>
                <div class="breakdown-val" style="color:${col}">${b.value}%</div>
                <div class="breakdown-weight">×${b.weight}%</div>
            </div>`;
        }).join('');
        return `<h2><span class="icon">🏆</span>Genel Uyumluluk Skoru</h2>
            <div class="composite-ring"><canvas id="compositeRing"></canvas><div class="composite-score-text">${d.composite_score}%</div></div>
            <p style="text-align:center;color:var(--text-muted);margin-bottom:24px;font-size:0.85rem">${sn(d.university1)} vs ${sn(d.university2)}</p>
            <div class="section-title">Metrik Kırılımı</div>
            <div class="breakdown-bars">${items}</div>`;
    },

    courses(d) {
        const rows = (d.similar_courses || []).map((p, i) => `<tr><td>${i + 1}</td><td><strong>${p.course1_code}</strong> ${p.course1_name}</td><td><strong>${p.course2_code}</strong> ${p.course2_name}</td><td>${simBar(p.similarity_pct)}</td></tr>`).join('');
        return `<h2><span class="icon">📊</span>Ders Benzerliği (İçerik)</h2><table class="data-table"><tr><th>#</th><th>${sn(d.university1)}</th><th>${sn(d.university2)}</th><th>Benzerlik</th></tr>${rows}</table>`;
    },

    staff(d) {
        const roles = { professor: 'Profesör', associate_professor: 'Doçent', assistant_professor: 'Dr. Öğr. Üyesi', lecturer: 'Öğr. Görevlisi', research_assistant: 'Arş. Görevlisi', total: 'Toplam' };
        const s1 = d.university1?.staff || {}, s2 = d.university2?.staff || {};
        const rows = Object.entries(roles).map(([k, v]) => `<tr><td>${v}</td><td>${s1[k] || 0}</td><td>${s2[k] || 0}</td><td>${diffSpan((s1[k] || 0) - (s2[k] || 0))}</td></tr>`).join('');
        return `<h2><span class="icon">👥</span>Akademik Kadro</h2><table class="data-table"><tr><th>Unvan</th><th>${sn(d.university1.name)}</th><th>${sn(d.university2.name)}</th><th>Fark</th></tr>${rows}</table><div class="metric-chart-wrap"><canvas id="metricChart"></canvas></div>`;
    },

    workload(d) {
        const w1 = d.university1, w2 = d.university2;
        const m = [['Toplam Ders', w1.course_count, w2.course_count], ['Toplam AKTS', w1.total_ects, w2.total_ects], ['Ort. AKTS', w1.avg_ects, w2.avg_ects], ['Ort. Teori Saat', w1.avg_theory_hours, w2.avg_theory_hours], ['Ort. Uygulama Saat', w1.avg_practice_hours, w2.avg_practice_hours], ['Teori/Uygulama', w1.theory_practice_ratio, w2.theory_practice_ratio]];
        const rows = m.map(([l, v1, v2]) => `<tr><td>${l}</td><td>${v1}</td><td>${v2}</td><td>${diffSpan(Math.round((v1 - v2) * 100) / 100)}</td></tr>`).join('');
        return `<h2><span class="icon">⚖️</span>İş Yükü</h2><table class="data-table"><tr><th>Metrik</th><th>${sn(w1.name)}</th><th>${sn(w2.name)}</th><th>Fark</th></tr>${rows}</table><div class="metric-chart-wrap"><canvas id="metricChart"></canvas></div>`;
    },

    'program-outcomes'(d) {
        const rows = (d.top_matches || []).map(m => `<tr><td style="max-width:300px">${m.outcome1_text}</td><td style="max-width:300px">${m.outcome2_text}</td><td>${simBar(m.similarity_pct)}</td></tr>`).join('');
        return `<h2><span class="icon">🎯</span>Program Çıktısı Benzerliği</h2><div class="stat-grid"><div class="stat-box"><div class="value">${d.overall_similarity_pct}%</div><div class="label">Genel Benzerlik</div></div><div class="stat-box"><div class="value">${d.outcome_count1}</div><div class="label">${sn(d.university1)} Çıktısı</div></div><div class="stat-box"><div class="value">${d.outcome_count2}</div><div class="label">${sn(d.university2)} Çıktısı</div></div></div><table class="data-table"><tr><th>${sn(d.university1)}</th><th>${sn(d.university2)}</th><th>Benzerlik</th></tr>${rows}</table>`;
    },

    'learning-outcomes'(d, uni1, uni2) {
        if (!d) {
            // Show course selector UI
            const courses1 = window._coursesCache?.[uni1] || [];
            const courses2 = window._coursesCache?.[uni2] || [];
            const opts1 = courses1.map(c => `<option value="${c.code}">${c.code} - ${c.name}</option>`).join('');
            const opts2 = courses2.map(c => `<option value="${c.code}">${c.code} - ${c.name}</option>`).join('');
            return `<div class="result-card"><h2><span class="icon">📝</span>Öğrenim Çıktısı Karşılaştırma</h2>
                <p style="color:var(--text-muted);margin-bottom:16px">İki ders seçerek öğrenim çıktılarını karşılaştırın:</p>
                <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
                    <div class="select-wrap" style="flex:1;min-width:200px"><label>${sn(uni1)} Dersi</label><select id="loCode1">${opts1 || '<option>Ders yok</option>'}</select></div>
                    <div class="select-wrap" style="flex:1;min-width:200px"><label>${sn(uni2)} Dersi</label><select id="loCode2">${opts2 || '<option>Ders yok</option>'}</select></div>
                    <button class="tab-btn" style="align-self:flex-end;opacity:1" onclick="loadLearningOutcomes()">Karşılaştır</button>
                </div>
                <div id="loResults"><div class="placeholder-msg">Ders seçip karşılaştır butonuna tıklayın.</div></div>
            </div>`;
        }
        // Render results
        const rows = (d.matches || []).map(m => `<tr><td style="max-width:300px">${m.lo1_text}</td><td style="max-width:300px">${m.lo2_text}</td><td>${simBar(m.similarity_pct)}</td></tr>`).join('');
        return `<h2><span class="icon">📝</span>Öğrenim Çıktısı Benzerliği</h2>
            <div class="stat-grid"><div class="stat-box"><div class="value">${d.overall_similarity_pct}%</div><div class="label">Genel Benzerlik</div></div><div class="stat-box"><div class="value">${d.course1?.outcome_count || 0}</div><div class="label">${d.course1?.code} Çıktısı</div></div><div class="stat-box"><div class="value">${d.course2?.outcome_count || 0}</div><div class="label">${d.course2?.code} Çıktısı</div></div></div>
            <table class="data-table"><tr><th>${d.course1?.code}</th><th>${d.course2?.code}</th><th>Benzerlik</th></tr>${rows}</table>`;
    },

    'curriculum-coverage'(d) {
        const sr = (d.top_similar || []).map(p => `<tr><td><strong>${p.course1_code}</strong> ${p.course1_name}</td><td><strong>${p.course2_code}</strong> ${p.course2_name}</td><td>${simBar(p.similarity_pct)}</td></tr>`).join('');
        const u1 = (d.unique_to_uni1 || []).map(c => `<tr><td>${c.code}</td><td>${c.name}</td><td>${c.best_match_similarity_pct}%</td></tr>`).join('');
        const u2 = (d.unique_to_uni2 || []).map(c => `<tr><td>${c.code}</td><td>${c.name}</td><td>${c.best_match_similarity_pct}%</td></tr>`).join('');
        return `<h2><span class="icon">📚</span>Müfredat Kapsama Analizi</h2><div class="stat-grid"><div class="stat-box"><div class="value">${d.matched_courses || 0}</div><div class="label">Eşleşen</div></div><div class="stat-box"><div class="value">${d.unique_to_uni1_count || 0}</div><div class="label">${sn(d.university1)}'e Özgü</div></div><div class="stat-box"><div class="value">${d.unique_to_uni2_count || 0}</div><div class="label">${sn(d.university2)}'e Özgü</div></div></div><div class="section-title">Benzer Dersler</div><table class="data-table"><tr><th>${sn(d.university1)}</th><th>${sn(d.university2)}</th><th>Benzerlik</th></tr>${sr || '<tr><td colspan="3">Eşleşen ders yok.</td></tr>'}</table>${u1 ? `<div class="section-title">${sn(d.university1)}'e Özgü</div><table class="data-table"><tr><th>Kod</th><th>Ders</th><th>En Yakın</th></tr>${u1}</table>` : ''}${u2 ? `<div class="section-title">${sn(d.university2)}'e Özgü</div><table class="data-table"><tr><th>Kod</th><th>Ders</th><th>En Yakın</th></tr>${u2}</table>` : ''}`;
    },

    prerequisites(d) {
        const p1 = d.university1, p2 = d.university2;
        const m = [['Toplam Ders', p1.total_courses, p2.total_courses], ['Önkoşullu', p1.courses_with_prerequisites, p2.courses_with_prerequisites], ['Önkoşulsuz', p1.courses_without_prerequisites, p2.courses_without_prerequisites], ['Toplam Bağ', p1.total_prerequisite_links, p2.total_prerequisite_links], ['Maks. Derinlik', p1.max_chain_depth, p2.max_chain_depth], ['Ort. Derinlik', p1.avg_chain_depth, p2.avg_chain_depth], ['Önkoşul %', p1.prerequisite_ratio_pct, p2.prerequisite_ratio_pct]];
        const rows = m.map(([l, v1, v2]) => `<tr><td>${l}</td><td>${v1}</td><td>${v2}</td><td>${diffSpan(Math.round((v1 - v2) * 100) / 100)}</td></tr>`).join('');
        return `<h2><span class="icon">🔗</span>Önkoşul Karmaşıklığı</h2><div class="stat-grid"><div class="stat-box"><div class="value">${p1.prerequisite_ratio_pct}%</div><div class="label">${sn(p1.name)}</div></div><div class="stat-box"><div class="value">${p2.prerequisite_ratio_pct}%</div><div class="label">${sn(p2.name)}</div></div><div class="stat-box"><div class="value">${p1.max_chain_depth} vs ${p2.max_chain_depth}</div><div class="label">Maks. Derinlik</div></div></div><table class="data-table"><tr><th>Metrik</th><th>${sn(p1.name)}</th><th>${sn(p2.name)}</th><th>Fark</th></tr>${rows}</table>`;
    },

    'semester-distribution'(d) {
        const d1 = d.university1.distribution || [], d2 = d.university2.distribution || [];
        const keys = new Set(); d1.forEach(x => keys.add(`${x.year}-${x.semester}`)); d2.forEach(x => keys.add(`${x.year}-${x.semester}`));
        const rows = [...keys].sort().map(k => {
            const [yr, sem] = k.split('-').map(Number); const r1 = d1.find(x => x.year === yr && x.semester === sem) || {}, r2 = d2.find(x => x.year === yr && x.semester === sem) || {};
            return `<tr><td>${yr}. Yıl / ${sem}. Dönem</td><td>${r1.courses || '-'}</td><td>${r1.total_ects || '-'}</td><td>${r1.avg_ects || '-'}</td><td>${r2.courses || '-'}</td><td>${r2.total_ects || '-'}</td><td>${r2.avg_ects || '-'}</td></tr>`;
        }).join('');
        const n1 = sn(d.university1.name), n2 = sn(d.university2.name);
        return `<h2><span class="icon">📅</span>Dönem Dağılımı</h2><table class="data-table"><tr><th rowspan="2">Dönem</th><th colspan="3" style="text-align:center">${n1}</th><th colspan="3" style="text-align:center">${n2}</th></tr><tr><th>Ders</th><th>AKTS</th><th>Ort.</th><th>Ders</th><th>AKTS</th><th>Ort.</th></tr>${rows}</table><div class="metric-chart-wrap"><canvas id="metricChart"></canvas></div>`;
    },

    'mandatory-elective'(d) {
        const m1 = d.university1, m2 = d.university2;
        return `<h2><span class="icon">📋</span>Zorunlu / Seçmeli</h2><div class="stat-grid"><div class="stat-box"><div class="value">${m1.mandatory_pct}%</div><div class="label">${sn(m1.name)} Zorunlu</div></div><div class="stat-box"><div class="value">${m1.elective_pct}%</div><div class="label">${sn(m1.name)} Seçmeli</div></div><div class="stat-box"><div class="value">${m2.mandatory_pct}%</div><div class="label">${sn(m2.name)} Zorunlu</div></div><div class="stat-box"><div class="value">${m2.elective_pct}%</div><div class="label">${sn(m2.name)} Seçmeli</div></div></div><table class="data-table"><tr><th>Metrik</th><th>${sn(m1.name)}</th><th>${sn(m2.name)}</th><th>Fark</th></tr><tr><td>Toplam</td><td>${m1.total_courses}</td><td>${m2.total_courses}</td><td>${diffSpan(m1.total_courses - m2.total_courses)}</td></tr><tr><td>Zorunlu</td><td>${m1.mandatory}</td><td>${m2.mandatory}</td><td>${diffSpan(m1.mandatory - m2.mandatory)}</td></tr><tr><td>Seçmeli</td><td>${m1.elective}</td><td>${m2.elective}</td><td>${diffSpan(m1.elective - m2.elective)}</td></tr><tr><td>Zorunlu %</td><td>${m1.mandatory_pct}%</td><td>${m2.mandatory_pct}%</td><td>${diffSpan(d.comparison.mandatory_pct_diff, '%')}</td></tr><tr><td>Seçmeli %</td><td>${m1.elective_pct}%</td><td>${m2.elective_pct}%</td><td>${diffSpan(d.comparison.elective_pct_diff, '%')}</td></tr></table><div class="metric-chart-wrap"><canvas id="metricChart"></canvas></div>`;
    },

    'language-distribution'(d) {
        const l1 = d.university1, l2 = d.university2, langs = new Set();
        (l1.languages || []).forEach(l => langs.add(l.language)); (l2.languages || []).forEach(l => langs.add(l.language));
        const rows = [...langs].map(lang => {
            const v1 = (l1.languages || []).find(l => l.language === lang), v2 = (l2.languages || []).find(l => l.language === lang);
            return `<tr><td>${lang}</td><td>${v1 ? v1.count : 0} (${v1 ? v1.percentage : 0}%)</td><td>${v2 ? v2.count : 0} (${v2 ? v2.percentage : 0}%)</td></tr>`;
        }).join('');
        const stats = [...(l1.languages || []).map(l => `<div class="stat-box"><div class="value">${l.percentage}%</div><div class="label">${sn(l1.name)} ${l.language}</div></div>`), ...(l2.languages || []).map(l => `<div class="stat-box"><div class="value">${l.percentage}%</div><div class="label">${sn(l2.name)} ${l.language}</div></div>`)].join('');
        return `<h2><span class="icon">🌐</span>Eğitim Dili</h2><div class="stat-grid">${stats}</div><table class="data-table"><tr><th>Dil</th><th>${sn(l1.name)}</th><th>${sn(l2.name)}</th></tr>${rows}</table><div class="metric-chart-wrap"><canvas id="metricChart"></canvas></div>`;
    },

    resources(d) {
        const shared = d.shared_resources || [];
        const rows = shared.map(s => `<tr><td style="max-width:250px;font-size:0.8rem">${s.resource_uni1}</td><td>${s.courses_uni1.join(', ')}</td><td style="max-width:250px;font-size:0.8rem">${s.resource_uni2}</td><td>${s.courses_uni2.join(', ')}</td><td><strong>${s.overlap_score}%</strong></td></tr>`).join('');
        return `<h2><span class="icon">📖</span>Kaynak Örtüşmesi</h2><div class="stat-grid"><div class="stat-box"><div class="value">${d.university1.unique_resources}</div><div class="label">${sn(d.university1.name)}</div></div><div class="stat-box"><div class="value">${d.university2.unique_resources}</div><div class="label">${sn(d.university2.name)}</div></div><div class="stat-box"><div class="value">${d.shared_count}</div><div class="label">Ortak</div></div></div>${shared.length ? `<table class="data-table"><tr><th>${sn(d.university1.name)}</th><th>Dersler</th><th>${sn(d.university2.name)}</th><th>Dersler</th><th>Örtüşme</th></tr>${rows}</table>` : '<p style="color:var(--text-muted);text-align:center;margin-top:20px">Ortak kaynak bulunamadı.</p>'}`;
    },
};

// ── Learning Outcomes Loader ──
async function loadLearningOutcomes() {
    const { uni1, uni2 } = getSelection();
    const code1 = document.getElementById('loCode1')?.value;
    const code2 = document.getElementById('loCode2')?.value;
    if (!code1 || !code2) return;

    const loResults = document.getElementById('loResults');
    loResults.innerHTML = `<div class="loading"><div class="spinner"></div><p>Yükleniyor...</p></div>`;

    try {
        const params = new URLSearchParams({ uni1, code1, uni2, code2 });
        const res = await fetch(`${API}/api/compare/learning-outcomes?${params}`);
        const data = await res.json();
        const rendered = renderers['learning-outcomes'](data, uni1, uni2);
        loResults.innerHTML = `<div class="result-card" style="border:none;padding:0;box-shadow:none">${rendered}</div>`;
    } catch (e) {
        loResults.innerHTML = `<div class="placeholder-msg">Veri yüklenirken hata oluştu.</div>`;
    }
}

// ── PDF Export ──
async function exportPDF() {
    const results = document.getElementById('results');
    if (!results || !results.children.length) return;

    const btn = document.querySelector('.export-btn');
    btn.textContent = '⏳ PDF oluşturuluyor...';
    btn.disabled = true;

    try {
        const canvas = await html2canvas(results, {
            backgroundColor: '#06080f',
            scale: 2,
            useCORS: true,
        });
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const imgWidth = pageWidth - 20;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // Add title
        pdf.setFontSize(14);
        pdf.setTextColor(99, 102, 241);
        const { uni1, uni2 } = getSelection();
        pdf.text(`UniCurriculum — ${sn(uni1)} vs ${sn(uni2)}`, 10, 15);
        pdf.setFontSize(8);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Oluşturulma: ${new Date().toLocaleString('tr-TR')}`, 10, 22);

        // Add content
        let y = 28;
        const pageHeight = pdf.internal.pageSize.getHeight();
        if (imgHeight + y > pageHeight) {
            // Multi-page
            let remainH = imgHeight;
            let srcY = 0;
            while (remainH > 0) {
                const sliceH = Math.min(pageHeight - y - 10, remainH);
                pdf.addImage(imgData, 'PNG', 10, y, imgWidth, imgHeight, undefined, 'FAST', 0);
                remainH -= sliceH;
                srcY += sliceH;
                if (remainH > 0) { pdf.addPage(); y = 10; }
            }
        } else {
            pdf.addImage(imgData, 'PNG', 10, y, imgWidth, imgHeight);
        }

        pdf.save(`UniCurriculum_${sn(uni1)}_vs_${sn(uni2)}.pdf`);
    } catch (e) { console.error('PDF export error:', e); }

    btn.textContent = '📄 PDF Olarak İndir';
    btn.disabled = false;
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════

window._coursesCache = {};

async function init() {
    try {
        const res = await fetch(`${API}/api/universities`);
        universities = await res.json();
        populateDropdowns();
        buildTabs();
        loadDashboard();
        loadKGStats();
        loadHeatmap();
        loadRadar();

        // Auto-load first university charts
        if (universities.length > 0) {
            document.getElementById('chartUni').value = universities[0].name;
            loadCharts(universities[0].name);
        }

        // Pre-cache courses for learning outcomes
        for (const u of universities) {
            try {
                const r = await fetch(`${API}/api/courses/${encodeURIComponent(u.name)}`);
                window._coursesCache[u.name] = await r.json();
            } catch (e) { /* ignore */ }
        }
    } catch (e) { console.error('Init error:', e); }
}

init();
