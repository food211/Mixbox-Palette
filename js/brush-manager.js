/**
 * 笔刷管理器
 * 管理笔刷预览和笔刷生成
 */
class BrushManager {
    constructor() {
        // 预设笔刷
        this.presetBrushes = [
            { name: '圆形', type: 'circle' },
            { name: '柔边', type: 'soft' },
            { name: '水彩', type: 'watercolor' },
            { name: '喷溅', type: 'splatter' },
            { name: '扁平笔', type: 'flat' },
            { name: '干笔刷', type: 'dry' }
        ];
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
                for (let i = 0; i < 8; i++) {
                    const angle = (Math.PI * 2 * i) / 8;
                    const dist = size * (0.5 + Math.random() * 0.5);
                    const dotSize = size * (0.2 + Math.random() * 0.3);
                    ctx.beginPath();
                    ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, dotSize, 0, Math.PI * 2);
                    ctx.fill();
                }
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
        const canvas = document.createElement('canvas');
        canvas.width = size * 2;
        canvas.height = size * 2;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        const centerX = size;
        const centerY = size;
        
        if (brush.image) {
            // 自定义图片笔刷
            ctx.drawImage(brush.image, 0, 0, size * 2, size * 2);
        } else {
            // 预设笔刷（简化版，保留核心形状）
            ctx.fillStyle = '#fff';
            
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
                    
                case 'watercolor':
                    // 主圆
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.arc(centerX, centerY, size * 0.8, 0, Math.PI * 2);
                    ctx.fill();
                    // 边缘扩散
                    ctx.globalAlpha = 0.3;
                    for (let i = 0; i < 5; i++) {
                        const angle = (Math.PI * 2 * i) / 5;
                        const dist = size * 0.5;
                        ctx.beginPath();
                        ctx.arc(centerX + Math.cos(angle) * dist, centerY + Math.sin(angle) * dist, size * 0.4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.globalAlpha = 1;
                    break;
                    
                case 'splatter':
                    for (let i = 0; i < 12; i++) {
                        const angle = (Math.PI * 2 * i) / 12;
                        const dist = size * (0.3 + Math.random() * 0.6);
                        const dotSize = size * (0.15 + Math.random() * 0.25);
                        ctx.beginPath();
                        ctx.arc(centerX + Math.cos(angle) * dist, centerY + Math.sin(angle) * dist, dotSize, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    break;
                    
                case 'flat':
                    ctx.save();
                    ctx.translate(centerX, centerY);
                    ctx.rotate(Math.PI / 12);
                    ctx.fillRect(-size * 1.2, -size * 0.4, size * 2.4, size * 0.8);
                    ctx.restore();
                    break;
                    
                case 'dry':
                    ctx.globalAlpha = 0.8;
                    for (let i = 0; i < 40; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const dist = Math.random() * size * 0.9;
                        const dotSize = size * (0.05 + Math.random() * 0.15);
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