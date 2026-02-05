/**
 * Mixbox 纯 JavaScript 实现
 */
(function() {
    // 如果已经存在 mixbox 对象，不再重复定义
    if (window.mixbox) return;
    
    // 定义 mixbox 对象
    const mixbox = {};
    
    // Mixbox 的 LATENT_SIZE 常量
    mixbox.LATENT_SIZE = 8;
    
    /**
     * 线性插值两种颜色
     * @param {Array|Object} rgb1 - 第一个RGB颜色 [r,g,b] 或 {r,g,b}
     * @param {Array|Object} rgb2 - 第二个RGB颜色 [r,g,b] 或 {r,g,b}
     * @param {Number} t - 混合系数 (0-1)
     * @returns {Array} - 混合后的RGB颜色 [r,g,b]
     */
    mixbox.lerp = function(rgb1, rgb2, t) {
        // 处理不同的输入格式
        let r1, g1, b1, r2, g2, b2;
        
        if (Array.isArray(rgb1)) {
            [r1, g1, b1] = rgb1;
        } else {
            r1 = rgb1.r;
            g1 = rgb1.g;
            b1 = rgb1.b;
        }
        
        if (Array.isArray(rgb2)) {
            [r2, g2, b2] = rgb2;
        } else {
            r2 = rgb2.r;
            g2 = rgb2.g;
            b2 = rgb2.b;
        }
        
        // 将RGB转换为潜在空间
        const latent1 = mixbox.rgbToLatent([r1, g1, b1]);
        const latent2 = mixbox.rgbToLatent([r2, g2, b2]);
        
        // 在潜在空间中线性插值
        const mixedLatent = new Array(mixbox.LATENT_SIZE);
        for (let i = 0; i < mixbox.LATENT_SIZE; i++) {
            mixedLatent[i] = (1 - t) * latent1[i] + t * latent2[i];
        }
        
        // 将插值结果转换回RGB
        return mixbox.latentToRgb(mixedLatent);
    };
    
    /**
     * 将RGB颜色转换为潜在空间
     * @param {Array|Object} rgb - RGB颜色 [r,g,b] 或 {r,g,b}
     * @returns {Array} - 潜在空间表示
     */
    mixbox.rgbToLatent = function(rgb) {
        // 这里实现RGB到潜在空间的转换
        // 这是一个简化版，实际实现需要使用预计算的查找表或神经网络
        let r, g, b;
        
        if (Array.isArray(rgb)) {
            [r, g, b] = rgb;
        } else {
            r = rgb.r;
            g = rgb.g;
            b = rgb.b;
        }
        
        // 简化实现，使用预定义的转换矩阵
        // 实际的Mixbox使用更复杂的非线性转换
        const latent = new Array(mixbox.LATENT_SIZE).fill(0);
        
        // 基于颜色的基本分量分配权重
        latent[0] = r;
        latent[1] = g;
        latent[2] = b;
        latent[3] = (r + g) / 2;
        latent[4] = (g + b) / 2;
        latent[5] = (r + b) / 2;
        latent[6] = (r + g + b) / 3;
        latent[7] = Math.max(r, g, b) - Math.min(r, g, b); // 饱和度
        
        return latent;
    };
    
    /**
     * 将潜在空间表示转换回RGB
     * @param {Array} latent - 潜在空间表示
     * @returns {Array} - RGB颜色 [r,g,b]
     */
    mixbox.latentToRgb = function(latent) {
        // 这是一个简化版，实际实现需要使用预计算的查找表或神经网络
        
        // 基于潜在空间的加权组合
        let r = latent[0] * 0.5 + latent[3] * 0.25 + latent[5] * 0.25 + latent[6] * 0.2;
        let g = latent[1] * 0.5 + latent[3] * 0.25 + latent[4] * 0.25 + latent[6] * 0.2;
        let b = latent[2] * 0.5 + latent[4] * 0.25 + latent[5] * 0.25 + latent[6] * 0.2;
        
        // 确保值在0-1范围内
        r = Math.max(0, Math.min(1, r));
        g = Math.max(0, Math.min(1, g));
        b = Math.max(0, Math.min(1, b));
        
        return [r, g, b];
    };
    
    /**
     * 返回 GLSL 着色器代码
     * @returns {String} - GLSL 代码
     */
    mixbox.glsl = function() {
        return `
        // Mixbox GLSL 实现
        vec3 mixbox_latent_to_rgb(vec3 latent) {
            // 简化实现，与 JavaScript 版本一致
            float r = latent.r * 0.5 + latent.r * 0.25 + latent.b * 0.25 + ((latent.r + latent.g + latent.b) / 3.0) * 0.2;
            float g = latent.g * 0.5 + latent.r * 0.25 + latent.g * 0.25 + ((latent.r + latent.g + latent.b) / 3.0) * 0.2;
            float b = latent.b * 0.5 + latent.g * 0.25 + latent.b * 0.25 + ((latent.r + latent.g + latent.b) / 3.0) * 0.2;
            
            return clamp(vec3(r, g, b), 0.0, 1.0);
        }
        
        vec3 mixbox_rgb_to_latent(vec3 rgb) {
            // 简化实现，返回原始 RGB 作为潜在表示
            return rgb;
        }
        
        vec3 mixbox_lerp(vec3 color1, vec3 color2, float t) {
            // 简化实现，直接在 RGB 空间中线性插值
            return mix(color1, color2, t);
        }
        `;
    };
    
    /**
     * 创建查找表纹理
     * @param {WebGLRenderingContext} gl - WebGL 上下文
     * @returns {WebGLTexture} - 查找表纹理
     */
    mixbox.lutTexture = function(gl) {
        // 创建一个简单的 1x1 纹理作为占位符
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        // 创建一个 1x1 的纯白色纹理
        const pixel = new Uint8Array([255, 255, 255, 255]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        
        return texture;
    };
    
    // 导出到全局
    window.mixbox = mixbox;
    
    // 添加调试信息
    console.log("Mixbox JS 加载成功");
})();