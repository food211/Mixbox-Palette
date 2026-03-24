/**
 * KM 混色引擎 (Kubelka-Munk Mixing Engine)
 * 使用 Kubelka-Munk 物理公式进行颜料混色，无需 LUT
 *
 * Copyright (C) 2026 food211
 * License: GPL-3.0 (https://www.gnu.org/licenses/gpl-3.0.html)
 * Repository: https://github.com/food211/Mixbox-Palette
 */
class KMWebGLPainter {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;

        // 创建离屏Canvas用于2D操作
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = canvas.width;
        this.offscreenCanvas.height = canvas.height;
        this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });

        this.program = null;
        this.textures = {};
        this.framebuffers = {};
        this.buffers = {};
        this.locations = {};
        this.currentBrushTexture = null;

        this.baseMixStrength = 0.2;
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
        this.initWebGL();
        this.compileShaders();
        this.setupTextures();
        this.setupFramebuffers();
        this.setupGeometry();

        console.log('✅ KMWebGLPainter 初始化完成');
    }

    /**
     * 初始化 WebGL
     */
    initWebGL() {
        this.webglCanvas = document.createElement('canvas');
        this.webglCanvas.width = this.canvas.width;
        this.webglCanvas.height = this.canvas.height;

        this.gl = this.webglCanvas.getContext('webgl', {
            alpha: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });

        if (!this.gl) {
            throw new Error('WebGL 不支持');
        }

        const gl = this.gl;
        gl.disable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    /**
     * 编译着色器
     */
    compileShaders() {
        const gl = this.gl;

        // 顶点着色器
        const vsSource = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;

        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;

        uniform vec2 u_resolution;

        void main() {
            vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
            gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

            v_texCoord = a_texCoord;
            v_canvasCoord = a_position;
        }
        `;

        // 片段着色器 - 纯 KM 公式，无 LUT 依赖
        const fsSource = `
        precision highp float;

        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;

        uniform sampler2D u_canvasTexture;
        uniform sampler2D u_brushTexture;
        uniform vec4 u_brushColor;
        uniform vec2 u_resolution;
        uniform vec2 u_currentPosition;
        uniform float u_brushRadius;
        uniform float u_baseMixStrength;
        // ============ KM 混色 ============

        // KM Direct: sRGB 空间几何平均
        vec3 km_mix_direct(vec3 c1, vec3 c2, float t) {
            vec3 r1 = clamp(c1, 0.001, 0.999);
            vec3 r2 = clamp(c2, 0.001, 0.999);
            return pow(r1, vec3(1.0 - t)) * pow(r2, vec3(t));
        }

        // KM Pure: KM Direct + 线性插值，通道互斥动态混合 + 蓝黄绿校正
        vec3 km_mix(vec3 c1, vec3 c2, float t) {
            vec3 km = km_mix_direct(c1, c2, t);
            vec3 lin = c1 + (c2 - c1) * t;

            // 通道互斥检测
            float conflictR = abs(c1.r - c2.r) * (1.0 - min(c1.r, c2.r));
            float conflictG = abs(c1.g - c2.g) * (1.0 - min(c1.g, c2.g));
            float conflictB = abs(c1.b - c2.b) * (1.0 - min(c1.b, c2.b));
            float maxConflict = max(conflictR, max(conflictG, conflictB));
            float conflictBlend = maxConflict * maxConflict;

            float blend = max(0.5, conflictBlend);

            vec3 result = km + (lin - km) * blend;

            // 蓝黄绿校正（HSV色相检测 + 饱和度加权）
            float maxC1 = max(c1.r, max(c1.g, c1.b));
            float minC1 = min(c1.r, min(c1.g, c1.b));
            float maxC2 = max(c2.r, max(c2.g, c2.b));
            float minC2 = min(c2.r, min(c2.g, c2.b));
            float sat1 = maxC1 > 0.001 ? (maxC1 - minC1) / maxC1 : 0.0;
            float sat2 = maxC2 > 0.001 ? (maxC2 - minC2) / maxC2 : 0.0;

            // HSV hue (0~1)
            float hue1 = -1.0;
            float hue2 = -1.0;
            float d1 = maxC1 - minC1;
            float d2 = maxC2 - minC2;
            if (d1 > 0.001) {
                float h1;
                if (maxC1 == c1.r) h1 = mod((c1.g - c1.b) / d1, 6.0);
                else if (maxC1 == c1.g) h1 = (c1.b - c1.r) / d1 + 2.0;
                else h1 = (c1.r - c1.g) / d1 + 4.0;
                hue1 = mod(h1 / 6.0 + 1.0, 1.0);
            }
            if (d2 > 0.001) {
                float h2;
                if (maxC2 == c2.r) h2 = mod((c2.g - c2.b) / d2, 6.0);
                else if (maxC2 == c2.g) h2 = (c2.b - c2.r) / d2 + 2.0;
                else h2 = (c2.r - c2.g) / d2 + 4.0;
                hue2 = mod(h2 / 6.0 + 1.0, 1.0);
            }
            // Blue hue ~0.49-0.83 (cyan-blue-purple), Yellow hue ~0.0-0.23 (orange-yellow)
            float bw1 = (hue1 >= 0.0) ? max(0.0, 1.0 - abs(hue1 - 0.66) / 0.17) * sat1 : 0.0;
            float yw1 = (hue1 >= 0.0) ? max(0.0, 1.0 - abs(hue1 - 0.11) / 0.12) * sat1 : 0.0;
            float bw2 = (hue2 >= 0.0) ? max(0.0, 1.0 - abs(hue2 - 0.66) / 0.17) * sat2 : 0.0;
            float yw2 = (hue2 >= 0.0) ? max(0.0, 1.0 - abs(hue2 - 0.11) / 0.12) * sat2 : 0.0;
            float crossSignal = max(bw1 * yw2, bw2 * yw1);
            float midWeight = 4.0 * t * (1.0 - t);
            // 自适应绿色注入：cross^0.3 使弱信号也能获得足够的绿色增强
            if (crossSignal > 0.01) {
                float crossP = pow(crossSignal, 0.3);
                float greenBoost = 0.13 * crossP * midWeight;
                float redReduce = 0.4 * crossP * midWeight;
                result.g = min(1.0, result.g + greenBoost);
                result.r = result.r * (1.0 - redReduce);
            }

            return result;
        }

        // ============ 主程序 ============

        void main() {
            vec4 brushSample = texture2D(u_brushTexture, v_texCoord);
            float brushAlpha = brushSample.a;

            if (brushAlpha < 0.01) {
                discard;
            }

            vec2 canvasUV = v_canvasCoord / u_resolution;
            canvasUV.y = 1.0 - canvasUV.y;
            vec4 canvasColor = texture2D(u_canvasTexture, canvasUV);

            float distToCenter = length(v_canvasCoord - u_currentPosition);
            float radialFalloff = 1.0 - smoothstep(0.0, u_brushRadius, distToCenter);
            float centerBoost = pow(radialFalloff, 0.5);

            float mixAmount = centerBoost * brushAlpha * u_baseMixStrength;

            gl_FragColor = vec4(km_mix(canvasColor.rgb, u_brushColor.rgb, mixAmount), 1.0);
        }
        `;

        const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
        this.program = this.createProgram(vs, fs);

        this.locations = {
            a_position:        gl.getAttribLocation(this.program, 'a_position'),
            a_texCoord:        gl.getAttribLocation(this.program, 'a_texCoord'),
            u_resolution:      gl.getUniformLocation(this.program, 'u_resolution'),
            u_canvasTexture:   gl.getUniformLocation(this.program, 'u_canvasTexture'),
            u_brushTexture:    gl.getUniformLocation(this.program, 'u_brushTexture'),
            u_brushColor:      gl.getUniformLocation(this.program, 'u_brushColor'),
            u_currentPosition: gl.getUniformLocation(this.program, 'u_currentPosition'),
            u_brushRadius:     gl.getUniformLocation(this.program, 'u_brushRadius'),
            u_baseMixStrength: gl.getUniformLocation(this.program, 'u_baseMixStrength')
        };
    }

    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('着色器编译错误:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(vs, fs) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('程序链接错误:', gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    /**
     * 设置纹理（无 LUT，只需双缓冲画布纹理）
     */
    setupTextures() {
        const gl = this.gl;
        const w = this.canvas.width;
        const h = this.canvas.height;

        this.textures.canvas = this.createEmptyTexture(w, h);
        this.textures.temp   = this.createEmptyTexture(w, h);

        console.log('✅ KM 纹理创建完成（无 LUT）');
    }

    createEmptyTexture(width, height) {
        const gl = this.gl;
        const texture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return texture;
    }

    createTextureFromImage(image) {
        const gl = this.gl;
        const texture = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return texture;
    }

    createBrushTextureFromCanvas(brushCanvas) {
        return this.createTextureFromImage(brushCanvas);
    }

    /**
     * 设置 Framebuffer
     */
    setupFramebuffers() {
        const gl = this.gl;

        this.framebuffers.canvas = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.canvas, 0);

        this.framebuffers.temp = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.temp, 0);

        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer 创建失败');
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * 设置几何体
     */
    setupGeometry() {
        const gl = this.gl;

        this.buffers.position = gl.createBuffer();

        const texCoords = new Float32Array([
            0.0, 0.0,
            1.0, 0.0,
            0.0, 1.0,
            1.0, 1.0
        ]);

        this.buffers.texCoord = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        this.pixelAlignmentOffset = 0.0;
    }

    /**
     * 绘制笔触（核心方法）
     */
    drawBrush(x, y, size, colorRGB, brushCanvas) {
        const gl = this.gl;

        if (brushCanvas !== this.lastBrushCanvas) {
            if (this.currentBrushTexture) {
                gl.deleteTexture(this.currentBrushTexture);
            }
            this.currentBrushTexture = this.createBrushTextureFromCanvas(brushCanvas);
            this.lastBrushCanvas = brushCanvas;
        }

        gl.useProgram(this.program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        // 清除纹理绑定
        for (let i = 0; i < 8; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        // 绑定纹理
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.uniform1i(this.locations.u_canvasTexture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
        gl.uniform1i(this.locations.u_brushTexture, 1);

        // 设置 uniform
        gl.uniform2f(this.locations.u_resolution, this.canvas.width, this.canvas.height);
        gl.uniform4f(this.locations.u_brushColor, colorRGB.r, colorRGB.g, colorRGB.b, 1.0);
        gl.uniform2f(this.locations.u_currentPosition, x, y);
        gl.uniform1f(this.locations.u_brushRadius, size / 2);
        gl.uniform1f(this.locations.u_baseMixStrength, this.baseMixStrength);

        // 更新几何体
        const halfSize = size / 2;
        const positions = new Float32Array([
            x - halfSize, y - halfSize,
            x + halfSize, y - halfSize,
            x - halfSize, y + halfSize,
            x + halfSize, y + halfSize
        ]);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.locations.a_position);
        gl.vertexAttribPointer(this.locations.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.enableVertexAttribArray(this.locations.a_texCoord);
        gl.vertexAttribPointer(this.locations.a_texCoord, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        this.swapTextures();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * 交换双缓冲纹理
     */
    swapTextures() {
        const gl = this.gl;

        for (let i = 0; i < 8; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        const tempTex = this.textures.canvas;
        this.textures.canvas = this.textures.temp;
        this.textures.temp = tempTex;

        const tempFB = this.framebuffers.canvas;
        this.framebuffers.canvas = this.framebuffers.temp;
        this.framebuffers.temp = tempFB;
    }

    /**
     * 从 WebGL 读取到 Canvas 2D
     */
    readToCanvas2D() {
        const gl = this.gl;
        const ctx = this.offscreenCtx;

        const pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4);

        for (let i = 0; i < 8; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // 翻转 Y 轴
        const flippedPixels = new Uint8ClampedArray(pixels.length);
        const width = this.canvas.width;
        const height = this.canvas.height;
        const rowSize = width * 4;

        for (let y = 0; y < height; y++) {
            const srcRow = (height - 1 - y) * rowSize;
            const dstRow = y * rowSize;
            for (let x = 0; x < rowSize; x++) {
                flippedPixels[dstRow + x] = pixels[srcRow + x];
            }
        }

        const imageData = new ImageData(flippedPixels, this.canvas.width, this.canvas.height);
        ctx.putImageData(imageData, 0, 0);

        const displayCtx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (displayCtx) {
            displayCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            displayCtx.drawImage(this.offscreenCanvas, 0, 0);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * 从 Canvas 2D 写入到 WebGL
     */
    writeFromCanvas2D() {
        const gl = this.gl;
        const ctx = this.offscreenCtx;

        const displayCtx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (displayCtx) {
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.drawImage(this.canvas, 0, 0);
        }

        const imageData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);

        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    getOffscreenContext() {
        return this.offscreenCtx;
    }

    getOffscreenCanvas() {
        return this.offscreenCanvas;
    }

    /**
     * 清空画布
     */
    clear(color = { r: 1, g: 1, b: 1 }) {
        const gl = this.gl;

        for (let i = 0; i < 8; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.clearColor(color.r, color.g, color.b, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.clearColor(color.r, color.g, color.b, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this.readToCanvas2D();
    }
}

window.KMWebGLPainter = KMWebGLPainter;
console.log("KMWebGLPainter 加载成功");
