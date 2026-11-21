'use strict';
const APP_VERSION = '11.0';

/* ==========================================================================
   0. UTILIDADES
   ========================================================================== */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : d; };
const fx = (n, d = 1) => (isFinite(n) ? Number(n).toFixed(d) : '—');

function toast(msg, ms = 2300) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

/* ==========================================================================
   1. ESTADO E ALMACENAMENTO (IndexedDB, con respaldo en localStorage)
   ========================================================================== */
const S = {
    arbores: [],
    cfg: { refTipo: 'tarxeta', refMm: 85.6, f35: 26, parcela: 'P1', modoPrezo: 'pie', ultEsp: 'e_globulus' },
    prezos: { pie: {}, carg: {} },
    params: {}
};

const DB = {
    db: null, ok: false,
    open() {
        return new Promise((res, rej) => {
            if (!window.indexedDB) return rej(new Error('sen IndexedDB'));
            const r = indexedDB.open('medidor', 1);
            r.onupgradeneeded = () => {
                const d = r.result;
                if (!d.objectStoreNames.contains('arbores')) d.createObjectStore('arbores', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
            };
            r.onsuccess = () => { DB.db = r.result; DB.ok = true; res(); };
            r.onerror = () => rej(r.error);
            r.onblocked = () => rej(new Error('IndexedDB bloqueada'));
        });
    },
    _r(store, mode, fn) {
        return new Promise((res, rej) => {
            const t = DB.db.transaction(store, mode);
            let out;
            try { out = fn(t.objectStore(store)); } catch (e) { return rej(e); }
            t.oncomplete = () => res(out ? out.result : undefined);
            t.onerror = t.onabort = () => rej(t.error);
        });
    },
    all() { return DB._r('arbores', 'readonly', s => s.getAll()); },
    put(o) { return DB._r('arbores', 'readwrite', s => s.put(o)); },
    del(id) { return DB._r('arbores', 'readwrite', s => s.delete(id)); },
    clear() { return DB._r('arbores', 'readwrite', s => s.clear()); },
    get(k) { return DB._r('kv', 'readonly', s => s.get(k)); },
    set(k, v) { return DB._r('kv', 'readwrite', s => s.put(v, k)); }
};

const LS = {
    ler(k, d) { try { return JSON.parse(localStorage.getItem('medidor_' + k)) ?? d; } catch (e) { return d; } },
    esc(k, v) { try { localStorage.setItem('medidor_' + k, JSON.stringify(v)); } catch (e) { toast('⚠️ Non se puido gardar'); } }
};

async function cargarEstado() {
    try { await DB.open(); } catch (e) {
        console.warn('IndexedDB non dispoñible', e);
        toast('⚠️ IndexedDB non dispoñible: uso localStorage', 4000);
    }
    if (DB.ok) {
        S.arbores = (await DB.all()) || [];
        for (const k of ['cfg', 'prezos', 'params']) {
            const v = await DB.get(k);
            if (v) S[k] = (k === 'cfg') ? Object.assign(S.cfg, v) : v;
        }
    } else {
        S.arbores = LS.ler('arbores', []);
        Object.assign(S.cfg, LS.ler('cfg', {}));
        S.prezos = LS.ler('prezos', S.prezos);
        S.params = LS.ler('params', S.params);
    }
    if (!S.prezos.pie) S.prezos.pie = {};
    if (!S.prezos.carg) S.prezos.carg = {};
    S.arbores.sort((a, b) => a.id - b.id);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* nada */ }
}

async function gardarKV(k) {
    try { DB.ok ? await DB.set(k, S[k]) : LS.esc(k, S[k]); } catch (e) { toast('⚠️ Erro ao gardar axustes'); }
}
async function gardarArbore(o) {
    try { DB.ok ? await DB.put(o) : LS.esc('arbores', S.arbores); } catch (e) { toast('⚠️ Erro ao gardar a árbore'); }
}
async function borrarArboreDB(id) {
    try { DB.ok ? await DB.del(id) : LS.esc('arbores', S.arbores); } catch (e) { toast('⚠️ Erro ao borrar'); }
}

/* ==========================================================================
   2. MODELO FORESTAL
   ========================================================================== */
function paramsEsp(id) {
    const e = espById(id), o = S.params[id] || {};
    return {
        a: o.a != null ? o.a : e.a,
        b: o.b != null ? o.b : e.b,
        f: o.f != null ? o.f : e.f,
        d: o.d != null ? o.d : e.d
    };
}
function prezoEsp(id, modo) {
    const v = S.prezos[modo] && S.prezos[modo][id];
    return v != null ? v : espById(id)[modo];
}
function alturaEst(id, dap) {
    const p = paramsEsp(id);
    return 1.3 + p.a * (1 - Math.exp(-p.b * dap));
}
function calcular(id, dap, alt) {
    const p = paramsEsp(id);
    const h = alt > 0 ? alt : alturaEst(id, dap);
    const vol = Math.PI / 4 * Math.pow(dap / 100, 2) * h * p.f;
    const peso = vol * p.d;
    return { h, vol, peso, pie: peso * prezoEsp(id, 'pie'), carg: peso * prezoEsp(id, 'carg') };
}
const valorModo = c => c[S.cfg.modoPrezo];
const etiquetaModo = () => S.cfg.modoPrezo === 'pie' ? 'en pé' : 'cargadeiro';

