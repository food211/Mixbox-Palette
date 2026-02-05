/**
 * 主应用逻辑
 */
// 全局变量
let webglPainter = null;  // WebGL 引擎实例
let paletteStorage = null;  // 持久化存储
let brushManager = null;  // 笔刷管理器

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

// 历史记录
let history = [];
let historyStep = -1;
const MAX_HISTORY = 50;

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

    // 初始化 WebGL 引擎
    console.log('🎨 初始化 Mixbox WebGL 引擎...');
    webglPainter = new MixboxWebGLPainter(mixCanvas);
    await webglPainter.init();
    
    // 尝试加载保存的画布
    const savedCanvas = paletteStorage.load();
    
    if (savedCanvas) {
        // 加载保存的画布
        const img = new Image();
        img.onload = () => {
            ctx2d.drawImage(img, 0, 0);
            // 同步到 WebGL
            webglPainter.writeFromCanvas2D();
            // 强制渲染一次，确保 WebGL 帧缓冲区也被更新
            webglPainter.readToCanvas2D();
            saveState();
            console.log('✅ 画布内容已恢复');
        };
        img.src = savedCanvas;
    } else {
        // 新建画布
        webglPainter.clear({ r: 0.973, g: 0.973, b: 0.961 });
        webglPainter.readToCanvas2D();
        saveState();
    }
    
    updateColorDisplay();
    updateBrushPreview();
    
    console.log('✅ Mixbox 引擎初始化完成');
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
        
        // ✅ 将 1-50 的范围转换为 0.01-0.5 的混合强度
        const mixStrength = value / 100;  // 1% -> 0.01, 50% -> 0.5
        webglPainter.setMixStrength(mixStrength);
        
        console.log(`混合强度: ${value}% (${mixStrength.toFixed(2)})`);
    });
    
    // 清空按钮
    clearBtn.addEventListener('click', () => {
        if (webglPainter) {
            webglPainter.clear({ r: 0.973, g: 0.973, b: 0.961 });
            webglPainter.readToCanvas2D();
            saveState();
        } else {
            ctx.fillStyle = '#F8F8F5';
            ctx.fillRect(0, 0, mixCanvas.width, mixCanvas.height);
            saveState();
        }
        
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
                webglPainter.setMixStrength(savedBrushSettings.mixStrength / 100);
            }
            
            console.log('✅ 切换回笔刷工具');
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
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (!e.altKey && isEyedropperMode) {
            isEyedropperMode = false;
            mixCanvas.classList.remove('eyedropper');
            mixCanvas.classList.add('brush');
            updateStatus('draw');
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
            e.preventDefault();
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
        } else if (currentTool === 'brush') {
            // 笔刷工具模式
            isDrawing = true;
            strokeStarted = true;
            
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
                    }
                } else {
                    // 距离太远或太近，直接绘制
                    drawBrush(x, y, currentBrushColor);
                }
            } else {
                // 第一次点击，直接绘制
                drawBrush(x, y, currentBrushColor);
            }
            
            lastX = x;
            lastY = y;
        } else if (currentTool === 'smudge') {
            // 涂抹工具模式
            isDrawing = true;
            strokeStarted = true;
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
                        }
                    } else {
                        drawBrush(x, y, currentBrushColor);
                    }
                    
                    lastX = x;
                    lastY = y;
                }
            } else if (currentTool === 'smudge') {
                // 涂抹工具模式
                const distance = Math.sqrt(Math.pow(x - lastX, 2) + Math.pow(y - lastY, 2));
                
                if (distance >= minDistance) {
                    // 沿着拖动路径涂抹
                    smudgeAlongPath(lastX, lastY, x, y);
                    
                    lastX = x;
                    lastY = y;
                }
            }
        }
    });
    
    mixCanvas.addEventListener('mouseup', () => {
        if (isDrawing && strokeStarted) {
            isDrawing = false;
            strokeStarted = false;
            
            saveState();
        }
    });
    
    mixCanvas.addEventListener('mouseleave', () => {
        if (isDrawing && strokeStarted) {
            isDrawing = false;
            strokeStarted = false;
            
            saveState();
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
 * 保存状态到历史记录
 */
function saveState() {
    const imageData = mixCanvas.toDataURL();
    history.splice(historyStep + 1);
    history.push(imageData);
    if (history.length > MAX_HISTORY) {
        history.shift();
    } else {
        historyStep++;
    }
    updateHistoryButtons();
    
    // 准备笔刷设置
    const brushSettings = {
        brushType: currentBrush.type,
        brushSize: brushSize,
    };
    
    // 自动保存画布、调色盘预设和笔刷设置（2秒防抖）
    paletteStorage.autoSaveAll(imageData, currentPalette, brushSettings);
}

/**
 * 恢复历史状态
 */
function restoreState(step) {
    if (step < 0 || step >= history.length) return;
    const img = new Image();
    img.onload = function() {
        ctx.clearRect(0, 0, mixCanvas.width, mixCanvas.height);
        ctx.drawImage(img, 0, 0);
        
        // 同步到 WebGL
        if (webglPainter) {
            webglPainter.writeFromCanvas2D();
        }
    };
    img.src = history[step];
    historyStep = step;
    updateHistoryButtons();
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
    if (!color || !webglPainter) return;
    
    // 1. 转换颜色为 RGB (0-1)
    const colorRGB = hexToRgb(color);
    
    // 2. 创建笔刷纹理
    const brushCanvas = brushManager.createBrushTexture(brushSize, currentBrush);
    
    // 3. 使用 WebGL 绘制（物理混色）
    webglPainter.drawBrush(
        x, 
        y, 
        brushSize * 2,  // WebGL 笔刷尺寸需要 *2
        colorRGB, 
        brushCanvas,
    );
    
    // 4. 读取到 Canvas 2D（用于显示）
    webglPainter.readToCanvas2D();
}

/**
 * 涂抹工具：沿着路径涂抹
 */
function smudgeAlongPath(x1, y1, x2, y2) {
    if (!webglPainter) return;
    
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
    webglPainter.readToCanvas2D();
}

/**
 * 在指定点执行涂抹
 */
function smudgeAtPoint(x, y, dx, dy) {
    if (!webglPainter) return;
    
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
    webglPainter.drawBrush(
        targetX,
        targetY,
        brushSize * 2,
        sourceRGB,  // 使用采样的颜色
        brushCanvas
    );
}

// 启动应用
document.addEventListener('DOMContentLoaded', initApp);