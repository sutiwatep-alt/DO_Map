/* Service Worker — แคชแอปไว้ให้เปิดออฟไลน์ + แคชภาพแผนที่โซนที่เคยดู */
const CACHE = 'do-monitor-v11';
const SHELL = [
  './', './index.html', './app.js', './config.js', './manifest.json', './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ❌ อย่าแตะข้อมูล Firestore/Firebase realtime (ปล่อยให้ Firebase จัดการออฟไลน์เอง)
  if (/(firestore\.googleapis\.com|firebaseinstallations|identitytoolkit|firebaseremoteconfig|\.firebaseio\.com|google-analytics|nominatim\.openstreetmap\.org|router\.project-osrm\.org|docs\.google\.com)/.test(url.href)) {
    return;
  }

  // ไฟล์แอป (โดเมนเดียวกัน) = network-first → ออนไลน์ได้ของใหม่เสมอ, ออฟไลน์ค่อยใช้แคช
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // ไลบรารี CDN / ฟอนต์ / ภาพแผนที่ (ข้ามโดเมน) = cache-first (เร็ว + ใช้ออฟไลน์ได้)
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
