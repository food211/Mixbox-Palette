// 颜料浓度滑条值(1-100) → 实际混色强度(0.01-0.85) 的非线性映射
// 使用1.5次幂曲线：低段平缓（涂抹感强），高段陡升（上色能力强）
// 100% → 0.85 (density=0.72, 强上色), 50% → 0.30 (density=0.09, 涂抹为主)
function mixSliderToStrength(sliderValue) {
    return 0.85 * Math.pow(sliderValue / 100, 1.5);
}

function track(name, params) {
    try {
        if (typeof window.gtag === 'function') {
            window.gtag('event', name, params || {});
        }
    } catch (_) {}
}

// 调试快捷方式：控制台直接调用 help() / debugHeatmap() 等，无需前缀
function _bindDebugShortcuts(painter) {
    // 函数版（带括号、可传参）
    window.debugHeatmap        = (on) => painter.debugHeatmap(on);
    window.debugDepositHeatmap = (on) => painter.debugDepositHeatmap(on);
    window.debugWetPaper       = (on) => painter.debugWetPaper(on);
    window.debugWetMask        = (on) => painter.debugWetMask(on);
    window.toggleWetMask       = (on) => painter.toggleWetMask(on);

    // 不带括号的别名：定义成 getter，访问即触发 toggle（仅无参形态）
    const defGetter = (name, fn) => Object.defineProperty(window, name, {
        get: fn, configurable: true,
    });
    defGetter('help', () => painter.listDebugCommands());
    defGetter('h',    () => painter.listDebugCommands());
    defGetter('dh',   () => painter.debugHeatmap());
    defGetter('ddh',  () => painter.debugDepositHeatmap());
    defGetter('dwp',  () => painter.debugWetPaper());
    defGetter('dwm',  () => painter.debugWetMask());
    defGetter('twm',  () => painter.toggleWetMask());
}

function reportAnalyticsEnv() {
    try {
        if (typeof window.gtag !== 'function') return;
        const isUXP = typeof window.uxpHost !== 'undefined';
        const ua = navigator.userAgent || '';
        const platform = navigator.platform || '';
        let os = 'other';
        if (/Windows/i.test(ua) || /Win/i.test(platform)) os = 'windows';
        else if (/Mac/i.test(ua) || /Mac/i.test(platform)) os = 'mac';
        else if (/Android/i.test(ua)) os = 'android';
        else if (/iPhone|iPad|iPod/i.test(ua)) os = 'ios';
        else if (/Linux/i.test(ua)) os = 'linux';
        const isTouch = matchMedia('(pointer:coarse)').matches;
        const deviceType = isUXP ? 'desktop' : (isTouch ? 'mobile' : 'desktop');
        const appVersion = (typeof Updater !== 'undefined' && Updater.CURRENT_VERSION) || 'unknown';
        const hostVersion = isUXP ? (new URLSearchParams(window.location.search).get('host') || 'unknown') : 'n/a';
        const hostname = (location.hostname || 'unknown').toLowerCase();
        window.gtag('set', 'user_properties', {
            app_env: isUXP ? 'uxp_plugin' : 'web_browser',
            device_os: os,
            device_type: deviceType,
            app_version: appVersion,
            host_version: hostVersion,
            hostname: hostname
        });
        track('app_env', {
            env: isUXP ? 'uxp_plugin' : 'web_browser',
            device_os: os,
            device_type: deviceType,
            app_version: appVersion,
            host_version: hostVersion,
            hostname: hostname
        });
    } catch (_) {}
}

// 当前颜料预设
let currentPalette = 'winsorNewtonCotman';
let colors = palettePresets[currentPalette].colors;

// 当前状态
let foregroundColor = '#000000';
let backgroundColor = '#ffffff';
let currentBrushColor = foregroundColor;
let isDrawing = false;
let isEyedropperMode = false;

// 矩形选取模式
let isRectSelectMode = false;
let isRectSelecting = false;
let rectSelectStart = null;  // { x, y }

// 工具状态模型（重构后单一数据源）
// mode = 'brush' | 'watercolor' | 'smudge'，由 currentTool + 当前笔型推导
const TOOL_STATE_DEFAULTS = {
    brush:      { size: 15, mixStrength: 77, spacingRatio: 0.05, brushType: 'watercolor' },
    watercolor: { size: 15, mixStrength: 77, wetness: 50 },
    smudge:     { size: 15, strength: 50, spacingRatio: 0.05, brushType: 'watercolor' },
};
const toolStates = {
    brush:      { ...TOOL_STATE_DEFAULTS.brush },
    watercolor: { ...TOOL_STATE_DEFAULTS.watercolor },
    smudge:     { ...TOOL_STATE_DEFAULTS.smudge },
};
let currentTool = 'brush';  // 'brush' 或 'smudge'
let pressureEnabled = false;  // 压感开关
let pressureGamma = 1.0;      // 压感灵敏度曲线（output = pressure ^ gamma，<1 灵敏，>1 迟钝）
let pressureSizeFloor = 0.4;  // 最小压力时的笔刷大小比例
let pressureSizeCeil  = 1.0;  // 最大压力时的笔刷大小比例（软档位可 > 1 放大超最大 brushSize）
let pressureMixFloor = 0.5;   // 最小压力时的浓度比例
let smudgeSnapshotCache = null;

// 当前笔刷类型（笔刷工具下决定走 brush 还是 watercolor state）
let currentBrush = { type: 'watercolor', image: null };

function getCurrentMode() {
    if (currentTool === 'smudge') return 'smudge';
    return currentBrush.type === 'watercolor' ? 'watercolor' : 'brush';
}

function getCurrentState() {
    return toolStates[getCurrentMode()];
}

// 旧变量名 → toolStates 字段的兼容 shim：
// 绘制管线代码量大且只读这些值，临时保留访问语义，避免一次性大改
const _brushSizeAccessor = {
    get brushSize() {
        return currentTool === 'smudge'
            ? toolStates.smudge.size
            : (currentBrush.type === 'watercolor' ? toolStates.watercolor.size : toolStates.brush.size);
    },
    set brushSize(v) { getCurrentState().size = v; },
    get smudgeBrushSize() { return toolStates.smudge.size; },
    set smudgeBrushSize(v) { toolStates.smudge.size = v; },
    get smudgeStrength() { return toolStates.smudge.strength; },
    set smudgeStrength(v) { toolStates.smudge.strength = v; },
    get smudgeBrushType() { return toolStates.smudge.brushType; },
    set smudgeBrushType(v) { toolStates.smudge.brushType = v; },
    get brushSpacingRatio() { return toolStates.brush.spacingRatio; },
    set brushSpacingRatio(v) { toolStates.brush.spacingRatio = v; },
    get smudgeSpacingRatio() { return toolStates.smudge.spacingRatio; },
    set smudgeSpacingRatio(v) { toolStates.smudge.spacingRatio = v; },
    get watercolorWetness() { return toolStates.watercolor.wetness; },
    set watercolorWetness(v) { toolStates.watercolor.wetness = v; },
};
Object.defineProperties(globalThis, Object.getOwnPropertyDescriptors(_brushSizeAccessor));
let _smudgeAngle = 0;  // 涂抹喷溅纹理旋转角，每步随机

// 历史记录 - 由 painter 的 GPU 纹理池管理，此处不再持有数据

// 当前笔画路径
let currentStroke = null;  // { type: 'brush'|'smudge'|'clear', points: [], color, brushSize, brushType, ... }
let currentStrokeBrushCanvas = null;  // 当前笔画的笔刷纹理（落笔时生成，整笔复用）

// 混色引擎: 'mixbox' (默认) 或 'km'
let currentEngine = 'km';

/**
 * 根据引擎类型创建 Painter
 */
function createPainter(engine, canvas) {
    if (engine === 'km') {
        if (typeof KMWebGLPainter !== 'undefined' && isWebGLSupported()) {
            console.log('使用 KM 渲染器');
            return new KMWebGLPainter(canvas);
        }
        // KM 不可用（脚本未加载或 WebGL 不支持）→ 退回 MB
        if (typeof MixboxWebGLPainter !== 'undefined') {
            console.warn('KM 不可用，回退到 Mixbox 渲染器');
            return new MixboxWebGLPainter(canvas);
        }
        throw new Error('KM 引擎不可用，且 Mixbox 也未加载');
    }
    if (typeof MixboxWebGLPainter !== 'undefined') {
        console.log('使用 Mixbox 渲染器');
        return new MixboxWebGLPainter(canvas);
    }
    // MB 还没加载完 → 临时退回 KM
    if (typeof KMWebGLPainter !== 'undefined') {
        console.warn('Mixbox 未加载，回退到 KM 渲染器');
        return new KMWebGLPainter(canvas);
    }
    throw new Error('Mixbox 与 KM 引擎都不可用');
}

/**
 * 切换混色引擎并用历史重绘画布
 */
async function switchEngine(engine) {
    if (engine === currentEngine) return;
    // 切引擎前把脏画布落盘，避免丢最近几笔
    await flushCanvasSave();
    const oldMixStrength = painter ? painter.getMixStrength() : 0.3;
    // 切换前从当前 GPU 帧读一次像素，用于迁移画布内容
    const oldPixels = painter ? painter.readPixelRegion(0, 0, mixCanvas.width, mixCanvas.height) : null;

    // 旧 painter 的历史池随实例一起废弃
    let newPainter;
    try {
        // 按需加载目标引擎（首屏可能没预取到）
        if (engine === 'km' && typeof KMWebGLPainter === 'undefined' && typeof window.ensureKMLoaded === 'function') {
            await window.ensureKMLoaded();
        }
        if (engine === 'mixbox' && typeof MixboxWebGLPainter === 'undefined' && typeof window.ensureMBLoaded === 'function') {
            await window.ensureMBLoaded();
        }
        newPainter = createPainter(engine, mixCanvas);
        await newPainter.init();
    } catch (err) {
        console.error('❌ 引擎切换失败:', err);
        if (confirm(t('engineInitFailed'))) location.reload();
        return;
    }
    // 释放旧 painter 的 RAF 和 GPU/CPU 资源，避免泄漏
    if (painter && typeof painter.dispose === 'function') painter.dispose();
    painter = newPainter;
    window._painter = painter;
    _bindDebugShortcuts(painter);
    painter.setMixStrength(oldMixStrength);
    painter.setWetness(toolStates.watercolor.wetness / 100);
    painter.setHeatmapDecayActive(currentTool === 'smudge');
    painter.startHeatmapFadeOut();
    painter.setWetPaperActive(getCurrentMode() === 'watercolor');
    currentEngine = engine;
    localStorage.setItem('mixbox_engine', engine);

    if (oldPixels) {
        painter.writeFromPixels(oldPixels, mixCanvas.width, mixCanvas.height);
    }
    // 以迁移后的画布为起点建立新历史
    saveState();

    // 更新按钮文字
    const engineBtn = document.getElementById('engineBtn');
    if (engineBtn) {
        engineBtn.textContent = engine === 'km' ? 'KM' : 'MB';
        engineBtn.classList.toggle('active', engine === 'km');
        engineBtn.classList.toggle('mb', engine === 'mixbox');
    }
    console.log('✅ 引擎已切换为:', engine);
}

