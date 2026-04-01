// 颜料浓度滑条值(1-100) → 实际混色强度(0.01-0.5) 的非线性映射
// 使用平方曲线使低浓度区域变化更平缓
function mixSliderToStrength(sliderValue) {
    return 0.5 * Math.sqrt(sliderValue / 100);
}

// 当前颜料预设
let currentPalette = 'winsorNewtonCotman';
let colors = palettePresets[currentPalette].colors;

// 当前状态
let foregroundColor = '#000000';
let backgroundColor = '#ffffff';
let currentBrushColor = foregroundColor;
let brushSize = 15;
let brushSpacingRatio = 1.0;  // 笔刷工具间距系数
let smudgeSpacingRatio = 1.0; // 涂抹工具间距系数
let isDrawing = false;
let isEyedropperMode = false;
let currentBrush = { type: 'watercolor', image: null };

// 矩形选取模式
let isRectSelectMode = false;
let isRectSelecting = false;
let rectSelectStart = null;  // { x, y }

// 工具模式
let currentTool = 'brush';  // 'brush' 或 'smudge'
let smudgeStrength = 50;  // 涂抹强度 (0-100)
let smudgeBrushSize = 15;  // 涂抹工具的笔刷大小
let smudgeBrushType = 'watercolor';  // 涂抹工具的笔刷类型
let savedBrushSettings = null;  // 临时保存笔刷设置（切换到涂抹工具时使用）
let smudgeSnapshotCache = null;

// 历史记录 - 基于路径记录
let history = [];  // 存储操作记录
let historyStep = -1;
const MAX_HISTORY = 50;

// 当前笔画路径
let currentStroke = null;  // { type: 'brush'|'smudge'|'clear', points: [], color, brushSize, brushType, ... }
let currentStrokeBrushCanvas = null;  // 当前笔画的笔刷纹理（落笔时生成，整笔复用）

// 混色引擎: 'mixbox' (默认) 或 'km'
let currentEngine = 'mixbox';

/**
 * 根据引擎类型创建 Painter
 */
function createPainter(engine, canvas) {
    if (engine === 'km' && typeof KMWebGLPainter !== 'undefined' && isWebGLSupported()) {
        console.log('使用 KM 渲染器');
        return new KMWebGLPainter(canvas);
    } else if (typeof MixboxWebGLPainter !== 'undefined' && isWebGLSupported()) {
        console.log('使用 Mixbox 渲染器');
        return new MixboxWebGLPainter(canvas);
    } else if (typeof MixboxCanvasPainter !== 'undefined') {
        console.log('使用 Canvas 2D 渲染器');
        return new MixboxCanvasPainter(canvas);
    }
    throw new Error('没有可用的渲染器');
}

/**
 * 切换混色引擎并用历史重绘画布
 */
async function switchEngine(engine) {
    if (engine === currentEngine) return;
    const oldMixStrength = painter ? painter.getMixStrength() : 0.3;

    painter = createPainter(engine, mixCanvas);
    await painter.init();
    painter.setMixStrength(oldMixStrength);
    currentEngine = engine;
    localStorage.setItem('mixbox_engine', engine);

    // 用历史记录重绘画布
    painter.clear(CANVAS_BG);
    for (let i = 0; i <= historyStep; i++) {
        const action = history[i];
        if (!action) continue;
        if (action.type === 'init') continue;
        else if (action.type === 'clear') painter.clear(CANVAS_BG);
        else if (action.type === 'brush') replayBrushStroke(action);
        else if (action.type === 'smudge') replaySmudgeStroke(action);
    }
    painter.readToCanvas2D();

    // 更新按钮文字
    const engineBtn = document.getElementById('engineBtn');
    if (engineBtn) {
        engineBtn.textContent = engine === 'km' ? 'KM' : 'MB';
        engineBtn.classList.toggle('active', engine === 'km');
    }
    console.log('✅ 引擎已切换为:', engine);
}

// DOM元素
const colorPicker = document.getElementById('colorPicker');
const mixCanvas = document.getElementById('mixCanvas');
const ctx = mixCanvas.getContext('2d', { willReadFrequently: true });
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
 * 初始化应用
 */
