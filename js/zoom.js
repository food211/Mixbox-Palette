// ============ 画布宽度调整 ============
const RESIZE_MIN = 480;   // container 最小宽度（同时作为默认值和 canvas 比例基准）
const RESIZE_MAX = 2000;
const RESIZE_STORAGE_KEY = 'mixbox_container_width';

// 当前 container max-width（像素，不含 zoom）
let _containerMaxWidth = parseInt(localStorage.getItem(RESIZE_STORAGE_KEY) || String(RESIZE_MIN));

function getContainerMaxWidth() { return _containerMaxWidth; }

function initResizeHandle() {
    const container = document.querySelector('.container');
    const handleLeft  = document.getElementById('resizeHandleLeft');
    const handleRight = document.getElementById('resizeHandleRight');
    const modal       = document.getElementById('resizeConfirmModal');
    const confirmText = document.getElementById('resizeConfirmText');
    const okBtn       = document.getElementById('resizeConfirmOkBtn');
    const cancelBtn   = document.getElementById('resizeConfirmCancelBtn');

    // 应用已保存的宽度
    _applyContainerWidth(_containerMaxWidth);

    let dragSide = null;      // 'left' | 'right'
    let dragStartX = 0;
    let dragStartWidth = 0;
    let pendingWidth = 0;

    function _positionHandles() {
        const rect = container.getBoundingClientRect();
        handleLeft.style.left  = (rect.left - 3) + 'px';
        handleRight.style.left = (rect.right - 3) + 'px';
    }

    // 每帧同步 handle 位置（container 受 zoom/panel 影响会动）
    function _rafLoop() {
        _positionHandles();
        requestAnimationFrame(_rafLoop);
    }
    requestAnimationFrame(_rafLoop);

    function _onPointerMove(e) {
        if (!dragSide) return;
        const dx = e.clientX - dragStartX;
        const zoom = typeof getCurrentZoom === 'function' ? getCurrentZoom() : 1;
        // 拖动量除以 zoom 还原为逻辑像素
        const delta = dx / zoom;
        let newWidth;
        if (dragSide === 'right') {
            newWidth = dragStartWidth + delta * 2; // 中心对称，两侧各变一半
        } else {
            newWidth = dragStartWidth - delta * 2;
        }
        newWidth = Math.round(Math.max(RESIZE_MIN, Math.min(RESIZE_MAX, newWidth)));
        // 实时预览（不提交）
        container.style.maxWidth = Math.floor(newWidth / zoom) + 'px';
        pendingWidth = newWidth;
    }

    function _onPointerUp() {
        if (!dragSide) return;
        handleLeft.classList.remove('dragging');
        handleRight.classList.remove('dragging');
        container.classList.remove('glow-dragging');
        dragSide = null;
        document.removeEventListener('pointermove', _onPointerMove);
        document.removeEventListener('pointerup', _onPointerUp);

        if (pendingWidth === _containerMaxWidth) return; // 没变化

        // 弹出确认框
        const isGrow = pendingWidth > _containerMaxWidth;
        const tpl = I18N.t(isGrow ? 'resizeGrow' : 'resizeShrink');
        const msg = tpl.replace('{from}', _containerMaxWidth).replace('{to}', pendingWidth);
        confirmText.textContent = msg;
        okBtn.textContent = I18N.t('confirm');
        cancelBtn.textContent = I18N.t('cancel');
        modal.classList.add('active');

        okBtn.onclick = async () => {
            modal.classList.remove('active');
            await _commitResize(pendingWidth);
        };
        cancelBtn.onclick = () => {
            modal.classList.remove('active');
            // 回退预览
            _applyContainerWidth(_containerMaxWidth);
        };
    }

    function _startDrag(side, e) {
        if (typeof isRectSelectMode !== 'undefined' && isRectSelectMode) return;
        dragSide = side;
        dragStartX = e.clientX;
        dragStartWidth = _containerMaxWidth;
        pendingWidth = _containerMaxWidth;
        if (side === 'left')  handleLeft.classList.add('dragging');
        if (side === 'right') handleRight.classList.add('dragging');
        container.classList.remove('glow-left', 'glow-right');
        container.classList.add('glow-dragging');
        document.addEventListener('pointermove', _onPointerMove);
        document.addEventListener('pointerup', _onPointerUp);
    }

    handleLeft.addEventListener('pointerdown',  (e) => { e.preventDefault(); _startDrag('left',  e); });
    handleRight.addEventListener('pointerdown', (e) => { e.preventDefault(); _startDrag('right', e); });

    handleLeft.addEventListener('mouseenter',  () => container.classList.add('glow-left'));
    handleLeft.addEventListener('mouseleave',  () => container.classList.remove('glow-left'));
    handleRight.addEventListener('mouseenter', () => container.classList.add('glow-right'));
    handleRight.addEventListener('mouseleave', () => container.classList.remove('glow-right'));
}

function _applyContainerWidth(w) {
    const container = document.querySelector('.container');
    if (!container) return;
    const zoom = typeof getCurrentZoom === 'function' ? getCurrentZoom() : 1;
    container.style.maxWidth = Math.floor(w / zoom) + 'px';
}