/* ==========================================================================
   3. NAVEGACIÓN
   ========================================================================== */
function irA(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    if (id === 'home') anovarMarcador();
    if (id === 'datos-screen') pintarDatos();
    if (id === 'prezos-screen') pintarPrezos();
    if (id === 'ajustes-screen') pintarAxustes();
    if (id === 'map-screen') iniciarMapa();
    if (id === 'foto-screen') setTimeout(layoutFoto, 30);
    if (id !== 'alt-screen') pararAltura();
    if (id !== 'reg-screen' && id !== 'alt-screen') pararGPS();
}

function anovarMarcador() {
    let eur = 0, vol = 0, t = 0;
    S.arbores.forEach(a => {
        const c = calcular(a.esp, a.dap, a.alt);
        eur += valorModo(c); vol += c.vol; t += c.peso;
    });
    $('display-euros').textContent = eur.toFixed(2) + ' €';
    $('display-count').textContent = S.arbores.length;
    $('display-vol').textContent = vol.toFixed(3);
    $('display-peso').textContent = t.toFixed(2);
    $('display-modo').textContent = 'valor ' + etiquetaModo();
    $('home-parcela').textContent = 'Parcela: ' + (S.cfg.parcela || '—');
}

/* ==========================================================================
   4. MEDICIÓN POR FOTO CON REFERENCIA
   Principio: unha tarxeta (85,6 mm) pegada ao tronco dá a escala (mm/píxel)
   no plano do tronco. DAP = (ancho tronco px / ancho tarxeta px) · ancho real,
   corrixido pola perspectiva (a tarxeta está máis preto da cámara que o eixo).
   ========================================================================== */
const F = {
    cv: null, w: 0, h: 0, ok: false, zoom: 1, snap: true, sel: 'r1', dragKey: null,
    x: { r1: 0.42, r2: 0.58, t1: 0.25, t2: 0.75 }, y: 0.5
};

function abrirFoto() {
    irA('foto-screen');
    $('foto-vacio').style.display = F.ok ? 'none' : 'flex';
    $('foto-inner').style.display = F.ok ? 'block' : 'none';
    actualizarLectura();
}

