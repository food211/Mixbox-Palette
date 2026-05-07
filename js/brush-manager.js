// ─── 水彩笔刷纹理参数 ─────────────────────────────────────────────────────────
const WC_DOT_COUNT      = 35;    // 点数
const WC_REF_SIZE       = 40;    // 基准笔尖：WC_DIST_RANGE 在此尺寸下成立，更大 size 时分布半径收紧
// 随机笔刷（watercolor/splatter/dry）变体池大小：每个 size 预生成 N 份，落笔随机挑一份
const RANDOM_VARIANT_COUNT = 4;
const WC_DIST_RANGE     = 0.8;   // 点分布半径（相对笔刷size）
const WC_DOT_SIZE_MIN   = 0.12;  // 点最小半径（相对size）
const WC_DOT_SIZE_RANGE = 0.18;  // 点大小随机范围
const WC_ALPHA_CENTER   = 0.5;   // 渐变中心 alpha
const WC_ALPHA_MID      = 0.3;   // 渐变中间 alpha（stop=0.5）
// ─────────────────────────────────────────────────────────────────────────────

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
        // 笔刷纹理缓存
        // 确定性笔刷（circle/soft/flat）：key = `${type}_${size}` → canvas
        // 随机笔刷（watercolor/splatter/dry）：key = `${type}_${size}` → canvas[]（变体池）
        this._brushCache = new Map();
        // 当前笔画使用的变体（refreshRandomBrush 写入，createBrushTexture 读取）
        // key = `${type}_${size}` → canvas
        this._activeVariant = new Map();
        // 上一次使用的变体索引；新一笔只在剩余变体中挑，避免连续两笔用同一份纹理
        // （不连续的"偶发重复"仍允许）
        // key = `${type}_${size}` → number
        this._lastVariantIdx = new Map();
        // 上次使用的变体索引，下笔从剩余变体里挑，避免连续两笔撞同一份纹理
        // key = `${type}_${size}` → number
        this._lastVariantIdx = new Map();
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
                ctx.globalAlpha = 0.8;
                for (let i = 0; i < 20; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const dotSize = size * (0.1 + Math.random() * 0.2);
                    const maxDist = size * 0.9 - dotSize;
                    const dist = Math.random() * maxDist;
                    ctx.beginPath();
                    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, dotSize, 0, Math.PI * 2);
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
                    const dotSize = size * (0.1 + Math.random() * 0.2);
                    const maxDist = size * 0.9 - dotSize; // 确保点不超出画布边缘
                    const dist = Math.random() * maxDist;
                    ctx.beginPath();
                    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, dotSize, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
                break;
        }
    }

    /**
     * 是否为含随机元素的笔刷（用变体池策略）
     */
    _isRandomBrush(brush) {
        return !brush.image && (brush.type === 'watercolor' || brush.type === 'splatter' || brush.type === 'dry');
    }

    /**
     * 落笔时调用：确保变体池存在（懒生成 RANDOM_VARIANT_COUNT 份），
     * 然后从池中随机挑一份作为本笔的"激活变体"，下次 createBrushTexture 直接返回它
     */
    refreshRandomBrush(size, brush) {
        if (!this._isRandomBrush(brush)) return;
        const key = `${brush.type}_${size}`;
        let pool = this._brushCache.get(key);
        if (!Array.isArray(pool)) {
            pool = [];
            for (let i = 0; i < RANDOM_VARIANT_COUNT; i++) {
                pool.push(this._buildBrushCanvas(size, brush));
            }
            this._brushCache.set(key, pool);
        }
        const lastIdx = this._lastVariantIdx.get(key);
        let idx = Math.floor(Math.random() * pool.length);
        if (idx === lastIdx && pool.length > 1) {
            // 连撞同一份：在剩余 N-1 份里再挑一次（>=2 份就保证与上一笔不同）
            idx = (idx + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
        }
        this._lastVariantIdx.set(key, idx);
        this._activeVariant.set(key, pool[idx]);
    }

    /**
     * 创建笔刷纹理
     */
    createBrushTexture(size, brush) {
        const cacheable = !brush.image;
        if (cacheable) {
            const key = `${brush.type}_${size}`;
            if (this._isRandomBrush(brush)) {
                // 随机笔刷：返回当前激活变体；池未建则现场建一份并激活
                const active = this._activeVariant.get(key);
                if (active) return active;
                this.refreshRandomBrush(size, brush);
                return this._activeVariant.get(key);
            }
            // 确定性笔刷：单 canvas 缓存
            const cached = this._brushCache.get(key);
            if (cached) return cached;
        }
        const canvas = this._buildBrushCanvas(size, brush);
        if (cacheable) {
            this._brushCache.set(`${brush.type}_${size}`, canvas);
        }
        return canvas;
    }

    /**
     * 实际生成一份笔刷 canvas（不带任何缓存逻辑）
     */
    _buildBrushCanvas(size, brush) {

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
                    // 大尺寸下分布半径按 sqrt(REF/size) 收紧，让 35 个点之间的间距与 size=40 接近；
                    // 点本身仍按 size 等比放大。size ≤ REF 时 distScale=1，不影响小笔尖手感。
                    const distScale = size > WC_REF_SIZE ? Math.sqrt(WC_REF_SIZE / size) : 1;
                    for (let i = 0; i < WC_DOT_COUNT; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const dist = Math.sqrt(Math.random()) * size * WC_DIST_RANGE * distScale;
                        const dotSize = size * (WC_DOT_SIZE_MIN + Math.random() * WC_DOT_SIZE_RANGE);
                        const cx = centerX + Math.cos(angle) * dist;
                        const cy = centerY + Math.sin(angle) * dist;
                        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotSize);
                        grad.addColorStop(0,   `rgba(0,0,0,${WC_ALPHA_CENTER})`);
                        grad.addColorStop(0.5, `rgba(0,0,0,${WC_ALPHA_MID})`);
                        grad.addColorStop(1,   'rgba(0,0,0,0)');
                        ctx.fillStyle = grad;
                        ctx.beginPath();
                        ctx.arc(cx, cy, dotSize, 0, Math.PI * 2);
                        ctx.fill();
                    }
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
                    envGrad.addColorStop(0,    'rgba(0,0,0,0.55)');
                    envGrad.addColorStop(0.3,  'rgba(0,0,0,0.85)');
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
        
        return canvas;
    }

    /**
     * 获取预设笔刷列表
     */
    getPresetBrushes() {
        return this.presetBrushes;
    }
}