// DOM元素
const colorPicker = document.getElementById('colorPicker');
const mixCanvas = document.getElementById('mixCanvas');
const brushSizeInput = document.getElementById('brushSize');
const brushSizeValue = document.getElementById('brushSizeValue');
const clearBtn = document.getElementById('clearBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const fgColorBox = document.getElementById('fgColorBox');
const bgColorBox = document.getElementById('bgColorBox');
const statusText = document.getElementById('statusText');
const brushPreviewBtn = document.getElementById('brushPreviewBtn');
const brushPreviewCanvas = document.getElementById('brushPreviewCanvas');
const brushModal = document.getElementById('brushModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const brushGrid = document.getElementById('brushGrid');
const paletteDropdown = document.getElementById('paletteDropdown');
const paletteBtn = document.getElementById('paletteBtn');
const paletteInfo = document.querySelector('.palette-info');
const brushMixSlider = document.getElementById('brushMix');
const brushMixValue = document.getElementById('brushMixStrength');
const brushSpacingSlider = document.getElementById('brushSpacing');
const brushSpacingValue = document.getElementById('brushSpacingValue');

/**
 * 加载三个工具的 state；不存在时尝试从旧 key 一次性迁移，否则用默认值。
 * TODO(2026-Q3 后删除)：迁移代码 mixbox_brush_settings / mixbox_app_settings → mb_tool_*
 */
function loadToolStatesFromStorage() {
    const modes = ['brush', 'watercolor', 'smudge'];
    let anyLoaded = false;
    for (const m of modes) {
        const saved = paletteStorage.loadToolState(m);
        if (saved) {
            Object.assign(toolStates[m], saved);
            anyLoaded = true;
        }
    }
    if (anyLoaded) {
        console.log('✅ 已加载 toolStates');
        return;
    }
    // 一次性迁移
    const oldBrush = paletteStorage.loadBrushSettings();
    const oldApp = paletteStorage.loadAppSettings();
    if (oldBrush) {
        if (oldBrush.brushType === 'watercolor') {
            toolStates.watercolor.brushType = 'watercolor';
            if (oldBrush.brushSize) toolStates.watercolor.size = oldBrush.brushSize;
            if (oldBrush.mixStrength != null) toolStates.watercolor.mixStrength = oldBrush.mixStrength;
            if (oldBrush.watercolorWetness != null) toolStates.watercolor.wetness = oldBrush.watercolorWetness;
        } else {
            if (oldBrush.brushType) toolStates.brush.brushType = oldBrush.brushType;
            if (oldBrush.brushSize) toolStates.brush.size = oldBrush.brushSize;
            if (oldBrush.mixStrength != null) toolStates.brush.mixStrength = oldBrush.mixStrength;
            if (oldBrush.brushSpacing != null) toolStates.brush.spacingRatio = oldBrush.brushSpacing / 100;
        }
        // 即使当前是水彩用户，也尝试恢复 watercolor.wetness（旧字段可能两边都有）
        if (oldBrush.watercolorWetness != null) toolStates.watercolor.wetness = oldBrush.watercolorWetness;
    }
    if (oldApp) {
        if (oldApp.smudgeBrushSize != null) toolStates.smudge.size = oldApp.smudgeBrushSize;
        if (oldApp.smudgeStrength != null) toolStates.smudge.strength = oldApp.smudgeStrength;
        if (oldApp.smudgeBrushType) toolStates.smudge.brushType = oldApp.smudgeBrushType;
        if (oldApp.smudgeSpacing != null) toolStates.smudge.spacingRatio = oldApp.smudgeSpacing / 100;
    }
    if (oldBrush || oldApp) {
        console.log('🔄 已从旧存储迁移到 toolStates');
        modes.forEach(m => paletteStorage.saveToolState(m, toolStates[m]));
    }
}

/**
 * 初始化应用
 */
async function initApp() {
    // 0. 检查宿主版本兼容性
    if (!checkHostCompatibility()) return;

    reportAnalyticsEnv();

    // 1. 初始化笔刷管理器
    brushManager = new BrushManager();
    
    // 2. 初始化持久化存储
    paletteStorage = new PaletteStorage();
    window.paletteStorage = paletteStorage;  // 暴露给调试脚本（perf-check 等）
    
    // 3. 加载保存的调色盘预设
    const savedPalette = paletteStorage.loadPalettePreset();
    if (savedPalette && palettePresets[savedPalette]) {
        currentPalette = savedPalette;
        colors = palettePresets[currentPalette].colors;
        console.log('✅ 已加载保存的调色盘预设:', palettePresets[currentPalette].name);
    }
    
    // 4. 加载工具状态（toolStates 重构后）
    loadToolStatesFromStorage();
    currentBrush.type = toolStates.brush.brushType;

    // 4b. 加载应用全局设置（颜色、压感）
    const savedAppSettings = paletteStorage.loadAppSettings();
    if (savedAppSettings) {
        if (savedAppSettings.foregroundColor) {
            foregroundColor = savedAppSettings.foregroundColor;
            currentBrushColor = foregroundColor;
        }
        if (savedAppSettings.backgroundColor) {
            backgroundColor = savedAppSettings.backgroundColor;
        }
        if (savedAppSettings.pressureEnabled != null) pressureEnabled = savedAppSettings.pressureEnabled;
        if (savedAppSettings.pressureGamma != null) pressureGamma = savedAppSettings.pressureGamma;
        if (savedAppSettings.pressureSizeFloor != null) pressureSizeFloor = savedAppSettings.pressureSizeFloor;
        if (savedAppSettings.pressureSizeCeil != null) pressureSizeCeil = savedAppSettings.pressureSizeCeil;
        if (savedAppSettings.pressureMixFloor != null) pressureMixFloor = savedAppSettings.pressureMixFloor;
        console.log('✅ 已加载保存的应用设置');
    }

    // 5. 初始化画布
    await initCanvas();

    // 5b. 画布初始化完成后把当前 state 应用到 painter
    if (painter) {
        painter.setMixStrength(mixSliderToStrength(getCurrentState().mixStrength ?? getCurrentState().strength ?? 77));
    }

    // 6. 初始化UI
    initUI();

    // 7. 绑定事件
    bindEvents();
    initCustomRanges();
    initInstructionsToggle();
    
    // 8. 初始化调色板下拉菜单
    initPaletteDropdown();

    // 9. 初始化缩放控制
    initZoomControl();

    // 10. 初始化语言切换
    initLangToggle();

    // 11. 通知 UXP Host 加载完成
    if (isInWebView()) {
        let cacheName = 'unknown';
        try {
            const keys = await caches.keys();
            cacheName = keys.find(k => k.startsWith('km-palette')) || 'none';
        } catch (e) {}
        window.uxpHost.postMessage({
            type: "loaded",
            version: typeof Updater !== 'undefined' ? Updater.CURRENT_VERSION : 'unknown',
            cache: cacheName
        });
    }
}

// saveBrushSettings 已被 persistCurrentState() 取代

/**
 * 初始化画布
 */
async function initCanvas() {
    // 根据已保存的 container 宽度推算 canvas 尺寸（与 _commitResize 保持同一比例）
    const BASE_CONTAINER = typeof RESIZE_MIN !== 'undefined' ? RESIZE_MIN : 480;
    const BASE_CANVAS_W  = 680;
    const BASE_CANVAS_H  = 572;
    const savedContainerW = parseInt(localStorage.getItem('mixbox_container_width') || String(BASE_CONTAINER));
    mixCanvas.width  = Math.round(BASE_CANVAS_W * savedContainerW / BASE_CONTAINER);
    mixCanvas.height = Math.round(BASE_CANVAS_H * savedContainerW / BASE_CONTAINER);

    // 初始化混色引擎
    const savedEngine = localStorage.getItem('mixbox_engine') || 'km';
    console.log('🎨 初始化混色引擎...', savedEngine);
    try {
        painter = createPainter(savedEngine, mixCanvas);
        await painter.init();
        window._painter = painter;
        _bindDebugShortcuts(painter);
        currentEngine = savedEngine;

        const savedDataURL = paletteStorage.load();
        // 先让画布可用（清空），快照异步恢复避免阻塞首屏
        painter.clear(CANVAS_BG);
        saveState();
        if (savedDataURL) {
            // 捕获 painter 引用：恢复期间若切换引擎，则放弃写入到新 painter
            const targetPainter = painter;
            const baseHistoryLen = painter.getHistoryLength();
            const img = new Image();
            img.onload = () => {
                // 若用户已经画了新笔画或切换了引擎，放弃恢复以免覆盖
                if (painter !== targetPainter) return;
                if (painter.getHistoryLength() > baseHistoryLen) {
                    console.log('ℹ️ 用户已开始绘制，跳过快照恢复');
                    return;
                }
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = mixCanvas.width;
                tmpCanvas.height = mixCanvas.height;
                const tmpCtx = tmpCanvas.getContext('2d');
                tmpCtx.drawImage(img, 0, 0);
                const imageData = tmpCtx.getImageData(0, 0, mixCanvas.width, mixCanvas.height);
                painter.writeFromPixels(imageData.data, mixCanvas.width, mixCanvas.height);
                saveState();
                console.log('✅ 画布内容已从快照恢复');
            };
            img.onerror = () => console.warn('画布快照解码失败，已使用空白画布');
            img.src = savedDataURL;
        }

        painter.setWetness(toolStates.watercolor.wetness / 100);
        painter.setWetPaperActive(getCurrentMode() === 'watercolor');
        updateColorDisplay();
        updateBrushPreview();
        renderSliders();

        console.log('✅ 混色引擎初始化完成:', currentEngine);
    } catch (error) {
        console.error('初始化混色引擎失败:', error);
        alert('无法初始化绘图引擎，请检查浏览器兼容性。错误: ' + error.message);
    }
}

/**
 * 初始化UI
 */
function initUI() {
    // 创建色块
    updateColorPicker();
    
    // 初始化笔刷选择器
    initBrushSelector();
    
    // 更新UI状态
    updateColorDisplay();
    updateBrushPreview();

    // 应用 i18n 到 DOM
    I18N.applyToDOM();
}

/**
 * 初始化调色板下拉菜单
 */
function initPaletteDropdown() {
    // 清空下拉菜单
    paletteDropdown.innerHTML = '';
    
    // 添加预设选项
    for (const key in palettePresets) {
        const option = document.createElement('div');
        option.className = 'palette-option';
        if (key === currentPalette) {
            option.classList.add('active');
        }
        option.textContent = I18N.paletteName(key);
        option.dataset.palette = key;
        
        option.addEventListener('click', (e) => {
            switchPalette(e.target.dataset.palette);
            paletteDropdown.classList.remove('show');
        });
        
        paletteDropdown.appendChild(option);
    }
    
    // 更新调色板信息
    updatePaletteInfo();
}

/**
 * 更新调色板信息
 */
function updatePaletteInfo() {
    paletteInfo.textContent = I18N.paletteName(currentPalette);
}

/**
 * 切换调色板
 */
function switchPalette(paletteKey) {
    if (palettePresets[paletteKey] && paletteKey !== currentPalette) {
        track('palette_preset_change', { from_palette: currentPalette, to_palette: paletteKey });
        currentPalette = paletteKey;
        colors = palettePresets[paletteKey].colors;
        
        // 更新UI
        updateColorPicker();
        updateColorDisplay();
        updatePaletteInfo();
        
        // 更新下拉菜单激活状态
        document.querySelectorAll('.palette-option').forEach(option => {
            option.classList.toggle('active', option.dataset.palette === paletteKey);
        });
        
        // 保存调色盘预设（新增）
        paletteStorage.savePalettePreset(paletteKey);
    }
}

/**
 * 更新颜色选择器
 */
function updateColorPicker() {
    // 清空颜色选择器
    colorPicker.innerHTML = '';
    
    // 创建色块
    colors.forEach((colorObj) => {
        const circle = document.createElement('div');
        circle.className = 'color-circle';
        circle.style.backgroundColor = colorObj.hex;
        circle.dataset.color = colorObj.hex;
        
        const tooltip = document.createElement('div');
        tooltip.className = 'color-name-tooltip';
        tooltip.textContent = I18N.colorName(colorObj);
        circle.appendChild(tooltip);
        
        circle.addEventListener('click', (e) => {
            e.preventDefault();
            foregroundColor = colorObj.hex;
            currentBrushColor = foregroundColor;
            // 选择颜色后自动关闭涂抹模式
            if (currentTool === 'smudge') {
                const smudgeBtn = document.getElementById('smudgeBtn');
                smudgeBtn.click();
            }
            updateColorDisplay();
        });

        circle.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            backgroundColor = colorObj.hex;
            updateColorDisplay();
        });

        colorPicker.appendChild(circle);
    });
}

/**
 * 绑定事件
 */
