/**
 * 更新检测模块
 * 从远端 CHANGELOG.md 获取最新版本信息，若有新版本则显示更新提示弹窗
 */
const Updater = {
    CHANGELOG_URL: 'https://raw.githubusercontent.com/food211/Mixbox-Palette/main/CHANGELOG.md',
    CHANGELOG_PAGE: 'https://food211.github.io/Mixbox-Palette/changelog.html',
    STORAGE_KEY: 'mixbox_dismissed_update',
    CURRENT_VERSION: 'V1.0.3',

    /** 解析 CHANGELOG.md 文本，返回最新版本 { version, contentZH, contentEN } */
    _parseChangelog(text) {
        const parts = text.split(/^== (V[\d.]+) ==$/m);
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
                    const isImprovement = /improv|改进/i.test(title);
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

    async check() {
        try {
            const res = await fetch(this.CHANGELOG_URL, { cache: 'no-store' });
            if (!res.ok) return;
            const text = await res.text();
            const parsed = this._parseChangelog(text);
            if (!parsed) return;

            if (parsed.version === this.CURRENT_VERSION) return;

            const dismissed = localStorage.getItem(this.STORAGE_KEY);
            if (dismissed === parsed.version) return;

            this._showModal(parsed);
        } catch (e) {
            // 网络失败静默处理
        }
    },

    _showModal({ version, contentZH, contentEN }) {
        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'en';
        const isZH = lang === 'zh';

        const content = isZH ? contentZH || contentEN : contentEN || contentZH;
        const contentHtml = this._mdToHtml(content);

        const modal = document.getElementById('updateModal');
        const titleEl = document.getElementById('updateModalTitle');
        const bodyEl = document.getElementById('updateModalBody');
        const changelogLink = document.getElementById('updateChangelogLink');
        const closeBtn = document.getElementById('updateCloseBtn');
        const laterBtn = document.getElementById('updateLaterBtn');
        const dismissBtn = document.getElementById('updateDismissBtn');
        const refreshBtn = document.getElementById('updateRefreshBtn');

        titleEl.textContent = isZH
            ? `🆕 发现新版本 ${version}`
            : `🆕 New Version Available: ${version}`;
        bodyEl.innerHTML = contentHtml;
        changelogLink.textContent = isZH ? '查看完整更新日志 →' : 'View Full Changelog →';
        changelogLink.href = this.CHANGELOG_PAGE;
        laterBtn.textContent = isZH ? '稍后' : 'Later';
        dismissBtn.textContent = isZH ? '不再提示此版本' : "Don't remind me";
        refreshBtn.textContent = isZH ? '立即更新' : 'Update Now';

        closeBtn.onclick = () => modal.classList.remove('active');
        laterBtn.onclick = () => modal.classList.remove('active');
        dismissBtn.onclick = () => {
            localStorage.setItem(this.STORAGE_KEY, version);
            modal.classList.remove('active');
        };
        refreshBtn.onclick = () => {
            localStorage.setItem(this.STORAGE_KEY, version);
            location.reload(true);
        };

        modal.classList.add('active');
    },
};
