'use strict';
// Sube este número cando cambies ficheiros: invalida a caché antiga.
const VERSION = 'medidor-v11';
const TILES = 'medidor-tiles';
const MAX_TILES = 400;

const CORE = [
    './', './index.html', './app.js', './especies.js', './manifest.json',
    './lib/leaflet.js', './lib/leaflet.css', './lib/xlsx.full.min.js',
    './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'
];

self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const c = await caches.open(VERSION);
        // Cada ficheiro por separado: se un falla non se bota a perder o resto
        await Promise.allSettled(CORE.map(u => c.add(new Request(u, { cache: 'reload' }))));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== VERSION && k !== TILES).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

async function limitarTiles() {
    const c = await caches.open(TILES), ks = await c.keys();
    if (ks.length > MAX_TILES) await Promise.all(ks.slice(0, ks.length - MAX_TILES).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Tesela do mapa: caché primeiro (offline) e garda as que se ven
    if (url.hostname.endsWith('tile.openstreetmap.org')) {
        e.respondWith((async () => {
            const c = await caches.open(TILES);
            const hit = await c.match(req);
            if (hit) return hit;
            try {
                const r = await fetch(req);
                if (r && (r.ok || r.type === 'opaque')) { c.put(req, r.clone()); limitarTiles(); }
                return r;
            } catch (err) { return Response.error(); }
        })());
        return;
    }

    // Ficheiros propios: stale-while-revalidate (rápido e sempre se actualiza)
    if (url.origin === self.location.origin) {
        e.respondWith((async () => {
            const c = await caches.open(VERSION);
            const hit = await c.match(req, { ignoreSearch: true });
            const red = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
            if (hit) { e.waitUntil(red); return hit; }
            const r = await red;
            if (r) return r;
            if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
            return Response.error();
        })());
    }
});
