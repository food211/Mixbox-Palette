/**
 * Service Worker - KM Watercolor Palette 离线缓存
 *
 * dev 域（localhost / 127.0.0.1）禁用缓存：
 * 否则 vite 没在跑时 SW 会从缓存返回 app.html，host 误判源探测成功，
 * 后续相对路径请求（versions.json 等）撞到没在跑的 vite 报 connection refused。
 *
 * 缓存模型：每个 CACHE_NAME 是一整份快照，install 时一次性从源站拉齐 CACHE_URLS。
 * 快照里的文件只读快照、不做后台更新，页面的 HTML / CSS / JS / 图标因此永远来自同一个版本。
 * 发新版必须改 CACHE_NAME（换一份新快照）：CACHE_URLS 里的文件改了或新增了而不改名，老用户拿不到。
 * 新 worker 接管后会刷新接管前就开着的页面，避免页面一半是旧版本、一半是新版本。
 */
const IS_DEV_HOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const CACHE_PREFIX = 'km-palette-';
const CACHE_NAME = 'km-palette-v104';
const CACHE_URLS = [
  './app.html',
  './css/base.css',
  './css/header.css',
  './css/palette.css',
  './css/controls.css',
  './css/mix-area.css',
  './css/modals.css',
  './css/onboarding.css',
  './js/params.js',
  './js/i18n.js',
  './js/i18n-translations.js',
  './js/ps-bridge.js',
  './js/palette-presets.js',
  './js/zoom.js',
  './js/onboarding.js',
  './js/app.js',
  './js/mixbox.js',
  './js/device-profile.js',
  './js/frame-scheduler.js',
  './js/base-painter.js',
  './js/heatmap.js',
  './js/wetpaper.js',
  './js/drip.js',
  './js/mixbox-painter.js',
  './js/km-painter.js',
  './js/brush-manager.js',
  './js/palette-storage.js',
  './js/updater.js',
  './js/announcer.js',
  './js/history-worker.js',
  './assets/km-lut.png',
  './icons/smudge.svg',
  './icons/brush.svg',
  './icons/eyedropper.svg',
  './icons/rect-select.svg',
  './icons/import-from-ps.svg',
  './icons/github.svg',
  './icons/discord.svg',
  './icons/caret-down.svg',
  './icons/eyedropper-cursor.svg'
];

// 快照里每个文件的绝对地址，同时是缓存的 key（请求的查询参数不参与匹配）
const SNAPSHOT_KEYS = new Set(CACHE_URLS.map((path) => new URL(path, self.location).href));

// 安装 - 整套拉取快照（dev 域跳过）
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中...');
  if (IS_DEV_HOST) {
    console.log('[SW] dev 域，跳过预缓存');
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    precacheSnapshot().then(() => {
      console.log('[SW] 安装完成');
      return self.skipWaiting();
    })
  );
});

/**
 * 每个文件都绕过浏览器 HTTP 缓存回源拉取：刚发布后浏览器里还留着旧文件（GitHub Pages 的 max-age=600），
 * 各文件新旧不一，拼出来的快照就是半新半旧（用 cache.addAll 时就中过这个招）。
 * cache: 'reload' 让浏览器不读 HTTP 缓存；查询参数让按完整 URL 缓存的中间层（如 Cloudflare Pages）也当成新地址，
 * GitHub Pages 的 CDN 不看查询参数，那一层只能等它自己过期。
 * 任何一个文件失败都让安装失败（旧 worker 继续服务，下次更新检查再试），不留半份快照。
 */
async function precacheSnapshot() {
  const existed = await caches.has(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  const bust = Date.now().toString(36);
  const results = await Promise.allSettled([...SNAPSHOT_KEYS].map(async (key) => {
    const res = await fetch(`${key}?sw=${bust}`, { cache: 'reload' });
    if (!res.ok || res.redirected) {
      throw new Error(`${key} → ${res.status}${res.redirected ? '（重定向）' : ''}`);
    }
    await cache.put(key, res);
  }));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length > 0) {
    if (!existed) await caches.delete(CACHE_NAME);
    const reason = failed[0].reason;
    throw new Error(`[SW] 预缓存失败 ${failed.length}/${results.length}：${(reason && reason.message) || reason}`);
  }
}

