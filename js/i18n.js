/**
 * 国际化 (i18n) 模块
 * 支持英文 (en) / 中文 (zh) / 日文 (ja)
 *
 * 翻译文本存储在 locales/translations.csv，通过 scripts/gen-i18n.js 构建成
 * js/i18n-translations.js（挂到 window.I18N_TRANSLATIONS）。
 * 本文件只含转译逻辑，不含翻译文本。
 */
const I18N = {
    _lang: 'en',
    _STORAGE_KEY: 'mixbox_lang',
    _FALLBACK: 'en',
    _LANG_ORDER: ['en', 'zh', 'ja'],

    get translations() {
        return window.I18N_TRANSLATIONS || {};
    },

    /**
     * 初始化语言。调用方必须保证 window.I18N_TRANSLATIONS 已就位（由 loadAppScripts 串行保证）。
     */
    init() {
        const saved = localStorage.getItem(this._STORAGE_KEY);
        if (saved && this.translations[saved]) {
            this._lang = saved;
        } else {
            const sysLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
            if (sysLang.startsWith('zh') && this.translations.zh) this._lang = 'zh';
            else if (sysLang.startsWith('ja') && this.translations.ja) this._lang = 'ja';
            else this._lang = 'en';
        }
        this._syncDocLang();
    },

    _syncDocLang() {
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.lang = this._lang;
        }
    },

    getLang() {
        return this._lang;
    },

    setLang(lang) {
        if (this.translations[lang]) {
            this._lang = lang;
            localStorage.setItem(this._STORAGE_KEY, lang);
            this._syncDocLang();
        }
    },

    /** 在 en → zh → ja → en 之间循环切换 */
    nextLang() {
        const order = this._LANG_ORDER.filter(l => this.translations[l]);
        const idx = order.indexOf(this._lang);
        return order[(idx + 1) % order.length];
    },

    /**
     * 转译：查 key 返回当前语言的纯文本。
     * - key 未找到时 fallback 到英文，再找不到返回 key 本身
     * - 第二个参数为变量字典，会替换文本中的 {name} 占位符
     */
    t(key, vars) {
        const dict = this.translations[this._lang] || {};
        const fb = this.translations[this._FALLBACK] || {};
        let text = dict[key];
        if (text === undefined || text === '') text = fb[key];
        if (text === undefined) return key;
        if (vars) {
            text = text.replace(/\{(\w+)\}/g, (m, name) =>
                Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m
            );
        }
        return text;
    },

    paletteName(paletteKey) {
        return this.t('paletteName_' + paletteKey);
    },

    brushName(brushType) {
        return this.t('brush_' + brushType);
    },

    /**
     * 颜色名：EN 用 name，ZH 用 nameCN，JA 暂 fallback 到 name（专业水彩圈对英文色名熟悉）。
     * 未来如果数据源添加 nameJA，在此按 _lang 分支即可。
     */
    colorName(colorObj) {
        if (this._lang === 'zh') return colorObj.nameCN || colorObj.name;
        return colorObj.name;
    },

    /**
     * 扫描 DOM：
     *   - [data-i18n]        → element.textContent = t(key)  (纯文本，无 HTML)
     *   - [data-i18n-html]   → element.innerHTML = t(key)    (少数保留 HTML 的 key)
     *   - [data-i18n-title]  → element.title = t(key)
     *   - input/textarea 上的 data-i18n → 改 placeholder
     */
    applyToDOM() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = text;
            } else {
                el.textContent = text;
            }
        });
        document.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            el.innerHTML = this.t(key);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = this.t(key);
        });
    }
};

// 注意：不在此处自动 init。由 app.html 的 loadAppScripts 在 i18n-translations.js
// 加载完成后显式调用 I18N.init()，确保时序可控。

function t(key, vars) {
    return I18N.t(key, vars);
}
