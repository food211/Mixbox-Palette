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
            brushSize: 'Size',
            brushSpacing: 'Sp.',
            brushWetness: 'Wet',
            paintConcentration: 'Conc.',
            smudgeStrength: 'Str.',
            brushSizeTitle: 'Brush Size',
            brushSpacingTitle: 'Brush Spacing',
            brushWetnessTitle: 'Watercolor Wetness',
            paintConcentrationTitle: 'Paint Concentration',
            smudgeStrengthTitle: 'Smudge Strength',
            brushLabel: 'Brush',
            selectBrush: 'Select Brush',
            undo: 'Undo',
            redo: 'Redo',
            smudgeTool: 'Smudge (S)',
            eyedropperTool: 'Eyedropper (I)',
            mixArea: 'Mixing Area',
            foreground: 'FG',
            background: 'BG',
            instructions: 'Instructions',
            inst1: '<strong>Left/Right Click paint</strong> → Select as foreground/background color',
            inst2: '<strong>Click brush icon</strong> → Switch brush texture',
            inst3: '<strong>Alt + Left Click canvas</strong> → Pick as foreground',
            inst4: '<strong>Alt + Right Click canvas</strong> → Pick as background',
            inst5: 'Click ↶ Undo / ↷ Redo',
            inst8: '<strong>Click version number</strong> → Check for updates',
            inst9: 'UI display issues? Press <strong>F5</strong> to reload from remote',
            statusDraw: '• Mode: <strong style="color: #e8a838;">Draw</strong>',
            statusSmudge: '• Mode: <strong style="color: #c87dd4;">Smudge</strong>',
            statusEyedropperFg: '• Mode: <strong style="color: #1473e6;">Eyedropper (FG)</strong>',
            statusEyedropperBg: '• Mode: <strong style="color: #44b556;">Eyedropper (BG)</strong>',
            selectBrushModal: 'Select Brush',
            mixStrengthLabel: 'Mix Strength:',

            // 调色盘名称
            paletteName_winsorNewtonCotman: 'Winsor & Newton Cotman 16',
            paletteName_digitalArtist: 'Digital Artist Palette',
            paletteName_schminckeHoradam: 'Schmincke Horadam 16',
            paletteName_kuretakeGansai: 'Kuretake Gansai 16',

            switchLanguage: 'Switch Language (EN / ZH)',
            versionModalTitle: 'Version Info',
            versionUpToDate: '✓ Up to date',
            versionTagApp: 'App',
            versionTagHost: 'Host',
            versionTagCache: 'Cache',
            versionCopyBtn: 'Copy',
            versionCopied: 'Copied!',
            zoomTitle: 'Zoom — Zoom in expands canvas size, zoom out does not',
            switchEngine: 'Switch Mixing Engine (Mixbox / KM)',
            focusHint: 'Hold Space + click PS canvas to return shortcuts',
            inst6: 'Hold <strong>Space</strong> + click <strong>PS canvas</strong> → Return shortcuts to PS',
            inst7: '<strong>Drag panel left/right edge</strong> → Resize canvas',
            saveCanvas: 'Save PNG',
            saveCanvasTitle: 'Save canvas as PNG image',
            rectSelectTool: 'Send to PS (M)',
            statusRectSelect: '• Mode: <strong style="color: #FF9800;">Rect Select → PS</strong>',
            rectSelectNoSelection: 'No active selection in Photoshop. Please create a selection first.',
            rectSelectNoDocument: 'No document open in Photoshop.',
            rectSelectSuccess: 'Pixels transferred to Photoshop.',
            rectSelectFailed: 'Failed to transfer pixels.',
            rectSelectTransferring: 'Transferring...',

            confirm: 'Confirm',
            cancel: 'Cancel',
            resizeGrow: 'Canvas width will expand from {from}px to {to}px. Continue?',
            resizeShrink: 'Canvas width will shrink from {from}px to {to}px. Pixels outside the new bounds will be cropped. Continue?',

            // 笔刷名称
            brush_circle: 'Circle',
            brush_soft: 'Soft',
            brush_watercolor: 'Watercolor',
            brush_splatter: 'Splatter',
            brush_flat: 'Flat',
            brush_dry: 'Dry',

            valueRulerLabel: 'Value',
        },
        zh: {
            title: '🎨 Mixbox 调色板',
            switchPalette: '切换颜料',
            clear: '清空',
            brushSize: '大小',
            brushSpacing: '间距',
            brushWetness: '湿度',
            paintConcentration: '浓度',
            smudgeStrength: '强度',
            brushSizeTitle: '笔刷大小',
            brushSpacingTitle: '笔刷间距',
            brushWetnessTitle: '水彩湿度',
            paintConcentrationTitle: '颜料浓度',
            smudgeStrengthTitle: '涂抹强度',
            brushLabel: '笔刷',
            selectBrush: '选择笔刷',
            undo: '撤销',
            redo: '重做',
            smudgeTool: '涂抹 (S)',
            eyedropperTool: '吸管 (I)',
            mixArea: '混色区',
            foreground: '前景',
            background: '背景',
            instructions: '操作说明',
            inst1: '<strong>左键/右键点击颜料</strong> → 选择为前景色/背景色',
            inst2: '<strong>点击笔刷图标</strong> → 切换笔刷材质',
            inst3: '<strong>Alt + 左键点击画布</strong> → 取色为前景色',
            inst4: '<strong>Alt + 右键点击画布</strong> → 取色为背景色',
            inst5: '点击 ↶ 撤销 / ↷ 重做',
            inst6: '点击 <strong>PS 画布</strong> → 将快捷键归还给 PS',
            inst7: '<strong>拖动面板左右边缘</strong> → 调整画布宽度',
            inst8: '<strong>点击版本号</strong> → 检查更新',
            inst9: 'UI 显示异常？按 <strong>F5</strong> 刷新重新获取远端',
            statusDraw: '• 当前模式: <strong style="color: #e8a838;">绘制</strong>',
            statusSmudge: '• 当前模式: <strong style="color: #c87dd4;">涂抹</strong>',
            statusEyedropperFg: '• 当前模式: <strong style="color: #1473e6;">吸管 (前景色)</strong>',
            statusEyedropperBg: '• 当前模式: <strong style="color: #44b556;">吸管 (背景色)</strong>',
            selectBrushModal: '选择笔刷',
            mixStrengthLabel: '混色强度:',

            paletteName_winsorNewtonCotman: '温莎牛顿 Cotman 16色',
            paletteName_digitalArtist: '数字艺术家调色板',
            paletteName_schminckeHoradam: '施美尔 Horadam 16色',
            paletteName_kuretakeGansai: '吴竹 Gansai 16色',

            switchLanguage: '切换语言 (EN / ZH)',
            versionModalTitle: '版本信息',
            versionUpToDate: '✓ 已是最新版本',
            versionTagApp: 'App',
            versionTagHost: '宿主',
            versionTagCache: '缓存',
            versionCopyBtn: '复制',
            versionCopied: '已复制！',
            zoomTitle: '缩放 — 放大会同步扩展画布尺寸，缩小不会',
            switchEngine: '切换混色引擎 (Mixbox / KM)',
            focusHint: '按住空格 + 点击 PS 画布以切回快捷键',
            inst6: '按住 <strong>空格</strong> + 点击 <strong>PS 画布</strong> → 将快捷键切回 PS',
            saveCanvas: '保存 PNG',
            saveCanvasTitle: '将画布保存为 PNG 图片',
            rectSelectTool: '传输至PS (M)',
            statusRectSelect: '• 当前模式: <strong style="color: #FF9800;">矩形选取 → PS</strong>',
            rectSelectNoSelection: 'Photoshop 中没有活动选区，请先创建选区。',
            rectSelectNoDocument: 'Photoshop 中没有打开文档。',
            rectSelectSuccess: '像素已传输至 Photoshop。',
            rectSelectFailed: '传输失败。',
            rectSelectTransferring: '传输中...',

            confirm: '确认',
            cancel: '取消',
            resizeGrow: '画布宽度将从 {from}px 扩大到 {to}px，是否继续？',
            resizeShrink: '画布宽度将从 {from}px 缩小到 {to}px，超出部分将被裁剪，是否继续？',

            brush_circle: '圆形',
            brush_soft: '柔边',
            brush_watercolor: '水彩',
            brush_splatter: '喷溅',
            brush_flat: '扁平笔',
            brush_dry: '干笔刷',

            valueRulerLabel: '明度',
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