async function initApp() {
    // 0. 检查宿主版本兼容性
    if (!checkHostCompatibility()) return;

    // 1. 初始化笔刷管理器
    brushManager = new BrushManager();
    
    // 2. 初始化持久化存储
    paletteStorage = new PaletteStorage();
    
    // 3. 加载保存的调色盘预设
    const savedPalette = paletteStorage.loadPalettePreset();
    if (savedPalette && palettePresets[savedPalette]) {
        currentPalette = savedPalette;
        colors = palettePresets[currentPalette].colors;
        console.log('✅ 已加载保存的调色盘预设:', palettePresets[currentPalette].name);
    }
    
    // 4. 加载保存的笔刷设置
    const savedBrushSettings = paletteStorage.loadBrushSettings();
    if (savedBrushSettings) {
        if (savedBrushSettings.brushType) {
            currentBrush.type = savedBrushSettings.brushType;
        }
        if (savedBrushSettings.brushSize) {
            brushSize = savedBrushSettings.brushSize;
            if (brushSizeInput) brushSizeInput.value = brushSize;
            if (brushSizeValue) brushSizeValue.textContent = brushSize;
        }
        if (savedBrushSettings.mixStrength != null) {
            if (brushMixSlider) brushMixSlider.value = savedBrushSettings.mixStrength;
            if (brushMixValue) brushMixValue.textContent = savedBrushSettings.mixStrength;
        }
        if (savedBrushSettings.brushSpacing != null) {
            brushSpacingRatio = savedBrushSettings.brushSpacing / 100;
            if (brushSpacingSlider) brushSpacingSlider.value = savedBrushSettings.brushSpacing;
            if (brushSpacingValue) brushSpacingValue.textContent = savedBrushSettings.brushSpacing;
        }
        console.log('✅ 已加载保存的笔刷设置');
    }

    // 4b. 加载保存的应用设置（颜色、涂抹工具参数等）
    const savedAppSettings = paletteStorage.loadAppSettings();
    if (savedAppSettings) {
        if (savedAppSettings.foregroundColor) {
            foregroundColor = savedAppSettings.foregroundColor;
            currentBrushColor = foregroundColor;
        }
        if (savedAppSettings.backgroundColor) {
            backgroundColor = savedAppSettings.backgroundColor;
        }
        if (savedAppSettings.smudgeBrushSize != null) smudgeBrushSize = savedAppSettings.smudgeBrushSize;
        if (savedAppSettings.smudgeStrength != null) smudgeStrength = savedAppSettings.smudgeStrength;
        if (savedAppSettings.smudgeBrushType) smudgeBrushType = savedAppSettings.smudgeBrushType;
        console.log('✅ 已加载保存的应用设置');
    }

    // 5. 初始化画布
    await initCanvas();

    // 5b. 画布初始化完成后将保存的混合强度应用到 painter
    if (savedBrushSettings && savedBrushSettings.mixStrength != null && painter) {
        painter.setMixStrength(mixSliderToStrength(savedBrushSettings.mixStrength));
    }

    // 6. 初始化UI
    initUI();

    // 7. 绑定事件
    bindEvents();
    
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

/**
 * 保存笔刷工具设置（笔刷类型、笔刷大小、混合强度）
 */
function saveBrushSettings() {
    paletteStorage.saveBrushSettings({
        brushType: currentBrush.type,
        brushSize: brushSize,
        mixStrength: parseInt(brushMixValue.textContent),
        brushSpacing: Math.round(brushSpacingRatio * 100),
    });
    paletteStorage.saveAppSettings({ smudgeBrushSize, smudgeStrength, smudgeBrushType });
}

/**
 * 初始化画布
 */
async function initCanvas() {
    mixCanvas.width = 680;
    mixCanvas.height = 572;
    // 先获取2D上下文，这样它就会被保留
    const ctx2d = mixCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx2d) {
        console.error('无法获取2D上下文');
        return;
    }

    // 初始化混色引擎
    const savedEngine = localStorage.getItem('mixbox_engine') || 'mixbox';
    console.log('🎨 初始化混色引擎...', savedEngine);
    try {
        painter = createPainter(savedEngine, mixCanvas);
        await painter.init();
        currentEngine = savedEngine;

        // 尝试加载保存的历史记录
        const savedHistory = paletteStorage.loadHistory();

        if (savedHistory && savedHistory.history && savedHistory.history.length > 0) {
            // 通过重绘历史记录恢复画布
            history = savedHistory.history;
            historyStep = savedHistory.step;

            // 清空画布后重绘所有笔画
            painter.clear(CANVAS_BG);

            for (let i = 0; i <= historyStep; i++) {
                const action = history[i];
                if (!action) continue;

                if (action.type === 'init') {
                    continue;
                } else if (action.type === 'clear') {
                    painter.clear(CANVAS_BG);
                } else if (action.type === 'brush') {
                    replayBrushStroke(action);
                } else if (action.type === 'smudge') {
                    replaySmudgeStroke(action);
                }
            }

            painter.readToCanvas2D();
            updateHistoryButtons();
            console.log('✅ 画布内容已通过历史记录恢复');
        } else {
            // 新建画布
            painter.clear(CANVAS_BG);
            painter.readToCanvas2D();
            saveState();
        }

        updateColorDisplay();
        updateBrushPreview();

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
function bindEvents() {

    // 笔刷大小控制
    brushSizeInput.addEventListener('input', (e) => {
        brushSize = parseInt(e.target.value);
        brushSizeValue.textContent = brushSize;
        saveBrushSettings(); // 保存笔刷设置
    });

    brushMixSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        brushMixValue.textContent = value;
        if (currentTool === 'smudge') {
            smudgeStrength = value;
            paletteStorage.saveAppSettings({ smudgeBrushSize, smudgeStrength });
        } else {
            if (painter && painter.setMixStrength) {
                painter.setMixStrength(mixSliderToStrength(value));
            }
            saveBrushSettings();
        }
    });
    
    brushSpacingSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        brushSpacingValue.textContent = value;

        if (currentTool === 'smudge') {
            smudgeSpacingRatio = value / 100;  // ← 涂抹工具更新自己的变量
            paletteStorage.saveAppSettings({ smudgeBrushSize, smudgeStrength, smudgeBrushType, smudgeSpacing: value });
        } else {
            brushSpacingRatio = value / 100;
            saveBrushSettings();
        }
    });

    // 清空按钮
    clearBtn.addEventListener('click', () => {
        if (painter) {
            painter.clear(CANVAS_BG);
            painter.readToCanvas2D();
        } else {
            ctx.fillStyle = '#F8F8F5';
            ctx.fillRect(0, 0, mixCanvas.width, mixCanvas.height);
        }

        // 清空历史记录
        history = [];
        historyStep = -1;
        saveState();  // 重新初始化历史
        paletteStorage.saveHistory(history, historyStep);
    });
    
    // 撤销/重做
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    
    // 涂抹工具按钮
    const smudgeBtn = document.getElementById('smudgeBtn');
    smudgeBtn.addEventListener('click', () => {
        if (currentTool === 'brush') {
            // 切换到涂抹工具：保存当前笔刷工具设置
            saveBrushSettings();
            brushSpacingRatio = parseInt(brushSpacingSlider.value) / 100;
            savedBrushSettings = {
                size: brushSize,
                mixStrength: parseInt(brushMixValue.textContent),
                brushType: currentBrush.type,
                brushSpacing: Math.round(brushSpacingRatio * 100),
            };

            currentTool = 'smudge';
            smudgeBtn.classList.add('active');
            document.getElementById('mixLabel').textContent = t('smudgeStrength');

            // 读取保存的涂抹工具设置
            const savedApp = paletteStorage.loadAppSettings();
            if (savedApp && savedApp.smudgeBrushSize != null) smudgeBrushSize = savedApp.smudgeBrushSize;
            if (savedApp && savedApp.smudgeStrength != null) smudgeStrength = savedApp.smudgeStrength;
            if (savedApp && savedApp.smudgeBrushType) smudgeBrushType = savedApp.smudgeBrushType;
            if (savedApp && savedApp.smudgeSpacing != null) smudgeSpacingRatio = savedApp.smudgeSpacing / 100;

            // 切换到涂抹工具的笔刷
            currentBrush = { type: smudgeBrushType, image: null };
            updateBrushPreview();
            brushSize = smudgeBrushSize;
            brushSizeInput.value = smudgeBrushSize;
            brushSizeValue.textContent = smudgeBrushSize;
            brushMixSlider.value = smudgeStrength;
            brushMixValue.textContent = smudgeStrength;
            if (painter) painter.setMixStrength(mixSliderToStrength(smudgeStrength));
            brushSpacingSlider.value = Math.round(smudgeSpacingRatio * 100);
            brushSpacingValue.textContent = Math.round(smudgeSpacingRatio * 100);
            console.log('✅ 切换到涂抹工具');
        } else {
            // 切换回笔刷工具：保存涂抹工具设置
            smudgeBrushSize = brushSize;
            smudgeStrength = parseInt(brushMixValue.textContent);
            smudgeBrushType = currentBrush.type;
            smudgeSpacingRatio = parseInt(brushSpacingSlider.value) / 100;
            paletteStorage.saveAppSettings({ smudgeBrushSize, smudgeStrength, smudgeBrushType, smudgeSpacing: Math.round(smudgeSpacingRatio * 100) });

            currentTool = 'brush';
            smudgeBtn.classList.remove('active');
            document.getElementById('mixLabel').textContent = t('paintConcentration');

            // 恢复笔刷工具设置
            if (savedBrushSettings) {
                currentBrush = { type: savedBrushSettings.brushType, image: null };
                updateBrushPreview();
                brushSize = savedBrushSettings.size;
                brushSizeInput.value = savedBrushSettings.size;
                brushSizeValue.textContent = savedBrushSettings.size;
                brushMixSlider.value = savedBrushSettings.mixStrength;
                brushMixValue.textContent = savedBrushSettings.mixStrength;
                painter.setMixStrength(mixSliderToStrength(savedBrushSettings.mixStrength));
                if (savedBrushSettings.brushSpacing != null) {
                    brushSpacingRatio = savedBrushSettings.brushSpacing / 100;
                    brushSpacingSlider.value = savedBrushSettings.brushSpacing;
                    brushSpacingValue.textContent = savedBrushSettings.brushSpacing;
                }
            }
            console.log('✅ 切换回笔刷工具');
        }
    });
    
    // 吸管工具按钮
    const eyedropperBtn = document.getElementById('eyedropperBtn');
    eyedropperBtn.addEventListener('click', () => {
        if (!isEyedropperMode) {
            // 进入吸管模式
            isEyedropperMode = true;
            eyedropperBtn.classList.add('active');
            updateStatus('eyedropper');
            console.log('✅ 进入吸管模式');
        } else {
            // 退出吸管模式
            isEyedropperMode = false;
            eyedropperBtn.classList.remove('active');
            updateStatus('ready');
            console.log('✅ 退出吸管模式');
        }
    });
    
    // 矩形选取按钮
    const rectSelectBtn = document.getElementById('rectSelectBtn');
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
            overlayCtx.clearRect(0, 0, selectOverlay.width, selectOverlay.height);
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

    // 引擎切换按钮
    const engineBtn = document.getElementById('engineBtn');
    if (engineBtn) {
        engineBtn.textContent = currentEngine === 'km' ? 'KM' : 'MB';
        engineBtn.classList.toggle('active', currentEngine === 'km');
        engineBtn.addEventListener('click', () => {
            const nextEngine = currentEngine === 'mixbox' ? 'km' : 'mixbox';
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

        // Escape 退出矩形选取模式
        if (e.key === 'Escape' && isRectSelectMode) {
            exitRectSelectMode();
            return;
        }

        // Alt 临时切换吸管
        if (e.altKey && !isEyedropperMode) {
            isEyedropperMode = true;
            mixCanvas.classList.add('eyedropper');
            mixCanvas.classList.remove('brush');
            updateStatus('eyedropper-fg');
            const eyedropperBtn = document.getElementById('eyedropperBtn');
            if (eyedropperBtn) eyedropperBtn.classList.add('active');
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
                saveAppSettings();
                break;
        }
    });

    document.addEventListener('keyup', (e) => {
        // 松开 Alt 退出吸管
        if (!e.altKey && isEyedropperMode) {
            isEyedropperMode = false;
            mixCanvas.classList.remove('eyedropper');
            mixCanvas.classList.add('brush');
            updateStatus('draw');
            const eyedropperBtn = document.getElementById('eyedropperBtn');
            if (eyedropperBtn) eyedropperBtn.classList.remove('active');
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

    mixCanvas.addEventListener('mousedown', (e) => {
        const rect = mixCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);

        if (isEyedropperMode) {
            // 吸管模式下阻止默认行为，但不立即取色
            e.preventDefault();
            return;
        }

        if (e.button !== 0 && e.button !== 2) return; // 左键或右键

        if (currentTool === 'brush') {
            // 笔刷工具模式
            isDrawing = true;
            strokeStarted = true;

            // 左键用前景色，右键用背景色
            const strokeColor = e.button === 2 ? backgroundColor : currentBrushColor;

            // 开始新笔画
            beginStroke('brush', strokeColor);

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
                        drawBrush(interpX, interpY, strokeColor);
                        addStrokePoint(interpX, interpY);
                    }
                } else {
                    // 距离太远或太近，直接绘制
                    drawBrush(x, y, strokeColor);
                    addStrokePoint(x, y);
                }
            } else {
                // 第一次点击，直接绘制
                drawBrush(x, y, strokeColor);
                addStrokePoint(x, y);
            }

            lastX = x;
            lastY = y;
        } else if (currentTool === 'smudge') {
            // 涂抹工具模式
            isDrawing = true;
            strokeStarted = true;

            // 开始新涂抹笔画，落笔时采样一次颜色，整笔复用
            beginStroke('smudge', null, x, y);
            currentStroke.smudgeStrength = smudgeStrength;
            addStrokePoint(x, y);

            lastX = x;
            lastY = y;
        }
    });
    
    mixCanvas.addEventListener('mousemove', (e) => {
        if (isDrawing && !isEyedropperMode) {
            const rect = mixCanvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
            const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);

            if (currentTool === 'brush') {
                // 笔刷工具模式
                const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
                const activeColor = currentStroke ? currentStroke.color : currentBrushColor;

                // 步长跟笔刷大小挂钩，乘以间距系数（1%时趋近1px，100%时为最大间距）
                const brushType = currentBrush.type;
                const baseSpacing = brushType === 'dry'
                    ? brushSize * 0.15
                    : brushType === 'splatter'
                    ? brushSize * 0.3
                    : brushSize * 0.25;
                const effectiveMinDist = Math.max(1, baseSpacing * brushSpacingRatio);

                if (distance >= effectiveMinDist) {
                    const steps = Math.floor(distance / effectiveMinDist);
                    let unionRect = null;

                    if (steps > 1) {
                        let prevIX = lastX, prevIY = lastY;
                        for (let i = 1; i <= steps; i++) {
                            const ratio = i / steps;
                            const interpX = lastX + (x - lastX) * ratio;
                            const interpY = lastY + (y - lastY) * ratio;
                            const r = drawBrush(interpX, interpY, activeColor, false, prevIX, prevIY);
                            if (r) unionRect = unionRect ? unionDirtyRect(unionRect, r) : r;
                            addStrokePoint(interpX, interpY);
                            prevIX = interpX; prevIY = interpY;
                        }
                    } else {
                        const r = drawBrush(x, y, activeColor, false, lastX, lastY);
                        unionRect = r;
                        addStrokePoint(x, y);
                    }

                    if (unionRect) painter.readToCanvas2D(unionRect);
                    lastX = x;
                    lastY = y;
                }
            } else if (currentTool === 'smudge') {
                // 涂抹工具模式
                const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
                const smudgeBaseSpacing = currentBrush.type === 'dry'
                    ? brushSize * 0.15
                    : currentBrush.type === 'splatter'
                    ? brushSize * 0.3
                    : brushSize * 0.25;
                const smudgeMinDist = Math.max(1, smudgeBaseSpacing * smudgeSpacingRatio);

                if (distance >= smudgeMinDist) {
                    // 记录路径点
                    addStrokePoint(x, y);

                    // 沿着拖动路径涂抹
                    smudgeAlongPath(lastX, lastY, x, y);

                    lastX = x;
                    lastY = y;
                }
            }
        }
    });
    
    mixCanvas.addEventListener('mouseup', (e) => {
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
            updateStatus('ready');
            return;
        }
        
        // 笔刷/涂抹模式：结束笔画
        if (isDrawing && strokeStarted) {
            isDrawing = false;
            strokeStarted = false;

            endStroke();
        }
    });

    mixCanvas.addEventListener('mouseleave', () => {
        if (isDrawing && strokeStarted) {
            isDrawing = false;
            strokeStarted = false;

            endStroke();
        }
    });

    mixCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

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
            // 同步到对应工具的笔刷类型
            if (currentTool === 'smudge') smudgeBrushType = brush.type;
            updateBrushPreview();
            brushModal.classList.remove('active');
            saveBrushSettings(); // 保存笔刷设置
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
function updateColorDisplay() {
    if (foregroundColor) fgColorBox.style.backgroundColor = foregroundColor;
    if (backgroundColor) bgColorBox.style.backgroundColor = backgroundColor;
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

    // 从 2D context 提取像素
    const imageData = ctx.getImageData(sx, sy, sw, sh);
    const data = imageData.data;

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
    tempCtx.putImageData(imageData, 0, 0);
    const dataURL = tempCanvas.toDataURL('image/png');

    // 发送到 UXP host
    window.uxpHost.postMessage({
        type: "pastePixels",
        imageDataURL: dataURL,
        width: sw,
        height: sh
    });
    console.log(`[rectSelect] Sent ${sw}x${sh} pixels to PS`);
}

