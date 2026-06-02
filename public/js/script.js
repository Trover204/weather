// ═══════════════════════════════════════════════
// API 3 – WMO weather code → icon + mô tả (VI)
// Theo chuẩn WMO 4677, giống OWM conditions
// ═══════════════════════════════════════════════
const WMO = {
    0: { icon: '☀️', desc: 'Trời quang' },
    1: { icon: '🌤', desc: 'Ít mây' },
    2: { icon: '⛅', desc: 'Có mây' },
    3: { icon: '☁️', desc: 'Âm u' },
    45: { icon: '🌫', desc: 'Sương mù' },
    48: { icon: '🌫', desc: 'Sương mù đóng băng' },
    51: { icon: '🌦', desc: 'Mưa phùn nhẹ' },
    53: { icon: '🌦', desc: 'Mưa phùn vừa' },
    55: { icon: '🌦', desc: 'Mưa phùn dày' },
    61: { icon: '🌧', desc: 'Mưa nhẹ' },
    63: { icon: '🌧', desc: 'Mưa vừa' },
    65: { icon: '🌧', desc: 'Mưa to' },
    71: { icon: '🌨', desc: 'Tuyết nhẹ' },
    73: { icon: '🌨', desc: 'Tuyết vừa' },
    75: { icon: '❄️', desc: 'Tuyết dày' },
    77: { icon: '🌨', desc: 'Hạt tuyết' },
    80: { icon: '🌦', desc: 'Mưa rào nhẹ' },
    81: { icon: '🌦', desc: 'Mưa rào vừa' },
    82: { icon: '⛈', desc: 'Mưa rào mạnh' },
    85: { icon: '🌨', desc: 'Tuyết rào nhẹ' },
    86: { icon: '🌨', desc: 'Tuyết rào mạnh' },
    95: { icon: '⛈', desc: 'Giông bão' },
    96: { icon: '⛈', desc: 'Giông có mưa đá nhẹ' },
    99: { icon: '⛈', desc: 'Giông có mưa đá to' },
};
function wmo(code) { return WMO[code] || { icon: '🌡', desc: 'Không rõ' }; }

// ═══════════════════════════════════════════════
// Màu card theo nhiệt độ
// ═══════════════════════════════════════════════
function tempClass(t) {
    if (t >= 35) return 'hot';
    if (t >= 30) return 'warm';
    if (t >= 20) return 'mild';
    return 'cool';
}

// ═══════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════
let allData = [];   // [{name, lat, lon, temp, code, time}]

// ═══════════════════════════════════════════════
// API 1 – esgoo.net: lấy danh sách tỉnh thành
// ═══════════════════════════════════════════════
async function fetchProvinces() {
    setDot('d-prov', 'wait');
    const r = await fetch('https://esgoo.net/api-tinhthanh/1/0.htm');
    if (!r.ok) throw new Error('esgoo API lỗi');
    const j = await r.json();
    if (j.error !== 0) throw new Error('esgoo trả lỗi: ' + j.error_text);
    setDot('d-prov', 'ok');
    return j.data.map(p => ({
        name: p.name,
        lat: parseFloat(p.latitude),
        lon: parseFloat(p.longitude),
    }));
}

// ═══════════════════════════════════════════════
// Retry với exponential backoff khi gặp 429
// ═══════════════════════════════════════════════
async function fetchWithRetry(url, maxRetries = 4) {
    let delay = 800;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const r = await fetch(url);
        if (r.status !== 429) return r;
        if (attempt === maxRetries) throw new Error('Rate limit sau ' + maxRetries + ' lần thứ');
        await new Promise(res => setTimeout(res, delay));
        delay *= 2; // 0.8s -> 1.6s -> 3.2s -> 6.4s
    }
}

// ═══════════════════════════════════════════════
// API 2 – Open-Meteo: multi-location batch request
// Gui tat ca lat/lon trong 1 request -> khong bi 429
// ═══════════════════════════════════════════════
async function fetchWeatherBatch(provinces) {
    setDot('d-weather', 'wait');

    // Open-Meteo cho phep truyen nhieu lat/lon cung luc (toi da ~100)
    // Chia thanh chunks 50 de an toan, moi chunk = 1 request
    const CHUNK = 50;
    const results = new Array(provinces.length);

    for (let i = 0; i < provinces.length; i += CHUNK) {
        const chunk = provinces.slice(i, i + CHUNK);
        const lats = chunk.map(p => p.lat).join(',');
        const lons = chunk.map(p => p.lon).join(',');

        const url = 'https://api.open-meteo.com/v1/forecast'
            + '?latitude=' + lats + '&longitude=' + lons
            + '&current=temperature_2m,weather_code'
            + '&timezone=Asia%2FBangkok'
            + '&forecast_days=1';

        const r = await fetchWithRetry(url);
        const json = await r.json();

        // Khi chi co 1 tinh, API tra object thay vi array
        const dataArr = Array.isArray(json) ? json : [json];

        dataArr.forEach((d, idx) => {
            const p = chunk[idx];
            results[i + idx] = {
                ...p,
                temp: d.current?.temperature_2m ?? null,
                code: d.current?.weather_code ?? 0,
                time: d.current?.time ?? '',
            };
        });
    }

    setDot('d-weather', 'ok');
    return results;
}

