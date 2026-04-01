/**
 * 笔刷管理器
 * 管理笔刷预览和笔刷生成
 */
class BrushManager {
    constructor() {
        // 预设笔刷
        this.presetBrushes = [
            { type: 'circle' },
            { type: 'soft' },
            { type: 'watercolor' },
            { type: 'splatter' },
            { type: 'flat' },
            { type: 'dry' }
        ];
        // 笔刷纹理缓存（仅确定性笔刷，key = `${type}_${size}`）
        this._brushCache = new Map();
    }

    /**
     * 绘制笔刷预览
     */
    drawBrushPreview(ctx, x, y, size, type) {
        ctx.fillStyle = '#fff';
        
        switch(type) {
            case 'circle':
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
                break;
                
            case 'soft':
                // 修复：显示正确的渐变圆形
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
                gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
                gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.4)');
                gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
                break;
                
            case 'watercolor':
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 0.3;
                for (let i = 0; i < 3; i++) {
                    const offsetX = (Math.random() - 0.5) * size * 0.5;
                    const offsetY = (Math.random() - 0.5) * size * 0.5;
                    ctx.beginPath();
                    ctx.arc(x + offsetX, y + offsetY, size * 0.6, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
                break;
                
            case 'splatter':
                for (let i = 0; i < 14; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = size * Math.pow(Math.random(), 0.7) * 0.82;
                    const proximity = 1 - dist / size;
                    const dotSize = size * (0.03 + proximity * 0.07 + Math.random() * 0.04);
                    const px = x + Math.cos(angle) * dist;
                    const py = y + Math.sin(angle) * dist;
                    const grad = ctx.createRadialGradient(px, py, dotSize * 0.5, px, py, dotSize);
                    grad.addColorStop(0, 'rgba(255,255,255,1)');
                    grad.addColorStop(1, 'rgba(255,255,255,0)');
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(px, py, dotSize, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.fillStyle = '#fff';
                break;
                
            case 'flat':
                // 修复：15° 倾斜角度
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(Math.PI / 12);  // 15° = π/12
                ctx.fillRect(-size * 1.2, -size * 0.4, size * 2.4, size * 0.8);
                ctx.restore();
                break;
                
            case 'dry':
                // 干笔刷 - 不规则边缘
                ctx.globalAlpha = 0.8;
                for (let i = 0; i < 20; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dist = Math.random() * size;
                    const dotSize = size * (0.1 + Math.random() * 0.2);
                    ctx.beginPath();
                    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, dotSize, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
                break;
        }
    }

    /**
     * 创建笔刷纹理
     */
    createBrushTexture(size, brush) {
        // splatter/dry 含随机数，不缓存；自定义图片笔刷也不缓存
        const cacheable = !brush.image && brush.type !== 'splatter' && brush.type !== 'dry';
        if (cacheable) {
            const key = `${brush.type}_${size}`;
            if (this._brushCache.has(key)) return this._brushCache.get(key);
        }

        const canvas = document.createElement('canvas');
        canvas.width = size * 2;
        canvas.height = size * 2;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, size * 2, size * 2);

        const centerX = size;
        const centerY = size;

        if (brush.image) {
            // 自定义图片笔刷
            ctx.drawImage(brush.image, 0, 0, size * 2, size * 2);
        } else {
            // 预设笔刷（简化版，保留核心形状）
            // 填黑色：shader 只用 alpha 通道，黑色不会对混色产生白色偏移
            ctx.fillStyle = '#000';
            
            switch(brush.type) {
                case 'circle':
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, size * 0.9, 0, Math.PI * 2);
                    ctx.fill();
                    break;
                    
                case 'soft':
                    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, size);
                    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
                    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.5)');
                    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, size * 2, size * 2);
                    break;
                    
                case 'watercolor': {
                    // 边缘堆积水彩：逐像素环形 alpha，中心柔和、边缘堆积
                    const wcData = ctx.createImageData(size * 2, size * 2);
                    const wd = wcData.data;
                    for (let py = 0; py < size * 2; py++) {
                        for (let px = 0; px < size * 2; px++) {
                            const dx = px - centerX;
                            const dy = py - centerY;
                            const dist = Math.sqrt(dx * dx + dy * dy) / (size * 0.92);
                            if (dist > 1) continue;
                            // 中心平缓（smoothstep），边缘快速堆积后收边
                            const t = dist < 0.7
                                ? dist * dist * (3 - 2 * dist) / (0.7 * 0.7 * (3 - 2 * 0.7))  // smoothstep 归一化到 0→1
                                : (1 - dist) / 0.3;  // 边缘快速收边
                            const alpha = 0.04 + t * t * 0.96;
                            const idx = (py * size * 2 + px) * 4;
                            wd[idx + 3] = Math.round(alpha * 255);
                        }
                    }
                    ctx.putImageData(wcData, 0, 0);
                    // 极少量边缘毛边，只贴在最外圈，不进入中间区域
                    ctx.fillStyle = '#000';
                    const edgeCount = 8;
                    for (let i = 0; i < edgeCount; i++) {
                        const angle = (Math.PI * 2 * i) / edgeCount + (i % 3) * 0.25;
                        const r = size * (0.88 + (i % 3) * 0.015);
                        const blobSize = size * 0.04;
                        ctx.globalAlpha = 0.4 + (i % 2) * 0.2;
                        ctx.beginPath();
                        ctx.arc(centerX + Math.cos(angle) * r, centerY + Math.sin(angle) * r, blobSize, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.globalAlpha = 1;
                    break;
                }
                    
                case 'splatter': {
                    // 第一步：在离屏 canvas 上画散落圆点
                    const dotCanvas = document.createElement('canvas');
                    dotCanvas.width = size * 2;
                    dotCanvas.height = size * 2;
                    const dotCtx = dotCanvas.getContext('2d');
                    const totalDots = 28;
                    for (let i = 0; i < totalDots; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        // 幂次分布让点向中心聚集；限制在 0.82 以内确保不超出贴图
                        const dist = size * Math.pow(Math.random(), 0.7) * 0.82;
                        // 外围的点更小，增强中心密外围稀的视觉感
                        const proximity = 1 - dist / size;
                        const dotSize = size * (0.03 + proximity * 0.07 + Math.random() * 0.04);
                        const cx = centerX + Math.cos(angle) * dist;
                        const cy = centerY + Math.sin(angle) * dist;
                        // 每个点用径向渐变实现柔和边缘
                        const inner = Math.max(0, dotSize * 0.5);
                        const grad = dotCtx.createRadialGradient(cx, cy, inner, cx, cy, dotSize);
                        grad.addColorStop(0, 'rgba(0,0,0,1)');
                        grad.addColorStop(1, 'rgba(0,0,0,0)');
                        dotCtx.fillStyle = grad;
                        dotCtx.beginPath();
                        dotCtx.arc(cx, cy, dotSize, 0, Math.PI * 2);
                        dotCtx.fill();
                    }

                    // 第二步：用整体径向 envelope 压暗外缘，消除贴图轮廓感
                    // destination-in 让点层只保留 envelope 的 alpha 形状
                    const envGrad = dotCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, size * 0.9);
                    envGrad.addColorStop(0,   'rgba(0,0,0,1)');
                    envGrad.addColorStop(0.55, 'rgba(0,0,0,1)');
                    envGrad.addColorStop(1,    'rgba(0,0,0,0)');
                    dotCtx.globalCompositeOperation = 'destination-in';
                    dotCtx.fillStyle = envGrad;
                    dotCtx.fillRect(0, 0, size * 2, size * 2);

                    // 第三步：把结果贴到主纹理
                    ctx.drawImage(dotCanvas, 0, 0);
                    ctx.fillStyle = '#000';
                    ctx.globalAlpha = 1;
                    break;
                }
                    
                case 'flat':
                    ctx.save();
                    ctx.translate(centerX, centerY);
                    ctx.rotate(Math.PI / 12);
                    ctx.fillRect(-size * 1.2, -size * 0.4, size * 2.4, size * 0.8);
                    ctx.restore();
                    break;
                    
                case 'dry':
                    ctx.globalAlpha = 0.8;
                    for (let i = 0; i < 60; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        // 平方根分布让点向中心集中，减少中间空洞感
                        const dist = Math.sqrt(Math.random()) * size * 0.85;
                        const dotSize = size * (0.03 + Math.random() * 0.07);
                        ctx.beginPath();
                        ctx.arc(centerX + Math.cos(angle) * dist, centerY + Math.sin(angle) * dist, dotSize, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.globalAlpha = 1;
                    break;
            }
        }
        
        if (cacheable) {
            const key = `${brush.type}_${size}`;
            this._brushCache.set(key, canvas);
        }
        return canvas;
    }

    /**
     * 获取预设笔刷列表
     */
    getPresetBrushes() {
        return this.presetBrushes;
    }
}