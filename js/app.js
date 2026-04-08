// 颜料浓度滑条值(1-100) → 实际混色强度(0.01-0.85) 的非线性映射
// 使用1.5次幂曲线：低段平缓（涂抹感强），高段陡升（上色能力强）
// 100% → 0.85 (density=0.72, 强上色), 50% → 0.30 (density=0.09, 涂抹为主)
function mixSliderToStrength(sliderValue) {
    return 0.85 * Math.pow(sliderValue / 100, 1.5);
}

// 当前颜料预设
let currentPalette = 'winsorNewtonCotman';
let colors = palettePresets[currentPalette].colors;

// 当前状态
let foregroundColor = '#000000';
let backgroundColor = '#ffffff';
let currentBrushColor = foregroundColor;
let brushSize = 15;
let brushSpacingRatio = 0.05;  // 笔刷工具间距系数
let smudgeSpacingRatio = 0.05; // 涂抹工具间距系数
let isDrawing = false;
let isEyedropperMode = false;
let currentBrush = { type: 'dry', image: null };

// 矩形选取模式
let isRectSelectMode = false;
let isRectSelecting = false;
let rectSelectStart = null;  // { x, y }

// 工具模式
let currentTool = 'brush';  // 'brush' 或 'smudge'
let smudgeStrength = 50;  // 涂抹强度 (0-100)
let pressureEnabled = false;  // 压感开关
let smudgeBrushSize = 15;  // 涂抹工具的笔刷大小
let smudgeBrushType = 'dry';  // 涂抹工具的笔刷类型
let savedBrushSettings = null;  // 临时保存笔刷设置（切换到涂抹工具时使用）
let smudgeSnapshotCache = null;
let _smudgeAngle = 0;  // 涂抹喷溅纹理旋转角，每步随机

// 历史记录 - 由 painter 的 GPU 纹理池管理，此处不再持有数据

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
    } else {
        console.log('使用 Mixbox 渲染器');
        return new MixboxWebGLPainter(canvas);
    }
}

/**
 * 切换混色引擎并用历史重绘画布
 */
