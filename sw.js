/**
 * Service Worker - KM Watercolor Palette 离线缓存
 */
const CACHE_NAME = 'km-palette-v12';
const CACHE_URLS = [
  './app.html',
  './style.css',
  './js/i18n.js',
  './js/app.js',
  './js/mixbox.js',
  './js/mixbox-painter.js',
  './js/km-painter.js',
  './js/brush-manager.js',
  './js/palette-storage.js',
  './js/updater.js'
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
        if (cachedResponse && !cachedResponse.redirected) {
          // 有缓存且非重定向，返回缓存并在后台更新
          console.log('[SW] 从缓存返回:', event.request.url);

          // 后台更新缓存 (Stale-While-Revalidate)
          fetch(event.request, { redirect: 'follow' })
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200 && !networkResponse.redirected) {
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(event.request, networkResponse.clone()));
              }
            })
            .catch(() => {});

          return cachedResponse;
        }

        // 无缓存或缓存是重定向响应，从网络获取
        console.log('[SW] 从网络获取:', event.request.url);
        return fetch(event.request, { redirect: 'follow' })
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              if (networkResponse.redirected) {
                // 重定向响应不能直接返回给FetchEvent，需要创建干净的副本
                const cleanResponse = new Response(networkResponse.body, {
                  status: networkResponse.status,
                  statusText: networkResponse.statusText,
                  headers: networkResponse.headers
                });
                return cleanResponse;
              }
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, responseClone));
            }
            return networkResponse;
          });
      })
  );
});