function cargarFoto(inp) {
    const file = inp.files && inp.files[0];
    inp.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const MAX = 3200;
        const sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
        const cv = $('foto-canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        F.cv = cv; F.w = w; F.h = h; F.ok = true; F.zoom = 1; F.y = 0.5;
        F.x = { r1: 0.42, r2: 0.58, t1: 0.25, t2: 0.75 };
        $('foto-vacio').style.display = 'none';
        $('foto-inner').style.display = 'block';
        layoutFoto();
        actualizarLectura();
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Non se puido abrir a foto'); };
    img.src = url;
}

function layoutFoto() {
    if (!F.ok) return;
    const wrap = $('foto-wrap'), inner = $('foto-inner');
    let fitH = wrap.clientHeight, fitW = fitH * F.w / F.h;
    if (fitW > wrap.clientWidth) { fitW = wrap.clientWidth; fitH = fitW * F.h / F.w; }
    inner.style.width = (fitW * F.zoom) + 'px';
    inner.style.height = (fitH * F.zoom) + 'px';
    posicionar();
}
window.addEventListener('resize', () => { if ($('foto-screen').classList.contains('active')) layoutFoto(); });

function setZoom(z) {
    F.zoom = z;
    document.querySelectorAll('[data-zoom]').forEach(b => b.classList.toggle('on', +b.dataset.zoom === z));
    layoutFoto();
}

const IDS_LINEA = { r1: 'L-r1', r2: 'L-r2', t1: 'L-t1', t2: 'L-t2' };
function posicionar() {
    for (const k in IDS_LINEA) {
        const el = $(IDS_LINEA[k]);
        el.style.left = (F.x[k] * 100) + '%';
        el.classList.toggle('sel', F.sel === k);
    }
    $('hline').style.top = (F.y * 100) + '%';
    document.querySelectorAll('[data-sel]').forEach(b => b.classList.toggle('on', b.dataset.sel === F.sel));
}
function selLinea(k) { F.sel = k; posicionar(); }
function nudge(px) {
    if (!F.ok) return;
    F.x[F.sel] = clamp(F.x[F.sel] + px / F.w, 0, 1);
    posicionar(); actualizarLectura();
}
function toggleSnap(v) { F.snap = !!v; }

(function engancharLinhas() {
    document.querySelectorAll('.linea').forEach(el => {
        const k = el.dataset.k;
        el.addEventListener('pointerdown', e => {
            e.preventDefault();
            try { el.setPointerCapture(e.pointerId); } catch (_) { /* nada */ }
            F.sel = k; F.dragKey = k; posicionar();
        });
        el.addEventListener('pointermove', e => {
            if (F.dragKey !== k) return;
            const r = $('foto-inner').getBoundingClientRect();
            F.x[k] = clamp((e.clientX - r.left) / r.width, 0, 1);
            posicionar(); actualizarLectura();
        });
        const fin = () => {
            if (F.dragKey !== k) return;
            F.dragKey = null;
            if (F.snap) snapLinea(k);
        };
        el.addEventListener('pointerup', fin);
        el.addEventListener('pointercancel', fin);
    });
    $('foto-canvas').addEventListener('click', e => {
        if (!F.ok) return;
        const r = $('foto-canvas').getBoundingClientRect();
        F.y = clamp((e.clientY - r.top) / r.height, 0, 1);
        posicionar();
        if (F.snap) autoaxustar();
    });
})();

// Perfil medio de gradiente horizontal nunha franxa arredor da fila F.y
function perfilGrad() {
    const ctx = F.cv.getContext('2d', { willReadFrequently: true });
    const bh = Math.max(4, Math.round(F.h * 0.015));
    const y0 = clamp(Math.round(F.y * F.h) - bh, 0, F.h - 2);
    const hh = Math.max(1, Math.min(2 * bh, F.h - y0));
    const d = ctx.getImageData(0, y0, F.w, hh).data;
    const col = new Float32Array(F.w);
    for (let yy = 0; yy < hh; yy++) {
        let o = yy * F.w * 4;
        for (let x = 0; x < F.w; x++, o += 4) col[x] += 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    }
    for (let x = 0; x < F.w; x++) col[x] /= hh;
    const g = new Float32Array(F.w), k = 3;
    for (let x = k; x < F.w - k; x++) g[x] = Math.abs(col[x + k] - col[x - k]);
    return g;
}
function snapLinea(k, g) {
    if (!F.ok) return;
    g = g || perfilGrad();
    const x0 = Math.round(F.x[k] * F.w), R = Math.round(F.w * 0.02);
    let best = -1, bx = x0, sum = 0, n = 0;
    for (let x = Math.max(4, x0 - R); x <= Math.min(F.w - 5, x0 + R); x++) {
        sum += g[x]; n++;
        if (g[x] > best) { best = g[x]; bx = x; }
    }
    if (n && best > 1.8 * (sum / n) && best > 6) {
        F.x[k] = bx / F.w;
        posicionar(); actualizarLectura();
    }
}
function autoaxustar() {
    if (!F.ok) return;
    const g = perfilGrad();
    ['r1', 'r2', 't1', 't2'].forEach(k => snapLinea(k, g));
}

// Cálculo da medida a partir das 4 liñas
function medidaFoto() {
    if (!F.ok) return null;
    const ref = Math.abs(F.x.r2 - F.x.r1) * F.w, tr = Math.abs(F.x.t2 - F.x.t1) * F.w;
    if (ref < 5 || tr < 5) return null;
    return calcularDAPFoto(ref, tr, S.cfg.refMm, S.cfg.f35, F.w, F.h);
}
// Función pura (testable): píxeles de referencia/tronco -> DAP, distancia, erro
function calcularDAPFoto(refPx, trPx, refMm, f35, w, h) {
    const fpx = f35 * Math.hypot(w, h) / 43.27;          // focal en píxeles
    const naive = trPx / refPx * refMm / 10;              // cm, sen corrixir
    const a = trPx / (2 * fpx);
    const corr = 1 / (Math.sqrt(1 + a * a) - a);          // perspectiva do cilindro
    const dap = naive * corr;
    const dc = fpx * (refMm / 1000) / refPx;              // m, cámara -> tarxeta
    const dist = dc + dap / 200;                          // m, cámara -> eixo do tronco
    const err = Math.hypot(1.4 / refPx, 1.4 / trPx) * 100; // % con ±1 px por bordo
    return { dap, naive, corr, dist, err, refPx, trPx };
}

function actualizarLectura() {
    const m = medidaFoto();
    const av = [];
    if (!m) {
        $('foto-dap').textContent = '— cm';
        $('foto-det').textContent = F.ok ? 'Move as liñas aos bordes' : 'Fai ou elixe unha foto';
        $('foto-aviso').textContent = '';
        $('btn-usar-foto').disabled = true;
        return;
    }
    $('foto-dap').textContent = fx(m.dap) + ' cm';
    $('foto-det').textContent = '± ' + fx(m.err, 1) + ' % · distancia ≈ ' + fx(m.dist) + ' m · perspectiva +' + fx((m.corr - 1) * 100, 1) + ' %';
    if (m.refPx < 60) av.push('Referencia moi pequena: achégate ou usa zoom');
    if (m.trPx < m.refPx * 1.2) av.push('Tronco case tan estreito como a referencia: revisa as liñas');
    if (m.err > 4) av.push('Erro estimado alto (> 4 %)');
    if (m.dap > 150 || m.dap < 3) av.push('DAP fóra do rango habitual');
    $('foto-aviso').textContent = av.join(' · ');
    $('btn-usar-foto').disabled = false;
}

function usarMedidaFoto() {
    const m = medidaFoto();
    if (!m) return toast('Axusta primeiro as liñas');
    novoRexistro({ dap: m.dap, dist: m.dist, metodo: 'foto' });
}
function novaFoto() { F.ok = false; $('foto-inner').style.display = 'none'; $('foto-vacio').style.display = 'flex'; actualizarLectura(); }

/* ==========================================================================
   5. REXISTRO (formulario de árbore, novo ou edición)
   ========================================================================== */
const R = { edit: null, metodo: 'manual', dist: null, gps: null, gpsW: null };

function poblarSelectEspecies() {
    const sel = $('r-esp');
    let h = '';
    for (const g in GRUPOS) {
        h += '<optgroup label="' + esc(GRUPOS[g]) + '">';
        ESPECIES.filter(e => e.g === g).forEach(e => { h += '<option value="' + e.id + '">' + esc(e.gl) + ' — ' + esc(e.ci) + '</option>'; });
        h += '</optgroup>';
    }
    sel.innerHTML = h;
}
function poblarParcelas() {
    const set = new Set(S.arbores.map(a => a.parcela).filter(Boolean));
    if (S.cfg.parcela) set.add(S.cfg.parcela);
    $('lista-parcelas').innerHTML = [...set].map(p => '<option value="' + esc(p) + '">').join('');
}

function novoRexistro(pre) {
    pre = pre || {};
    R.edit = null; R.metodo = pre.metodo || 'manual'; R.dist = pre.dist || null;
    $('reg-titulo').textContent = R.metodo === 'foto' ? '📸 Novo rexistro (foto)' : '📏 Novo rexistro (manual)';
    $('r-esp').value = S.cfg.ultEsp && ESP_POR_ID[S.cfg.ultEsp] ? S.cfg.ultEsp : ESPECIES[0].id;
    $('r-dap').value = pre.dap ? fx(pre.dap) : '';
    $('r-circ').value = pre.dap ? fx(pre.dap * Math.PI) : '';
    $('r-alt').value = '';
    $('r-dist').value = pre.dist ? fx(pre.dist) : '';
    $('r-parcela').value = S.cfg.parcela || '';
    $('r-notas').value = '';
    $('btn-gardar-reg').textContent = '💾 GARDAR';
    poblarParcelas();
    irA('reg-screen');
    iniciarGPS();
    previa();
}

function editarRexistro(id) {
    const t = S.arbores.find(x => x.id === id);
    if (!t) return;
    R.edit = id; R.metodo = t.metodo || 'manual'; R.dist = t.dist || null;
    R.gps = t.lat != null ? { lat: t.lat, lon: t.lon, acc: t.acc } : null;
    $('reg-titulo').textContent = '✏️ Editar rexistro';
    $('r-esp').value = ESP_POR_ID[t.esp] ? t.esp : 'o_outras';
    $('r-dap').value = fx(t.dap);
    $('r-circ').value = fx(t.dap * Math.PI);
    $('r-alt').value = t.alt ? fx(t.alt) : '';
    $('r-dist').value = t.dist ? fx(t.dist) : '';
    $('r-parcela').value = t.parcela || '';
    $('r-notas').value = t.notas || '';
    $('btn-gardar-reg').textContent = '💾 GARDAR CAMBIOS';
    poblarParcelas();
    irA('reg-screen');
    estadoGPS();
    previa();
}

function syncDap() { const d = num($('r-dap').value); $('r-circ').value = d > 0 ? fx(d * Math.PI) : ''; previa(); }
function syncCirc() { const c = num($('r-circ').value); $('r-dap').value = c > 0 ? fx(c / Math.PI) : ''; previa(); }

function previa() {
    const esp = $('r-esp').value, dap = num($('r-dap').value), alt = num($('r-alt').value);
    const e = espById(esp);
    if (!(dap > 0)) {
        $('r-prev').innerHTML = '<span class="mut">Introduce o DAP para ver volume e valor</span>';
        $('r-alt').placeholder = 'estimada';
        return;
    }
    const c = calcular(esp, dap, alt);
    $('r-alt').placeholder = 'est. ' + fx(alturaEst(esp, dap)) + ' m';
    const p = paramsEsp(esp);
    $('r-prev').innerHTML =
        '<div class="prev-grid">' +
        '<div><b>' + fx(c.vol, 3) + '</b><small>m³</small></div>' +
        '<div><b>' + fx(c.peso, 3) + '</b><small>t</small></div>' +
        '<div class="' + (S.cfg.modoPrezo === 'pie' ? 'hi' : '') + '"><b>' + fx(c.pie, 2) + ' €</b><small>en pé</small></div>' +
        '<div class="' + (S.cfg.modoPrezo === 'carg' ? 'hi' : '') + '"><b>' + fx(c.carg, 2) + ' €</b><small>cargadeiro</small></div>' +
        '</div>' +
        '<small class="mut">H ' + fx(c.h) + ' m ' + (alt > 0 ? '(medida)' : '(estimada)') + ' · f ' + fx(p.f, 2) + ' · ' + fx(p.d, 2) + ' t/m³ · ' + esc(e.gl) + '</small>';
}

async function gardarRexistro() {
    const dap = num($('r-dap').value);
    if (!(dap > 0) || dap > 300) return toast('DAP non válido');
    const alt = num($('r-alt').value) || null;
    if (alt && (alt < 1.5 || alt > 80)) return toast('Altura non válida');
    const esp = $('r-esp').value;
    const parcela = $('r-parcela').value.trim();
    const antigo = R.edit ? S.arbores.find(x => x.id === R.edit) : null;
    const rec = {
        id: R.edit || Date.now(),
        fecha: antigo ? antigo.fecha : new Date().toISOString(),
        esp, dap: Math.round(dap * 10) / 10, alt,
        metodo: R.metodo, dist: num($('r-dist').value) || null,
        lat: R.gps ? R.gps.lat : null, lon: R.gps ? R.gps.lon : null, acc: R.gps ? R.gps.acc : null,
        parcela, notas: $('r-notas').value.trim()
    };
    if (antigo) S.arbores[S.arbores.indexOf(antigo)] = rec; else S.arbores.push(rec);
    S.cfg.parcela = parcela || S.cfg.parcela;
    S.cfg.ultEsp = esp;
    await gardarArbore(rec);
    await gardarKV('cfg');
    const c = calcular(rec.esp, rec.dap, rec.alt);
    toast('✅ Gardado: ' + fx(c.vol, 3) + ' m³ · ' + fx(valorModo(c), 2) + ' €');
    if (antigo) return irA('datos-screen');
    if (R.metodo === 'foto') { novaFoto(); abrirFoto(); } else novoRexistro();
}

/* ---------- GPS ---------- */
function iniciarGPS() {
    pararGPS();
    R.gps = null;
    if (!navigator.geolocation) { $('r-gps').textContent = '📡 GPS non dispoñible'; return; }
    $('r-gps').textContent = '📡 Buscando GPS…';
    R.gpsW = navigator.geolocation.watchPosition(
        p => { R.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; estadoGPS(); },
        err => { $('r-gps').textContent = '📡 Sen GPS (' + (err.code === 1 ? 'permiso denegado' : 'sen sinal') + ')'; },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
}
function pararGPS() { if (R.gpsW != null && navigator.geolocation) { navigator.geolocation.clearWatch(R.gpsW); R.gpsW = null; } }
function estadoGPS() {
    $('r-gps').textContent = R.gps ? '📡 ' + R.gps.lat.toFixed(6) + ', ' + R.gps.lon.toFixed(6) + ' (±' + Math.round(R.gps.acc || 0) + ' m)' : '📡 Sen posición gardada';
}

/* ==========================================================================
   6. ALTURA CON INCLINÓMETRO (sensor de orientación + cámara de apuntado)
   H = L · (tan α_copa − tan α_base), con L = distancia horizontal ao tronco
   ========================================================================== */
const A = { stream: null, handler: null, ang: 0, top: null, base: null, dist: 0 };

async function abrirAltura() {
    const dist = num($('r-dist').value);
    if (!(dist > 0)) return toast('Indica antes a distancia ao árbore (m)');
    A.dist = dist; A.top = A.base = null;
    $('alt-top').textContent = '—'; $('alt-base').textContent = '—'; $('alt-res').textContent = '—';
    $('btn-usar-alt').disabled = true;
    irA('alt-screen');
    try {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const p = await DeviceOrientationEvent.requestPermission();
            if (p !== 'granted') { toast('Permiso de sensores denegado'); return irA('reg-screen'); }
        }
    } catch (e) { toast('Non se puido activar o sensor'); return irA('reg-screen'); }
    A.handler = e => {
        if (e.beta == null) return;
        A.ang = e.beta - 90;       // móbil vertical, cámara traseira á fronte: 0° = horizonte
        $('alt-ang').textContent = fx(A.ang) + '°';
    };
    window.addEventListener('deviceorientation', A.handler);
    try {
        A.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const v = $('alt-video'); v.srcObject = A.stream; v.play().catch(() => { });
    } catch (e) { /* sen vista previa: apunta co borde do móbil */ }
}
function pararAltura() {
    if (A.handler) { window.removeEventListener('deviceorientation', A.handler); A.handler = null; }
    if (A.stream) { A.stream.getTracks().forEach(t => t.stop()); A.stream = null; }
}
function marcarAngulo(que) {
    A[que] = A.ang;
    $('alt-' + que).textContent = fx(A.ang) + '°';
    if (A.top != null && A.base != null) {
        const h = alturaPorAngulos(A.dist, A.top, A.base);
        if (h > 0) { $('alt-res').textContent = fx(h) + ' m'; $('btn-usar-alt').disabled = false; A.h = h; }
        else { $('alt-res').textContent = 'copa debe estar máis alta que a base'; $('btn-usar-alt').disabled = true; }
    }
}
function alturaPorAngulos(L, topDeg, baseDeg) {
    const r = d => d * Math.PI / 180;
    return L * (Math.tan(r(topDeg)) - Math.tan(r(baseDeg)));
}
function usarAltura() {
    $('r-alt').value = fx(A.h);
    irA('reg-screen'); previa();
}

/* ==========================================================================
   7. INVENTARIO
   ========================================================================== */
let filtroParcela = '';
function setFiltro(v) { filtroParcela = v; pintarDatos(); }

function pintarDatos() {
    const parcelas = [...new Set(S.arbores.map(a => a.parcela || '(sen parcela)'))].sort();
    if (filtroParcela && !parcelas.includes(filtroParcela)) filtroParcela = '';
    $('filtro-parcela').innerHTML = '<option value="">Todas as parcelas</option>' +
        parcelas.map(p => '<option' + (p === filtroParcela ? ' selected' : '') + '>' + esc(p) + '</option>').join('');

    const lista = S.arbores.filter(a => !filtroParcela || (a.parcela || '(sen parcela)') === filtroParcela);
    const res = {};
    let tot = { n: 0, vol: 0, peso: 0, eur: 0 };
    lista.forEach(a => {
        const c = calcular(a.esp, a.dap, a.alt), r = res[a.esp] || (res[a.esp] = { n: 0, dap: 0, vol: 0, peso: 0, eur: 0 });
        r.n++; r.dap += a.dap; r.vol += c.vol; r.peso += c.peso; r.eur += valorModo(c);
        tot.n++; tot.vol += c.vol; tot.peso += c.peso; tot.eur += valorModo(c);
    });
    let h = '';
    if (lista.length) {
        h += '<table class="resumo"><tr><th>Especie</th><th>N</th><th>DAP</th><th>m³</th><th>t</th><th>€</th></tr>';
        Object.keys(res).sort((a, b) => res[b].eur - res[a].eur).forEach(id => {
            const r = res[id];
            h += '<tr><td>' + esc(espById(id).gl) + '</td><td>' + r.n + '</td><td>' + fx(r.dap / r.n) + '</td><td>' + fx(r.vol, 2) + '</td><td>' + fx(r.peso, 2) + '</td><td>' + fx(r.eur, 0) + '</td></tr>';
        });
        h += '<tr class="tot"><td>Total</td><td>' + tot.n + '</td><td></td><td>' + fx(tot.vol, 2) + '</td><td>' + fx(tot.peso, 2) + '</td><td>' + fx(tot.eur, 0) + '</td></tr></table>';
        h += '<p class="mut" style="margin:4px 0 12px">Valor ' + etiquetaModo() + '</p>';
    }
    const filas = lista.slice().reverse().map(a => {
        const c = calcular(a.esp, a.dap, a.alt);
        return '<div class="item-rexistro"><div><b>' + esc(espById(a.esp).gl) + '</b> · ' + fx(a.dap) + ' cm · ' + fx(c.h) + ' m' + (a.alt ? '' : '*') + '<br>' +
            '<small>' + fx(c.vol, 3) + ' m³ · ' + fx(c.peso, 3) + ' t · <b>' + fx(valorModo(c), 2) + ' €</b><br>' +
            esc(a.parcela || '') + ' · ' + new Date(a.fecha).toLocaleString('gl-ES', { dateStyle: 'short', timeStyle: 'short' }) + (a.lat != null ? ' · 📍' : '') + '</small></div>' +
            '<div class="acc"><button class="btn-mini" onclick="editarRexistro(' + a.id + ')">✏️</button><button class="btn-borrar" onclick="borrarItem(' + a.id + ')">✖</button></div></div>';
    });
    $('lista-datos').innerHTML = h + (filas.length ? filas.join('') + '<p class="mut">* altura estimada polo DAP</p>' : '<p class="mut">Non hai rexistros aínda.</p>');
}

async function borrarItem(id) {
    if (!confirm('Seguro que queres borrar esta árbore?')) return;
    S.arbores = S.arbores.filter(a => a.id !== id);
    await borrarArboreDB(id);
    pintarDatos(); anovarMarcador();
}

/* ==========================================================================
   8. PREZOS E PARÁMETROS POR ESPECIE
   ========================================================================== */
function setModoPrezo(m) {
    S.cfg.modoPrezo = m; gardarKV('cfg');
    pintarPrezos(); anovarMarcador();
}
function pintarPrezos() {
    $('btn-pie').classList.toggle('activo', S.cfg.modoPrezo === 'pie');
    $('btn-carg').classList.toggle('activo', S.cfg.modoPrezo === 'carg');
    const m = S.cfg.modoPrezo;
    let h = '';
    for (const g in GRUPOS) {
        h += '<h3 class="grupo">' + esc(GRUPOS[g]) + '</h3>';
        ESPECIES.filter(e => e.g === g).forEach(e => {
            const p = paramsEsp(e.id), custom = !!S.params[e.id] || S.prezos.pie[e.id] != null || S.prezos.carg[e.id] != null;
            h += '<div class="prezo-card"><div class="prezo-row"><span>' + esc(e.gl) + '<small>' + esc(e.ci) + (custom ? ' · editada' : '') + '</small></span>' +
                '<input type="number" inputmode="decimal" step="0.5" value="' + prezoEsp(e.id, m) + '" onchange="setPrezo(\'' + e.id + '\',this.value)"><em>€/t</em></div>' +
                '<details><summary>Parámetros de volume</summary><div class="param-grid">' +
                '<label>a (m)<input type="number" inputmode="decimal" step="0.5" value="' + p.a + '" onchange="setParam(\'' + e.id + '\',\'a\',this.value)"></label>' +
                '<label>b<input type="number" inputmode="decimal" step="0.001" value="' + p.b + '" onchange="setParam(\'' + e.id + '\',\'b\',this.value)"></label>' +
                '<label>f<input type="number" inputmode="decimal" step="0.01" value="' + p.f + '" onchange="setParam(\'' + e.id + '\',\'f\',this.value)"></label>' +
                '<label>t/m³<input type="number" inputmode="decimal" step="0.01" value="' + p.d + '" onchange="setParam(\'' + e.id + '\',\'d\',this.value)"></label>' +
                '</div><button class="btn-mini" onclick="resetEsp(\'' + e.id + '\')">Restaurar valores orixinais</button></details></div>';
        });
    }
    $('lista-prezos').innerHTML = h;
}
async function setPrezo(id, v) {
    const n = num(v, NaN);
    if (!isFinite(n) || n < 0) return toast('Prezo non válido');
    S.prezos[S.cfg.modoPrezo][id] = n;
    await gardarKV('prezos'); anovarMarcador();
}
async function setParam(id, k, v) {
    const n = num(v, NaN);
    if (!isFinite(n) || n <= 0) { toast('Valor non válido'); return pintarPrezos(); }
    S.params[id] = Object.assign(S.params[id] || {}, { [k]: n });
    await gardarKV('params'); anovarMarcador();
}
async function resetEsp(id) {
    delete S.params[id]; delete S.prezos.pie[id]; delete S.prezos.carg[id];
    await gardarKV('params'); await gardarKV('prezos');
    pintarPrezos(); anovarMarcador();
}

/* ==========================================================================
   9. AXUSTES E COPIAS
   ========================================================================== */
const REFS = { tarxeta: 85.6, a4largo: 297, a4ancho: 210 };
function pintarAxustes() {
    $('ax-ref').value = S.cfg.refTipo;
    $('ax-refmm').value = S.cfg.refMm;
    $('ax-refmm').disabled = S.cfg.refTipo !== 'custom';
    $('ax-f35').value = S.cfg.f35;
    $('ax-parcela').value = S.cfg.parcela || '';
    $('ax-version').textContent = 'v' + APP_VERSION + ' · ' + S.arbores.length + ' árbores · ' + (DB.ok ? 'IndexedDB' : 'localStorage');
}
async function axRef(v) {
    S.cfg.refTipo = v;
    if (REFS[v]) S.cfg.refMm = REFS[v];
    await gardarKV('cfg'); pintarAxustes(); actualizarLectura();
}
async function axNum(k, v) {
    const n = num(v, NaN);
    if (!isFinite(n) || n <= 0) { toast('Valor non válido'); return pintarAxustes(); }
    S.cfg[k] = n; await gardarKV('cfg'); actualizarLectura();
}
async function axParcela(v) { S.cfg.parcela = v.trim(); await gardarKV('cfg'); anovarMarcador(); }

function exportarJSON() {
    const datos = { app: 'medidor-arbores', version: APP_VERSION, exportado: new Date().toISOString(), cfg: S.cfg, prezos: S.prezos, params: S.params, arbores: S.arbores };
    guardarFicheiro(new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' }), 'medidor_copia_' + hoy() + '.json');
}
function importarJSON(inp) {
    const file = inp.files && inp.files[0];
    inp.value = '';
    if (!file) return;
    const rd = new FileReader();
    rd.onload = async () => {
        try {
            const d = JSON.parse(rd.result);
            if (!d || !Array.isArray(d.arbores)) throw new Error('formato');
            const ids = new Set(S.arbores.map(a => a.id));
            let nuevos = 0;
            for (const a of d.arbores) {
                if (a && a.id != null && a.dap > 0 && !ids.has(a.id)) { S.arbores.push(a); ids.add(a.id); await gardarArbore(a); nuevos++; }
            }
            if (d.prezos && confirm('Importar tamén prezos e parámetros da copia (substitúe os actuais)?')) {
                S.prezos = d.prezos; S.params = d.params || {};
                await gardarKV('prezos'); await gardarKV('params');
            }
            S.arbores.sort((a, b) => a.id - b.id);
            toast('Importadas ' + nuevos + ' árbores novas');
            pintarAxustes(); anovarMarcador();
        } catch (e) { toast('Ficheiro de copia non válido'); }
    };
    rd.readAsText(file);
}
async function borrarTodo() {
    if (!confirm('Borrar TODAS as árbores? Non se pode desfacer. Fai antes unha copia (JSON).')) return;
    if (!confirm('Seguro? Vanse borrar ' + S.arbores.length + ' rexistros.')) return;
    S.arbores = [];
    try { DB.ok ? await DB.clear() : LS.esc('arbores', []); } catch (e) { /* nada */ }
    pintarAxustes(); anovarMarcador(); toast('Inventario baleirado');
}

/* ==========================================================================
   10. EXPORTACIÓN (Excel, KML)
   ========================================================================== */
const hoy = () => new Date().toISOString().slice(0, 10);

async function guardarFicheiro(blob, nome) {
    try {
        const file = new File([blob], nome, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: nome }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

function filasArbores() {
    return S.arbores.map((t, i) => {
        const e = espById(t.esp), c = calcular(t.esp, t.dap, t.alt);
        return {
            'Nº': i + 1,
            'Data': t.fecha.slice(0, 19).replace('T', ' '),
            'Parcela': t.parcela || '',
            'Especie': e.gl, 'Nome científico': e.ci,
            'DAP (cm)': t.dap,
            'Altura (m)': +c.h.toFixed(1), 'Altura': t.alt ? 'medida' : 'estimada',
            'Volume (m³)': +c.vol.toFixed(3), 'Peso (t)': +c.peso.toFixed(3),
            'Valor en pé (€)': +c.pie.toFixed(2), 'Valor cargadeiro (€)': +c.carg.toFixed(2),
            'Método': t.metodo || '', 'Distancia (m)': t.dist ? +t.dist.toFixed(1) : '',
            'Latitude': t.lat != null ? +t.lat.toFixed(7) : '', 'Lonxitude': t.lon != null ? +t.lon.toFixed(7) : '',
            'Precisión GPS (m)': t.acc != null ? Math.round(t.acc) : '',
            'Notas': t.notas || ''
        };
    });
}
function resumoPor(clave, nomeCol) {
    const r = {};
    S.arbores.forEach(t => {
        const k = clave(t), c = calcular(t.esp, t.dap, t.alt), o = r[k] || (r[k] = { n: 0, dap: 0, vol: 0, peso: 0, pie: 0, carg: 0 });
        o.n++; o.dap += t.dap; o.vol += c.vol; o.peso += c.peso; o.pie += c.pie; o.carg += c.carg;
    });
    return Object.keys(r).sort().map(k => ({
        [nomeCol]: k, 'Nº árbores': r[k].n, 'DAP medio (cm)': +(r[k].dap / r[k].n).toFixed(1),
        'Volume (m³)': +r[k].vol.toFixed(3), 'Peso (t)': +r[k].peso.toFixed(3),
        'Valor en pé (€)': +r[k].pie.toFixed(2), 'Valor cargadeiro (€)': +r[k].carg.toFixed(2)
    }));
}
function exportarExcel() {
    if (!S.arbores.length) return toast('Sen datos');
    if (typeof XLSX === 'undefined') return toast('Librería Excel non cargada');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasArbores()), 'Árbores');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoPor(t => espById(t.esp).gl, 'Especie')), 'Resumo especies');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoPor(t => t.parcela || '(sen parcela)', 'Parcela')), 'Resumo parcelas');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    guardarFicheiro(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Monte_' + hoy() + '.xlsx');
}
function exportarKML() {
    const con = S.arbores.filter(t => t.lat != null);
    if (!con.length) return toast('Ningunha árbore ten GPS');
    const pm = con.map(t => {
        const e = espById(t.esp), c = calcular(t.esp, t.dap, t.alt);
        return '<Placemark><name>' + esc(e.gl) + ' ' + fx(t.dap) + ' cm</name><description>' +
            esc(fx(c.vol, 3) + ' m³ · ' + fx(c.peso, 3) + ' t · ' + fx(valorModo(c), 2) + ' € (' + etiquetaModo() + ') · ' + (t.parcela || '')) +
            '</description><Point><coordinates>' + t.lon + ',' + t.lat + ',0</coordinates></Point></Placemark>';
    }).join('');
    const kml = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Medidor de árbores</name>' + pm + '</Document></kml>';
    guardarFicheiro(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), 'Monte_' + hoy() + '.kml');
}

