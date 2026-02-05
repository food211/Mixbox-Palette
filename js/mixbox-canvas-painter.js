/**
 * Canvas 2D 混色引擎
 * 使用 Mixbox 算法进行颜料物理混色，纯 JavaScript 实现
 * 适用于不支持 WebGL 的环境（如 Adobe UXP）
 */
class MixboxCanvasPainter {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        // 创建离屏Canvas用于双缓冲
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = canvas.width;
        this.offscreenCanvas.height = canvas.height;
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
        
        // 当前笔刷
        this.currentBrushCanvas = null;
        
        // 混合强度
        this.baseMixStrength = 0.2;
        
        // 初始化为白色背景
        this.clear({ r: 1, g: 1, b: 1 });
    }

    /**
     * 设置混合强度
     */
    setMixStrength(strength) {
        this.baseMixStrength = Math.max(0.01, Math.min(1.0, strength));
    }

    /**
     * 获取当前混合强度
     */
    getMixStrength() {
        return this.baseMixStrength;
    }

    /**
     * 初始化
     */
    async init() {
        console.log('✅ MixboxCanvasPainter 初始化完成');
        return Promise.resolve();
    }
    
    /**
     * 从 Canvas 创建笔刷纹理
     */
    createBrushTextureFromCanvas(brushCanvas) {
        // 在Canvas实现中，直接保存引用即可
        return brushCanvas;
    }
    
    /**
     * 绘制笔触 (核心方法)
     * 使用纯JavaScript实现Mixbox混色
     */
    drawBrush(x, y, size, colorRGB, brushCanvas) {
        // 更新当前笔刷
        this.currentBrushCanvas = brushCanvas;
        
        const halfSize = size / 2;
        const left = Math.floor(x - halfSize);
        const top = Math.floor(y - halfSize);
        const width = Math.ceil(size);
        const height = Math.ceil(size);
        
        // 获取当前区域的像素数据
        const imageData = this.ctx.getImageData(left, top, width, height);
        const pixels = imageData.data;
        
        // 创建一个临时的画布来绘制笔刷
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 绘制笔刷到临时画布
        tempCtx.drawImage(
            brushCanvas, 
            0, 0, brushCanvas.width, brushCanvas.height,
            0, 0, width, height
        );
        
        // 获取笔刷的像素数据
        const brushData = tempCtx.getImageData(0, 0, width, height);
        const brushPixels = brushData.data;
        
        // 遍历每个像素进行混色
        for (let i = 0; i < pixels.length; i += 4) {
            const brushAlpha = brushPixels[i + 3] / 255;
            
            // 如果笔刷在这个像素上是透明的，跳过
            if (brushAlpha < 0.01) continue;
            
            // 计算像素在画布上的位置
            const pixelX = (i / 4) % width;
            const pixelY = Math.floor((i / 4) / width);
            
            // 计算到中心点的距离
            const distToCenter = Math.sqrt(
                Math.pow(pixelX - halfSize, 2) + 
                Math.pow(pixelY - halfSize, 2)
            );
            
            // 径向衰减
            const radialFalloff = Math.max(0, 1 - distToCenter / halfSize);
            
            // 计算混合强度
            const mixAmount = radialFalloff * brushAlpha * this.baseMixStrength;
            
            if (mixAmount <= 0) continue;
            
            // 获取当前像素颜色
            const canvasR = pixels[i] / 255;
            const canvasG = pixels[i + 1] / 255;
            const canvasB = pixels[i + 2] / 255;
            
            // 使用Mixbox的lerp函数进行混色
            const mixed = window.mixbox.lerp(
                [canvasR, canvasG, canvasB],
                [colorRGB.r, colorRGB.g, colorRGB.b],
                mixAmount
            );
            
            // 更新像素值
            pixels[i] = Math.round(mixed[0] * 255);
            pixels[i + 1] = Math.round(mixed[1] * 255);
            pixels[i + 2] = Math.round(mixed[2] * 255);
            // Alpha保持不变
        }
        
        // 将修改后的像素数据写回画布
        this.ctx.putImageData(imageData, left, top);
        
        // 同步到离屏Canvas
        this.offscreenCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.offscreenCtx.drawImage(this.canvas, 0, 0);
    }
    
    /**
     * 从Canvas 2D读取到离屏Canvas
     */
    readToCanvas2D() {
        // 在Canvas实现中这是一个空操作，因为我们直接在Canvas上绘制
    }

    /**
     * 从离屏Canvas写入到Canvas 2D
     */
    writeFromCanvas2D() {
        // 从离屏Canvas复制到显示Canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
    }
    
    /**
     * 获取离屏Canvas的2D上下文
     */
    getOffscreenContext() {
        return this.offscreenCtx;
    }
    
    /**
     * 获取离屏Canvas
     */
    getOffscreenCanvas() {
        return this.offscreenCanvas;
    }

    /**
     * 清空画布
     */
    clear(color = { r: 1, g: 1, b: 1 }) {
        // 转换为CSS颜色
        const cssColor = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
        
        // 清除主画布
        this.ctx.fillStyle = cssColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 清除离屏画布
        this.offscreenCtx.fillStyle = cssColor;
        this.offscreenCtx.fillRect(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
    }
}

// 导出到全局
window.MixboxCanvasPainter = MixboxCanvasPainter;
// 添加调试信息
console.log("MixboxCanvasPainter 加载成功");