/**
 * 更新状态文本
 */
function updateStatus(mode) {
    if (mode === 'eyedropper-fg') {
        statusText.innerHTML = t('statusEyedropperFg');
    } else if (mode === 'eyedropper-bg') {
        statusText.innerHTML = t('statusEyedropperBg');
    } else if (mode === 'rect-select') {
        statusText.innerHTML = t('statusRectSelect');
    } else {
        statusText.innerHTML = t('statusDraw');
    }
}

/**
 * 开始新笔画
 */
function beginStroke(type, color = null, startX = 0, startY = 0) {
    currentStroke = {
        type: type,
        points: [],
        color: color,
        brushSize: brushSize,
        brushType: currentBrush.type,
        mixStrength: painter ? painter.getMixStrength() : 0.5
    };
    currentStrokeBrushCanvas = brushManager.createBrushTexture(brushSize, currentBrush);

    if (type === 'smudge') {
        const r = Math.ceil(brushSize / 2);
        const sx = Math.max(0, Math.floor(startX) - r);
        const sy = Math.max(0, Math.floor(startY) - r);
        const sw = Math.min(mixCanvas.width - sx, r * 2);
        const sh = Math.min(mixCanvas.height - sy, r * 2);
        const imageData = ctx.getImageData(sx, sy, sw, sh);
        const localX = Math.floor(startX) - sx;
        const localY = Math.floor(startY) - sy;
        // 只存落笔点的颜色，不存整块数据
        smudgeSnapshotCache = {
            color: pickColorFromSnapshot(
                { data: imageData.data, width: sw, height: sh },
                localX, localY
            ),
            startX,
            startY,
        };
        currentStroke.canvasSnapshot = smudgeSnapshotCache;
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
        // 截断后面的历史（撤销后新操作会覆盖）
        history.splice(historyStep + 1);
        history.push(currentStroke);

        if (history.length > MAX_HISTORY) {
            history.shift();
            historyStep = history.length - 1;
        } else {
            historyStep++;
        }

        smudgeSnapshotCache = null;
        currentStroke = null;
        updateHistoryButtons();

        // 持久化存储
        saveCanvasToStorage();
    }
}

