/**
 * 国际化 (i18n) 模块
 * 支持英文 (en) 和中文 (zh)
 */
const I18N = {
    _lang: 'en',
    _STORAGE_KEY: 'mixbox_lang',

    translations: {
        en: {
            title: '🎨 Mixbox Palette',
            switchPalette: 'Palette',
            clear: 'Clear',
            brushSize: 'Brush Size',
            paintConcentration: 'Concentration',
            selectBrush: 'Select Brush',
            undo: 'Undo',
            redo: 'Redo',
            smudgeTool: 'Smudge Tool',
            eyedropperTool: 'Eyedropper (Alt)',
            mixArea: 'Mixing Area',
            foreground: 'Foreground',
            background: 'Background',
            instructions: 'Instructions:',
            inst1: '<strong>Click paint</strong> → Select color and paint on canvas',
            inst2: '<strong>Click brush icon</strong> → Select brush',
            inst3: '<strong>Alt + Left Click canvas</strong> → Pick as foreground',
            inst4: '<strong>Alt + Right Click canvas</strong> → Pick as background',
            inst5: 'Click ↶ Undo / ↷ Redo',
            statusDraw: '• Mode: <strong>Draw</strong>',
            statusEyedropperFg: '• Mode: <strong style="color: #1473e6;">Eyedropper (FG)</strong>',
            statusEyedropperBg: '• Mode: <strong style="color: #44b556;">Eyedropper (BG)</strong>',
            selectBrushModal: 'Select Brush',
            mixStrengthLabel: 'Mix Strength:',

            // 调色盘名称
            paletteName_winsorNewtonCotman: 'Winsor & Newton Cotman 16',
            paletteName_digitalArtist: 'Digital Artist Palette',
            paletteName_schminckeHoradam: 'Schmincke Horadam 16',
            paletteName_kuretakeGansai: 'Kuretake Gansai 16',

            // 笔刷名称
            brush_circle: 'Circle',
            brush_soft: 'Soft',
            brush_watercolor: 'Watercolor',
            brush_splatter: 'Splatter',
            brush_flat: 'Flat',
            brush_dry: 'Dry',
        },
        zh: {
            title: '🎨 Mixbox 调色板',
            switchPalette: '切换颜料',
            clear: '清空',
            brushSize: '笔刷大小',
            paintConcentration: '颜料浓度',
            selectBrush: '选择笔刷',
            undo: '撤销',
            redo: '重做',
            smudgeTool: '涂抹工具',
            eyedropperTool: '吸管工具 (Alt)',
            mixArea: '混色区',
            foreground: '前景色',
            background: '背景色',
            instructions: '操作说明：',
            inst1: '<strong>点击颜料</strong> → 选择颜色后在调色区绘制',
            inst2: '<strong>点击笔刷图标</strong> → 选择/上传笔刷',
            inst3: '<strong>Alt + 左键点击画布</strong> → 取色为前景色',
            inst4: '<strong>Alt + 右键点击画布</strong> → 取色为背景色',
            inst5: '点击 ↶ 撤销 / ↷ 重做',
            statusDraw: '• 当前模式: <strong>绘制</strong>',
            statusEyedropperFg: '• 当前模式: <strong style="color: #1473e6;">吸管 (前景色)</strong>',
            statusEyedropperBg: '• 当前模式: <strong style="color: #44b556;">吸管 (背景色)</strong>',
            selectBrushModal: '选择笔刷',
            mixStrengthLabel: '混色强度:',

            paletteName_winsorNewtonCotman: '温莎牛顿 Cotman 16色',
            paletteName_digitalArtist: '数字艺术家调色板',
            paletteName_schminckeHoradam: '施美尔 Horadam 16色',
            paletteName_kuretakeGansai: '吴竹 Gansai 16色',

            brush_circle: '圆形',
            brush_soft: '柔边',
            brush_watercolor: '水彩',
            brush_splatter: '喷溅',
            brush_flat: '扁平笔',
            brush_dry: '干笔刷',
        }
    },

    init() {
        const saved = localStorage.getItem(this._STORAGE_KEY);
        if (saved && this.translations[saved]) {
            this._lang = saved;
        } else {
            // 跟随系统语言：中文系统默认中文，其他默认英文
            const sysLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
            this._lang = sysLang.startsWith('zh') ? 'zh' : 'en';
        }
    },

    getLang() {
        return this._lang;
    },

    setLang(lang) {
        if (this.translations[lang]) {
            this._lang = lang;
            localStorage.setItem(this._STORAGE_KEY, lang);
        }
    },

    t(key) {
        return this.translations[this._lang][key] || this.translations['en'][key] || key;
    },

    /** 获取调色盘本地化名称 */
    paletteName(paletteKey) {
        return this.t('paletteName_' + paletteKey);
    },

    /** 获取笔刷本地化名称 */
    brushName(brushType) {
        return this.t('brush_' + brushType);
    },

    /** 获取颜色tooltip名称 (EN用name, ZH用nameCN) */
    colorName(colorObj) {
        return this._lang === 'zh' ? colorObj.nameCN : colorObj.name;
    },

    /** 更新所有带 data-i18n 属性的 DOM 元素 */
    applyToDOM() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = text;
            } else {
                el.innerHTML = text;
            }
        });

        // 更新 data-i18n-title 属性 (tooltips)
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = this.t(key);
        });
    }
};

// 初始化
I18N.init();

// 全局快捷函数
function t(key) {
    return I18N.t(key);
}
