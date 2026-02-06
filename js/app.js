// ============ WebView 通信 ============
// 检测是否在 UXP WebView 环境中
function isInWebView() {
  return typeof window.uxpHost !== 'undefined';
}

// 发送颜色到 Photoshop
function sendColorToPS(target, hexColor) {
  if (isInWebView()) {
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);

    window.uxpHost.postMessage({
      type: "setColor",
      target: target,
      color: { r, g, b, hex: hexColor }
    });
    console.log(`📤 → PS ${target}: ${hexColor}`);
  }
}
// ============ WebView 通信结束 ============

// 颜料预设
const palettePresets = {
    // 温莎牛顿 Cotman 16 色
    winsorNewtonCotman: {
        name: "温莎牛顿 Cotman 16色",
        colors: [
            { hex: '#F5E84C', name: 'Lemon Yellow', nameCN: '柠檬黄' },
            { hex: '#F0D635', name: 'Cadmium Yellow Pale Hue', nameCN: '镉黄浅' },
            { hex: '#ED7F3D', name: 'Cadmium Orange Hue', nameCN: '镉橙' },
            { hex: '#E85D5D', name: 'Cadmium Red Pale Hue', nameCN: '镉红浅' },
            { hex: '#7A1818', name: 'Alizarin Crimson Hue', nameCN: '茜素深红' },
            { hex: '#6B2A7C', name: 'Purple Lake', nameCN: '紫湖' },
            { hex: '#1C3575', name: 'Ultramarine', nameCN: '群青' },
            { hex: '#1A8FCC', name: 'Cerulean Blue Hue', nameCN: '天蓝' },
            { hex: '#0A7A5A', name: 'Viridian Hue', nameCN: '翠绿' },
            { hex: '#456B0E', name: 'Sap Green', nameCN: '树汁绿' },
            { hex: '#C49665', name: 'Yellow Ochre', nameCN: '黄赭' },
            { hex: '#8F4A2A', name: 'Raw Sienna', nameCN: '生赭' },
            { hex: '#7A3F13', name: 'Burnt Sienna', nameCN: '熟赭' },
            { hex: '#362320', name: 'Burnt Umber', nameCN: '熟褐' },
            { hex: '#424B5A', name: 'Payne\'s Gray', nameCN: '佩恩灰' },
            { hex: '#F5F5F0', name: 'Chinese White', nameCN: '中国白' }
        ]
    },
    // 数字艺术家调色板
    digitalArtist: {
        name: "数字艺术家调色板",
        colors: [
            { hex: '#FFFF00', name: 'Yellow', nameCN: '黄色' },
            { hex: '#FFA500', name: 'Orange', nameCN: '橙色' },
            { hex: '#FF0000', name: 'Red', nameCN: '红色' },
            { hex: '#FF69B4', name: 'Hot Pink', nameCN: '粉红' },
            { hex: '#8A2BE2', name: 'Violet', nameCN: '紫色' },
            { hex: '#0000FF', name: 'Blue', nameCN: '蓝色' },
            { hex: '#00BFFF', name: 'Deep Sky Blue', nameCN: '天蓝' },
            { hex: '#008000', name: 'Green', nameCN: '绿色' },
            { hex: '#00FF7F', name: 'Spring Green', nameCN: '春绿' },
            { hex: '#8B4513', name: 'Brown', nameCN: '棕色' },
            { hex: '#D2B48C', name: 'Tan', nameCN: '棕褐' },
            { hex: '#FFD700', name: 'Gold', nameCN: '金色' },
            { hex: '#ffffff', name: 'White', nameCN: '纯白' },
            { hex: '#808080', name: 'Gray', nameCN: '灰色' },
            { hex: '#2F4F4F', name: 'Dark Slate Gray', nameCN: '深灰' },
            { hex: '#000000', name: 'Black', nameCN: '黑色' }
        ]
    },
    // 施美尔 Schmincke Horadam 16色
    schminckeHoradam: {
        name: "施美尔 Horadam 16色",
        colors: [
            { hex: '#FFEB3B', name: 'Lemon Yellow', nameCN: '柠檬黄' },
            { hex: '#FFC107', name: 'Indian Yellow', nameCN: '印度黄' },
            { hex: '#FF5722', name: 'Vermilion', nameCN: '朱红' },
            { hex: '#E91E63', name: 'Ruby Red', nameCN: '宝石红' },
            { hex: '#9C27B0', name: 'Magenta', nameCN: '洋红' },
            { hex: '#673AB7', name: 'Mauve', nameCN: '淡紫' },
            { hex: '#3F51B5', name: 'Ultramarine Finest', nameCN: '特级群青' },
            { hex: '#2196F3', name: 'Prussian Blue', nameCN: '普鲁士蓝' },
            { hex: '#03A9F4', name: 'Cerulean Blue', nameCN: '天蓝' },
            { hex: '#009688', name: 'Phthalo Green', nameCN: '酞青绿' },
            { hex: '#4CAF50', name: 'Permanent Green', nameCN: '永固绿' },
            { hex: '#8BC34A', name: 'May Green', nameCN: '五月绿' },
            { hex: '#CDDC39', name: 'Green Earth', nameCN: '绿土' },
            { hex: '#A1887F', name: 'Burnt Sienna', nameCN: '熟赭' },
            { hex: '#795548', name: 'Sepia Brown', nameCN: '深褐' },
            { hex: '#607D8B', name: 'Neutral Grey', nameCN: '中性灰' }
        ]
    },
    // 日本吴竹透明水彩 16色
    kuretakeGansai: {
        name: "吴竹 Gansai 16色",
        colors: [
            { hex: '#FFEB3B', name: 'Pale Yellow', nameCN: '淡黄' },
            { hex: '#FFC107', name: 'Yellow', nameCN: '中黄' },
            { hex: '#FF9800', name: 'Orange', nameCN: '橙色' },
            { hex: '#F44336', name: 'Scarlet', nameCN: '朱红' },
            { hex: '#E91E63', name: 'Carmine', nameCN: '胭脂红' },
            { hex: '#9C27B0', name: 'Violet', nameCN: '紫色' },
            { hex: '#673AB7', name: 'Purple', nameCN: '深紫' },
            { hex: '#3F51B5', name: 'Indigo', nameCN: '靛蓝' },
            { hex: '#2196F3', name: 'Blue', nameCN: '蓝色' },
            { hex: '#03A9F4', name: 'Light Blue', nameCN: '浅蓝' },
            { hex: '#00BCD4', name: 'Turquoise', nameCN: '绿松石' },
            { hex: '#009688', name: 'Viridian', nameCN: '翠绿' },
            { hex: '#4CAF50', name: 'Green', nameCN: '绿色' },
            { hex: '#8BC34A', name: 'Sap Green', nameCN: '树绿' },
            { hex: '#795548', name: 'Brown', nameCN: '棕色' },
            { hex: '#607D8B', name: 'Gray', nameCN: '灰色' }
        ]
    }
};

