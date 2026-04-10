/**
 * Announcer — 统一管理更新弹窗与公告弹窗
 *
 * 流程：
 *   init() 被调用
 *     → 检查更新（Updater.check()）
 *         有新版本 → 弹更新弹窗，关闭后检查公告
 *         无新版本 → 直接检查公告
 *
 * 公告哈希：按当前语言取 title + content 生成，存储 key 带语言前缀
 *   mixbox_seen_announcement_zh_<hash>
 *   mixbox_seen_announcement_en_<hash>
 */

// ─── 当前公告内容（无公告时设为 null）───────────────────────────────────────
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

    /** djb2 哈希，返回 8 位十六进制字符串 */
    _hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) ^ str.charCodeAt(i);
            h = h >>> 0; // 转为无符号 32 位
        }
        return h.toString(16).padStart(8, '0');
    },

    /** 根据当前语言计算公告哈希及存储 key */
    _getAnnouncementKey(lang, ann) {
        const title = lang === 'zh' ? ann.titleZH : ann.titleEN;
        const content = lang === 'zh' ? ann.contentZH : ann.contentEN;
        const hash = this._hash(title + content);
        return `${this.STORAGE_PREFIX}${lang}_${hash}`;
    },

    /** 检查当前语言下公告是否已读 */
    _isSeen(lang, ann) {
        return !!localStorage.getItem(this._getAnnouncementKey(lang, ann));
    },

    /** 标记当前语言下公告为已读 */
    _markSeen(lang, ann) {
        localStorage.setItem(this._getAnnouncementKey(lang, ann), '1');
    },

    /**
     * 入口：检查更新，完成后检查公告
     * 替代原来 app.html 里的 setTimeout(() => Updater.check(), 3000)
     */
    async init() {
        const hasUpdate = await this._checkUpdate();
        if (hasUpdate) {
            // 更新弹窗关闭后再检查公告
            this._waitForModalClose('updateModal', () => this._checkAnnouncement());
        } else {
            this._checkAnnouncement();
        }
    },

    /**
     * 手动触发更新检查（版本号点击）
     * 不触发公告，直接走原 checkAndShow 逻辑
     */
    checkUpdate() {
        Updater.checkAndShow();
    },

    /**
     * 调用 Updater.check()，若有更新则弹窗并返回 true
     * 无更新返回 false
     */
    async _checkUpdate() {
        return new Promise(resolve => {
            Updater.check().then(hadUpdate => resolve(!!hadUpdate));
        });
    },

    /** 监听弹窗从 active 变为非 active，触发 callback */
    _waitForModalClose(modalId, callback) {
        const modal = document.getElementById(modalId);
        if (!modal) { callback(); return; }

        const observer = new MutationObserver(() => {
            if (!modal.classList.contains('active')) {
                observer.disconnect();
                callback();
            }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    },

    /** 检查并弹出公告弹窗 */
    _checkAnnouncement() {
        if (!CURRENT_ANNOUNCEMENT) return;

        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'en';
        if (this._isSeen(lang, CURRENT_ANNOUNCEMENT)) return;

        this._showAnnouncement(lang, CURRENT_ANNOUNCEMENT);
    },

    _showAnnouncement(lang, ann) {
        const isZH = lang === 'zh';
        const modal = document.getElementById('announcementModal');
        if (!modal) return;

        document.getElementById('announcementTitle').textContent =
            isZH ? ann.titleZH : ann.titleEN;

        // 正文：换行转 <br>
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
        const okBtn = document.getElementById('announcementOkBtn');
        okBtn.textContent = isZH ? '知道了' : 'Got it';

        const dismiss = () => {
            this._markSeen(lang, ann);
            modal.classList.remove('active');
        };

        closeBtn.onclick = dismiss;
        okBtn.onclick = dismiss;

        modal.classList.add('active');
    },
};