/**
 * 保存清空操作到历史
 */
function saveClearAction() {
    history.splice(historyStep + 1);
    history.push({ type: 'clear' });

    if (history.length > MAX_HISTORY) {
        history.shift();
        historyStep = history.length - 1;
    } else {
        historyStep++;
    }

    updateHistoryButtons();
    saveCanvasToStorage();
}

/**
 * 保存状态到历史记录（兼容旧调用，现在只用于初始化）
 */
function saveState() {
    // 初始化时保存一个空的初始状态
    if (history.length === 0) {
        history.push({ type: 'init' });
        historyStep = 0;
        updateHistoryButtons();
    }
}


/**
 * 恢复历史状态 - 重绘所有笔画到指定步骤
 */
function restoreState(step) {
    if (step < 0 || step >= history.length) return;

    // 1. 清空画布到初始状态
    painter.clear(CANVAS_BG);

    // 2. 重绘从第一步到目标步骤的所有笔画
    for (let i = 0; i <= step; i++) {
        const action = history[i];
        if (!action) continue;

        if (action.type === 'init') {
            // 初始状态，不需要做任何事
            continue;
        } else if (action.type === 'clear') {
            // 清空操作
            painter.clear(CANVAS_BG);
        } else if (action.type === 'brush') {
            // 重绘笔刷笔画
            replayBrushStroke(action);
        } else if (action.type === 'smudge') {
            // 重绘涂抹笔画（需要逐步更新以正确混色）
            replaySmudgeStroke(action);
        }
    }

    // 3. 读取到 Canvas 2D
    painter.readToCanvas2D();

    historyStep = step;
    updateHistoryButtons();
}