// 当前颜料预设
let currentPalette = 'winsorNewtonCotman';
let colors = palettePresets[currentPalette].colors;

// 当前状态
let foregroundColor = colors[0].hex;
let backgroundColor = colors[15].hex;
let currentBrushColor = foregroundColor;
let brushSize = 15;
let isDrawing = false;
let isEyedropperMode = false;
let currentBrush = { type: 'watercolor', image: null };

// 工具模式
let currentTool = 'brush';  // 'brush' 或 'smudge'
let smudgeStrength = 50;  // 涂抹强度 (0-100)
let smudgeBrushSize = 15;  // 涂抹工具的笔刷大小
let savedBrushSettings = null;  // 临时保存笔刷设置（切换到涂抹工具时使用）

// 历史记录 - 基于路径记录
let history = [];  // 存储操作记录
let historyStep = -1;
const MAX_HISTORY = 50;

// 当前笔画路径
let currentStroke = null;  // { type: 'brush'|'smudge'|'clear', points: [], color, brushSize, brushType, ... }

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

/**
 * 初始化应用
 */
async function initApp() {
    // 1. 初始化笔刷管理器
    brushManager = new BrushManager();
    
    // 2. 初始化持久化存储
    paletteStorage = new PaletteStorage();
    
    // 3. 加载保存的调色盘预设
    const savedPalette = paletteStorage.loadPalettePreset();
    if (savedPalette && palettePresets[savedPalette]) {
        currentPalette = savedPalette;
        colors = palettePresets[currentPalette].colors;
        foregroundColor = colors[0].hex;
        backgroundColor = colors[15].hex;
        currentBrushColor = foregroundColor;
        console.log('✅ 已加载保存的调色盘预设:', palettePresets[currentPalette].name);
    }
    
    // 4. 加载保存的笔刷设置
    const savedBrushSettings = paletteStorage.loadBrushSettings();
    if (savedBrushSettings) {
        // 恢复笔刷类型
        if (savedBrushSettings.brushType) {
            currentBrush.type = savedBrushSettings.brushType;
        }
        
        // 恢复笔刷大小
        if (savedBrushSettings.brushSize) {
            brushSize = savedBrushSettings.brushSize;
            if (brushSizeInput) brushSizeInput.value = brushSize;
            if (brushSizeValue) brushSizeValue.textContent = brushSize;
        }
        
        console.log('✅ 已加载保存的笔刷设置');
    }

    // 5. 初始化画布
    await initCanvas();
    
    // 6. 初始化UI
    initUI();
    
    // 7. 绑定事件
    bindEvents();
    
    // 8. 初始化调色板下拉菜单
    initPaletteDropdown();

    // 9. 初始化缩放控制
    initZoomControl();
}