// ═══════════════════════════════════════════════
// MODAL – 12-hour forecast
// ═══════════════════════════════════════════════
async function fetchHourly(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast'
        + '?latitude=' + lat + '&longitude=' + lon
        + '&hourly=temperature_2m,weather_code,precipitation_probability'
        + '&timezone=Asia%2FBangkok'
        + '&forecast_days=2';
    const r = await fetchWithRetry(url);
    if (!r.ok) throw new Error('Open-Meteo loi');
    return r.json();
}

function getNext12Hours(data) {
    const times = data.hourly.time;
    const temps = data.hourly.temperature_2m;
    const codes = data.hourly.weather_code;
    const rains = data.hourly.precipitation_probability;

    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    const results = [];
    for (let i = 0; i < times.length && results.length < 12; i++) {
        const t = new Date(times[i]);
        if (t >= currentHour) {
            results.push({
                time: t,
                temp: temps[i],
                code: codes[i],
                rain: rains[i] ?? 0,
            });
        }
    }
    return results;
}

function drawChart(hours) {
    const temps = hours.map(h => h.temp);
    const minT = Math.min(...temps);
    const maxT = Math.max(...temps);
    const range = maxT - minT || 1;

    const W = 460, H = 80, PAD = 10;
    const step = (W - PAD * 2) / (hours.length - 1);

    const points = hours.map((h, i) => {
        const x = PAD + i * step;
        const y = H - PAD - ((h.temp - minT) / range) * (H - PAD * 2.5);
        return { x, y, temp: h.temp };
    });

    let d = 'M ' + points[0].x + ',' + points[0].y;
    for (let i = 1; i < points.length; i++) {
        const cp1x = points[i - 1].x + step * 0.4;
        const cp1y = points[i - 1].y;
        const cp2x = points[i].x - step * 0.4;
        const cp2y = points[i].y;
        d += ' C ' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + points[i].x + ',' + points[i].y;
    }

    const fillD = d + ' L ' + points[points.length - 1].x + ',' + H + ' L ' + points[0].x + ',' + H + ' Z';

    const dots = points.map((p, i) =>
        '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5" fill="#e07b39" stroke="#1a2030" stroke-width="2"/>' +
        '<text x="' + p.x + '" y="' + (p.y - 8) + '" text-anchor="middle" font-size="9" fill="rgba(232,237,245,.85)" font-family="\'Be Vietnam Pro\',sans-serif" font-weight="700">' +
        p.temp.toFixed(1) + '</text>'
    ).join('');

    return '<svg viewBox="0 0 ' + W + ' ' + (H + 10) + '" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#e07b39" stop-opacity="0.35"/>' +
        '<stop offset="100%" stop-color="#e07b39" stop-opacity="0.02"/>' +
        '</linearGradient></defs>' +
        '<path d="' + fillD + '" fill="url(#chartGrad)"/>' +
        '<path d="' + d + '" fill="none" stroke="#e07b39" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        dots + '</svg>';
}

