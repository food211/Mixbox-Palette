/**
 * WebGL 混色引擎
 * 使用 Mixbox 算法进行颜料物理混色
 */
class MixboxWebGLPainter {
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
        
        this.baseMixStrength = 0.2; // ✅ 添加这个：基础混合强度
    }

    /**
     * 设置混合强度
     */
    setMixStrength(strength) {
        // strength 从 0-1 的范围
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
        // 2. 初始化 WebGL
        this.initWebGL();
        
        // 3. 编译着色器
        this.compileShaders();
        
        // 4. 创建纹理和 Framebuffer
        this.setupTextures();
        this.setupFramebuffers();
        
        // 5. 创建几何体
        this.setupGeometry();
        
        console.log('✅ MixboxWebGLPainter 初始化完成');
    }
    
    /**
     * 初始化 WebGL
     */
    initWebGL() {
        // 创建一个临时canvas用于WebGL渲染
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
        
        // 片段着色器 - 使用官方Mixbox库，低浓度时切换为涂抹模式
        const fsSource = `
        precision highp float;

        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;

        uniform sampler2D u_canvasTexture;
        uniform sampler2D u_brushTexture;
        uniform sampler2D mixbox_lut;
        uniform vec4 u_brushColor;
        uniform vec2 u_resolution;
        uniform vec2 u_currentPosition;
        uniform float u_brushRadius;
        uniform float u_baseMixStrength;
        uniform float u_useFalloff;
        uniform vec2 u_smearDir;
        uniform float u_smearLen;

        ${mixbox.glsl()}

        void main() {
            vec4 brushSample = texture2D(u_brushTexture, v_texCoord);
            float brushAlpha = u_useFalloff < 0.5
                ? step(0.5, brushSample.a)
                : brushSample.a;

            if (brushAlpha < 0.01) {
                discard;
            }

            vec2 canvasUV = v_canvasCoord / u_resolution;
            canvasUV.y = 1.0 - canvasUV.y;
            vec4 canvasColor = texture2D(u_canvasTexture, canvasUV);

            float distToCenter = length(v_canvasCoord - u_currentPosition);
            float radialFalloff = (u_useFalloff > 0.5 && u_useFalloff < 1.5)
                ? 1.0 - smoothstep(0.0, u_brushRadius, distToCenter)
                : 1.0;

            float aBrush = radialFalloff * brushAlpha;

            // density: 0=纯涂抹, 1=纯上色。pow 映射让低浓度区间更灵敏
            float density = u_baseMixStrength * u_baseMixStrength;

            // 采样上游颜色（笔划来的方向）
            float smearReach = clamp(u_smearLen, 1.0, u_brushRadius) * 0.8;
            vec2 smearUV = (v_canvasCoord - u_smearDir * smearReach) / u_resolution;
            smearUV.y = 1.0 - smearUV.y;
            smearUV = clamp(smearUV, 0.0, 1.0);
            vec4 smearSample = texture2D(u_canvasTexture, smearUV);

            vec3 safeCanvasRGB = (canvasColor.a > 0.1) ? canvasColor.rgb : u_brushColor.rgb;
            vec3 safeSmearRGB  = (smearSample.a > 0.1) ? smearSample.rgb : safeCanvasRGB;

            // 涂抹目标色：当前位置与上游颜色的 mixbox 混合
            vec3 smearTarget = mixbox_lerp(safeCanvasRGB, safeSmearRGB, aBrush * 0.6);

            vec3 outRGB;
            if (density > 0.98) {
                // 高浓度：纯上色
                outRGB = mixbox_lerp(canvasColor.rgb, u_brushColor.rgb, aBrush * u_baseMixStrength);
            } else if (density < 0.01) {
                // 极低浓度：纯涂抹，mixbox 混合上游色
                outRGB = smearTarget;
            } else {
                // 中间值：上色和涂抹按 density 过渡
                vec3 paintResult = mixbox_lerp(canvasColor.rgb, u_brushColor.rgb, aBrush * u_baseMixStrength);
                outRGB = mixbox_lerp(smearTarget, paintResult, density);
            }

            gl_FragColor = vec4(outRGB, 1.0);
        }
        `;
        
        // 编译
        const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
        this.program = this.createProgram(vs, fs);
        
        // 获取 locations
        this.locations = {
            a_position: gl.getAttribLocation(this.program, 'a_position'),
            a_texCoord: gl.getAttribLocation(this.program, 'a_texCoord'),
            u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            u_canvasTexture: gl.getUniformLocation(this.program, 'u_canvasTexture'),
            u_brushTexture: gl.getUniformLocation(this.program, 'u_brushTexture'),
            mixbox_lut: gl.getUniformLocation(this.program, 'mixbox_lut'),
            u_brushColor: gl.getUniformLocation(this.program, 'u_brushColor'),
            u_currentPosition: gl.getUniformLocation(this.program, 'u_currentPosition'),
            u_brushRadius: gl.getUniformLocation(this.program, 'u_brushRadius'),
            u_baseMixStrength: gl.getUniformLocation(this.program, 'u_baseMixStrength'),
            u_useFalloff: gl.getUniformLocation(this.program, 'u_useFalloff'),
            u_smearDir: gl.getUniformLocation(this.program, 'u_smearDir'),
            u_smearLen: gl.getUniformLocation(this.program, 'u_smearLen'),
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
     * 设置纹理
     */
    setupTextures() {
        const gl = this.gl;
        const w = this.canvas.width;
        const h = this.canvas.height;
        
        // 画布纹理 (双缓冲)
        this.textures.canvas = this.createEmptyTexture(w, h);
        this.textures.temp = this.createEmptyTexture(w, h);
        
        // 使用官方Mixbox LUT纹理
        this.textures.mixbox_lut = mixbox.lutTexture(gl);
        
        console.log('✅ 纹理创建完成');
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
    
    /**
     * 从 Canvas 创建笔刷纹理
     */
    createBrushTextureFromCanvas(brushCanvas) {
        return this.createTextureFromImage(brushCanvas);
    }
    
    /**
     * 设置 Framebuffer
     */
    setupFramebuffers() {
        const gl = this.gl;
        
        // 创建两个独立的帧缓冲区
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
        
        // 位置缓冲 (动态更新)
        this.buffers.position = gl.createBuffer();
        
        // 纹理坐标缓冲 (固定)
        const texCoords = new Float32Array([
            0.0, 0.0,
            1.0, 0.0,
            0.0, 1.0,
            1.0, 1.0
        ]);
        
        this.buffers.texCoord = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
        
        // 添加像素对齐修正
        this.pixelAlignmentOffset = 0.0;
    }
    
    /**
     * 绘制笔触 (核心方法)
     * 返回脏区矩形 {x, y, w, h}，供 readToCanvas2D 局部回读
     */
    drawBrush(x, y, size, colorRGB, brushCanvas, useFalloff = true, smearDir = { x: 0, y: 0 }, smearLen = 0) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // 计算笔刷 AABB，clamp 到画布范围
        const halfSize = size / 2;
        const rx0 = Math.max(0, Math.floor(x - halfSize));
        const ry0 = Math.max(0, Math.floor(y - halfSize));
        const rx1 = Math.min(cw, Math.ceil(x + halfSize));
        const ry1 = Math.min(ch, Math.ceil(y + halfSize));
        const rw = rx1 - rx0;
        const rh = ry1 - ry0;

        if (rw <= 0 || rh <= 0) return null;

        // 更新笔刷纹理
        if (brushCanvas !== this.lastBrushCanvas) {
            if (this.currentBrushTexture) {
                gl.deleteTexture(this.currentBrushTexture);
            }
            this.currentBrushTexture = this.createBrushTextureFromCanvas(brushCanvas);
            this.lastBrushCanvas = brushCanvas;
        }

        gl.useProgram(this.program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);

        // 全 viewport（保证顶点坐标→裁剪坐标的变换与 shader 中 canvasUV 计算一致）
        gl.viewport(0, 0, cw, ch);

        // 绑定纹理
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.mixbox_lut);
        gl.uniform1i(this.locations.mixbox_lut, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.uniform1i(this.locations.u_canvasTexture, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
        gl.uniform1i(this.locations.u_brushTexture, 2);

        // 设置 uniform
        gl.uniform2f(this.locations.u_resolution, cw, ch);
        gl.uniform4f(this.locations.u_brushColor, colorRGB.r, colorRGB.g, colorRGB.b, 1.0);
        gl.uniform2f(this.locations.u_currentPosition, x, y);
        gl.uniform1f(this.locations.u_brushRadius, size / 2);
        gl.uniform1f(this.locations.u_baseMixStrength, this.baseMixStrength);
        gl.uniform1f(this.locations.u_useFalloff, +useFalloff);
        gl.uniform2f(this.locations.u_smearDir, smearDir.x, smearDir.y);
        gl.uniform1f(this.locations.u_smearLen, smearLen);

        // 更新几何体
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

        // 绘制
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 交换纹理
        this.swapTextures();

        // 恢复默认 Framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { x: rx0, y: ry0, w: rw, h: rh };
    }

    /**
     * 交换双缓冲纹理
     */
    swapTextures() {
        // 交换引用
        const tempTex = this.textures.canvas;
        this.textures.canvas = this.textures.temp;
        this.textures.temp = tempTex;
        
        // 交换帧缓冲区引用
        const tempFB = this.framebuffers.canvas;
        this.framebuffers.canvas = this.framebuffers.temp;
        this.framebuffers.temp = tempFB;
    }     
    /**
     * 从 WebGL 读取到 Canvas 2D
     * @param {Object|null} rect - 局部脏区 {x, y, w, h}，null 则全量回读
     */
    readToCanvas2D(rect) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // 清除所有纹理绑定
        for (let i = 0; i < 8; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);

        const displayCtx = this.canvas.getContext('2d', { willReadFrequently: true });

        if (rect && rect.w > 0 && rect.h > 0) {
            // 局部回读：只读脏区
            // WebGL Y 轴从底部起
            const glY = ch - rect.y - rect.h;
            const pixels = new Uint8Array(rect.w * rect.h * 4);
            gl.readPixels(rect.x, glY, rect.w, rect.h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            // 翻转 Y 轴（局部）
            const flipped = new Uint8ClampedArray(pixels.length);
            const rowSize = rect.w * 4;
            for (let row = 0; row < rect.h; row++) {
                const srcRow = (rect.h - 1 - row) * rowSize;
                const dstRow = row * rowSize;
                flipped.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
            }

            const imageData = new ImageData(flipped, rect.w, rect.h);
            if (displayCtx) {
                displayCtx.putImageData(imageData, rect.x, rect.y);
            }
        } else {
            // 全量回读（用于 clear / restore 等场景）
            const pixels = new Uint8Array(cw * ch * 4);
            gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            const flipped = new Uint8ClampedArray(pixels.length);
            const rowSize = cw * 4;
            for (let row = 0; row < ch; row++) {
                const srcRow = (ch - 1 - row) * rowSize;
                const dstRow = row * rowSize;
                flipped.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
            }

            const imageData = new ImageData(flipped, cw, ch);
            this.offscreenCtx.putImageData(imageData, 0, 0);
            if (displayCtx) {
                displayCtx.clearRect(0, 0, cw, ch);
                displayCtx.drawImage(this.offscreenCanvas, 0, 0);
            }
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * 从 Canvas 2D 写入到 WebGL
     */
    writeFromCanvas2D() {
        const gl = this.gl;
        // 使用离屏canvas的2D上下文
        const ctx = this.offscreenCtx;
        
        // 先从显示Canvas复制到离屏Canvas
        const displayCtx = this.canvas.getContext('2d', { willReadFrequently: true });
        if (displayCtx) {
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.drawImage(this.canvas, 0, 0);
        }
        
        const imageData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        
        // 清除纹理绑定
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        
        // 绑定并更新画布纹理
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }
    
    // 添加方法获取离屏Canvas的2D上下文
    getOffscreenContext() {
        return this.offscreenCtx;
    }
    
    // 添加方法获取离屏Canvas
    getOffscreenCanvas() {
        return this.offscreenCanvas;
    }

    /**
     * 清空画布
     */
    clear(color = { r: 1, g: 1, b: 1 }) {
        const gl = this.gl;
        
        // 清除所有纹理绑定
        for (let i = 0; i < 8; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }
        
        // 清除画布帧缓冲区
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.clearColor(color.r, color.g, color.b, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // 清除临时帧缓冲区
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.clearColor(color.r, color.g, color.b, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // 恢复默认帧缓冲区
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        
        // 更新到Canvas 2D
        this.readToCanvas2D();
    }
}
window.MixboxWebGLPainter = MixboxWebGLPainter;
console.log("MixboxWebGLPainter 加载成功");