/**
 * 重放笔刷笔画
 */
function replayBrushStroke(stroke) {
    if (!stroke.points || stroke.points.length === 0) return;

    const colorRGB = hexToRgb(stroke.color);
    const savedMixStrength = painter.getMixStrength();

    // 设置笔画时的混色强度
    painter.setMixStrength(stroke.mixStrength);

    // 创建笔刷纹理
    const brushCanvas = brushManager.createBrushTexture(
        stroke.brushSize,
        { type: stroke.brushType, image: null }
    );

    // 重绘所有点
    for (const point of stroke.points) {
        painter.drawBrush(
            point.x,
            point.y,
            stroke.brushSize * 2,
            colorRGB,
            brushCanvas
        );
    }

    // 恢复混色强度
    painter.setMixStrength(savedMixStrength);
}

/**
 * 重放涂抹笔画
 */
function replaySmudgeStroke(stroke) {
    if (!stroke.points || stroke.points.length < 2) return;

    const savedMixStrength = painter.getMixStrength();
    painter.setMixStrength(stroke.mixStrength);

    // 涂抹需要逐点重放，因为每个点依赖前一个点的混色结果
    for (let i = 1; i < stroke.points.length; i++) {
        const prev = stroke.points[i - 1];
        const curr = stroke.points[i];

        // 每次涂抹前先同步到 2D canvas，以便正确取色
        painter.readToCanvas2D();

        // 执行涂抹段（使用落笔时记录的初始颜色）
        replaySmudgeSegment(prev.x, prev.y, curr.x, curr.y, stroke.brushSize, stroke.brushType, stroke.smudgeStrength, stroke.smudgeSourceColor);
    }

    painter.setMixStrength(savedMixStrength);
}