/**
 * 保存笔刷设置
 */
function saveBrushSettings() {
    const settings = {
        brushType: currentBrush.type,
        brushSize: brushSize,
    };
    
    paletteStorage.saveBrushSettings(settings);
}

/**
 * 初始化画布
 */
async function initCanvas() {
    // 先获取2D上下文，这样它就会被保留
    const ctx2d = mixCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx2d) {
        console.error('无法获取2D上下文');
        return;
    }

    // 根据环境选择合适的Painter实现
    console.log('🎨 初始化 Mixbox 引擎...');
    try {
        // 检查全局对象是否可用
        if (typeof MixboxWebGLPainter !== 'undefined' && isWebGLSupported()) {
            // 标准Web环境 - 使用WebGL实现
            painter = new MixboxWebGLPainter(mixCanvas);
            console.log('使用 WebGL 渲染器');
        } else if (typeof MixboxCanvasPainter !== 'undefined') {
            // 使用Canvas 2D实现
            painter = new MixboxCanvasPainter(mixCanvas);
            console.log('使用 Canvas 2D 渲染器');
        } else {
            throw new Error('没有可用的渲染器，请确保已加载 mixbox-painter.js 或 mixbox-canvas-painter.js');
        }

        await painter.init();

        // 尝试加载保存的历史记录
        const savedHistory = paletteStorage.loadHistory();

        if (savedHistory && savedHistory.history && savedHistory.history.length > 0) {
            // 通过重绘历史记录恢复画布
            history = savedHistory.history;
            historyStep = savedHistory.step;

            // 清空画布后重绘所有笔画
            painter.clear({ r: 0.973, g: 0.973, b: 0.961 });

            for (let i = 0; i <= historyStep; i++) {
                const action = history[i];
                if (!action) continue;

                if (action.type === 'init') {
                    continue;
                } else if (action.type === 'clear') {
                    painter.clear({ r: 0.973, g: 0.973, b: 0.961 });
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
            painter.clear({ r: 0.973, g: 0.973, b: 0.961 });
            painter.readToCanvas2D();
            saveState();
        }

        updateColorDisplay();
        updateBrushPreview();

        console.log('✅ Mixbox 引擎初始化完成');
    } catch (error) {
        console.error('初始化 Mixbox 引擎失败:', error);
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

    // 更新混色距离标签
    const mixStrengthLabel = document.querySelector('label[for="brushMix"]');
    if (mixStrengthLabel) {
        mixStrengthLabel.textContent = '混色强度:';
    }
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
        option.textContent = palettePresets[key].name;
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
    paletteInfo.textContent = palettePresets[currentPalette].name;
}

/**
 * 切换调色板
 */
function switchPalette(paletteKey) {
    if (palettePresets[paletteKey] && paletteKey !== currentPalette) {
        currentPalette = paletteKey;
        colors = palettePresets[paletteKey].colors;
        
        // 更新前景色和背景色
        foregroundColor = colors[0].hex;
        backgroundColor = colors[15].hex;
        currentBrushColor = foregroundColor;
        
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
        tooltip.textContent = colorObj.nameCN;
        circle.appendChild(tooltip);
        
        circle.addEventListener('click', (e) => {
            e.preventDefault();
            foregroundColor = colorObj.hex;
            currentBrushColor = foregroundColor;
            updateColorDisplay();
            sendColorToPS('foreground', colorObj.hex);
            
            // 选择颜色后自动关闭涂抹模式
            if (currentTool === 'smudge') {
                const smudgeBtn = document.getElementById('smudgeBtn');
                smudgeBtn.click();  // 触发切换回笔刷模式
            }
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
        
        if (painter && painter.setMixStrength) {
            // 将 1-100 的范围转换为 0.01-1.0 的混合强度
            const mixStrength = value / 100;  // 1% -> 0.01, 100% -> 1.0
            painter.setMixStrength(mixStrength);
            console.log(`混合强度: ${value}% (${mixStrength.toFixed(2)})`);
        }
    });
    
    // 清空按钮
    clearBtn.addEventListener('click', () => {
        if (painter) {
            painter.clear({ r: 0.973, g: 0.973, b: 0.961 });
            painter.readToCanvas2D();
        } else {
            ctx.fillStyle = '#F8F8F5';
            ctx.fillRect(0, 0, mixCanvas.width, mixCanvas.height);
        }

        // 清空历史记录
        history = [];
        historyStep = -1;
        saveState();  // 重新初始化历史

        // 清除保存的画布（修改为清除所有数据）
        paletteStorage.clearAll();
    });
    
    // 撤销/重做
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    
    // 涂抹工具按钮
    const smudgeBtn = document.getElementById('smudgeBtn');
    smudgeBtn.addEventListener('click', () => {
        if (currentTool === 'brush') {
            // 切换到涂抹工具
            currentTool = 'smudge';
            smudgeBtn.classList.add('active');
            
            // 临时保存当前笔刷设置
            savedBrushSettings = {
                size: brushSize,
                mixStrength: parseInt(brushMixValue.textContent)
            };
            
            // 加载涂抹工具设置
            brushSize = smudgeBrushSize;
            brushSizeInput.value = smudgeBrushSize;
            brushSizeValue.textContent = smudgeBrushSize;
            
            brushMixSlider.value = smudgeStrength;
            brushMixValue.textContent = smudgeStrength;
            
            console.log('✅ 切换到涂抹工具');
        } else {
            // 切换回笔刷工具
            currentTool = 'brush';
            smudgeBtn.classList.remove('active');
            
            // 保存涂抹工具设置
            smudgeBrushSize = brushSize;
            smudgeStrength = parseInt(brushMixValue.textContent);
            
            // 恢复之前保存的笔刷设置
            if (savedBrushSettings) {
                brushSize = savedBrushSettings.size;
                brushSizeInput.value = savedBrushSettings.size;
                brushSizeValue.textContent = savedBrushSettings.size;
                
                brushMixSlider.value = savedBrushSettings.mixStrength;
                brushMixValue.textContent = savedBrushSettings.mixStrength;
                painter.setMixStrength(savedBrushSettings.mixStrength / 100);
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
    document.addEventListener('keydown', (e) => {
        if (e.altKey && !isEyedropperMode) {
            isEyedropperMode = true;
            mixCanvas.classList.add('eyedropper');
            mixCanvas.classList.remove('brush');
            updateStatus('eyedropper-fg');
            
            // 按下 Alt 键时高亮吸管按钮
            const eyedropperBtn = document.getElementById('eyedropperBtn');
            if (eyedropperBtn) {
                eyedropperBtn.classList.add('active');
            }
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (!e.altKey && isEyedropperMode) {
            isEyedropperMode = false;
            mixCanvas.classList.remove('eyedropper');
            mixCanvas.classList.add('brush');
            updateStatus('draw');
            
            // 松开 Alt 键时取消高亮
            const eyedropperBtn = document.getElementById('eyedropperBtn');
            if (eyedropperBtn) {
                eyedropperBtn.classList.remove('active');
            }
        }
    });
    
    // Canvas 事件
    let strokeStarted = false;
    let lastX = 0;
    let lastY = 0;
    let minDistance = 2; // 笔触之间的最小距离，可以调整

    mixCanvas.addEventListener('mousedown', (e) => {
        const rect = mixCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (mixCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (mixCanvas.height / rect.height);

        if (isEyedropperMode) {
            // 吸管模式下阻止默认行为，但不立即取色
            e.preventDefault();
            return;
        } else if (currentTool === 'brush') {
            // 笔刷工具模式
            isDrawing = true;
            strokeStarted = true;

            // 开始新笔画
            beginStroke('brush', currentBrushColor);

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
                        drawBrush(interpX, interpY, currentBrushColor);
                        addStrokePoint(interpX, interpY);
                    }
                } else {
                    // 距离太远或太近，直接绘制
                    drawBrush(x, y, currentBrushColor);
                    addStrokePoint(x, y);
                }
            } else {
                // 第一次点击，直接绘制
                drawBrush(x, y, currentBrushColor);
                addStrokePoint(x, y);
            }

            lastX = x;
            lastY = y;
        } else if (currentTool === 'smudge') {
            // 涂抹工具模式
            isDrawing = true;
            strokeStarted = true;

            // 开始新涂抹笔画，记录涂抹强度
            beginStroke('smudge');
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

                if (distance >= minDistance) {
                    const steps = Math.floor(distance / minDistance);

                    if (steps > 1) {
                        for (let i = 1; i <= steps; i++) {
                            const ratio = i / steps;
                            const interpX = lastX + (x - lastX) * ratio;
                            const interpY = lastY + (y - lastY) * ratio;
                            drawBrush(interpX, interpY, currentBrushColor);
                            addStrokePoint(interpX, interpY);
                        }
                    } else {
                        drawBrush(x, y, currentBrushColor);
                        addStrokePoint(x, y);
                    }

                    lastX = x;
                    lastY = y;
                }
            } else if (currentTool === 'smudge') {
                // 涂抹工具模式
                const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));

                if (distance >= minDistance) {
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
                sendColorToPS('foreground', pickedColor);
            } else if (e.button === 2) {
                backgroundColor = pickedColor;
                updateStatus('eyedropper-bg');
                sendColorToPS('background', pickedColor);
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
        name.textContent = brush.name;
        
        option.appendChild(canvas);
        option.appendChild(name);
        
        option.addEventListener('click', () => {
            currentBrush = { type: brush.type, image: null };
            updateBrushPreview();
            brushModal.classList.remove('active');
            saveBrushSettings(); // 保存笔刷设置
        });
        
        brushGrid.appendChild(option);
    });
}

/**
 * 更新颜色显示
 */
function updateColorDisplay() {
    fgColorBox.style.backgroundColor = foregroundColor;
    bgColorBox.style.backgroundColor = backgroundColor;
    document.querySelectorAll('.color-circle').forEach(circle => {
        const color = circle.dataset.color;
        circle.classList.toggle('selected-fg', color === foregroundColor);
        circle.classList.toggle('selected-bg', color === backgroundColor);
    });
}

/**
 * 更新状态文本
 */
function updateStatus(mode) {
    if (mode === 'eyedropper-fg') {
        statusText.innerHTML = '• 当前模式: <strong style="color: #1473e6;">吸管 (前景色)</strong>';
    } else if (mode === 'eyedropper-bg') {
        statusText.innerHTML = '• 当前模式: <strong style="color: #44b556;">吸管 (背景色)</strong>';
    } else {
        statusText.innerHTML = '• 当前模式: <strong>绘制</strong>';
    }
}

/**
 * 开始新笔画
 */
function beginStroke(type, color = null) {
    currentStroke = {
        type: type,  // 'brush', 'smudge', 'clear'
        points: [],
        color: color,
        brushSize: brushSize,
        brushType: currentBrush.type,
        mixStrength: painter ? painter.getMixStrength() : 0.5
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
        } else {
            historyStep++;
        }

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
    painter.clear({ r: 0.973, g: 0.973, b: 0.961 });

    // 2. 重绘从第一步到目标步骤的所有笔画
    for (let i = 0; i <= step; i++) {
        const action = history[i];
        if (!action) continue;

        if (action.type === 'init') {
            // 初始状态，不需要做任何事
            continue;
        } else if (action.type === 'clear') {
            // 清空操作
            painter.clear({ r: 0.973, g: 0.973, b: 0.961 });
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

        // 执行涂抹段
        replaySmudgeSegment(prev.x, prev.y, curr.x, curr.y, stroke.brushSize, stroke.brushType, stroke.smudgeStrength);
    }

    painter.setMixStrength(savedMixStrength);
}

/**
 * 重放涂抹段
 */
function replaySmudgeSegment(x1, y1, x2, y2, size, brushType, strength) {
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

        // 采样当前位置颜色（从已混色的画布上取色）
        const sourceColor = pickColor(Math.floor(x), Math.floor(y));
        const sourceRGB = hexToRgb(sourceColor);

        // 计算目标位置（使用记录的涂抹强度）
        const pushDistance = (size / 2) * (strength / 100);
        const targetX = x + dirX * pushDistance;
        const targetY = y + dirY * pushDistance;

        // 绘制到目标位置（会与画布上已有颜色混色）
        painter.drawBrush(targetX, targetY, size * 2, sourceRGB, brushCanvas);

        // 每次绘制后同步到 2D canvas，以便下一次取色正确
        painter.readToCanvas2D();
    }
}

/**
 * 持久化存储当前画布（异步，不阻塞撤销/重做）
 */
async function saveCanvasToStorage() {
    try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = mixCanvas.width;
        tempCanvas.height = mixCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        if (!tempCtx) {
            console.error('无法创建临时 canvas 上下文');
            return;
        }
        
        // 从主 canvas 复制当前内容
        tempCtx.drawImage(mixCanvas, 0, 0);
        
        // 转换为 Data URL（兼容 UXP）
        let dataURL;
        if (isAdobeUXP && tempCanvas.toBlob) {
            // UXP 环境：使用 toBlob
            dataURL = await new Promise((resolve, reject) => {
                tempCanvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('toBlob 失败'));
                        return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                }, 'image/png');
            });
        } else if (tempCanvas.toDataURL) {
            // 标准浏览器环境
            dataURL = tempCanvas.toDataURL('image/png');
        } else {
            console.warn('当前环境不支持 canvas 导出');
            return;
        }
        
        const brushSettings = {
            brushType: currentBrush.type,
            brushSize: brushSize,
        };

        paletteStorage.autoSaveAll(dataURL, currentPalette, brushSettings);

        // 同时保存历史记录
        paletteStorage.saveHistory(history, historyStep);
    } catch (error) {
        console.error('保存画布失败:', error);
    }
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
 * 绘制笔刷
 */
function drawBrush(x, y, color) {
    if (!color || !painter) return;
    
    // 1. 转换颜色为 RGB (0-1)
    const colorRGB = hexToRgb(color);
    
    // 2. 创建笔刷纹理
    const brushCanvas = brushManager.createBrushTexture(brushSize, currentBrush);
    
    // 3. 使用 WebGL 绘制（物理混色）
    painter.drawBrush(
        x, 
        y, 
        brushSize * 2,  // WebGL 笔刷尺寸需要 *2
        colorRGB, 
        brushCanvas,
    );
    
    // 4. 读取到 Canvas 2D（用于显示）
    painter.readToCanvas2D();
}

/**
 * 涂抹工具：沿着路径涂抹
 */
function smudgeAlongPath(x1, y1, x2, y2) {
    if (!painter) return;
    
    // 计算路径长度
    const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    const steps = Math.max(1, Math.floor(distance / 2));  // 每 2 像素采样一次
    
    // 沿着路径插值
    for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const x = x1 + (x2 - x1) * ratio;
        const y = y1 + (y2 - y1) * ratio;
        
        // 在当前位置执行涂抹
        smudgeAtPoint(x, y, x2 - x1, y2 - y1);
    }
    
    // 读取到 Canvas 2D
    painter.readToCanvas2D();
}

/**
 * 在指定点执行涂抹
 */
function smudgeAtPoint(x, y, dx, dy) {
    if (!painter) return;
    
    const ctx = mixCanvas.getContext('2d', { willReadFrequently: true });
    const radius = brushSize / 2;
    
    // 1. 采样起点颜色（当前位置的颜色）
    const sourceColor = pickColor(Math.floor(x), Math.floor(y));
    
    // 2. 计算推移方向（单位化）
    const length = Math.sqrt(dx * dx + dy * dy);
    const dirX = length > 0 ? dx / length : 0;
    const dirY = length > 0 ? dy / length : 0;
    
    // 3. 计算目标位置（沿着方向推移）
    const pushDistance = radius * (smudgeStrength / 100);  // 根据强度计算推移距离
    const targetX = x + dirX * pushDistance;
    const targetY = y + dirY * pushDistance;
    
    // 4. 采样目标位置的颜色
    const targetColor = pickColor(Math.floor(targetX), Math.floor(targetY));
    
    // 5. 混合两个颜色（使用 Mixbox）
    const sourceRGB = hexToRgb(sourceColor);
    const targetRGB = hexToRgb(targetColor);
    
    // 6. 创建笔刷纹理
    const brushCanvas = brushManager.createBrushTexture(brushSize, currentBrush);
    
    // 7. 在目标位置绘制混合后的颜色
    painter.drawBrush(
        targetX,
        targetY,
        brushSize * 2,
        sourceRGB,  // 使用采样的颜色
        brushCanvas
    );
}

// ============ 缩放控制 ============
function initZoomControl() {
    const zoomBtn = document.getElementById('zoomBtn');
    const zoomDropdown = document.getElementById('zoomDropdown');
    const container = document.querySelector('.container');

    // 从 localStorage 读取保存的缩放比例
    let currentZoom = parseFloat(localStorage.getItem('mixbox_zoom') || '1.0');

    // 应用初始缩放
    applyZoom(currentZoom);

    // 切换下拉菜单
    zoomBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomDropdown.classList.toggle('show');
    });

    // 选择缩放选项
    document.querySelectorAll('.zoom-option').forEach(option => {
        const zoom = parseFloat(option.getAttribute('data-zoom'));

        // 标记当前选中的选项
        if (Math.abs(zoom - currentZoom) < 0.01) {
            option.classList.add('active');
        }

        option.addEventListener('click', (e) => {
            e.stopPropagation();

            // 移除所有 active 状态
            document.querySelectorAll('.zoom-option').forEach(opt => {
                opt.classList.remove('active');
            });

            // 添加当前选中状态
            option.classList.add('active');

            // 应用缩放
            currentZoom = zoom;
            applyZoom(currentZoom);

            // 保存到 localStorage
            localStorage.setItem('mixbox_zoom', currentZoom.toString());

            // 关闭下拉菜单
            zoomDropdown.classList.remove('show');
        });
    });

    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', () => {
        zoomDropdown.classList.remove('show');
    });

    function applyZoom(zoom) {
        container.style.transform = `scale(${zoom})`;
        container.style.transformOrigin = 'top center';
        zoomBtn.textContent = `缩放: ${Math.round(zoom * 100)}%`;

        // 调整 body 的 padding，防止缩放后内容被裁剪
        if (zoom < 1) {
            document.body.style.padding = '10px';
        } else {
            document.body.style.padding = '20px';
        }
    }
}

// 导出到全局
window.initApp = initApp;
console.log('🚀 app.js 加载完成，调用 initApp() 初始化应用');