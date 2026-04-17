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
        if (updateData && updateData.error) {
            // 处理错误情况，但仍然继续检查公告
            if (updateData.timeout) {
                console.warn('更新检查超时');
            } else {
                console.warn('更新检查失败');
            }
            this._checkAnnouncement();
        } else if (updateData) {
            this._showUpdateModal(updateData, { onDone: () => this._checkAnnouncement() });
        } else {
            this._checkAnnouncement();
        }
    },

    /** 版本号点击时调用：立即显示弹窗，在窗口内异步加载检查结果 */
    async checkUpdate() {
        const isZH = this._getLang() === 'zh';
        const t = (k) => (typeof I18N !== 'undefined') ? I18N.t(k) : k;

        const modal         = document.getElementById('updateModal');
        const titleEl       = document.getElementById('updateModalTitle');
        const versionInfo   = document.getElementById('updateVersionInfo');
        const copyBtn       = document.getElementById('updateCopyBtn');
        const bodyEl        = document.getElementById('updateModalBody');
        const changelogLink = document.getElementById('updateChangelogLink');
        const closeBtn      = document.getElementById('updateCloseBtn');
        const laterBtn      = document.getElementById('updateLaterBtn');
        const dismissBtn    = document.getElementById('updateDismissBtn');
        const refreshBtn    = document.getElementById('updateRefreshBtn');

        // 标题
        titleEl.textContent = t('versionModalTitle');

        // 版本信息标签（本地数据，立即可用）
        const appVer  = Updater.CURRENT_VERSION;
        const hostVer = (typeof getHostVersion === 'function') ? getHostVersion() : null;
        // Service Worker 版本（通过缓存名称解析，格式为 km-palette-v{version}）
        const swVer   = await caches.keys().then(keys => {
            const name = keys.find(k => k.startsWith('km-palette'));
            if (!name) return '—';
            const m = name.match(/-(v\d+)$/);
            return m ? m[1] : name;
        }).catch(() => '—');

        const buildTags = (appVerStr) => {
        // 检查是否有箭头，表示有更新版本
        if (appVerStr.includes('→')) {
            const [currentVer, targetVer] = appVerStr.split('→').map(v => v.trim());
            return [
                `${t('versionTagApp')}: ${currentVer} → <span style="color:#6abf6a">${targetVer}</span>`,
                ...(hostVer ? [`${t('versionTagHost')}: ${hostVer}`] : []),
                `${t('versionTagCache')}: ${swVer}`,
            ];
            } else {
                return [
                    `${t('versionTagApp')}: ${appVerStr}`,
                    ...(hostVer ? [`${t('versionTagHost')}: ${hostVer}`] : []),
                    `${t('versionTagCache')}: ${swVer}`,
                ];
            }
        };

        let currentTags = buildTags(appVer);
        versionInfo.innerHTML = currentTags.map(tag =>
            `<span class="update-version-tag">${tag}</span>`
        ).join('');

        copyBtn.textContent = t('versionCopyBtn');
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(currentTags.join(' | ')).then(() => {
                copyBtn.textContent = t('versionCopied');
                setTimeout(() => { copyBtn.textContent = t('versionCopyBtn'); }, 2000);
            });
        };

        // 初始状态：正在获取
        bodyEl.innerHTML     = `<p style="color:#888;">${isZH ? '正在获取版本信息…' : 'Fetching version info…'}</p>`;
        changelogLink.textContent = '';
        changelogLink.href   = '#';
        laterBtn.style.display   = 'none';
        dismissBtn.style.display = 'none';
        closeBtn.style.display   = '';
        refreshBtn.textContent   = isZH ? '检查中…' : 'Checking…';
        refreshBtn.disabled      = true;

        const close = (dismissed, updateData) => {
            if (dismissed && updateData) localStorage.setItem(Updater.STORAGE_KEY, updateData.latest);
            modal.classList.remove('active');
        };
        closeBtn.onclick   = () => close(false, null);
        laterBtn.onclick   = () => close(false, null);
        dismissBtn.onclick = () => close(true, null);

        // 立即显示弹窗
        modal.classList.add('active');

        // 异步发起网络检查
        const result = await Updater.checkAndFetch();

        // 处理错误情况
        if (result && result.error) {
            if (result.timeout) {
                bodyEl.innerHTML = `<p style="color:#e67e22;">${isZH ? '请求超时，请检查网络连接' : 'Request timed out. Please check your network connection.'}</p>`;
            } else {
                bodyEl.innerHTML = `<p style="color:#e74c3c;">${isZH ? '检查更新失败，请稍后再试' : 'Failed to check for updates. Please try again later.'}</p>`;
            }
            changelogLink.textContent = isZH ? '查看完整更新日志 →' : 'View Full Changelog →';
            changelogLink.href = Updater.CHANGELOG_PAGE;
            refreshBtn.textContent = isZH ? '重试' : 'Retry';
            refreshBtn.disabled = false;
            refreshBtn.onclick = () => {
                this.checkUpdate();
            };
            return;
        }

        const updateData = (result !== null) ? result : null;

        // 有更新时更新版本标签
        if (updateData) {
            currentTags = buildTags(`${appVer} → ${updateData.latest}`);
            versionInfo.innerHTML = currentTags.map(tag =>
                `<span class="update-version-tag">${tag}</span>`
            ).join('');
        }

        // 填充 changelog
        if (updateData) {
            bodyEl.innerHTML = this._renderVersionsHtml(updateData, isZH);
        } else {
            bodyEl.innerHTML = `<p style="color:#6abf6a;">${t('versionUpToDate')}</p>`;
            // 已最新：展示当前版本（recent-changelogs 的第一条）的更新说明
            try {
                const recent = await fetch(Updater.RECENT_URL, { cache: 'no-store' }).then(r => r.json());
                const cur = (recent.versions || []).find(v => v.version === appVer) || (recent.versions || [])[0];
                if (cur) {
                    const content = isZH ? cur.zh || cur.en : cur.en || cur.zh;
                    bodyEl.innerHTML += Updater._mdToHtml(content);
                }
            } catch (e) { /* 离线时静默失败 */ }
        }

        changelogLink.textContent = isZH ? '查看完整更新日志 →' : 'View Full Changelog →';
        changelogLink.href = Updater.CHANGELOG_PAGE;

        // 更新按钮状态
        laterBtn.style.display   = updateData ? '' : 'none';
        dismissBtn.style.display = updateData ? '' : 'none';
        if (updateData) {
            laterBtn.textContent   = isZH ? '稍后' : 'Later';
            dismissBtn.textContent = isZH ? '不再提示此版本' : "Don't remind me";
            refreshBtn.textContent = isZH ? '立即更新' : 'Update Now';
            refreshBtn.disabled    = false;
            dismissBtn.onclick     = () => close(true, updateData);
            refreshBtn.onclick     = () => {
                localStorage.setItem(Updater.STORAGE_KEY, updateData.latest);
                this._showReloadOverlay();
            };
        } else {
            refreshBtn.textContent = isZH ? '已是最新版本' : 'Up to Date';
            refreshBtn.disabled    = true;
        }
    },

    // ── 更新弹窗 ──────────────────────────────────────────────────────────

    /** 把 updateData.versions 数组渲染为多版本堆叠 HTML */
    _renderVersionsHtml(data, isZH) {
        const shown = data.versions;
        const parts = shown.map(v => {
            const content = isZH ? v.zh || v.en : v.en || v.zh;
            const label = isZH ? `版本 ${v.version}` : `Version ${v.version}`;
            return `<div class="update-version-block"><p class="update-version-label">${label}</p>${Updater._mdToHtml(content)}</div>`;
        });
        // 超过展示数量时附加"还有更多"提示
        if (data.totalNewer > shown.length) {
            const more = data.totalNewer - shown.length;
            const moreText = isZH
                ? `还有 ${more} 个较早版本的更新，查看完整日志了解详情 →`
                : `${more} earlier version(s) not shown. View full changelog for details →`;
            parts.push(`<p class="update-more-hint">${moreText}</p>`);
        }
        return parts.join('');
    },

    _showUpdateModal(data, { onDone }) {
        const lang  = this._getLang();
        const isZH  = lang === 'zh';

        const track = (name, params) => {
            try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch (_) {}
        };
        track('update_modal_shown', { from_version: Updater.CURRENT_VERSION, to_version: data.latest });

        const modal      = document.getElementById('updateModal');
        const titleEl    = document.getElementById('updateModalTitle');
        const bodyEl     = document.getElementById('updateModalBody');
        const changelogLink = document.getElementById('updateChangelogLink');
        const closeBtn   = document.getElementById('updateCloseBtn');
        const laterBtn   = document.getElementById('updateLaterBtn');
        const dismissBtn = document.getElementById('updateDismissBtn');
        const refreshBtn = document.getElementById('updateRefreshBtn');

        titleEl.textContent = isZH
            ? `🆕 发现新版本 ${data.latest}`
            : `🆕 New Version Available: ${data.latest}`;
        bodyEl.innerHTML = this._renderVersionsHtml(data, isZH);
        changelogLink.textContent = isZH ? '查看完整更新日志 →' : 'View Full Changelog →';
        changelogLink.href = Updater.CHANGELOG_PAGE;
        laterBtn.textContent  = isZH ? '稍后' : 'Later';
        dismissBtn.textContent = isZH ? '不再提示此版本' : "Don't remind me";
        refreshBtn.textContent = isZH ? '立即更新' : 'Update Now';

        const close = (dismissed) => {
            if (dismissed) localStorage.setItem(Updater.STORAGE_KEY, data.latest);
            modal.classList.remove('active');
            if (onDone) onDone();
        };

        const trackAction = (action) => track('update_action', { action, to_version: data.latest });
        closeBtn.onclick  = () => { trackAction('close'); close(false); };
        laterBtn.onclick  = () => { trackAction('later'); close(false); };
        dismissBtn.onclick = () => { trackAction('dismiss'); close(true); };
        refreshBtn.onclick = () => {
            trackAction('refresh');
            localStorage.setItem(Updater.STORAGE_KEY, data.latest);
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