/* ==========================================================================
   11. MAPA
   ========================================================================== */
let mapa = null, capaPts = null;
function iniciarMapa() {
    setTimeout(() => {
        if (typeof L === 'undefined') return toast('Mapa non dispoñible');
        if (!mapa) {
            mapa = L.map('map').setView([42.9, -8.2], 9);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
            capaPts = L.layerGroup().addTo(mapa);
        }
        mapa.invalidateSize();
        capaPts.clearLayers();
        const pts = [];
        S.arbores.forEach(t => {
            if (t.lat == null) return;
            const e = espById(t.esp), c = calcular(t.esp, t.dap, t.alt);
            L.circleMarker([t.lat, t.lon], { radius: 7, color: '#fff', weight: 1.5, fillColor: COR_GRUPO[e.g], fillOpacity: 0.95 })
                .bindPopup('<b>' + esc(e.gl) + '</b><br>' + fx(t.dap) + ' cm · ' + fx(c.h) + ' m<br>' + fx(c.vol, 3) + ' m³ · ' + fx(valorModo(c), 2) + ' €<br>' + esc(t.parcela || ''))
                .addTo(capaPts);
            pts.push([t.lat, t.lon]);
        });
        if (pts.length) mapa.fitBounds(pts, { padding: [30, 30], maxZoom: 19 });
        else toast('Aínda non hai árbores con GPS');
    }, 60);
}

/* ==========================================================================
   12. PWA E ARRANQUE
   ========================================================================== */
function rexistrarSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener('statechange', () => {
                if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Nova versión lista: pecha e volve abrir a app', 6000);
            });
        });
    }).catch(e => console.warn('SW', e));
}

(async function init() {
    await cargarEstado();
    poblarSelectEspecies();
    poblarParcelas();
    anovarMarcador();
    rexistrarSW();
    irA('home');
})();