async function switchEngine(engine) {
    if (engine === currentEngine) return;
    const oldMixStrength = painter ? painter.getMixStrength() : 0.3;
    // 切换前从当前 GPU 帧读一次像素，用于迁移画布内容
    const oldPixels = painter ? painter.readPixelRegion(0, 0, mixCanvas.width, mixCanvas.height) : null;

    // 旧 painter 的历史池随实例一起废弃
    painter = createPainter(engine, mixCanvas);
    await painter.init();
    painter.setMixStrength(oldMixStrength);
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
        syncAllRangeThumbs();
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
        if (savedAppSettings.pressureEnabled != null) pressureEnabled = savedAppSettings.pressureEnabled;
        console.log('✅ 已加载保存的应用设置');
    }

    // 5. 初始化画布
    await initCanvas();

    // 5b. 画布初始化完成后将混合强度应用到 painter（存档优先，否则用 slider 的 HTML 默认值）
    if (painter) {
        const sliderVal = savedBrushSettings?.mixStrength ?? parseInt(brushMixSlider?.value ?? 77);
        painter.setMixStrength(mixSliderToStrength(sliderVal));
    }

    // 6. 初始化UI
    initUI();

    // 7. 绑定事件
    bindEvents();
    initCustomRanges();
    
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
    // 根据已保存的 container 宽度推算 canvas 尺寸（与 _commitResize 保持同一比例）
    const BASE_CONTAINER = typeof RESIZE_MIN !== 'undefined' ? RESIZE_MIN : 480;
    const BASE_CANVAS_W  = 680;
    const BASE_CANVAS_H  = 572;
    const savedContainerW = parseInt(localStorage.getItem('mixbox_container_width') || String(BASE_CONTAINER));
    mixCanvas.width  = Math.round(BASE_CANVAS_W * savedContainerW / BASE_CONTAINER);
    mixCanvas.height = Math.round(BASE_CANVAS_H * savedContainerW / BASE_CONTAINER);

    // 初始化混色引擎
    const savedEngine = localStorage.getItem('mixbox_engine') || 'mixbox';
    console.log('🎨 初始化混色引擎...', savedEngine);
    try {
        painter = createPainter(savedEngine, mixCanvas);
        await painter.init();
        currentEngine = savedEngine;

        const savedDataURL = paletteStorage.load();
        if (savedDataURL) {
            await new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    // 用临时 2D canvas 解码 PNG → 读取像素 → 上传 WebGL
                    const tmpCanvas = document.createElement('canvas');
                    tmpCanvas.width = mixCanvas.width;
                    tmpCanvas.height = mixCanvas.height;
                    const tmpCtx = tmpCanvas.getContext('2d');
                    tmpCtx.drawImage(img, 0, 0);
                    const imageData = tmpCtx.getImageData(0, 0, mixCanvas.width, mixCanvas.height);
                    painter.writeFromPixels(imageData.data, mixCanvas.width, mixCanvas.height);
                    saveState();
                    resolve();
                };
                img.onerror = () => {
                    painter.clear(CANVAS_BG);
                    saveState();
                    resolve();
                };
                img.src = savedDataURL;
            });
            console.log('✅ 画布内容已从快照恢复');
        } else {
            painter.clear(CANVAS_BG);
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
        paletteStorage.saveAppSettings({ smudgeBrushSize, smudgeStrength, smudgeBrushType, pressureEnabled });
    });

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
            updateStatus('smudge');
            const mixLabelEl = document.getElementById('mixLabel');
            mixLabelEl.textContent = t('smudgeStrength');
            mixLabelEl.title = t('smudgeStrengthTitle');

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
            syncAllRangeThumbs();
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
            updateStatus('draw');
            const mixLabelEl2 = document.getElementById('mixLabel');
            mixLabelEl2.textContent = t('paintConcentration');
            mixLabelEl2.title = t('paintConcentrationTitle');

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
            syncAllRangeThumbs();
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

        // 阻止 Ctrl+F / Ctrl+G 弹出查找框
        if (e.ctrlKey && (e.key === 'f' || e.key === 'g' || e.key === 'F' || e.key === 'G')) {
            e.preventDefault();
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

    mixCanvas.addEventListener('pointerdown', (e) => {
        // 阻止默认行为（防止长按时浏览器恢复系统光标）
        e.preventDefault();

        const rect = mixCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);
        const pressure = (pressureEnabled && e.pointerType === 'pen') ? (e.pressure > 0 ? e.pressure : 1.0) : 1.0;

        if (isEyedropperMode) {
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
            beginStroke('brush', strokeColor, x, y, pressure);

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
                        drawBrush(interpX, interpY, strokeColor, interpX, interpY, pressure);
                        addStrokePoint(interpX, interpY);
                    }
                } else {
                    // 距离太远或太近，直接绘制
                    drawBrush(x, y, strokeColor, x, y, pressure);
                    addStrokePoint(x, y);
                }
            } else {
                // 第一次点击，直接绘制
                drawBrush(x, y, strokeColor, x, y, pressure);
                addStrokePoint(x, y);
            }

            lastX = x;
            lastY = y;
            if (painter) painter.flush();
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
            if (painter) painter.flush();
        }
    });

    mixCanvas.addEventListener('pointermove', (e) => {
        e.preventDefault();
        if (isDrawing && !isEyedropperMode) {
            const rect = mixCanvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
            const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);
            const pressure = (pressureEnabled && e.pointerType === 'pen') ? (e.pressure > 0 ? e.pressure : 1.0) : 1.0;

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
                            const r = drawBrush(interpX, interpY, activeColor, prevIX, prevIY, pressure);
                            if (r) unionRect = unionRect ? unionDirtyRect(unionRect, r) : r;
                            addStrokePoint(interpX, interpY);
                            prevIX = interpX; prevIY = interpY;
                        }
                    } else {
                        const r = drawBrush(x, y, activeColor, lastX, lastY, pressure);
                        unionRect = r;
                        addStrokePoint(x, y);
                    }

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
            // 每个 pointermove 末尾统一 flush 一次，避免中间帧闪烁
            if (painter) painter.flush();
        }

        // 笔刷光标跟随（无论是否在绘制）
        {
            const rect = mixCanvas.getBoundingClientRect();
            updateBrushCursor(e.clientX - rect.left, e.clientY - rect.top);
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

    mixCanvas.addEventListener('pointerleave', () => {
        if (isDrawing && strokeStarted) {
            isDrawing = false;
            strokeStarted = false;

            endStroke();
        }
        hideBrushCursor();
    });

    // ── 笔刷光标 ──────────────────────────────────────
    const brushCursorCanvas = document.getElementById('brushCursor');
    const brushCursorCtx = brushCursorCanvas.getContext('2d');
    let _cursorCacheKey = null;  // 上次绘制时的 key，用于判断是否需要重绘

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
        if (!brushManager || isEyedropperMode || isRectSelectMode) {
            hideBrushCursor();
            return;
        }

        const rect = mixCanvas.getBoundingClientRect();
        const scaleX = rect.width / mixCanvas.width;
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

        brushCursorCanvas.style.width  = totalSize + 'px';
        brushCursorCanvas.style.height = totalSize + 'px';
        // pad 补偿：让笔刷形状中心对准鼠标
        brushCursorCanvas.style.left = (cssX - canvasSize / 2 - pad) + 'px';
        brushCursorCanvas.style.top  = (cssY - canvasSize / 2 - pad) + 'px';
        brushCursorCanvas.style.display = 'block';
        mixCanvas.style.cursor = 'none';
    }

    function hideBrushCursor() {
        brushCursorCanvas.style.display = 'none';
        mixCanvas.style.cursor = '';
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
    } else if (mode === 'smudge') {
        statusText.innerHTML = t('statusSmudge');
    } else {
        statusText.innerHTML = t('statusDraw');
    }
}

