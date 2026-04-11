/**
 * 更新检测模块（数据层）
 * 只负责 fetch CHANGELOG、解析版本数据，不操作 DOM，不管理弹窗。
 * 弹窗逻辑全部由 Announcer 负责。
 */
const Updater = {
    CHANGELOG_URL: 'https://raw.githubusercontent.com/food211/Mixbox-Palette/main/CHANGELOG.md',
    CHANGELOG_PAGE: 'https://food211.github.io/Mixbox-Palette/changelog.html',
    STORAGE_KEY: 'mixbox_dismissed_update',
    CURRENT_VERSION: 'V1.3.4b',

    /** 解析 CHANGELOG.md 文本，返回最新版本 { version, contentZH, contentEN } */
    _parseChangelog(text) {
        const parts = text.split(/^== (V[\d.]+[a-z]?) ==$/m);
        if (parts.length < 3) return null;

        const version = parts[1].trim();
        const body = parts[2] || '';
        const zhMatch = body.match(/\[ZH\]([\s\S]*?)(?=\[EN\]|$)/);
        const enMatch = body.match(/\[EN\]([\s\S]*?)(?=\[ZH\]|== |$)/);

        return {
            version,
            contentZH: zhMatch ? zhMatch[1].trim() : '',
            contentEN: enMatch ? enMatch[1].trim() : '',
        };
    },

    /** 将 markdown 列表转为简单 HTML（支持加粗和链接） */
    _mdToHtml(md) {
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
     * 自动检查更新。
     * 返回需要展示的更新数据 { version, contentZH, contentEN }，
     * 或 null（无更新 / 已忽略 / 网络失败）。
     */
    async check() {
        try {
            const res = await fetch(this.CHANGELOG_URL, { cache: 'no-store' });
            if (!res.ok) return null;
            const text = await res.text();
            const parsed = this._parseChangelog(text);
            if (!parsed) return null;
            if (parsed.version === this.CURRENT_VERSION) return null;
            const dismissed = localStorage.getItem(this.STORAGE_KEY);
            if (dismissed === parsed.version) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    },

    /**
     * 手动触发检查（版本号点击）。
     * 返回更新数据，或 null（已是最新 / 网络失败）。
     * 网络失败时返回特殊标记 'open-changelog'，由 Announcer 决定打开页面。
     */
    async checkAndFetch() {
        try {
            const res = await fetch(this.CHANGELOG_URL, { cache: 'no-store' });
            if (!res.ok) return 'open-changelog';
            const text = await res.text();
            const parsed = this._parseChangelog(text);
            if (!parsed || parsed.version === this.CURRENT_VERSION) return 'open-changelog';
            return parsed;
        } catch (e) {
            return 'open-changelog';
        }
    },
};