// ---------- sliderBindings：mode → 三个 slider 的语义配置 ----------
// 每个 slider 描述：从 state 读出、写回 state、对应 i18n 标签
const SLIDER_BINDINGS = {
    brush: {
        size:    { read: s => s.size,                     write: (s, v) => { s.size = v; }, label: null },
        mix:     { read: s => s.mixStrength,              write: (s, v) => { s.mixStrength = v; }, label: { i18n: 'paintConcentration', titleI18n: 'paintConcentrationTitle' } },
        spacing: { read: s => Math.round(s.spacingRatio * 100), write: (s, v) => { s.spacingRatio = v / 100; }, label: { i18n: 'brushSpacing', titleI18n: 'brushSpacingTitle' } },
    },
    watercolor: {
        size:    { read: s => s.size,                     write: (s, v) => { s.size = v; }, label: null },
        mix:     { read: s => s.mixStrength,              write: (s, v) => { s.mixStrength = v; }, label: { i18n: 'paintConcentration', titleI18n: 'paintConcentrationTitle' } },
        spacing: { read: s => s.wetness,                  write: (s, v) => { s.wetness = v; }, label: { i18n: 'brushWetness', titleI18n: 'brushWetnessTitle' } },
    },
    smudge: {
        size:    { read: s => s.size,                     write: (s, v) => { s.size = v; }, label: null },
        mix:     { read: s => s.strength,                 write: (s, v) => { s.strength = v; }, label: { i18n: 'smudgeStrength', titleI18n: 'smudgeStrengthTitle' } },
        spacing: { read: s => Math.round(s.spacingRatio * 100), write: (s, v) => { s.spacingRatio = v / 100; }, label: { i18n: 'brushSpacing', titleI18n: 'brushSpacingTitle' } },
    },
};

function _setSliderUI(input, valueEl, value) {
    if (!input) return;
    input.value = value;
    if (valueEl) valueEl.textContent = value;
}

function _applyLabel(el, cfg) {
    if (!el || !cfg) return;
    el.dataset.i18n = cfg.i18n;
    el.dataset.i18nTitle = cfg.titleI18n;
    el.title = t(cfg.titleI18n);
    el.textContent = t(cfg.i18n);
}

/**
 * 把当前 mode 的 state 推到三个 slider DOM 上（单向：state → DOM）
 * 这是工具/笔型切换、初始化、以及外部修改 state 后的唯一同步入口
 */
function renderSliders() {
    const mode = getCurrentMode();
    const state = toolStates[mode];
    const binding = SLIDER_BINDINGS[mode];

    _setSliderUI(brushSizeInput,     brushSizeValue,     binding.size.read(state));
    _setSliderUI(brushMixSlider,     brushMixValue,      binding.mix.read(state));
    _setSliderUI(brushSpacingSlider, brushSpacingValue,  binding.spacing.read(state));

    _applyLabel(document.getElementById('mixLabel'),       binding.mix.label);
    _applyLabel(document.querySelector('.label-spacing'),  binding.spacing.label);

    syncAllRangeThumbs();
}

function persistCurrentState() {
    const mode = getCurrentMode();
    paletteStorage.saveToolState(mode, toolStates[mode]);
}

/**
 * 初始化自定义滑条，用 pointer events 接管拖动，绕开 Windows Ink 延迟
 */
function syncAllRangeThumbs() {
    [brushSizeInput, brushMixSlider, brushSpacingSlider].forEach(input => {
        if (input) input.dispatchEvent(new Event('sync-thumb'));
    });
}

function initCustomRanges() {
    document.querySelectorAll('.custom-range').forEach(track => {
        const input = document.getElementById(track.dataset.for);
        if (!input) return;

        const min = parseFloat(input.min);
        const max = parseFloat(input.max);

        function updateFromPointer(e) {
            const rect = track.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            const value = Math.round(min + ratio * (max - min));
            if (parseInt(input.value) !== value) {
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            // 更新滑块位置
            track.style.setProperty('--thumb-pos', (ratio * 100) + '%');
        }

        function syncThumb() {
            const ratio = (parseFloat(input.value) - min) / (max - min);
            track.style.setProperty('--thumb-pos', (ratio * 100) + '%');
        }

        // 初始同步位置
        syncThumb();
        // input 值被外部代码改变时同步
        input.addEventListener('sync-thumb', syncThumb);

        track.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            track.setPointerCapture(e.pointerId);
            track.classList.add('dragging');
            updateFromPointer(e);
        });
        track.addEventListener('pointermove', (e) => {
            if (!track.hasPointerCapture(e.pointerId)) return;
            updateFromPointer(e);
        });
        track.addEventListener('pointerup', () => {
            track.classList.remove('dragging');
        });
    });
}

