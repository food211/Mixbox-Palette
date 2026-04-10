/**
 * Announcer — 统一管理更新弹窗与公告弹窗
 *
 * 流程（自动，页面加载后触发）：
 *   init()
 *     → Updater.check() 获取更新数据
 *         有更新 → 弹更新弹窗
 *                    用户点"稍后/不再提示/关闭" → 检查公告
 *                    用户点"立即更新"           → 刷新页面，结束
 *         无更新 → 直接检查公告
 *
 * 流程（手动，版本号点击触发）：
 *   checkUpdate()
 *     → Updater.checkAndFetch()
 *         有更新 → 弹更新弹窗（关闭后不触发公告）
 *         无更新 → 打开 changelog 页面
 *
 * 公告哈希：按当前语言取 title + content 生成
 *   存储 key：mixbox_seen_announcement_zh_<hash> / _en_<hash>
 */

// ─── 当前公告（无公告时设为 null）──────────────────────────────────────────
const CURRENT_ANNOUNCEMENT = {
    titleZH: '加入我们的 Discord 社区 🎨',
    titleEN: 'Join our Discord Community 🎨',
    contentZH: '欢迎加入 Mixbox Palette 官方 Discord！\n在这里你可以提交反馈、报告 Bug、与其他用户交流创作。',
    contentEN: 'Welcome to the official Mixbox Palette Discord!\nShare feedback, report bugs, and connect with other artists.',
    linkZH: '进入 Discord →',
    linkEN: 'Join Discord →',
    link: 'https://discord.gg/d3ubWGpe',
};
// ────────────────────────────────────────────────────────────────────────────

