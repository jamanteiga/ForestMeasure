// Nome da versión (cámbiia cada vez que fagas un cambio grande no index.html)
const CACHE_NAME = 'medidor-arbores-v2.1';

// Lista de ficheiros necesarios para que todo funcione NO MONTE
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    'https://cdn.sheetjs.com/xlsx-0.20.0/package/dist/xlsx.full.min.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

// 1. Cando instalas a App: Garda todo na memoria do móbil
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando Service Worker e gardando caché...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    // Forzar a que o novo SW tome o control inmediatamente
    self.skipWaiting();
});

// 2. Cando a App se activa: Limpa versións vellas de prezos ou mapas
self.addEventListener('activate', (event) => {
    console.log('[SW] Activado. Limpando cachés antigas...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// 3. O "Porteiro": Decide de onde sacar os datos (Rede vs Caché)
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            // Se o temos na caché, devolvémolo. Se non, imos a internet.
            return response || fetch(event.request).catch(() => {
                // Se non hai nin caché nin internet (fallo crítico)
                console.log('[SW] Erro: Non hai conexión nin datos gardados para:', event.request.url);
            });
        })
    );
});