/**
 * 重放涂抹段
 */
function replaySmudgeSegment(x1, y1, x2, y2, size, brushType, strength, sourceRGB = null) {
    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const steps = Math.max(1, Math.floor(distance / 2));

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const dirX = length > 0 ? dx / length : 0;
    const dirY = length > 0 ? dy / length : 0;

    // 创建笔刷纹理（只创建一次）
    const brushCanvas = brushManager.createBrushTexture(
        size,
        { type: brushType, image: null }
    );

    for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const x = x1 + (x2 - x1) * ratio;
        const y = y1 + (y2 - y1) * ratio;

        // 用传入的初始颜色，避免逐步重采样导致颜色无限传递
        const rgb = sourceRGB || hexToRgb(pickColor(Math.floor(x), Math.floor(y)));

        // 计算目标位置（使用记录的涂抹强度）
        const pushDistance = (size / 2) * (strength / 100);
        const targetX = x + dirX * pushDistance;
        const targetY = y + dirY * pushDistance;

        // 绘制到目标位置（会与画布上已有颜色混色）
        const r = painter.drawBrush(targetX, targetY, size * 2, rgb, brushCanvas, true, { x: 0, y: 0 }, 0, true);

        // 每次绘制后同步到 2D canvas，以便下一次取色正确（局部回读）
        painter.readToCanvas2D(r);
    }
}