function openModal(province) {
    const overlay = document.getElementById('modal-overlay');
    const w = wmo(province.code);

    document.getElementById('modal-icon').textContent = w.icon;
    document.getElementById('modal-city').textContent = province.name;
    document.getElementById('modal-now').textContent =
        'Hien tai: ' + (province.temp?.toFixed(1) ?? '--') + 'C - ' + w.desc;
    document.getElementById('modal-chart').innerHTML = '';
    document.getElementById('modal-hours').innerHTML = '';
    document.getElementById('modal-loading').classList.add('show');

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    fetchHourly(province.lat, province.lon).then(data => {
        const hours = getNext12Hours(data);
        document.getElementById('modal-loading').classList.remove('show');
        document.getElementById('modal-chart').innerHTML = drawChart(hours);
        document.getElementById('modal-hours').innerHTML = hours.map((h, i) => {
            const label = i === 0 ? 'Ngay' : h.time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const hw = wmo(h.code);
            return '<div class="hour-item">' +
                '<span class="h-time">' + label + '</span>' +
                '<span class="h-icon">' + hw.icon + '</span>' +
                '<span class="h-temp">' + h.temp.toFixed(1) + '</span>' +
                '<span class="h-rain">💧' + h.rain + '%</span>' +
                '</div>';
        }).join('');
    }).catch(err => {
        document.getElementById('modal-loading').classList.remove('show');
        document.getElementById('modal-hours').innerHTML =
            '<p style="color:#d62828;font-size:.8rem;padding:10px">Loi: ' + err.message + '</p>';
    });
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ═══════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════
function renderSkeleton(n) {
    document.getElementById('grid').innerHTML =
        Array(n).fill(0).map(() =>
            '<div class="card skel">' +
            '<div class="sk sk-ico"></div>' +
            '<div class="sk sk-nm"></div>' +
            '<div class="sk sk-tm"></div>' +
            '<div class="sk sk-tp"></div>' +
            '</div>'
        ).join('');
}

function renderCards(data) {
    const grid = document.getElementById('grid');
    if (!data.length) {
        grid.innerHTML = '<p style="color:var(--muted);padding:20px">Không tìm thấy tỉnh nào.</p>';
        return;
    }

    window._cardData = data;

    grid.innerHTML = data.map((d, i) => {
        const w = wmo(d.code);
        const cls = tempClass(d.temp);
        const time = d.time ? d.time.replace('T', ' ') : '';
        const temp = d.temp !== null ? d.temp.toFixed(1) : '--';
        return '<div class="card ' + cls + '" style="animation-delay:' + (Math.min(i, 30) * 0.025) + 's"' +
            ' title="' + d.name + ': ' + w.desc + ' - ' + temp + 'C"' +
            ' data-idx="' + i + '" onclick="openModal(window._cardData[' + i + '])">' +
            '<span class="card-src">12h</span>' +
            '<span class="card-icon">' + w.icon + '</span>' +
            '<div class="card-name">' + d.name + '</div>' +
            '<div class="card-time">' + time + '</div>' +
            '<div class="card-temp">' + temp + '<sup>°C</sup></div>' +
            '<div class="card-desc">' + w.desc + '</div>' +
            '</div>';
    }).join('');
}

function updateStats(data) {
    if (!data.length) { document.getElementById('stats').innerHTML = ''; return; }
    const temps = data.map(d => d.temp).filter(t => t !== null);
    const max = Math.max(...temps).toFixed(1);
    const min = Math.min(...temps).toFixed(1);
    const avg = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1);
    const maxP = data.find(d => d.temp == Math.max(...temps))?.name || '';
    const minP = data.find(d => d.temp == Math.min(...temps))?.name || '';
    document.getElementById('stats').innerHTML =
        '<span>📍 <strong>' + data.length + '</strong> tỉnh thành</span>' +
        '<span>🔥 Cao nhất: <strong>' + max + '°C</strong> (' + maxP + ')</span>' +
        '<span>❄️ Thấp nhất: <strong>' + min + '°C</strong> (' + minP + ')</span>' +
        '<span>📊 Trung bình: <strong>' + avg + '°C</strong></span>';
}

function applyFilter() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const sort = document.getElementById('sort').value;
    let filtered = [...allData];
    if (q) filtered = filtered.filter(d => d.name.toLowerCase().includes(q));
    if (sort === 'temp-h') filtered.sort((a, b) => (b.temp ?? -99) - (a.temp ?? -99));
    else if (sort === 'temp-l') filtered.sort((a, b) => (a.temp ?? 99) - (b.temp ?? 99));
    else filtered.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    renderCards(filtered);
    updateStats(filtered);
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
function setDot(id, state) {
    const el = document.getElementById(id);
    if (el) { el.className = 'dot ' + state; }
}
function setSpin(on) {
    document.getElementById('spin-ico').classList.toggle('spinning', on);
}

// ═══════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════
async function init() {
    setSpin(true);
    setDot('d-prov', 'wait');
    setDot('d-weather', 'wait');

    try {
        const skCount = allData.length || 63;
        renderSkeleton(skCount);

        const provinces = await fetchProvinces();
        allData = await fetchWeatherBatch(provinces);

        applyFilter();

        document.getElementById('last-upd').textContent =
            '· ' + new Date().toLocaleTimeString('vi-VN');

    } catch (err) {
        console.error(err);
        document.getElementById('grid').innerHTML =
            '<p style="color:#d62828;padding:20px">Loi: ' + err.message + '</p>';
        setDot('d-prov', 'err');
        setDot('d-weather', 'err');
    } finally {
        setSpin(false);
    }
}

init();
setInterval(init, 10 * 60 * 1000);