function bindEvents() {

    // 三个 slider 走统一通道：DOM 输入 → 写入当前 state → 持久化 → 通知 painter
    brushSizeInput.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        const mode = getCurrentMode();
        SLIDER_BINDINGS[mode].size.write(toolStates[mode], value);
        brushSizeValue.textContent = value;
        persistCurrentState();
    });

    brushMixSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        const mode = getCurrentMode();
        SLIDER_BINDINGS[mode].mix.write(toolStates[mode], value);
        brushMixValue.textContent = value;
        if (mode !== 'smudge' && painter?.setMixStrength) {
            painter.setMixStrength(mixSliderToStrength(value));
        }
        persistCurrentState();
    });

    brushSpacingSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        const mode = getCurrentMode();
        SLIDER_BINDINGS[mode].spacing.write(toolStates[mode], value);
        brushSpacingValue.textContent = value;
        if (mode === 'watercolor' && painter?.setWetness) {
            painter.setWetness(value / 100);
        }
        persistCurrentState();
    });

    // 清空按钮
    clearBtn.addEventListener('click', () => {
        if (painter) {
            painter.clear(CANVAS_BG);
        }

        // 清空历史记录并以当前（空白）画布为起点
        if (painter) painter.clearHistory();
        saveState();
        saveCanvasToStorage();
    });
    
    // 撤销/重做
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    
    // 涂抹工具按钮
    const pressureBtn = document.getElementById('pressureBtn');
    pressureBtn.classList.toggle('active', pressureEnabled);
    pressureBtn.addEventListener('click', () => {
        pressureEnabled = !pressureEnabled;
        pressureBtn.classList.toggle('active', pressureEnabled);
        paletteStorage.saveAppSettings({ pressureEnabled });
    });

    // 压感灵敏度 4 档 toggle（gamma + size 下限/上限 + 浓度下限 绑定存储在 data-* 属性）
    // 必须恰有一个按钮处于 active 状态
    const pressureSensBtns = document.querySelectorAll('.pressure-sens-btn');

    function _applyPressureSensBtn(btn, persist) {
        pressureGamma = parseFloat(btn.dataset.gamma);
        pressureSizeFloor = parseFloat(btn.dataset.sizeFloor);
        pressureSizeCeil  = parseFloat(btn.dataset.sizeCeil);
        pressureMixFloor  = parseFloat(btn.dataset.mixFloor);
        pressureSensBtns.forEach(b => b.classList.toggle('active', b === btn));
        if (persist) {
            paletteStorage.saveAppSettings({
                pressureGamma,
                pressureSizeFloor,
                pressureSizeCeil,
                pressureMixFloor,
            });
        }
    }

    // 初始化：找到与已存 gamma 匹配的按钮，找不到就退回"适中"档（gamma=1.0）
    let _initialBtn = null;
    for (const btn of pressureSensBtns) {
        if (Math.abs(parseFloat(btn.dataset.gamma) - pressureGamma) < 0.001) {
            _initialBtn = btn;
            break;
        }
    }
    if (!_initialBtn) {
        _initialBtn = [...pressureSensBtns].find(b => parseFloat(b.dataset.gamma) === 1.0) || pressureSensBtns[0];
    }
    _applyPressureSensBtn(_initialBtn, false);

    pressureSensBtns.forEach(btn => {
        btn.addEventListener('click', () => _applyPressureSensBtn(btn, true));
    });

    const smudgeBtn = document.getElementById('smudgeBtn');
    smudgeBtn.addEventListener('click', () => {
        const brushPreviewBtn = document.getElementById('brushPreviewBtn');
        if (currentTool === 'brush') {
            currentTool = 'smudge';
            currentBrush = { type: toolStates.smudge.brushType, image: null };
            smudgeBtn.classList.add('active');
            if (brushPreviewBtn) brushPreviewBtn.classList.add('smudge-active');
            updateStatus('smudge');
        } else {
            currentTool = 'brush';
            currentBrush = { type: toolStates.brush.brushType, image: null };
            // 若用户上次是水彩，进入笔刷工具时也要恢复水彩笔型
            if (toolStates.watercolor.brushType === 'watercolor' &&
                toolStates.brush.brushType === 'watercolor') {
                currentBrush.type = 'watercolor';
            }
            smudgeBtn.classList.remove('active');
            if (brushPreviewBtn) brushPreviewBtn.classList.remove('smudge-active');
            updateStatus('draw');
        }
        const mode = getCurrentMode();
        if (painter) {
            painter.setHeatmapDecayActive(mode === 'smudge');
            painter.setWetPaperActive(mode === 'watercolor');
            if (mode !== 'smudge') {
                painter.setMixStrength(mixSliderToStrength(toolStates[mode].mixStrength));
            }
            if (mode === 'watercolor') painter.setWetness(toolStates.watercolor.wetness / 100);
        }
        updateBrushPreview();
        renderSliders();
        console.log(currentTool === 'smudge' ? '✅ 切换到涂抹工具' : '✅ 切换回笔刷工具');
    });
    
    // 吸管工具按钮
    const eyedropperBtn = document.getElementById('eyedropperBtn');
    eyedropperBtn.addEventListener('click', () => {
        if (!isEyedropperMode) {
            // 进入吸管模式
            isEyedropperMode = true;
            eyedropperBtn.classList.add('active');
            mixCanvas.classList.add('eyedropper');
            mixCanvas.classList.remove('brush');
            updateStatus('eyedropper-fg'); // 改为'eyedropper-fg'而不是'eyedropper'
            console.log('✅ 进入吸管模式');
        } else {
            // 退出吸管模式
            isEyedropperMode = false;
            eyedropperBtn.classList.remove('active');
            mixCanvas.classList.remove('eyedropper');
            mixCanvas.classList.add('brush');
            updateStatus('draw'); // 改为'draw'而不是'ready'
            if (typeof hideEyedropperPreview === 'function') hideEyedropperPreview();
            console.log('✅ 退出吸管模式');
        }
    });
    
    // 矩形选取按钮（非UXP环境下替换为保存PNG按钮）
    const rectSelectBtn = document.getElementById('rectSelectBtn');
    if (typeof window.uxpHost === 'undefined' && rectSelectBtn) {
        rectSelectBtn.innerHTML = '<img src="icons/save.svg" width="14" height="14" alt="Save">';
        rectSelectBtn.title = t('saveCanvasTitle');
        rectSelectBtn.removeAttribute('data-i18n');
        rectSelectBtn.removeAttribute('data-i18n-title');
        rectSelectBtn.addEventListener('click', () => {
            const dataURL = painter.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataURL;
            a.download = 'mixbox-palette.png';
            a.click();
            track('save_canvas_png', {
                canvas_w: mixCanvas.width,
                canvas_h: mixCanvas.height
            });
        });
    } else {
    // 动态创建 overlay canvas，尺寸完全复制 mixCanvas
    const selectOverlay = document.createElement('canvas');
    selectOverlay.id = 'selectOverlay';
    selectOverlay.width = mixCanvas.width;
    selectOverlay.height = mixCanvas.height;
    selectOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;pointer-events:none;visibility:hidden;cursor:crosshair;';
    mixCanvas.parentElement.appendChild(selectOverlay);
    if (rectSelectBtn) {
        const overlayCtx = selectOverlay.getContext('2d');

        rectSelectBtn.addEventListener('click', () => {
            if (!isRectSelectMode) {
                isRectSelectMode = true;
                rectSelectBtn.classList.add('active');
                selectOverlay.style.visibility = 'visible';
                selectOverlay.style.pointerEvents = 'auto';
                mixCanvas.classList.remove('brush');
                mixCanvas.classList.add('rect-select');
                updateStatus('rect-select');
                overlayCtx.clearRect(0, 0, selectOverlay.width, selectOverlay.height);
                overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
                overlayCtx.fillRect(0, 0, selectOverlay.width, selectOverlay.height);
            } else {
                exitRectSelectMode();
            }
        });

        selectOverlay.addEventListener('mousedown', (e) => {
            if (!isRectSelectMode || e.button !== 0) return;
            const rect = mixCanvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
            const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);
            isRectSelecting = true;
            rectSelectStart = { x, y };
        });

        selectOverlay.addEventListener('mousemove', (e) => {
            if (!isRectSelecting) return;
            const rect = mixCanvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
            const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);

            const sx = Math.min(rectSelectStart.x, x);
            const sy = Math.min(rectSelectStart.y, y);
            const sw = Math.abs(x - rectSelectStart.x);
            const sh = Math.abs(y - rectSelectStart.y);

            overlayCtx.clearRect(0, 0, selectOverlay.width, selectOverlay.height);
            // 暗化选区外部
            overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            overlayCtx.fillRect(0, 0, selectOverlay.width, selectOverlay.height);
            overlayCtx.clearRect(sx, sy, sw, sh);
            // 虚线边框
            overlayCtx.strokeStyle = '#ffffff';
            overlayCtx.lineWidth = 1;
            overlayCtx.setLineDash([4, 4]);
            overlayCtx.strokeRect(sx, sy, sw, sh);
            overlayCtx.setLineDash([]);
        });

        selectOverlay.addEventListener('mouseup', (e) => {
            if (!isRectSelecting) return;
            isRectSelecting = false;

            const rect = mixCanvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
            const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);

            const sx = Math.max(0, Math.floor(Math.min(rectSelectStart.x, x)));
            const sy = Math.max(0, Math.floor(Math.min(rectSelectStart.y, y)));
            const sw = Math.min(mixCanvas.width - sx, Math.ceil(Math.abs(x - rectSelectStart.x)));
            const sh = Math.min(mixCanvas.height - sy, Math.ceil(Math.abs(y - rectSelectStart.y)));

            if (sw < 2 || sh < 2) {
                overlayCtx.clearRect(0, 0, selectOverlay.width, selectOverlay.height);
                return;
            }

            extractAndSendPixels(sx, sy, sw, sh);
            // 短暂显示选区后清除
            setTimeout(() => {
                overlayCtx.clearRect(0, 0, selectOverlay.width, selectOverlay.height);
                exitRectSelectMode();
            }, 500);
        });
    }
    } // end else (UXP env)

    // 引擎切换按钮
    const engineBtn = document.getElementById('engineBtn');
    if (engineBtn) {
        engineBtn.textContent = currentEngine === 'km' ? 'KM' : 'MB';
        engineBtn.classList.toggle('active', currentEngine === 'km');
        engineBtn.classList.toggle('mb', currentEngine === 'mixbox');
        engineBtn.addEventListener('click', () => {
            const nextEngine = currentEngine === 'mixbox' ? 'km' : 'mixbox';
            track('engine_switch', { from_engine: currentEngine, to_engine: nextEngine });
            switchEngine(nextEngine);
        });
    }

    // 打开笔刷选择器
    brushPreviewBtn.addEventListener('click', () => {
        brushModal.classList.add('active');
        initBrushSelector();
    });
    
    // 关闭笔刷选择器
    closeModalBtn.addEventListener('click', () => {
        brushModal.classList.remove('active');
    });
    
    brushModal.addEventListener('click', (e) => {
        if (e.target === brushModal) {
            brushModal.classList.remove('active');
        }
    });
    
    // 调色板下拉菜单
    paletteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        paletteDropdown.classList.toggle('show');
    });
    
    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', (e) => {
        if (!paletteBtn.contains(e.target) && !paletteDropdown.contains(e.target)) {
            paletteDropdown.classList.remove('show');
        }
    });
    
    // 键盘事件
    let shiftSmudgeActive = false; // Shift 临时涂抹模式
    let previousTool = null; // 记录上一次的工具，用于快捷键双击回切

    // 获取当前工具标识
    function getCurrentToolId() {
        if (isRectSelectMode) return 'rectSelect';
        if (isEyedropperMode) return 'eyedropper';
        return currentTool; // 'brush' 或 'smudge'
    }

    // 通过快捷键切换工具，自动记录上一个工具
    function switchToTool(targetTool) {
        const current = getCurrentToolId();
        if (current === targetTool) {
            // 再次按下同一快捷键 → 回切上一个工具
            if (previousTool && previousTool !== targetTool) {
                switchToTool(previousTool);
            }
            return;
        }
        previousTool = current;
        // 先退出当前特殊模式
        if (isEyedropperMode) document.getElementById('eyedropperBtn').click();
        if (isRectSelectMode) exitRectSelectMode();
        // 切换到目标工具
        switch (targetTool) {
            case 'brush':
                if (currentTool !== 'brush') document.getElementById('smudgeBtn').click();
                break;
            case 'smudge':
                if (currentTool !== 'smudge') document.getElementById('smudgeBtn').click();
                break;
            case 'eyedropper':
                if (!isEyedropperMode) document.getElementById('eyedropperBtn').click();
                break;
            case 'rectSelect':
                if (!isRectSelectMode && document.getElementById('rectSelectBtn')) {
                    document.getElementById('rectSelectBtn').click();
                }
                break;
        }
    }

    document.addEventListener('keydown', (e) => {
        // 阻止空格滚动页面；主动释放焦点让 PS 可以接管
        if (e.key === ' ') {
            e.preventDefault();
            if (document.activeElement) document.activeElement.blur();
        }

        // 阻止 Ctrl+F / Ctrl+G 弹出查找框
        if (e.ctrlKey && (e.key === 'f' || e.key === 'g' || e.key === 'F' || e.key === 'G')) {
            e.preventDefault();
        }

        // Escape 退出矩形选取模式
        if (e.key === 'Escape' && isRectSelectMode) {
            exitRectSelectMode();
            return;
        }

        // Alt 临时切换吸管；同时压住浏览器默认行为（Alt 单按会聚焦菜单栏 / 三点按钮）
        if (e.altKey) {
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
            }
            if (!isEyedropperMode) {
                isEyedropperMode = true;
                mixCanvas.classList.add('eyedropper');
                mixCanvas.classList.remove('brush');
                updateStatus('eyedropper-fg');
                const eyedropperBtn = document.getElementById('eyedropperBtn');
                if (eyedropperBtn) eyedropperBtn.classList.add('active');
            }
        }

        // Shift 临时切换涂抹
        if (e.key === 'Shift' && !shiftSmudgeActive && currentTool === 'brush' && !isEyedropperMode && !isRectSelectMode) {
            shiftSmudgeActive = true;
            document.getElementById('smudgeBtn').click();
        }

        // 工具快捷键 (忽略输入框中的按键)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        switch (e.key.toLowerCase()) {
            case 'b': switchToTool('brush'); break;
            case 's': switchToTool('smudge'); break;
            case 'i': switchToTool('eyedropper'); break;
            case 'm': switchToTool('rectSelect'); break;
            case 'x': // 互换前景/背景色
                const tmpColor = foregroundColor;
                foregroundColor = backgroundColor;
                currentBrushColor = foregroundColor;
                backgroundColor = tmpColor;
                updateColorDisplay();
                paletteStorage.saveAppSettings({ foregroundColor, backgroundColor });
                break;
        }
    });

    document.addEventListener('keyup', (e) => {
        // Alt 抬起要压掉默认行为（Chrome/Edge 单击 Alt 会聚焦菜单栏 / 三点按钮）
        if (e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') {
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
            }
        }
        // 松开 Alt 退出吸管
        if (!e.altKey && isEyedropperMode) {
            isEyedropperMode = false;
            mixCanvas.classList.remove('eyedropper');
            mixCanvas.classList.add('brush');
            updateStatus('draw');
            const eyedropperBtn = document.getElementById('eyedropperBtn');
            if (eyedropperBtn) eyedropperBtn.classList.remove('active');
            if (typeof hideEyedropperPreview === 'function') hideEyedropperPreview();
        }

        // 松开 Shift 退出临时涂抹
        if (e.key === 'Shift' && shiftSmudgeActive) {
            shiftSmudgeActive = false;
            document.getElementById('smudgeBtn').click(); // 切换回画笔
        }

    });

    // 窗口失焦时重置临时快捷键状态（Alt吸管、Shift涂抹）
    window.addEventListener('blur', () => {
        if (isEyedropperMode) {
            isEyedropperMode = false;
            mixCanvas.classList.remove('eyedropper');
            mixCanvas.classList.add('brush');
            updateStatus('draw');
            const eyedropperBtn = document.getElementById('eyedropperBtn');
            if (eyedropperBtn) eyedropperBtn.classList.remove('active');
            if (typeof hideEyedropperPreview === 'function') hideEyedropperPreview();
        }
        if (shiftSmudgeActive) {
            shiftSmudgeActive = false;
            document.getElementById('smudgeBtn').click();
        }
    });
    
    // Canvas 事件
    let strokeStarted = false;
    let lastX = 0;
    let lastY = 0;
    // 笔尖防抖（stabilizer）：每帧笔尖按 α lerp 朝 pointer 目标移动，
    // 笔触沿笔尖平滑轨迹画——代价是笔尾有可感知的滞后，好处是快画无折线、单帧 steps 自然被上限控制。
    // _targetX/Y：pointer 最后报告的目标位置（pointermove 持续更新）
    // _hasTarget：笔画活跃期间为 true；false 时 flush 不做任何事
    // _tipX/Y：笔尖当前位置，每帧朝 target lerp
    let _targetX = 0, _targetY = 0;
    let _targetRawPressure = null;
    let _hasTarget = false;
    let _tipX = 0, _tipY = 0;
    // α 越大越跟手越易折线，越小越平滑越滞后。0.35 类似主流软件默认防抖档。
    const STROKE_SMOOTHING_ALPHA = 0.35;
    // 笔尖抵达目标的收敛阈值（CSS px）：tip 与 target 距离小于此就视为追上，停止绘制
    const TIP_SETTLE_EPSILON = 0.5;

    // pen pressure EMA 平滑：pencil 每帧压力读数有天然抖动（±0.03）
    // 在软档位 gamma<1 下斜率巨大会被放大为肉眼可见的粗细抖动，需要低通滤波。
    let _smoothedPressure = 0;
    const PRESSURE_EMA_ALPHA = 0.35;
    // 单帧最多 draw 次数（防御性上限，正常不触发——α 平滑已经限制了每帧追赶量）
    // 极端情况（target 跳变很远）兜底用
    const MAX_STEPS_PER_FRAME = (typeof DeviceProfile !== 'undefined' && DeviceProfile.MAX_STEPS_PER_FRAME) || 15;

    function _flushPendingStroke() {
        if (!isDrawing || !_hasTarget) return;

        // 笔尖 lerp 朝 target 前进；已经贴近 target 就不画了
        const toTargetDX = _targetX - _tipX;
        const toTargetDY = _targetY - _tipY;
        const toTargetDist = Math.sqrt(toTargetDX * toTargetDX + toTargetDY * toTargetDY);
        if (toTargetDist < TIP_SETTLE_EPSILON) return;

        const stepX = _tipX + toTargetDX * STROKE_SMOOTHING_ALPHA;
        const stepY = _tipY + toTargetDY * STROKE_SMOOTHING_ALPHA;

        // 压力 EMA 平滑（每帧按 α 更新一次）
        let pressure;
        if (_targetRawPressure != null) {
            _smoothedPressure = _smoothedPressure * (1 - PRESSURE_EMA_ALPHA) + _targetRawPressure * PRESSURE_EMA_ALPHA;
            const PRESSURE_NORM = 0.8;
            pressure = Math.pow(Math.min(1.0, _smoothedPressure / PRESSURE_NORM), pressureGamma);
        } else {
            pressure = 1.0;  // 鼠标 / 非 pen
        }

        if (currentTool === 'brush') {
            const distance = Math.sqrt(Math.pow(stepX - lastX, 2) + Math.pow(stepY - lastY, 2));
            const activeColor = currentStroke ? currentStroke.color : currentBrushColor;

            const brushType = currentBrush.type;
            const baseSpacing = brushType === 'dry'
                ? brushSize * 0.15
                : brushType === 'splatter'
                ? brushSize * 0.3
                : brushSize * 0.25;
            // 水彩间距用户侧不暴露，固定 35%：baseSpacing * 0.35 = brushSize * 0.25 * 0.35 ≈ brushSize * 0.088
            const spacingRatio = brushType === 'watercolor' ? 0.35 : brushSpacingRatio;
            // 下限跟笔刷大小挂钩：
            //   - 大笔刷（size ≥ 50）：brushSize * 0.05 占优，保持原来手感
            //   - 小笔刷（size < 50）：min(2.5, size*0.3) 抬高下限，避免过密导致单帧 draw 次数暴涨
            const smallBrushFloor = Math.min(2.5, brushSize * 0.3);
            const sizeBasedFloor = Math.max(brushSize * 0.05, smallBrushFloor);
            const effectiveMinDist = Math.max(1, sizeBasedFloor, baseSpacing * spacingRatio);

            if (distance >= effectiveMinDist) {
                const rawSteps = Math.floor(distance / effectiveMinDist);
                // 防御性上限（正常 α 平滑已限流；target 跳变极远时才截断）
                const steps = Math.min(rawSteps, MAX_STEPS_PER_FRAME);
                const reachedRatio = steps / rawSteps;
                const endX = lastX + (stepX - lastX) * reachedRatio;
                const endY = lastY + (stepY - lastY) * reachedRatio;

                if (steps > 1) {
                    let prevIX = lastX, prevIY = lastY;
                    for (let i = 1; i <= steps; i++) {
                        const ratio = i / steps;
                        const interpX = lastX + (endX - lastX) * ratio;
                        const interpY = lastY + (endY - lastY) * ratio;
                        drawBrush(interpX, interpY, activeColor, prevIX, prevIY, pressure);
                        addStrokePoint(interpX, interpY);
                        prevIX = interpX; prevIY = interpY;
                    }
                } else {
                    drawBrush(endX, endY, activeColor, lastX, lastY, pressure);
                    addStrokePoint(endX, endY);
                }

                lastX = endX;
                lastY = endY;
                _tipX = endX;
                _tipY = endY;
                if (painter) painter.flush();
            }
        } else if (currentTool === 'smudge') {
            const distance = Math.sqrt(Math.pow(stepX - lastX, 2) + Math.pow(stepY - lastY, 2));
            const smudgeBaseSpacing = currentBrush.type === 'dry'
                ? brushSize * 0.15
                : currentBrush.type === 'splatter'
                ? brushSize * 0.3
                : brushSize * 0.25;
            const smudgeMinDist = Math.max(1, brushSize * 0.05, smudgeBaseSpacing * smudgeSpacingRatio);

            if (distance >= smudgeMinDist) {
                const rawSteps = Math.max(1, Math.floor(distance / smudgeMinDist));
                const steps = Math.min(rawSteps, MAX_STEPS_PER_FRAME);
                const reachedRatio = steps / rawSteps;
                const endX = lastX + (stepX - lastX) * reachedRatio;
                const endY = lastY + (stepY - lastY) * reachedRatio;

                addStrokePoint(endX, endY);
                smudgeAlongPath(lastX, lastY, endX, endY, pressure);
                lastX = endX;
                lastY = endY;
                _tipX = endX;
                _tipY = endY;
                if (painter) painter.flush();
            }
        }
    }

    /**
     * 笔尾补齐：抬笔前把笔尖从滞后位置跳到 target 并把剩余距离一次画完，
     * 避免防抖导致笔尾离 pointer 一段距离。跳跃不走 α 平滑。
     */
    function _finalizeStrokeTail() {
        // 抬笔即停：不再把 tip→target 的滞后段补画出来。
        // Why: 快画时 tip 可能落后 target 几十到上百像素，补画会出现"松手后突然一条直线"的违和感。
        // 保留 flush 确保最后一次 drawBrush 的结果刷上屏。
        if (!isDrawing) { _hasTarget = false; return; }
        if (painter) painter.flush();
        _hasTarget = false;
    }

    let _activePointerId = null;  // 锁定第一指的 pointerId，忽略多指干扰

    mixCanvas.addEventListener('pointerdown', (e) => {
        // 已有笔画进行中：忽略第二指（防多指触控干扰，也保护 Windows 触控屏手掌误触）
        if (_activePointerId !== null && e.pointerId !== _activePointerId) return;

        // 阻止默认行为（防止长按时浏览器恢复系统光标）
        e.preventDefault();

        const rect = mixCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);
        // pen + 压感开启时：先归一化（Pencil / Wacom 实际最大 e.pressure 往往只到 0.7~0.85，不是 1.0），
        // 再走 gamma 曲线。抬笔瞬间 pressure=0 被原样传下去（不 fallback 成 1.0，避免大笔触）。
        const PRESSURE_NORM = 0.8;
        const pressure = (pressureEnabled && e.pointerType === 'pen')
            ? Math.pow(Math.min(1.0, e.pressure / PRESSURE_NORM), pressureGamma)
            : 1.0;

        if (isEyedropperMode) {
            return;
        }

        if (e.button !== 0 && e.button !== 2) return; // 左键或右键

        _activePointerId = e.pointerId;

        // 锁定 pointer 到 canvas：绕过 iPad Safari 的手势仲裁窗口，
        // 避免刚点过 UI 后第一笔 pointermove 被系统延迟派发（表现为第一笔画不出/卡一下）
        try { mixCanvas.setPointerCapture(e.pointerId); } catch (_) {}

        if (currentTool === 'brush') {
            // 笔刷工具模式
            isDrawing = true;
            strokeStarted = true;
            _targetX = x; _targetY = y;
            _targetRawPressure = null;
            _hasTarget = true;
            _tipX = x; _tipY = y;
            FrameScheduler.register('stroke-draw', _flushPendingStroke, 10);

            // 左键用前景色，右键用背景色
            const strokeColor = e.button === 2 ? backgroundColor : currentBrushColor;

            // 开始新笔画
            beginStroke('brush', strokeColor, x, y, pressure);

            // 首点压力固定用 0（映射到 floor 下限）：pen 落笔瞬间 e.pressure 通常不稳且偏大，
            // 实际体验是笔尖刚碰纸，视觉上应该最轻。后续 pointermove 才反映真实压感。
            const firstPressure = (pressureEnabled && e.pointerType === 'pen') ? 0 : pressure;

            // 检查是否需要插值（连续点击场景）
            if (lastX !== 0 || lastY !== 0) {  // 不是第一次点击
                const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
                const brushRadius = brushSize / 2;  // 笔刷半径
                const maxInterpolationRange = brushRadius * 1.5;  // 最大插值范围：1.5 倍笔刷半径
                const interpolationDistance = Math.max(1, brushSize * 0.25);  // 插值间隔：笔刷大小的 25%

                if (distance > 0 && distance <= maxInterpolationRange) {
                    // 在两次点击之间插值，确保笔触连续
                    const steps = Math.ceil(distance / interpolationDistance);
                    for (let i = 0; i <= steps; i++) {
                        const ratio = i / steps;
                        const interpX = lastX + (x - lastX) * ratio;
                        const interpY = lastY + (y - lastY) * ratio;
                        drawBrush(interpX, interpY, strokeColor, interpX, interpY, firstPressure);
                        addStrokePoint(interpX, interpY);
                    }
                } else {
                    // 距离太远或太近，直接绘制
                    drawBrush(x, y, strokeColor, x, y, firstPressure);
                    addStrokePoint(x, y);
                }
            } else {
                // 第一次点击，直接绘制
                drawBrush(x, y, strokeColor, x, y, firstPressure);
                addStrokePoint(x, y);
            }

            lastX = x;
            lastY = y;
            if (painter) painter.flush();
        } else if (currentTool === 'smudge') {
            // 涂抹工具模式
            isDrawing = true;
            strokeStarted = true;
            _targetX = x; _targetY = y;
            _targetRawPressure = null;
            _hasTarget = true;
            _tipX = x; _tipY = y;
            FrameScheduler.register('stroke-draw', _flushPendingStroke, 10);

            // 开始新涂抹笔画，落笔时采样一次颜色，整笔复用
            beginStroke('smudge', null, x, y);
            currentStroke.smudgeStrength = smudgeStrength;
            addStrokePoint(x, y);

            lastX = x;
            lastY = y;
            if (painter) painter.flush();
        }
    });

    mixCanvas.addEventListener('pointermove', (e) => {
        e.preventDefault();
        const rect = mixCanvas.getBoundingClientRect();
        if (isDrawing && !isEyedropperMode) {
            const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
            const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);
            // pointermove 只记录原始 e.pressure（或 null 表示鼠标/非 pen）。
            // EMA 平滑 + 归一化 + gamma 映射统一在 scheduler tick 的 _flushPendingStroke 里做，
            // 确保 α 的时间常数按帧而非事件（pencil 120Hz 事件会让 α 的"帧权重"失真）。
            const rawPressure = (pressureEnabled && e.pointerType === 'pen') ? e.pressure : null;
            // 只更新 target；笔尖每帧按 α 追赶，绘制由 scheduler 'stroke-draw' 任务每帧消费
            _targetX = x; _targetY = y;
            _targetRawPressure = rawPressure;
            _hasTarget = true;
        }

        // 笔刷光标跟随（无论是否在绘制）——UI 必须即时响应，不走 scheduler
        {
            const zoom = typeof getCurrentZoom === 'function' ? getCurrentZoom() : 1;
            updateBrushCursor((e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom);
        }

        // 吸管预览：记录画布坐标 + CSS 坐标，实际采样与 DOM 更新在 rAF 里做
        if (isEyedropperMode) {
            const zoom = typeof getCurrentZoom === 'function' ? getCurrentZoom() : 1;
            const cssX = (e.clientX - rect.left) / zoom;
            const cssY = (e.clientY - rect.top) / zoom;
            const canvasX = Math.floor((e.clientX - rect.left) * (mixCanvas.width / rect.width));
            const canvasY = Math.floor((e.clientY - rect.top) * (mixCanvas.height / rect.height));
            scheduleEyedropperPreview(cssX, cssY, canvasX, canvasY);
        }
    });

    mixCanvas.addEventListener('pointerup', (e) => {
        // 吸管模式：在松开鼠标时取色
        if (isEyedropperMode) {
            const rect = mixCanvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
            const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);
            
            const pickedColor = pickColor(Math.floor(x), Math.floor(y));
            if (e.button === 0) {
                foregroundColor = pickedColor;
                currentBrushColor = foregroundColor;
                updateStatus('eyedropper-fg');
            } else if (e.button === 2) {
                backgroundColor = pickedColor;
                updateStatus('eyedropper-bg');
            }
            updateColorDisplay();
            
            // 吸取颜色后自动退出吸管模式
            isEyedropperMode = false;
            const eyedropperBtn = document.getElementById('eyedropperBtn');
            if (eyedropperBtn) {
                eyedropperBtn.classList.remove('active');
            }
            mixCanvas.classList.remove('eyedropper');
            mixCanvas.classList.add('brush');
            hideEyedropperPreview();
            updateStatus('ready');
            return;
        }
        
        // 笔刷/涂抹模式：结束笔画
        if (isDrawing && strokeStarted) {
            // 消费最后一帧残留的 pending，防止笔触尾部缺失
            _finalizeStrokeTail();
            isDrawing = false;
            strokeStarted = false;
            _smoothedPressure = 0;
            _activePointerId = null;
            FrameScheduler.unregister('stroke-draw');

            endStroke();
        }
        try { mixCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    mixCanvas.addEventListener('pointerleave', () => {
        if (isDrawing && strokeStarted) {
            _finalizeStrokeTail();
            isDrawing = false;
            strokeStarted = false;
            _smoothedPressure = 0;
            _activePointerId = null;
            FrameScheduler.unregister('stroke-draw');

            endStroke();
        }
        hideBrushCursor();
        if (typeof hideEyedropperPreview === 'function') hideEyedropperPreview();
    });

    // pointercancel：系统中断笔画（如手势冲突、应用切换）时 pointerup 不会触发，要单独处理
    mixCanvas.addEventListener('pointercancel', (e) => {
        if (isDrawing && strokeStarted) {
            _finalizeStrokeTail();
            isDrawing = false;
            strokeStarted = false;
            _smoothedPressure = 0;
            _activePointerId = null;
            FrameScheduler.unregister('stroke-draw');
            endStroke();
        }
        try { mixCanvas.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    // ── 笔刷光标 ──────────────────────────────────────
    const brushCursorCanvas = document.getElementById('brushCursor');
    const brushCursorCtx = brushCursorCanvas.getContext('2d');
    let _cursorCacheKey = null;  // 上次绘制时的 key，用于判断是否需要重绘
    let _cursorAppliedSizeKey = null;  // 上次应用到 style 的 size key，避免每帧写 width/height

    function _rebuildCursorImage(canvasSize, cssDiameter) {
        const pad = 3; // 给描边留出空间，防止被裁切
        const totalSize = canvasSize + pad * 2;
        brushCursorCanvas.width  = totalSize;
        brushCursorCanvas.height = totalSize;
        const ctx = brushCursorCtx;
        ctx.clearRect(0, 0, totalSize, totalSize);

        // 1. 在离屏 canvas 上画出笔刷形状（白色 fill，与背景无关）
        const offscreen = document.createElement('canvas');
        offscreen.width  = totalSize;
        offscreen.height = totalSize;
        const oc = offscreen.getContext('2d');
        oc.fillStyle = '#000';
        const brushSrc = currentBrush.image
            ? currentBrush.image
            : brushManager.createBrushTexture(Math.ceil(cssDiameter / 2), currentBrush);
        oc.drawImage(brushSrc, pad, pad, canvasSize, canvasSize);

        // 2. 黑色外描边：以离屏形状作 shadow，自身透明
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur  = 2;
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();

        // 3. 白色内描边（稍细）
        ctx.save();
        ctx.shadowColor = 'rgba(255,255,255,0.95)';
        ctx.shadowBlur  = 1;
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();

        // 4. 扣掉实心区域，只留描边轮廓
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(offscreen, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
    }

    function updateBrushCursor(cssX, cssY) {
        if (!brushManager || isRectSelectMode) {
            hideBrushCursor();
            return;
        }
        if (isEyedropperMode) {
            brushCursorCanvas.style.display = 'none';
            mixCanvas.style.cursor = 'url("icons/eyedropper-cursor.svg") 2 14, crosshair';
            return;
        }

        const rect = mixCanvas.getBoundingClientRect();
        const zoom = typeof getCurrentZoom === 'function' ? getCurrentZoom() : 1;
        const scaleX = rect.width / mixCanvas.width / zoom;
        const activeSize = currentTool === 'smudge' ? smudgeBrushSize : brushSize;
        const cssDiameter = activeSize * scaleX;
        const canvasSize = Math.ceil(cssDiameter);
        const pad = 3;
        const totalSize = canvasSize + pad * 2;

        // 只在笔刷类型或尺寸变化时重绘（随机笔刷也只重建一次，避免每帧抖动）
        const brushKey = currentBrush.image ? 'custom' : currentBrush.type;
        const cacheKey = `${brushKey}_${canvasSize}`;
        if (cacheKey !== _cursorCacheKey) {
            _rebuildCursorImage(canvasSize, cssDiameter);
            _cursorCacheKey = cacheKey;
        }

        // size 变化时才写 width/height（rebuild 已保证此时重建）
        if (cacheKey !== _cursorAppliedSizeKey) {
            brushCursorCanvas.style.width  = totalSize + 'px';
            brushCursorCanvas.style.height = totalSize + 'px';
            _cursorAppliedSizeKey = cacheKey;
        }
        // 用 transform 代替 left/top，避免布局偏移触发 layout
        const tx = cssX - canvasSize / 2 - pad;
        const ty = cssY - canvasSize / 2 - pad;
        brushCursorCanvas.style.transform = `translate(${tx}px, ${ty}px)`;
        if (brushCursorCanvas.style.display !== 'block') brushCursorCanvas.style.display = 'block';
        if (mixCanvas.style.cursor !== 'none') mixCanvas.style.cursor = 'none';
    }

    function hideBrushCursor() {
        brushCursorCanvas.style.display = 'none';
        mixCanvas.style.cursor = '';
    }

    // ── 吸管颜色预览 ──────────────────────────────────────
    // 光标右下角一个小方块，显示即将 pick 的颜色。
    // 采样本身很便宜（1×1 readPixels），但 pointermove 在 iPad 上 120Hz，
    // 所以统一用 rAF 合帧：一帧最多采一次 + 更新一次 DOM。
    const eyedropperPreview = document.getElementById('eyedropperPreview');
    let _eyePreviewPendingCssX = 0;
    let _eyePreviewPendingCssY = 0;
    let _eyePreviewPendingCanvasX = 0;
    let _eyePreviewPendingCanvasY = 0;
    let _eyePreviewRafHandle = 0;
    let _eyePreviewLastBg = '';

    function scheduleEyedropperPreview(cssX, cssY, canvasX, canvasY) {
        _eyePreviewPendingCssX = cssX;
        _eyePreviewPendingCssY = cssY;
        _eyePreviewPendingCanvasX = canvasX;
        _eyePreviewPendingCanvasY = canvasY;
        if (_eyePreviewRafHandle) return;
        _eyePreviewRafHandle = requestAnimationFrame(_flushEyedropperPreview);
    }

    function _flushEyedropperPreview() {
        _eyePreviewRafHandle = 0;
        if (!isEyedropperMode || !painter) {
            eyedropperPreview.style.display = 'none';
            return;
        }
        const cx = _eyePreviewPendingCanvasX;
        const cy = _eyePreviewPendingCanvasY;
        if (cx < 0 || cy < 0 || cx >= mixCanvas.width || cy >= mixCanvas.height) {
            eyedropperPreview.style.display = 'none';
            return;
        }
        let hex;
        try {
            hex = pickColor(cx, cy);
        } catch (_) {
            return;
        }
        // 吸管 SVG 从热点(2,22)往右上延伸到约(22,2)，笔身占据右上方向。
        // 默认预览放在光标右下方；靠近画布右/下边时翻到左/上，避免跑出画布被裁掉。
        const OFFSET = 14;
        // 预览方块几何：28×28 + 1.5 描边 + 1 阴影层 ≈ 32（再留点余量）
        const PREVIEW_SIZE = 32;
        // 画布 CSS 尺寸（与 _eyePreviewPendingCssX/Y 同一坐标空间）
        const zoom = typeof getCurrentZoom === 'function' ? getCurrentZoom() : 1;
        const rect = mixCanvas.getBoundingClientRect();
        const cssW = rect.width / zoom;
        const cssH = rect.height / zoom;

        let tx = _eyePreviewPendingCssX + OFFSET;
        let ty = _eyePreviewPendingCssY + OFFSET;
        // 右边放不下 → 翻到光标左边
        if (tx + PREVIEW_SIZE > cssW) {
            tx = _eyePreviewPendingCssX - OFFSET - PREVIEW_SIZE;
        }
        // 下边放不下 → 翻到光标上边
        if (ty + PREVIEW_SIZE > cssH) {
            ty = _eyePreviewPendingCssY - OFFSET - PREVIEW_SIZE;
        }
        // 翻到左/上后若还越界（极端小画布），夹一下到可视区内
        if (tx < 0) tx = 0;
        if (ty < 0) ty = 0;
        eyedropperPreview.style.transform = `translate(${tx}px, ${ty}px)`;
        if (hex !== _eyePreviewLastBg) {
            eyedropperPreview.style.backgroundColor = hex;
            _eyePreviewLastBg = hex;
        }
        if (eyedropperPreview.style.display !== 'block') {
            eyedropperPreview.style.display = 'block';
        }
    }

    function hideEyedropperPreview() {
        if (_eyePreviewRafHandle) {
            cancelAnimationFrame(_eyePreviewRafHandle);
            _eyePreviewRafHandle = 0;
        }
        eyedropperPreview.style.display = 'none';
        _eyePreviewLastBg = '';
    }

    mixCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // 阻止全局右键菜单，防止数位板笔长按触发 Windows Ink 菜单造成卡顿
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // 非 mixCanvas 区域：pen 输入交给系统当鼠标处理，避免 Windows Ink 延迟
    document.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'pen' && e.target !== mixCanvas) {
            e.target.releasePointerCapture(e.pointerId);
        }
    }, true);

    mixCanvas.classList.add('brush');
}

/**
 * 更新笔刷预览
 */
function updateBrushPreview() {
    const previewCtx = brushPreviewCanvas.getContext('2d', { willReadFrequently: true });
    previewCtx.clearRect(0, 0, 28, 28);
    
    if (currentBrush.image) {
        previewCtx.drawImage(currentBrush.image, 0, 0, 28, 28);
    } else {
        brushManager.drawBrushPreview(previewCtx, 14, 14, 12, currentBrush.type);
    }
}

/**
 * 初始化笔刷选择器
 */
function initBrushSelector() {
    brushGrid.innerHTML = '';
    
    const presetBrushes = brushManager.getPresetBrushes();
    
    presetBrushes.forEach(brush => {
        const option = document.createElement('div');
        option.className = 'brush-option';
        if (currentBrush.type === brush.type && !currentBrush.image) {
            option.classList.add('selected');
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = 80;
        canvas.height = 80;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        brushManager.drawBrushPreview(ctx, 40, 40, 30, brush.type);
        
        const name = document.createElement('div');
        name.className = 'brush-option-name';
        name.textContent = I18N.brushName(brush.type);
        
        option.appendChild(canvas);
        option.appendChild(name);
        
        option.addEventListener('click', () => {
            currentBrush = { type: brush.type, image: null };
            // 把笔型记到对应工具的 state 上
            if (currentTool === 'smudge') {
                toolStates.smudge.brushType = brush.type;
            } else {
                // brush 工具下：水彩走 watercolor state，否则走 brush state
                if (brush.type === 'watercolor') {
                    toolStates.brush.brushType = 'watercolor';
                    toolStates.watercolor.brushType = 'watercolor';
                } else {
                    toolStates.brush.brushType = brush.type;
                }
            }
            updateBrushPreview();
            brushModal.classList.remove('active');
            const mode = getCurrentMode();
            if (painter) {
                painter.setWetPaperActive(mode === 'watercolor');
                if (mode !== 'smudge') painter.setMixStrength(mixSliderToStrength(toolStates[mode].mixStrength));
                if (mode === 'watercolor') painter.setWetness(toolStates.watercolor.wetness / 100);
            }
            renderSliders();
            // 笔型变化可能同时改了 brush + watercolor 两份 state，全部持久化
            if (currentTool === 'smudge') {
                paletteStorage.saveToolState('smudge', toolStates.smudge);
            } else {
                paletteStorage.saveToolState('brush', toolStates.brush);
                if (brush.type === 'watercolor') {
                    paletteStorage.saveToolState('watercolor', toolStates.watercolor);
                }
            }
            track('brush_select', { brush_type: brush.type, tool: currentTool });
        });
        
        brushGrid.appendChild(option);
    });
}

// 上一次同步到 PS 的颜色（用于检测变化）
let lastSyncedFgColor = null;
let lastSyncedBgColor = null;

/**
 * 更新颜色显示，并在颜色变化时自动同步到 PS
 */
/**
 * 计算颜色的感知亮度 (0~1)，用于 Value Ruler 定位
 */
function colorToValue(hex) {
    const r = parseInt(hex.slice(1,3),16) / 255;
    const g = parseInt(hex.slice(3,5),16) / 255;
    const b = parseInt(hex.slice(5,7),16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function updateColorDisplay() {
    if (foregroundColor) fgColorBox.style.backgroundColor = foregroundColor;
    if (backgroundColor) bgColorBox.style.backgroundColor = backgroundColor;

    // 更新 Value Ruler 标记
    const fgMarker = document.getElementById('fgValueMarker');
    const bgMarker = document.getElementById('bgValueMarker');
    if (fgMarker && foregroundColor && foregroundColor.length === 7) {
        const v = colorToValue(foregroundColor);
        fgMarker.style.left = (v * 100) + '%';
        fgMarker.style.backgroundColor = foregroundColor;
        const fgTip = document.getElementById('fgValueTooltip');
        if (fgTip) fgTip.textContent = t('foreground') + ' ' + Math.round(v * 100);
    }
    if (bgMarker && backgroundColor && backgroundColor.length === 7) {
        const v = colorToValue(backgroundColor);
        bgMarker.style.left = (v * 100) + '%';
        bgMarker.style.backgroundColor = backgroundColor;
        const bgTip = document.getElementById('bgValueTooltip');
        if (bgTip) bgTip.textContent = t('background') + ' ' + Math.round(v * 100);
    }
    document.querySelectorAll('.color-circle').forEach(circle => {
        const color = circle.dataset.color;
        circle.classList.toggle('selected-fg', color === foregroundColor);
        circle.classList.toggle('selected-bg', color === backgroundColor);
    });

    // 检测颜色变化，自动同步到 PS 并持久化保存
    let colorChanged = false;
    if (foregroundColor !== lastSyncedFgColor) {
        lastSyncedFgColor = foregroundColor;
        sendColorToPS('foreground', foregroundColor);
        colorChanged = true;
    }
    if (backgroundColor !== lastSyncedBgColor) {
        lastSyncedBgColor = backgroundColor;
        sendColorToPS('background', backgroundColor);
        colorChanged = true;
    }
    if (colorChanged && paletteStorage) {
        paletteStorage.saveAppSettings({ foregroundColor, backgroundColor });
    }
}

/**
 * 退出矩形选取模式
 */
function exitRectSelectMode() {
    isRectSelectMode = false;
    isRectSelecting = false;
    rectSelectStart = null;
    const rectSelectBtn = document.getElementById('rectSelectBtn');
    const selectOverlay = document.getElementById('selectOverlay');
    if (rectSelectBtn) rectSelectBtn.classList.remove('active');
    if (selectOverlay) {
        selectOverlay.style.visibility = 'hidden';
        selectOverlay.style.pointerEvents = 'none';
        const overlayCtx = selectOverlay.getContext('2d');
        overlayCtx.clearRect(0, 0, selectOverlay.width, selectOverlay.height);
    }
    mixCanvas.classList.remove('rect-select');
    mixCanvas.classList.add('brush');
    updateStatus('draw');
}

/**
 * 从混色区提取像素并发送到 PS
 */
function extractAndSendPixels(sx, sy, sw, sh) {
    if (!isInWebView()) {
        console.log('[rectSelect] Not in WebView, skipping');
        return;
    }

    const data = painter.readPixelRegion(sx, sy, sw, sh);

    // 白色边缘平滑过渡：用与白色的欧氏距离决定透明度，各颜色通道表现一致
    const DIST_THRESHOLD = 60; // 距离低于此值开始渐变透明
    for (let i = 0; i < data.length; i += 4) {
        const dr = 255 - data[i], dg = 255 - data[i + 1], db = 255 - data[i + 2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < DIST_THRESHOLD) {
            data[i + 3] = Math.round(255 * dist / DIST_THRESHOLD);
        }
    }

    // 编码为 PNG base64
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sw;
    tempCanvas.height = sh;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(new ImageData(data, sw, sh), 0, 0);
    const dataURL = tempCanvas.toDataURL('image/png');

    // 发送到 UXP host
    window.uxpHost.postMessage({
        type: "pastePixels",
        imageDataURL: dataURL,
        width: sw,
        height: sh
    });
    console.log(`[rectSelect] Sent ${sw}x${sh} pixels to PS`);
    const areaRatio = (sw * sh) / (mixCanvas.width * mixCanvas.height);
    track('send_to_ps', {
        region_w: sw,
        region_h: sh,
        area_ratio: Math.round(areaRatio * 100) / 100
    });
}

/**
 * 更新状态文本：改 class 控制颜色，改 textContent 填当前语言文本
 */
function updateStatus(mode) {
    const value = document.getElementById('statusValue');
    if (!value) return;
    const map = {
        'eyedropper-fg': { cls: 'status-eyedropper-fg', key: 'statusEyedropper_value' },
        'eyedropper-bg': { cls: 'status-eyedropper-bg', key: 'statusEyedropper_value' },
        'rect-select':   { cls: 'status-rect-select',   key: 'statusRectSelect_value' },
        'smudge':        { cls: 'status-smudge',        key: 'statusSmudge_value' },
    };
    const cfg = map[mode] || { cls: 'status-draw', key: 'statusDraw_value' };
    value.className = cfg.cls;
    value.textContent = t(cfg.key);
}

/**
 * 开始新笔画
 */
function beginStroke(type, color = null, startX = 0, startY = 0, pressure = 1.0) {
    // 告诉 painter 开始绘制，暂停 idle 备份（连续画时避免 rIC 挤进帧间隙）
    if (painter?.notifyStrokeStart) painter.notifyStrokeStart();

    // brushCanvas 按整笔可能达到的最大尺寸（ceil）生成，后续 shader 按实际 effectiveSize 缩小采样。
    // 否则首点 pressure 小 → canvas 小 → 中途压力变大时纹理被拉伸采样变模糊。
    //
    // 例外：水彩笔是"随机散点"纹理（WC_DOT_COUNT 个点撒在 canvas 上），canvas 尺寸直接决定
    // 点的空间密度。用 ceil 放大后轻压时采样窗口拿到的点太稀，湿度/沉积注入不起来，效果
    // 远弱于关压感直接设小 size。水彩固定按 brushSize 生成，保证纹理密度与用户预期一致。
    const isWatercolor = type === 'brush' && currentBrush.type === 'watercolor';
    const canvasSize = isWatercolor ? brushSize : brushSize * pressureSizeCeil;
    currentStroke = {
        type: type,
        points: [],
        color: color,
        brushSize: brushSize,
        brushType: currentBrush.type,
        mixStrength: painter ? painter.getMixStrength() : 0.5,
        startedAt: performance.now()
    };
    brushManager.refreshRandomBrush(canvasSize, currentBrush);
    currentStrokeBrushCanvas = brushManager.createBrushTexture(canvasSize, currentBrush);

    if (type === 'smudge') {
        _smudgeAngle = 0;
        // 只记录起始坐标，用于距离衰减计算
        smudgeSnapshotCache = { startX, startY };
        currentStroke.canvasSnapshot = smudgeSnapshotCache;
        // 落笔时把当前画布冻结到 smudgeSnapshot 纹理，
        // 涂抹全程从这张快照采样，颜色不会被反复稀释变灰
        if (painter) painter.captureSmudgeSnapshot();
    }

    if (type === 'brush' && currentBrush.type === 'watercolor') {
        if (painter) {
            // 落笔时清热度图，防止旧热度区域被新颜色的 smudge pass 染色
            painter.clearWetHeatmap();
            painter._wetHeatFrames = 0;
            painter._wetHeatCap = undefined;      // 重置方向分段上限
            painter._wetHeatBaseAngle = undefined;
            painter._wetColorFreqAcc = 1.0;       // _applyWetColor 频率累加器：1.0 保证第一次必触发
            painter._wetPaperActive = true;
            painter._wetIsDrawing = true;
            painter._wetColor = color ? hexToRgb(color) : { r: 0, g: 0, b: 0 };
            painter._wetMixStrength = painter.baseMixStrength;
            // RAF 未运行时（如第一笔）立即启动，确保第一笔就有湿纸效果
            painter.startHeatmapFadeOut();
        }
    }
}

/**
 * 从快照取色
 */
function pickColorFromSnapshot(snapshot, x, y) {
    const ix = Math.max(0, Math.min(Math.floor(x), snapshot.width - 1));
    const iy = Math.max(0, Math.min(Math.floor(y), snapshot.height - 1));
    const idx = (iy * snapshot.width + ix) * 4;
    return {
        r: snapshot.data[idx] / 255,
        g: snapshot.data[idx + 1] / 255,
        b: snapshot.data[idx + 2] / 255,
    };
}

/**
 * 添加笔画点
 */
function addStrokePoint(x, y, extra = {}) {
    if (currentStroke) {
        currentStroke.points.push({ x, y, ...extra });
    }
}

/**
 * 结束笔画并保存到历史
 */
function endStroke() {
    if (currentStroke && currentStroke.points.length > 0) {
        if (painter) painter.startHeatmapFadeOut();
        if (painter && currentBrush.type === 'watercolor') {
            painter._wetIsDrawing = false;
            painter._applyDepositColor(); // 内部 RAF 渐进，末帧自动 flush + clearDepositHeatmap
        }
        track('paint_stroke', {
            duration_ms: Math.round(performance.now() - currentStroke.startedAt),
            stroke_type: currentStroke.type,
            brush_type: currentStroke.brushType,
            engine: currentEngine
        });
        pushSnapshot();
        smudgeSnapshotCache = null;
        currentStroke = null;
        updateHistoryButtons();
        saveCanvasToStorage();
    }
    // notify 必须无条件调：即使 points=0（pointercancel 掐断极短触点）也要复位
    // _strokeActive，否则 idle 备份会被永久闸住
    if (painter?.notifyStrokeEnd) painter.notifyStrokeEnd();
}

/**
 * 保存清空操作到历史
 */
function saveClearAction() {
    pushSnapshot();
    updateHistoryButtons();
    saveCanvasToStorage();
}

/**
 * 初始化历史记录（首次或引擎切换后调用）
 */
function saveState() {
    if (!painter) return;
    if (painter.getHistoryLength() === 0) {
        painter.pushHistoryFrame();
        updateHistoryButtons();
    }
}

/**
 * 把当前画布状态压入 GPU 历史池
 */
function pushSnapshot() {
    if (!painter) return;
    painter.pushHistoryFrame();
}

/**
 * 恢复到指定历史步骤
 */
async function restoreState(step) {
    if (!painter) return;
    const ok = await painter.restoreHistoryFrame(step);
    if (ok) updateHistoryButtons();
}

/**
 * 异步写入 localStorage（不阻塞当前帧）
 */
// ─── 自动保存：节流 + 标脏模式 ─────────────────────────────────────────────
// 之前每笔 endStroke 都会触发一次"readPixels → 编码 → localStorage.setItem"，
// 在大画布下持续绘制累积开销很大（readPixels 每次约 10-30ms + 编码后 localStorage
// 主线程同步写）。现在改为：
//   - endStroke 只做 _markDirty，标记"画布有新内容待保存"
//   - 一个定时器以 SAVE_MIN_INTERVAL_MS 为间隔检查，dirty 就做一次真正保存
//   - engine 切换 / canvas resize / 页面关闭时强制 flush 一次，保证最新状态不丢
//
// 结果：用户画 100 笔、30 秒内只会发生 3 次真正保存。
const SAVE_MIN_INTERVAL_MS = 10_000;
let _canvasDirty = false;
let _lastSavedAt = 0;
let _saveInFlight = false;
let _saveTimer = null;

function saveCanvasToStorage() {
    // 改成标脏即返回，实际保存由节流器决定
    _canvasDirty = true;
    _ensureSaveTimer();
}

function _ensureSaveTimer() {
    if (_saveTimer !== null) return;
    _saveTimer = setInterval(() => {
        if (!_canvasDirty) return;
        const now = performance.now();
        if (now - _lastSavedAt < SAVE_MIN_INTERVAL_MS) return;
        _doSave();
    }, 1_000);
}

async function _doSave() {
    if (!painter || _saveInFlight) return;
    _canvasDirty = false;
    _saveInFlight = true;
    _lastSavedAt = performance.now();
    try {
        const dataURL = await painter.toDataURLAsync('image/webp', 1.0);
        paletteStorage.save(dataURL);
    } catch (e) {
        console.warn('自动保存失败', e);
        _canvasDirty = true; // 失败重新标脏，下个窗口再试
    } finally {
        _saveInFlight = false;
    }
}

/**
 * 强制立刻把脏画布写入 localStorage（切换引擎 / resize / beforeunload 时调）。
 * 如果当前有 in-flight 保存，先等它跑完；等完后如果仍然脏，再跑一次。
 */
async function flushCanvasSave() {
    // 顺带把 appSettings 的 pending 写入也 flush 掉，避免切引擎/resize 期间丢配置
    try { if (paletteStorage) { paletteStorage.flushAppSettings(); paletteStorage.flushToolStates(); } } catch (_) {}
    // 若有 in-flight 任务先等它结束，否则新笔画可能被跳过
    while (_saveInFlight) {
        await new Promise(r => setTimeout(r, 30));
    }
    if (!_canvasDirty) return;
    await _doSave();
}
window.flushCanvasSave = flushCanvasSave;

// 页面关闭前补一次保存（beforeunload 必须同步走完，异步 promise 可能被打断；
// 这里退回同步的 toDataURL，只在真正关闭时付这一次代价）
window.addEventListener('beforeunload', () => {
    // 应用设置可能有未 debounce 的 pending 写入，必须先 flush
    try { if (paletteStorage) { paletteStorage.flushAppSettings(); paletteStorage.flushToolStates(); } } catch (_) {}
    if (!_canvasDirty || !painter) return;
    try {
        paletteStorage.save(painter.toDataURL('image/webp', 1.0));
    } catch (_) {}
});

/**
 * 更新撤销/重做按钮状态
 */
function updateHistoryButtons() {
    if (!painter) return;
    const step = painter.getHistoryStep();
    const len  = painter.getHistoryLength();
    undoBtn.disabled = step <= 0;
    redoBtn.disabled = step >= len - 1;
}

/**
 * 撤销
 */
function undo() {
    if (!painter) return;
    const step = painter.getHistoryStep();
    if (step > 0) restoreState(step - 1);
}

/**
 * 重做
 */
function redo() {
    if (!painter) return;
    const step = painter.getHistoryStep();
    const len  = painter.getHistoryLength();
    if (step < len - 1) restoreState(step + 1);
}

/**
 * 取色函数
 */
function pickColor(x, y) {
    const { r, g, b } = painter.readPixelByte(x, y);
    return rgbToHex(r, g, b);
}

/**
 * RGB转Hex
 */
function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
}

/**
 * Hex转RGB(0-1范围)
 */
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
}

/**
 * 合并两个脏区矩形
 */
function unionDirtyRect(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w);
    const y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * 绘制笔刷
 */
function drawBrush(x, y, color, prevX = x, prevY = y, pressure = 1.0) {
    if (!color || !painter) return null;

    const colorRGB = hexToRgb(color);

    // 压感映射：size 下限 floor → 上限 ceil（软档 ceil>1 放大超最大）；浓度下限 floor → 最大 1.0
    const effectiveSize = brushSize * (pressureSizeFloor + (pressureSizeCeil - pressureSizeFloor) * pressure);
    const pressureMixScale = pressureMixFloor + (1 - pressureMixFloor) * pressure;

    const isSplatter = currentBrush.type === 'splatter';
    const isCircle = currentBrush.type === 'circle';
    const isWatercolor = currentBrush.type === 'watercolor';
    // 0=硬边, 1=径向渐变衰减, 2=无衰减(纹理自身决定形状)
    const isSoftBrush = isSplatter ? 2 : isCircle ? 0 : isWatercolor ? 2 : 1;
    const brushCanvas = currentStrokeBrushCanvas || brushManager.createBrushTexture(effectiveSize, currentBrush);

    const dx = x - prevX;
    const dy = y - prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const smearDir = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 };

    // 喷溅笔刷每步用随机角度旋转纹理，模拟喷枪散点无规律感
    const brushRotation = isSplatter ? Math.random() * Math.PI * 2 : 0;

    // 临时按压感缩放 painter 的 baseMixStrength，画完恢复（不污染用户设置）
    const originalMixStrength = painter.baseMixStrength;
    if (pressureMixScale < 1.0) {
        painter.baseMixStrength = originalMixStrength * pressureMixScale;
    }

    const dirtyRect = painter.drawBrush(
        x,
        y,
        effectiveSize * 2,
        colorRGB,
        brushCanvas,
        isSoftBrush,
        smearDir,
        dist,
        false, 1.0, false, 0, 0,
        brushRotation, 0, isWatercolor,
    );

    // 恢复用户设置的 baseMixStrength
    painter.baseMixStrength = originalMixStrength;

    return dirtyRect;
}

/**
 * 涂抹工具：沿着路径涂抹
 */
function smudgeAlongPath(x1, y1, x2, y2, pressure = 1.0) {
    if (!painter) return;

    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const smudgeBaseSpacing = currentBrush.type === 'dry'
        ? brushSize * 0.15
        : currentBrush.type === 'splatter'
        ? brushSize * 0.3
        : brushSize * 0.25;
    const smudgeStep = Math.max(1, brushSize * 0.05, smudgeBaseSpacing * smudgeSpacingRatio);
    const steps = Math.max(1, Math.floor(distance / smudgeStep));

    let unionRect = null;
    for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const x = x1 + (x2 - x1) * ratio;
        const y = y1 + (y2 - y1) * ratio;
        const r = smudgeAtPoint(x, y, x2 - x1, y2 - y1, pressure);
        if (r) {
            unionRect = unionRect ? unionDirtyRect(unionRect, r) : r;
        }
    }
}

/**
 * 在指定点执行涂抹：复用笔刷 smear 逻辑，把移动方向后方的颜色带到当前位置。
 * density=0（baseMixStrength=0）→ 纯 smear，不混入新颜料，不会反复混浊。
 *
 * 涂抹工具不响应压感（size/strength 固定按用户滑条设置），避免 Pencil 压力抖动导致
 * 画笔粗细/力度忽大忽小，影响涂抹连贯性。
 */
function smudgeAtPoint(x, y, dx, dy, pressure = 1.0) {
    if (!painter) return;

    const len = Math.sqrt(dx * dx + dy * dy);
    const dirX = len > 0 ? dx / len : 0;
    const dirY = len > 0 ? dy / len : 0;

    // 涂抹屏蔽压感：size/strength 固定使用用户设置值
    const sizeScale = 1.0;
    const strengthScale = 1.0;
    const effectiveSize = brushSize * sizeScale;
    const effectiveStrength = smudgeStrength * strengthScale;

    // smudgeCanvas 用的 size 量化到 2px 网格（防连续压力值导致 cache key 每帧不同）
    const canvasSize = Math.max(2, Math.round(effectiveSize / 2) * 2);
    const brushCanvas = currentStrokeBrushCanvas
        || brushManager.createBrushTexture(canvasSize, currentBrush);

    const smearLen = effectiveSize * 0.5 * (effectiveStrength / 100) * 0.3;

    // smudgeMix：后方颜色参与物理混色的比例，低强度保留更多当前位置颜色感
    // 映射到原始 smudgeStrength 30~60 对应的区间 0.32~0.44
    const smudgeMix = 0.32 + (effectiveStrength / 100) * 0.12;

    const prevStrength = painter.getMixStrength();
    painter.setMixStrength(0); // density=0 → 纯 smear 分支
    const result = painter.drawBrush(
        x, y, effectiveSize * 2,
        { r: 0, g: 0, b: 0 },
        brushCanvas,
        true,
        { x: dirX, y: dirY }, smearLen,
        false,  // disableSmear=false，走 smear 路径
        1.0, true, effectiveSize, 0, 0, smudgeMix
    );
    painter.setMixStrength(prevStrength);
    return result;
}

// ============ Instructions 折叠 ============
function initInstructionsToggle() {
    const toggle = document.getElementById('instructionsToggle');
    const body = document.getElementById('instructionsBody');
    const chevron = document.getElementById('instructionsChevron');
    if (!toggle || !body || !chevron) return;

    const isOpen = localStorage.getItem('mixbox_instructions_open') !== 'false';
    if (!isOpen) {
        body.classList.add('collapsed');
    } else {
        chevron.classList.add('open');
    }

    toggle.addEventListener('click', () => {
        const collapsed = body.classList.toggle('collapsed');
        chevron.classList.toggle('open', !collapsed);
        localStorage.setItem('mixbox_instructions_open', String(!collapsed));
    });
}

// ============ 语言切换 ============
function initLangToggle() {
    const langBtn = document.getElementById('langBtn');
    const labelOf = (lang) => (lang === 'ja' ? 'JA' : lang.toUpperCase());
    langBtn.textContent = labelOf(I18N.getLang());

    langBtn.addEventListener('click', () => {
        const newLang = I18N.nextLang();
        I18N.setLang(newLang);
        langBtn.textContent = labelOf(newLang);

        // 更新所有 data-i18n DOM 元素
        I18N.applyToDOM();

        // 更新动态生成的内容
        updateColorPicker();
        initPaletteDropdown();
        updatePaletteInfo();
        initBrushSelector();
        updateStatus('draw');
        updateColorDisplay();
    });
}

// 导出到全局
window.initApp = initApp;
console.log('🚀 app.js 加载完成，调用 initApp() 初始化应用');

// 接收来自 PS 的颜色变化（由 UXP host 推送）
window.addEventListener("message", (e) => {
  console.log("📨 message received:", JSON.stringify(e.data).slice(0, 200));
  const { type, target, color, foreground, background } = e.data || {};

  if (type === "psColorChanged" && color) {
    if (target === "foreground") {
      foregroundColor = color.hex;
      currentBrushColor = foregroundColor;
    } else if (target === "background") {
      backgroundColor = color.hex;
    }
    // 先同步 lastSynced 状态，防止 updateColorDisplay 触发反向 setColor 造成死循环
    lastSyncedFgColor = foregroundColor;
    lastSyncedBgColor = backgroundColor;
    updateColorDisplay();
    if (paletteStorage) paletteStorage.saveAppSettings({ foregroundColor, backgroundColor });
  } else if (type === "psInitColors") {
    // D/X 键等同时改变前景/背景色时同步
    if (foreground) {
      foregroundColor = foreground.hex;
      currentBrushColor = foregroundColor;
    }
    if (background) {
      backgroundColor = background.hex;
    }
    lastSyncedFgColor = foregroundColor;
    lastSyncedBgColor = backgroundColor;
    updateColorDisplay();
    if (paletteStorage) paletteStorage.saveAppSettings({ foregroundColor, backgroundColor });
  } else if (type === "pastePixelsResult") {
    if (e.data.success) {
      console.log('[rectSelect] Transfer success');
      track('send_to_ps_result', { success: true });
    } else {
      const errorKey = e.data.error || 'rectSelectFailed';
      showAlert(t(errorKey));
      track('send_to_ps_result', { success: false, error: errorKey });
    }
  }
});

// 焦点指示条：提示用户键盘输入被插件捕获
(function() {
    const indicator = document.getElementById('focusIndicator');
    if (!indicator) return;
    window.addEventListener('focus', () => indicator.classList.add('active'));
    window.addEventListener('blur', () => indicator.classList.remove('active'));
    // 页面加载时如果已有焦点则立即显示
    if (document.hasFocus()) indicator.classList.add('active');

    // 无效重复按键检测：同一个键1秒内按3次以上 → 闪烁提示
    const VALID_KEYS = new Set(['b', 's', 'i', 'm', 'x', ' ', 'z', 'escape', 'alt', 'shift', 'control', 'meta']);
    let _lastInvalidKey = null;
    let _invalidKeyTimes = [];
    let _flashTimer = null;

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const key = e.key.toLowerCase();
        if (VALID_KEYS.has(key) || e.ctrlKey || e.metaKey) return;

        const now = Date.now();
        if (key !== _lastInvalidKey) {
            _lastInvalidKey = key;
            _invalidKeyTimes = [];
        }
        _invalidKeyTimes.push(now);
        _invalidKeyTimes = _invalidKeyTimes.filter(t => now - t < 1000);

        if (_invalidKeyTimes.length >= 3) {
            _invalidKeyTimes = [];
            // 闪烁：短暂加深再恢复
            clearTimeout(_flashTimer);
            indicator.style.backgroundColor = '#e53935';
            indicator.classList.add('active');
            _flashTimer = setTimeout(() => {
                indicator.style.backgroundColor = '';
            }, 600);
        }
    });
})();