/**
 * 保存历史记录（用于撤销/重做恢复）
 */
function saveCanvasToStorage() {
    paletteStorage.saveHistory(history, historyStep);
}

/**
 * 更新历史按钮状态
 */
function updateHistoryButtons() {
    undoBtn.disabled = historyStep <= 0;
    redoBtn.disabled = historyStep >= history.length - 1;
}

/**
 * 撤销
 */
function undo() {
    if (historyStep > 0) restoreState(historyStep - 1);
}

/**
 * 重做
 */
function redo() {
    if (historyStep < history.length - 1) restoreState(historyStep + 1);
}

/**
 * 取色函数
 */
function pickColor(x, y) {
    // 使用主canvas的2D上下文
    const imageData = ctx.getImageData(x, y, 1, 1);
    const [r, g, b] = imageData.data;
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
function drawBrush(x, y, color, flush = true, prevX = x, prevY = y) {
    if (!color || !painter) return null;

    const colorRGB = hexToRgb(color);

    const isSplatter = currentBrush.type === 'splatter';
    const isSoftBrush = isSplatter ? 2 : 1;
    const brushCanvas = isSplatter
        ? brushManager.createBrushTexture(brushSize, currentBrush)
        : (currentStrokeBrushCanvas || brushManager.createBrushTexture(brushSize, currentBrush));

    const dx = x - prevX;
    const dy = y - prevY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const smearDir = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 };

    const dirtyRect = painter.drawBrush(
        x,
        y,
        brushSize * 2,
        colorRGB,
        brushCanvas,
        isSoftBrush,
        smearDir,
        dist,
    );

    if (flush) painter.readToCanvas2D(dirtyRect);
    return dirtyRect;
}

