/**
 * Service Worker - Mixbox Palette 离线缓存
 */
const CACHE_NAME = 'mixbox-palette-v1';
const CACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/mixbox.js',
  './js/mixbox-painter.js',
  './js/brush-manager.js',
  './js/palette-storage.js',
  './icons/icon.png'
];

// 安装 - 预缓存资源
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] 预缓存资源');
        return cache.addAll(CACHE_URLS);
      })
      .then(() => {
        console.log('[SW] 安装完成');
        return self.skipWaiting();
      })
  );
});

// 激活 - 清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] 删除旧缓存:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        console.log('[SW] 激活完成');
        return self.clients.claim();
      })
  );
});

// 请求拦截 - 缓存优先，网络回退
self.addEventListener('fetch', (event) => {
  // 只处理同源请求
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // 有缓存，返回缓存并在后台更新
          console.log('[SW] 从缓存返回:', event.request.url);

          // 后台更新缓存 (Stale-While-Revalidate)
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(event.request, networkResponse));
              }
            })
            .catch(() => {});

          return cachedResponse;
        }

        // 无缓存，从网络获取
        console.log('[SW] 从网络获取:', event.request.url);
        return fetch(event.request)
          .then((networkResponse) => {
            // 缓存新资源
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, responseClone));
            }
            return networkResponse;
          });
      })
  );
});