async function _commitResize(newWidth) {
    const mixCanvas = document.getElementById('mixCanvas');
    if (!mixCanvas || !window.painter) {
        _containerMaxWidth = newWidth;
        localStorage.setItem(RESIZE_STORAGE_KEY, String(newWidth));
        _applyContainerWidth(newWidth);
        return;
    }

    const oldW = mixCanvas.width;
    const oldH = mixCanvas.height;

    // 以 RESIZE_MIN 对应 680px 逻辑宽度为基准，按比例推算新分辨率
    const BASE_CONTAINER = RESIZE_MIN;
    const BASE_CANVAS_W  = 680;
    const BASE_CANVAS_H  = 572;
    const newCanvasW = Math.round(BASE_CANVAS_W * newWidth / BASE_CONTAINER);
    const newCanvasH = Math.round(BASE_CANVAS_H * newWidth / BASE_CONTAINER);

    // 先更新状态，防止 await 期间 window resize 事件用旧值覆盖 container 宽度
    _containerMaxWidth = newWidth;
    localStorage.setItem(RESIZE_STORAGE_KEY, String(newWidth));
    _applyContainerWidth(newWidth);

    // 1. 读取当前画面和参数
    const oldMixStrength = painter.getMixStrength();
    const oldPixels = painter.readPixelRegion(0, 0, oldW, oldH);

    // 2. 将旧像素写入离屏 2D canvas，再用 drawImage 缩放到新尺寸
    //    缩小：等比例缩放内容居中；扩展：内容居中，四周填白
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = oldW; srcCanvas.height = oldH;
    srcCanvas.getContext('2d').putImageData(
        new ImageData(oldPixels, oldW, oldH), 0, 0
    );

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = newCanvasW; dstCanvas.height = newCanvasH;
    const dstCtx = dstCanvas.getContext('2d');
    // 白色背景
    dstCtx.fillStyle = '#ffffff';
    dstCtx.fillRect(0, 0, newCanvasW, newCanvasH);

    if (newCanvasW < oldW) {
        // 缩小：等比例缩放，居中放置
        const scale = Math.min(newCanvasW / oldW, newCanvasH / oldH);
        const dw = Math.round(oldW * scale);
        const dh = Math.round(oldH * scale);
        const dx = Math.round((newCanvasW - dw) / 2);
        const dy = Math.round((newCanvasH - dh) / 2);
        dstCtx.drawImage(srcCanvas, dx, dy, dw, dh);
    } else {
        // 扩展：原始尺寸居中，四周留白
        const dx = Math.round((newCanvasW - oldW) / 2);
        const dy = Math.round((newCanvasH - oldH) / 2);
        dstCtx.drawImage(srcCanvas, dx, dy);
    }

    // 3. 读取最终像素
    const newPixels = dstCtx.getImageData(0, 0, newCanvasW, newCanvasH).data;

    // 4. Resize canvas 并重建 painter
    mixCanvas.width  = newCanvasW;
    mixCanvas.height = newCanvasH;
    painter = createPainter(currentEngine, mixCanvas);
    await painter.init();
    painter.setMixStrength(oldMixStrength);
    painter.writeFromPixels(newPixels, newCanvasW, newCanvasH);

    if (typeof saveState === 'function') saveState();
    if (typeof saveCanvasToStorage === 'function') saveCanvasToStorage();
    console.log(`✅ 画布已 resize: ${oldW}x${oldH} → ${newCanvasW}x${newCanvasH}`);
}

// ============ 缩放控制 ============
let _currentZoom = 1.0;
function getCurrentZoom() { return _currentZoom; }

function initZoomControl() {
    const zoomBtn = document.getElementById('zoomBtn');
    const zoomDropdown = document.getElementById('zoomDropdown');
    const container = document.querySelector('.container');

    // 从 localStorage 读取保存的缩放比例
    let currentZoom = parseFloat(localStorage.getItem('mixbox_zoom') || '1.0');
    _currentZoom = currentZoom;

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

    // 窗口大小变化时重新计算容器宽度
    let _resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(() => applyZoom(currentZoom), 150);
    });

    function applyZoom(zoom) {
        _currentZoom = zoom;
        container.style.transform = `scale(${zoom})`;
        container.style.transformOrigin = 'top center';
        zoomBtn.textContent = `${Math.round(zoom * 100)}%`;

        const adjustedMax = Math.floor(_containerMaxWidth / zoom);
        container.style.maxWidth = `${adjustedMax}px`;
        document.body.style.padding = zoom < 1 ? '0 10px 10px' : '0 12px 12px';

        // 检测 controls 第一行是否折行，若折行则扩大 maxWidth 到刚好容纳
        requestAnimationFrame(() => {
            const controls = document.querySelector('.controls');
            if (!controls) return;
            const breakEl = controls.querySelector('.controls-break');
            if (!breakEl) return;
            const children = [...controls.children];
            const breakIdx = children.indexOf(breakEl);
            const rowItems = children.slice(0, breakIdx);
            if (rowItems.length < 2) return;

            const firstTop = rowItems[0].offsetTop;
            const allInLine = rowItems.every(el => el.offsetTop === firstTop);
            if (!allInLine) {
                // 折行：把所有第一行元素宽度加起来，加上 gap 和 container 内边距
                const totalW = rowItems.reduce((sum, el) => sum + el.offsetWidth, 0)
                             + (rowItems.length - 1) * 2   // gap: 2px
                             + 30;                          // container padding: 15px * 2
                const needed = Math.ceil(totalW);
                // 只有需要的宽度比当前 maxWidth 更大时才覆盖
                const current = parseInt(container.style.maxWidth) || 0;
                if (needed > current) {
                    // 反算逻辑宽度并同步画布分辨率
                    const neededLogical = Math.ceil(needed * zoom);
                    _commitResize(neededLogical);
                }
            }
        });
    }

    initResizeHandle();
}