/**
 * 涂抹工具：沿着路径涂抹
 */
function smudgeAlongPath(x1, y1, x2, y2) {
    if (!painter) return;

    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const smudgeBaseSpacing = currentBrush.type === 'dry'
        ? brushSize * 0.15
        : currentBrush.type === 'splatter'
        ? brushSize * 0.3
        : brushSize * 0.25;
    const smudgeStep = Math.max(1, smudgeBaseSpacing * smudgeSpacingRatio);
    const steps = Math.max(1, Math.floor(distance / smudgeStep));

    // 累积所有步骤的脏区
    let unionRect = null;
    for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const x = x1 + (x2 - x1) * ratio;
        const y = y1 + (y2 - y1) * ratio;
        const r = smudgeAtPoint(x, y, x2 - x1, y2 - y1);
        if (r) unionRect = unionRect ? unionDirtyRect(unionRect, r) : r;
    }

    painter.readToCanvas2D(unionRect);
}

/**
 * 在指定点执行涂抹
 */
function smudgeAtPoint(x, y, dx, dy) {
    if (!painter) return;

    const snapshot = currentStroke?.canvasSnapshot;
    if (!snapshot) return;

    const distFromStart = Math.sqrt(
        (x - snapshot.startX) ** 2 + (y - snapshot.startY) ** 2
    );

    const maxPushDistance = (brushSize / 2) * (smudgeStrength / 100) * 5;
    if (distFromStart > maxPushDistance) return;  // 超出就停

    // 越接近边界越淡
    const alpha = 1 - distFromStart / maxPushDistance;
    const baseStrength = mixSliderToStrength(smudgeStrength);

    const length = Math.sqrt(dx * dx + dy * dy);
    const dirX = length > 0 ? dx / length : 0;
    const dirY = length > 0 ? dy / length : 0;

    const brushCanvas = currentStrokeBrushCanvas
        || brushManager.createBrushTexture(brushSize, currentBrush);

    painter.setMixStrength(baseStrength * alpha);

    const result = painter.drawBrush(
        x, y,
        brushSize * 2,
        snapshot.color,
        brushCanvas,
        true,
        { x: dirX, y: dirY },
        0,
        true,
        alpha //距离衰减值，越远越小
    );

    painter.setMixStrength(baseStrength);
    return result;
}

// ============ 语言切换 ============
function initLangToggle() {
    const langBtn = document.getElementById('langBtn');
    langBtn.textContent = I18N.getLang().toUpperCase();

    langBtn.addEventListener('click', () => {
        const newLang = I18N.getLang() === 'en' ? 'zh' : 'en';
        I18N.setLang(newLang);
        langBtn.textContent = newLang.toUpperCase();

        // 更新所有 data-i18n DOM 元素
        I18N.applyToDOM();

        // 更新动态生成的内容
        updateColorPicker();
        initPaletteDropdown();
        updatePaletteInfo();
        initBrushSelector();
        updateStatus('draw');
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
    } else {
      const errorKey = e.data.error || 'rectSelectFailed';
      showAlert(t(errorKey));
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
})();