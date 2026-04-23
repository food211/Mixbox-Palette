/**
 * 更新检测模块（数据层）
 * 读取同源 versions.json（轻量）+ recent-changelogs.json（最近 N 版）
 * 由 scripts/gen-versions.js 在发布时生成，SW 对这两个文件做 network-only
 * 不操作 DOM，不管理弹窗；弹窗逻辑由 Announcer 负责。
 */
const Updater = {
    VERSIONS_URL: 'versions.json',
    RECENT_URL: 'recent-changelogs.json',
    CHANGELOG_PAGE: 'https://food211.github.io/Mixbox-Palette/changelog.html',
    STORAGE_KEY: 'mixbox_dismissed_update',
    CURRENT_VERSION: 'V1.5.2',

    /** 将 markdown 列表转为简单 HTML（支持加粗和链接） */
    _mdToHtml(md) {
        if (!md) return '';
        return md
            .split('\n')
            .map(line => {
                line = line
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');
                if (/^###\s+/.test(line)) {
                    const title = line.replace(/^###\s+/, '');
                    const isImprovement = /improv|优化|改进/i.test(title);
                    const color = isImprovement ? '#7a9ab5' : '#7a9e8a';
                    return '<p class="update-section-title" style="color:' + color + '">' + title + '</p>';
                }
                if (/^-\s+/.test(line)) {
                    return '<p class="update-item">• ' + line.replace(/^-\s+/, '') + '</p>';
                }
                if (line.trim()) {
                    return '<p>' + line + '</p>';
                }
                return '';
            })
            .filter(Boolean)
            .join('');
    },

    /**
     * 检测到新版本后，静默触发 SW 后台更新。
     * 新 SW 的 install 会预缓存 CACHE_URLS，配合 skipWaiting+clients.claim，
     * 用户下次 reload 就能拿到完整一致的新版本资源，避免新旧文件混用。
     */
    _triggerSwUpdate() {
        if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
        navigator.serviceWorker.getRegistration()
            .then(reg => { if (reg) reg.update(); })
            .catch(() => {});
    },

    /** 带超时的 fetch */
    async _fetchWithTimeout(url, options = {}, timeout = 5000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') throw new Error('请求超时');
            throw error;
        }
    },

    /** 截取 all 数组中比 CURRENT_VERSION 更新的版本号（按原顺序） */
    _newerVersions(all) {
        const i = all.indexOf(this.CURRENT_VERSION);
        if (i === -1) return all; // 当前版本不在列表：全部视为新（极端情况）
        return all.slice(0, i);
    },

    /**
     * 自动检查更新。
     * 返回 { latest, versions: [{version, zh, en}] } | null（无更新/已忽略） | { error, timeout }
     */
    async check() {
        try {
            const versionsRes = await this._fetchWithTimeout(this.VERSIONS_URL, { cache: 'no-store' });
            if (!versionsRes.ok) return { error: true };
            const versions = await versionsRes.json();
            if (versions.latest === this.CURRENT_VERSION) return null;
            this._triggerSwUpdate();
            const dismissed = localStorage.getItem(this.STORAGE_KEY);
            if (dismissed === versions.latest) return null;

            const newerKeys = this._newerVersions(versions.all || []);
            if (newerKeys.length === 0) return null;

            const recentRes = await this._fetchWithTimeout(this.RECENT_URL, { cache: 'no-store' });
            if (!recentRes.ok) return { error: true };
            const recent = await recentRes.json();
            const shown = (recent.versions || []).filter(v => newerKeys.includes(v.version));
            if (shown.length === 0) return null;

            return { latest: versions.latest, versions: shown, totalNewer: newerKeys.length };
        } catch (e) {
            return { error: true, timeout: e.message === '请求超时' };
        }
    },

    /**
     * 手动触发检查（点击版本号）。不考虑 dismissed。
     * 返回 { latest, versions, totalNewer } | null（已最新） | { error, timeout }
     */
    async checkAndFetch() {
        try {
            const versionsRes = await this._fetchWithTimeout(this.VERSIONS_URL, { cache: 'no-store' });
            if (!versionsRes.ok) return { error: true };
            const versions = await versionsRes.json();
            if (versions.latest === this.CURRENT_VERSION) return null;
            this._triggerSwUpdate();

            const newerKeys = this._newerVersions(versions.all || []);
            if (newerKeys.length === 0) return null;

            const recentRes = await this._fetchWithTimeout(this.RECENT_URL, { cache: 'no-store' });
            if (!recentRes.ok) return { error: true };
            const recent = await recentRes.json();
            const shown = (recent.versions || []).filter(v => newerKeys.includes(v.version));
            if (shown.length === 0) return null;

            return { latest: versions.latest, versions: shown, totalNewer: newerKeys.length };
        } catch (e) {
            return { error: true, timeout: e.message === '请求超时' };
        }
    },
};