// 激活 - 清理旧快照，接管页面
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  event.waitUntil(activateAndRefreshPages());
});

async function activateAndRefreshPages() {
  // 只动自己的缓存：同一个域名（food211.github.io）下还有别的项目
  const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
  // dev 域清掉所有历史缓存，避免遗留污染
  const outdated = names.filter((name) => IS_DEV_HOST || name !== CACHE_NAME);

  // 升级：接管前就开着的页面是在旧 worker 下加载的，接管后它们后续的请求会改读新快照，
  // 页面就成了半旧半新，所以接管后要刷新。首次安装没有旧快照，页面本来就是新的，不用刷新。
  let stalePages = [];
  if (!IS_DEV_HOST && outdated.length > 0) {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    stalePages = clients.filter((client) => client.url.startsWith(self.registration.scope));
  }

  await Promise.all(outdated.map((name) => {
    console.log('[SW] 删除旧缓存:', name);
    return caches.delete(name);
  }));
  await self.clients.claim();
  console.log('[SW] 激活完成');

  // 不能 await：激活结束前，新页面的请求都排队等本 worker，等它们就是死锁
  stalePages.forEach((client) => {
    client.navigate(client.url).catch((err) => console.warn('[SW] 刷新页面失败:', client.url, err));
  });
}

// 更新检测数据：network-only，不走缓存（避免老用户永远拿不到新版本信息）
const UPDATE_META_PATHS = ['/versions.json', '/recent-changelogs.json'];

// 请求拦截
self.addEventListener('fetch', (event) => {
  // dev 域：完全不拦截，所有请求走真实网络
  if (IS_DEV_HOST) return;

  const request = event.request;
  // 只处理同源的 GET 请求
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // 更新元数据：network-only，失败不返回缓存
  const url = new URL(request.url);
  if (UPDATE_META_PATHS.some(p => url.pathname.endsWith(p))) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  const snapshotKey = url.origin + url.pathname;
  event.respondWith(
    SNAPSHOT_KEYS.has(snapshotKey)
      ? fromSnapshot(request, snapshotKey)
      : staleWhileRevalidate(event)
  );
});

// 快照里的文件：只读当前这一份快照
async function fromSnapshot(request, key) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(key, { ignoreVary: true });
  if (cached) return cached;

  // 快照里没有（理论上不会发生，比如缓存被手动清掉）：回源，但不写缓存，免得单个文件混进快照
  console.warn('[SW] 快照缺少文件，回源:', key);
  return fetch(request);
}

// 快照之外的同源资源（index.html、更新日志页等）：缓存优先，后台更新 (Stale-While-Revalidate)
async function staleWhileRevalidate(event) {
  const request = event.request;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached && !cached.redirected) {
    // 有缓存且非重定向，返回缓存并在后台更新
    console.log('[SW] 从缓存返回:', request.url);
    event.waitUntil(
      fetch(request, { redirect: 'follow' })
        .then((networkResponse) => {
          if (networkResponse.status === 200 && !networkResponse.redirected) {
            return cache.put(request, networkResponse.clone());
          }
        })
        .catch(() => {})
    );
    return cached;
  }

  // 无缓存或缓存是重定向响应，从网络获取
  console.log('[SW] 从网络获取:', request.url);
  const networkResponse = await fetch(request, { redirect: 'follow' });
  if (networkResponse.status === 200) {
    if (networkResponse.redirected) {
      // 重定向响应不能直接返回给FetchEvent，需要创建干净的副本
      return new Response(networkResponse.body, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers: networkResponse.headers
      });
    }
    event.waitUntil(cache.put(request, networkResponse.clone()).catch(() => {}));
  }
  return networkResponse;
}