const Announcer = {
    STORAGE_PREFIX: 'mixbox_seen_announcement_',

    // ── 公告哈希工具 ──────────────────────────────────────────────────────

    /** djb2 哈希，返回 8 位十六进制字符串 */
    _hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) ^ str.charCodeAt(i);
            h = h >>> 0;
        }
        return h.toString(16).padStart(8, '0');
    },

    _getAnnouncementKey(lang, ann) {
        const title   = lang === 'zh' ? ann.titleZH   : ann.titleEN;
        const content = lang === 'zh' ? ann.contentZH : ann.contentEN;
        return `${this.STORAGE_PREFIX}${lang}_${this._hash(title + content)}`;
    },

    _isSeen(lang, ann) {
        return !!localStorage.getItem(this._getAnnouncementKey(lang, ann));
    },

    _markSeen(lang, ann) {
        localStorage.setItem(this._getAnnouncementKey(lang, ann), '1');
    },

    _getLang() {
        return (typeof I18N !== 'undefined') ? I18N.getLang() : 'en';
    },

    // ── 公开入口 ──────────────────────────────────────────────────────────

    /** 页面启动时调用：自动检查更新，完成后检查公告 */
    async init() {
        const updateData = await Updater.check();
        if (updateData) {
            this._showUpdateModal(updateData, { onDone: () => this._checkAnnouncement() });
        } else {
            this._checkAnnouncement();
        }
    },

    /** 版本号点击时调用：显示版本信息弹窗，包含最新 changelog，有更新则启用更新按钮 */
    async checkUpdate() {
        const result = await Updater.checkAndFetch();
        const hasUpdate = result !== 'open-changelog' && result !== null;
        this._showVersionModal(hasUpdate ? result : null);
    },

    /** 版本信息弹窗：始终显示版本号区域和最新 changelog，按需启用更新按钮 */
    async _showVersionModal(updateData) {
        const isZH = this._getLang() === 'zh';
        const t = (k) => (typeof I18N !== 'undefined') ? I18N.t(k) : k;

        const modal      = document.getElementById('updateModal');
        const titleEl    = document.getElementById('updateModalTitle');
        const versionInfo = document.getElementById('updateVersionInfo');
        const bodyEl     = document.getElementById('updateModalBody');
        const changelogLink = document.getElementById('updateChangelogLink');
        const closeBtn   = document.getElementById('updateCloseBtn');
        const laterBtn   = document.getElementById('updateLaterBtn');
        const dismissBtn = document.getElementById('updateDismissBtn');
        const refreshBtn = document.getElementById('updateRefreshBtn');

        // 标题
        titleEl.textContent = t('versionModalTitle');

        // 版本信息标签
        const appVer  = Updater.CURRENT_VERSION;
        const hostVer = (typeof getHostVersion === 'function') ? getHostVersion() : null;
        const swVer   = await caches.keys().then(keys => {
            const name = keys.find(k => k.startsWith('km-palette'));
            if (!name) return '—';
            const m = name.match(/-(v\d+)$/);
            return m ? m[1] : name;
        }).catch(() => '—');

        const appVerStr = updateData
            ? `${appVer} → ${updateData.version}`
            : appVer;
        const tags = [
            `${t('versionTagApp')}: ${appVerStr}`,
            ...(hostVer ? [`${t('versionTagHost')}: ${hostVer}`] : []),
            `${t('versionTagCache')}: ${swVer}`,
        ];
        versionInfo.innerHTML = tags.map(tag =>
            `<span class="update-version-tag">${tag}</span>`
        ).join('');

        // Changelog 内容（最新版本）
        if (updateData) {
            const content = isZH ? updateData.contentZH || updateData.contentEN : updateData.contentEN || updateData.contentZH;
            bodyEl.innerHTML = Updater._mdToHtml(content);
        } else {
            // 无更新：拉取本地当前版本的 changelog 展示
            bodyEl.innerHTML = `<p style="color:#6abf6a;">${t('versionUpToDate')}</p>`;
            try {
                const text = await fetch(Updater.CHANGELOG_URL, { cache: 'no-store' }).then(r => r.text());
                const parsed = Updater._parseChangelog(text);
                if (parsed) {
                    const content = isZH ? parsed.contentZH || parsed.contentEN : parsed.contentEN || parsed.contentZH;
                    bodyEl.innerHTML += Updater._mdToHtml(content);
                }
            } catch (e) { /* 离线时静默失败 */ }
        }

        changelogLink.textContent = isZH ? '查看完整更新日志 →' : 'View Full Changelog →';
        changelogLink.href = Updater.CHANGELOG_PAGE;

        // 按钮
        laterBtn.style.display   = updateData ? '' : 'none';
        dismissBtn.style.display = updateData ? '' : 'none';
        closeBtn.style.display   = updateData ? '' : '';

        if (updateData) {
            laterBtn.textContent   = isZH ? '稍后' : 'Later';
            dismissBtn.textContent = isZH ? '不再提示此版本' : "Don't remind me";
            refreshBtn.textContent = isZH ? '立即更新' : 'Update Now';
            refreshBtn.disabled    = false;
        } else {
            refreshBtn.textContent = isZH ? '已是最新版本' : 'Up to Date';
            refreshBtn.disabled    = true;
        }

        const close = (dismissed) => {
            if (dismissed && updateData) localStorage.setItem(Updater.STORAGE_KEY, updateData.version);
            modal.classList.remove('active');
        };

        closeBtn.onclick   = () => close(false);
        laterBtn.onclick   = () => close(false);
        dismissBtn.onclick = () => close(true);
        refreshBtn.onclick = updateData ? () => {
            localStorage.setItem(Updater.STORAGE_KEY, updateData.version);
            this._showReloadOverlay();
        } : null;

        modal.classList.add('active');
    },

    // ── 更新弹窗 ──────────────────────────────────────────────────────────

    _showUpdateModal({ version, contentZH, contentEN }, { onDone }) {
        const lang  = this._getLang();
        const isZH  = lang === 'zh';
        const content     = isZH ? contentZH || contentEN : contentEN || contentZH;
        const contentHtml = Updater._mdToHtml(content);

        const modal      = document.getElementById('updateModal');
        const titleEl    = document.getElementById('updateModalTitle');
        const bodyEl     = document.getElementById('updateModalBody');
        const changelogLink = document.getElementById('updateChangelogLink');
        const closeBtn   = document.getElementById('updateCloseBtn');
        const laterBtn   = document.getElementById('updateLaterBtn');
        const dismissBtn = document.getElementById('updateDismissBtn');
        const refreshBtn = document.getElementById('updateRefreshBtn');

        titleEl.textContent = isZH
            ? `🆕 发现新版本 ${version}`
            : `🆕 New Version Available: ${version}`;
        bodyEl.innerHTML = contentHtml;
        changelogLink.textContent = isZH ? '查看完整更新日志 →' : 'View Full Changelog →';
        changelogLink.href = Updater.CHANGELOG_PAGE;
        laterBtn.textContent  = isZH ? '稍后' : 'Later';
        dismissBtn.textContent = isZH ? '不再提示此版本' : "Don't remind me";
        refreshBtn.textContent = isZH ? '立即更新' : 'Update Now';

        const close = (dismissed) => {
            if (dismissed) localStorage.setItem(Updater.STORAGE_KEY, version);
            modal.classList.remove('active');
            if (onDone) onDone();
        };

        closeBtn.onclick  = () => close(false);
        laterBtn.onclick  = () => close(false);
        dismissBtn.onclick = () => close(true);
        refreshBtn.onclick = () => {
            localStorage.setItem(Updater.STORAGE_KEY, version);
            this._showReloadOverlay();
        };

        modal.classList.add('active');
    },

    _showReloadOverlay() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#2b2b2b;display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:10000;';
        const icon = document.createElement('div');
        icon.style.cssText = 'font-size:48px;margin-bottom:20px;';
        icon.textContent = '🎨';
        const isZH = this._getLang() === 'zh';
        const text = document.createElement('div');
        text.style.cssText = 'color:#e0e0e0;font-size:14px;';
        text.textContent = isZH ? '正在更新，请稍候' : 'Updating, please wait';
        const dots = document.createElement('span');
        dots.textContent = '';
        text.appendChild(dots);
        let dotCount = 0;
        setInterval(() => { dotCount = (dotCount + 1) % 4; dots.textContent = '.'.repeat(dotCount); }, 400);
        overlay.appendChild(icon);
        overlay.appendChild(text);
        document.body.appendChild(overlay);

        if (navigator.serviceWorker) {
            navigator.serviceWorker.getRegistrations().then(regs =>
                Promise.all(regs.map(r => r.unregister())).then(() =>
                    caches.keys().then(keys =>
                        Promise.all(keys.map(k => caches.delete(k))).finally(() => location.reload(true))
                    )
                )
            );
        } else {
            location.reload(true);
        }
    },

    // ── 公告弹窗 ──────────────────────────────────────────────────────────

    _checkAnnouncement() {
        if (!CURRENT_ANNOUNCEMENT) return;
        const lang = this._getLang();
        if (this._isSeen(lang, CURRENT_ANNOUNCEMENT)) return;
        this._showAnnouncement(lang, CURRENT_ANNOUNCEMENT);
    },

    _showAnnouncement(lang, ann) {
        const isZH  = lang === 'zh';
        const modal = document.getElementById('announcementModal');
        if (!modal) return;

        document.getElementById('announcementTitle').textContent =
            isZH ? ann.titleZH : ann.titleEN;

        const contentEl = document.getElementById('announcementContent');
        const raw = isZH ? ann.contentZH : ann.contentEN;
        contentEl.innerHTML = raw
            .split('\n')
            .map(l => l.trim() ? `<p>${l}</p>` : '')
            .join('');

        const linkEl = document.getElementById('announcementLink');
        linkEl.textContent = isZH ? ann.linkZH : ann.linkEN;
        linkEl.onclick = () => {
            this._markSeen(lang, ann);
            modal.classList.remove('active');
            openExternalURL(ann.link);
        };

        const closeBtn = document.getElementById('announcementCloseBtn');
        const okBtn    = document.getElementById('announcementOkBtn');
        okBtn.textContent = isZH ? '知道了' : 'Got it';

        const dismiss = () => {
            this._markSeen(lang, ann);
            modal.classList.remove('active');
        };
        closeBtn.onclick = dismiss;
        okBtn.onclick    = dismiss;

        modal.classList.add('active');
    },
};