/**
 * 开始新笔画
 */
function beginStroke(type, color = null, startX = 0, startY = 0, pressure = 1.0) {
    const effectiveSize = Math.max(brushSize * 0.01, brushSize * pressure);
    currentStroke = {
        type: type,
        points: [],
        color: color,
        brushSize: brushSize,
        brushType: currentBrush.type,
        mixStrength: painter ? painter.getMixStrength() : 0.5
    };
    brushManager.refreshRandomBrush(effectiveSize, currentBrush);
    currentStrokeBrushCanvas = brushManager.createBrushTexture(effectiveSize, currentBrush);

    if (type === 'smudge') {
        // 角度归零：每笔重新开始旋转，避免每笔开头方向相同
        _smudgeAngle = 0;
        // 只记录起始坐标，用于距离衰减计算
        smudgeSnapshotCache = { startX, startY };
        currentStroke.canvasSnapshot = smudgeSnapshotCache;
        // 落笔时把当前画布冻结到 smudgeSnapshot 纹理，
        // 涂抹全程从这张快照采样，颜色不会被反复稀释变灰
        if (painter) painter.captureSmudgeSnapshot();
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
        pushSnapshot();
        smudgeSnapshotCache = null;
        currentStroke = null;
        updateHistoryButtons();
        saveCanvasToStorage();
    }
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
function restoreState(step) {
    if (!painter) return;
    if (painter.restoreHistoryFrame(step)) {
        updateHistoryButtons();
    }
}

/**
 * 异步写入 localStorage（不阻塞当前帧）
 */
function saveCanvasToStorage() {
    if (!painter) return;
    painter.scheduleIdleSave(() => {
        paletteStorage.save(painter.toDataURL('image/png'));
    });
}

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

    // 压感映射：1% ~ 100% 的笔刷大小；鼠标传入 1.0 保持满大小
    const effectiveSize = Math.max(brushSize * 0.01, brushSize * pressure);

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
        brushRotation,
    );

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

    let unionRect = null;
    for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const x = x1 + (x2 - x1) * ratio;
        const y = y1 + (y2 - y1) * ratio;
        const r = smudgeAtPoint(x, y, x2 - x1, y2 - y1);
        if (r) {
            unionRect = unionRect ? unionDirtyRect(unionRect, r) : r;
        }
    }
}

/**
 * 在指定点执行涂抹：复用笔刷 smear 逻辑，把移动方向后方的颜色带到当前位置。
 * density=0（baseMixStrength=0）→ 纯 smear，不混入新颜料，不会反复混浊。
 */
function smudgeAtPoint(x, y, dx, dy) {
    if (!painter) return;

    const len = Math.sqrt(dx * dx + dy * dy);
    const dirX = len > 0 ? dx / len : 0;
    const dirY = len > 0 ? dy / len : 0;
    const smearLen = brushSize * 0.5 * (smudgeStrength / 100) * 0.3;

    const brushCanvas = currentStrokeBrushCanvas
        || brushManager.createBrushTexture(brushSize, currentBrush);

    // smudgeMix：后方颜色参与物理混色的比例，低强度保留更多当前位置颜色感
    // 映射到原始 smudgeStrength 30~60 对应的区间 0.32~0.44
    const smudgeMix = 0.32 + (smudgeStrength / 100) * 0.12;

    const prevStrength = painter.getMixStrength();
    painter.setMixStrength(0); // density=0 → 纯 smear 分支
    const result = painter.drawBrush(
        x, y, brushSize * 2,
        { r: 0, g: 0, b: 0 },
        brushCanvas,
        true,
        { x: dirX, y: dirY }, smearLen,
        false,  // disableSmear=false，走 smear 路径
        1.0, false, 0, 0, 0, smudgeMix
    );
    painter.setMixStrength(prevStrength);
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