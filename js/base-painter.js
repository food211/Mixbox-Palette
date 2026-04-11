/**
 * BaseWebGLPainter — 共享 WebGL 基类
 *
 * 包含：
 *  - 所有两个引擎共用的 WebGL 基础设施
 *  - GPU 纹理历史记录池（撤销/重做零 readPixels）
 *  - requestIdleCallback 异步 CPU 备份 + localStorage 写入
 *
 * 子类须实现：
 *  _buildFragmentShader()   → 返回片段着色器字符串
 *  _getExtraUniformNames()  → 返回额外 uniform 名数组
 *  async _loadLUT()         → 加载 LUT 纹理到 this.textures.lut
 *  _bindLUT()               → drawBrush 时绑定 LUT 到正确纹理槽
 */
class BaseWebGLPainter {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;

        this.program = null;
        this.textures = {};
        this.framebuffers = {};
        this.buffers = {};
        this.locations = {};
        this.currentBrushTexture = null;

        this.baseMixStrength = 0.2;

        // GPU 历史池
        this._history = [];          // HistoryFrame[]
        this._historyStep = -1;      // 当前指针
        this._frameCounter = 0;      // 单调递增帧 ID
        this._maxGpuSlots = 50;      // init 后由 _calcGpuBudget 设定
        this._gpuFreeSlots = [];     // 可用 GPU slot 对象 { tex, fb }
        this._engineBirthTime = performance.now();

        // blit 程序（用于历史帧还原）
        this._blitProgram = null;
        this._blitLocations = {};
        this._blitBuffer = null;

        // 待处理的 idle 任务 Map<frameId, handle>
        this._pendingIdle = new Map();
    }

    // ─────────────────────────────────────────────
    // 抽象接口（子类实现）
    // ─────────────────────────────────────────────

    /** 返回片段着色器 GLSL 字符串 */
    _buildFragmentShader() { throw new Error('BaseWebGLPainter: _buildFragmentShader() not implemented'); }

    /** 返回需要额外获取 location 的 uniform 名数组，如 ['mixbox_lut'] */
    _getExtraUniformNames() { return []; }

    /** 加载 LUT 纹理（可为异步），完成后写入 this.textures.lut */
    async _loadLUT() {}

    /** 在 drawBrush 里绑定 LUT 到正确纹理槽 */
    _bindLUT() {}

    // ─────────────────────────────────────────────
    // 初始化模板方法
    // ─────────────────────────────────────────────

    async init() {
        this.initWebGL();
        this._calcGpuBudget();
        this.compileShaders();
        await this._loadLUT();
        this.setupTextures();
        this.setupFramebuffers();
        this.setupGeometry();
        this._initBlitProgram();
        this._initHeatmapProgram();
        this._initHeatDecayProgram();
    }

    initWebGL() {
        this.gl = this.canvas.getContext('webgl', {
            alpha: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
        });

        if (!this.gl) throw new Error('WebGL 不支持');

        const gl = this.gl;
        gl.disable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    // ─────────────────────────────────────────────
    // GPU 预算计算
    // ─────────────────────────────────────────────

    _calcGpuBudget() {
        const bytesPerFrame = this.canvas.width * this.canvas.height * 4;
        // 保守估计：200MB 可用显存，减去运行时约 20MB
        const budgetBytes = (200 - 20) * 1024 * 1024;
        this._maxGpuSlots = Math.min(50, Math.max(10, Math.floor(budgetBytes / bytesPerFrame)));
    }

    // ─────────────────────────────────────────────
    // 着色器
    // ─────────────────────────────────────────────

    compileShaders() {
        const gl = this.gl;

        const vsSource = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;

        varying vec2 v_texCoord;
        varying vec2 v_canvasCoord;

        uniform vec2 u_resolution;
        uniform float u_smudgeAlpha;

        void main() {
            vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
            gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
            v_texCoord = a_texCoord;
            v_canvasCoord = a_position;
        }
        `;

        const fsSource = this._buildFragmentShader();

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
            u_baseMixStrength: gl.getUniformLocation(this.program, 'u_baseMixStrength'),
            u_useFalloff:      gl.getUniformLocation(this.program, 'u_useFalloff'),
            u_smearDir:        gl.getUniformLocation(this.program, 'u_smearDir'),
            u_smearLen:        gl.getUniformLocation(this.program, 'u_smearLen'),
            u_disableSmear:    gl.getUniformLocation(this.program, 'u_disableSmear'),
            u_smudgeAlpha:     gl.getUniformLocation(this.program, 'u_smudgeAlpha'),
            u_isSmudge:        gl.getUniformLocation(this.program, 'u_isSmudge'),
            u_smudgeSampleRadius: gl.getUniformLocation(this.program, 'u_smudgeSampleRadius'),
            u_smudgeAngle:        gl.getUniformLocation(this.program, 'u_smudgeAngle'),
            u_smudgeSnapshot:     gl.getUniformLocation(this.program, 'u_smudgeSnapshot'),
            u_smudgeMix:          gl.getUniformLocation(this.program, 'u_smudgeMix'),
            u_smudgeHeatmap:      gl.getUniformLocation(this.program, 'u_smudgeHeatmap'),
        };

        for (const name of this._getExtraUniformNames()) {
            this.locations[name] = gl.getUniformLocation(this.program, name);
        }
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

    // ─────────────────────────────────────────────
    // 纹理 / Framebuffer / 几何体
    // ─────────────────────────────────────────────

    setupTextures() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.textures.canvas         = this.createEmptyTexture(w, h);
        this.textures.temp           = this.createEmptyTexture(w, h);
        this.textures.smudgeSnapshot  = this.createEmptyTexture(w, h);
        this.setupHeatmapTextures(w, h);
    }

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

        // 辅助 read FB：仅用于 drawBrush 中 copyTexImage2D，不参与 swapTextures
        this._copyReadFB = gl.createFramebuffer();

        this.setupHeatmapFramebuffers();

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    setupGeometry() {
        const gl = this.gl;
        this.buffers.position = gl.createBuffer();

        const texCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
        this.buffers.texCoord = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        this.pixelAlignmentOffset = 0.0;
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

    // ─────────────────────────────────────────────
    // blit 程序（历史还原用，WebGL1 全屏四边形）
    // ─────────────────────────────────────────────

    _initBlitProgram() {
        const gl = this.gl;

        const vs = this.createShader(gl.VERTEX_SHADER, `
            attribute vec2 a_clipPos;
            void main() { gl_Position = vec4(a_clipPos, 0, 1); }
        `);
        const fs = this.createShader(gl.FRAGMENT_SHADER, `
            precision mediump float;
            uniform sampler2D u_src;
            uniform vec2 u_resolution;
            void main() {
                vec2 uv = gl_FragCoord.xy / u_resolution;
                gl_FragColor = texture2D(u_src, uv);
            }
        `);
        this._blitProgram = this.createProgram(vs, fs);
        this._blitLocations = {
            a_clipPos:    gl.getAttribLocation(this._blitProgram, 'a_clipPos'),
            u_src:        gl.getUniformLocation(this._blitProgram, 'u_src'),
            u_resolution: gl.getUniformLocation(this._blitProgram, 'u_resolution'),
        };

        this._blitBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._blitBuffer);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array([-1, -1,  1, -1,  -1, 1,  1, 1]),
            gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // ─────────────────────────────────────────────
    // 绘制
    // ─────────────────────────────────────────────

    setMixStrength(strength) {
        this.baseMixStrength = Math.max(0.01, Math.min(1.0, strength));
    }

    getMixStrength() {
        return this.baseMixStrength;
    }

    /**
     * 落笔时调用：把当前 canvas 纹理复制到 smudgeSnapshot，
     * 涂抹期间 shader 从此快照采样，避免颜色被反复稀释变灰。
     * 同时清零热度图，让新笔从热度 0 开始累积。
     */
    captureSmudgeSnapshot() {
        // 新笔触开始，取消定时清零，确保衰减 RAF 在运行
        this._resetHeatmapFade();
        this.startHeatmapFadeOut();

        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeSnapshot);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // 清零热度图（每笔重新累积）
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatTemp);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

    }

    /**
     * 绘制笔触（核心方法）
     * 返回脏区矩形 {x, y, w, h}
     */
    drawBrush(x, y, size, colorRGB, brushCanvas,
              useFalloff = true,
              smearDir = { x: 0, y: 0 }, smearLen = 0,
              disableSmear = false, smudgeAlpha = 1.0, u_isSmudge = false, smudgeSampleRadius = 0, smudgeAngle = 0,
              brushRotation = 0, smudgeMix = 0) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        const halfSize = size / 2;
        const rx0 = Math.max(0, Math.floor(x - halfSize));
        const ry0 = Math.max(0, Math.floor(y - halfSize));
        const rx1 = Math.min(cw, Math.ceil(x + halfSize));
        const ry1 = Math.min(ch, Math.ceil(y + halfSize));
        const rw = rx1 - rx0;
        const rh = ry1 - ry0;
        if (rw <= 0 || rh <= 0) return null;

        if (brushCanvas !== this.lastBrushCanvas) {
            if (this.currentBrushTexture) gl.deleteTexture(this.currentBrushTexture);
            this.currentBrushTexture = this.createBrushTextureFromCanvas(brushCanvas);
            this.lastBrushCanvas = brushCanvas;
        }

        // 渲染前先把 canvas 完整同步到 temp，保证 temp 笔刷区域之外的像素正确
        // 注意：不能用 this.framebuffers.canvas（会随 swapTextures 轮换），
        // 必须用辅助 FB 直接绑定当前 textures.canvas 来读取。
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._copyReadFB);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.canvas, 0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        gl.useProgram(this.program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.temp);
        gl.viewport(0, 0, cw, ch);

        // 子类绑定 LUT（各自负责纹理槽）
        this._bindLUT();

        gl.uniform2f(this.locations.u_resolution, cw, ch);
        gl.uniform4f(this.locations.u_brushColor, colorRGB.r, colorRGB.g, colorRGB.b, 1.0);
        gl.uniform2f(this.locations.u_currentPosition, x, y);
        gl.uniform1f(this.locations.u_brushRadius, size / 2);
        gl.uniform1f(this.locations.u_baseMixStrength, this.baseMixStrength);
        gl.uniform1f(this.locations.u_useFalloff, +useFalloff);
        gl.uniform2f(this.locations.u_smearDir, smearDir.x, smearDir.y);
        gl.uniform1f(this.locations.u_smearLen, smearLen);
        gl.uniform1f(this.locations.u_disableSmear, disableSmear ? 1.0 : 0.0);
        gl.uniform1f(this.locations.u_smudgeAlpha, smudgeAlpha);
        gl.uniform1f(this.locations.u_isSmudge, u_isSmudge ? 1.0 : 0.0);
        gl.uniform1f(this.locations.u_smudgeSampleRadius, smudgeSampleRadius);
        gl.uniform1f(this.locations.u_smudgeAngle, u_isSmudge ? smudgeAngle : brushRotation);
        gl.uniform1f(this.locations.u_smudgeMix, smudgeMix);

        // 涂抹快照纹理固定绑定到 TEXTURE3，供 shader 采样冻结的起始画布
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeSnapshot);
        gl.uniform1i(this.locations.u_smudgeSnapshot, 3);

        // 热度图绑定到 TEXTURE4，供 shader 读取当前累积热度
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatmap);
        gl.uniform1i(this.locations.u_smudgeHeatmap, 4);

        const positions = new Float32Array([
            x - halfSize, y - halfSize,
            x + halfSize, y - halfSize,
            x - halfSize, y + halfSize,
            x + halfSize, y + halfSize,
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

        // 涂抹模式：每次 drawcall 后先更新热度图，再更新累积混色缓存
        if (u_isSmudge) {
            this.updateSmudgeHeatmap(x, y, size, brushCanvas, useFalloff, 0.1);
        }


        return { x: rx0, y: ry0, w: rw, h: rh };
    }

    /**
     * 把离屏 canvas 纹理 blit 到 default framebuffer（屏幕）
     */
    flush() {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        gl.useProgram(this._blitProgram);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);

        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.uniform1i(this._blitLocations.u_src, 0);
        gl.uniform2f(this._blitLocations.u_resolution, cw, ch);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._blitBuffer);
        gl.enableVertexAttribArray(this._blitLocations.a_clipPos);
        gl.vertexAttribPointer(this._blitLocations.a_clipPos, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindTexture(gl.TEXTURE_2D, null);

        // 调试：热度图 overlay 叠加在 canvas 之上
        if (this._debugHeatmapEnabled) this._flushDebugHeatmap(this._debugHeatOpacity ?? 1.0);
    }

    swapTextures() {
        const gl = this.gl;
        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }
        [this.textures.canvas, this.textures.temp] =
            [this.textures.temp, this.textures.canvas];
        [this.framebuffers.canvas, this.framebuffers.temp] =
            [this.framebuffers.temp, this.framebuffers.canvas];
    }

    // ─────────────────────────────────────────────
    // 像素读写
    // ─────────────────────────────────────────────

    /**
     * CPU 像素数据 → WebGL 纹理（屏幕坐标，Y向下）
     */
    writeFromPixels(pixels, w, h) {
        const gl = this.gl;
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.canvas);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this.flush();
    }

    readPixelByte(x, y) {
        const gl = this.gl;
        const glY = this.canvas.height - 1 - y;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        const pixels = new Uint8Array(4);
        gl.readPixels(x, glY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { r: pixels[0], g: pixels[1], b: pixels[2] };
    }

    readPixelRegion(x, y, w, h) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const sx = Math.max(0, x);
        const sy = Math.max(0, y);
        const sw = Math.min(w, cw - sx);
        const sh = Math.min(h, ch - sy);
        const glY = ch - sy - sh;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        const pixels = new Uint8Array(sw * sh * 4);
        gl.readPixels(sx, glY, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        const flipped = new Uint8ClampedArray(pixels.length);
        const rowSize = sw * 4;
        for (let row = 0; row < sh; row++) {
            flipped.set(
                pixels.subarray((sh - 1 - row) * rowSize, (sh - row) * rowSize),
                row * rowSize
            );
        }
        return flipped;
    }

    // ─────────────────────────────────────────────
    // 清空
    // ─────────────────────────────────────────────

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
        this.flush();
    }

    // ─────────────────────────────────────────────
    // GPU 历史记录系统
    // ─────────────────────────────────────────────

    /**
     * 分配一个 GPU slot（纹理 + framebuffer）
     * 如果空闲池有则复用，否则新建；超出上限时驱逐最老可驱逐帧
     */
    _acquireGpuSlot() {
        if (this._gpuFreeSlots.length > 0) {
            return this._gpuFreeSlots.pop();
        }

        // 检查是否还有预算新建
        const usedSlots = this._history.filter(f => f.gpuSlot !== null).length;
        if (usedSlots < this._maxGpuSlots) {
            return this._createGpuSlot();
        }

        // 超出预算，驱逐最老的、不是当前步的帧
        return this._evictOldestGpuSlot();
    }

    _createGpuSlot() {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        const tex = this.createEmptyTexture(cw, ch);
        const fb  = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { tex, fb };
    }

    _evictOldestGpuSlot() {
        // 从最老帧开始找可驱逐的（不是当前步）
        for (let i = 0; i < this._history.length; i++) {
            const frame = this._history[i];
            if (frame.gpuSlot === null) continue;
            if (i === this._historyStep) continue;

            if (!frame.cpuReady) {
                // CPU 数据还没准备好，强制同步读一次
                this._syncReadFrameToCPU(frame);
            }
            const slot = frame.gpuSlot;
            frame.gpuSlot = null;
            return slot;
        }

        // 所有帧都是当前步（理论上不会发生），新建一个
        console.warn('BaseWebGLPainter: 无法驱逐任何帧，强制新建 GPU slot');
        return this._createGpuSlot();
    }

    /** 同步从 GPU 读取帧数据到 CPU（仅在驱逐前必要时调用）*/
    _syncReadFrameToCPU(frame) {
        if (frame.cpuReady || !frame.gpuSlot) return;
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        gl.bindFramebuffer(gl.FRAMEBUFFER, frame.gpuSlot.fb);
        const raw = new Uint8Array(cw * ch * 4);
        gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // 翻转 Y（与 writeFromPixels 保持一致）
        const flipped = new Uint8ClampedArray(raw.length);
        const rowSize = cw * 4;
        for (let row = 0; row < ch; row++) {
            flipped.set(raw.subarray((ch - 1 - row) * rowSize, (ch - row) * rowSize), row * rowSize);
        }
        frame.cpuPixels = flipped;
        frame.cpuReady  = true;

        // 取消 idle 任务（已同步完成）
        this._cancelIdleBackup(frame);
    }

    /**
     * 把当前 canvas framebuffer 用 copyTexImage2D 保存到 slot.tex
     * 不需要 readPixels，纯 GPU 操作
     */
    _copyCanvasToSlot(slot) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.bindTexture(gl.TEXTURE_2D, slot.tex);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * 用 blit 程序把 slot.tex 渲染回 canvas framebuffer（及 temp）
     */
    _copySlotToCanvas(slot) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        gl.useProgram(this._blitProgram);
        gl.viewport(0, 0, cw, ch);

        // 解绑所有纹理，防止反馈
        for (let i = 0; i < 4; i++) {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, slot.tex);
        gl.uniform1i(this._blitLocations.u_src, 0);
        gl.uniform2f(this._blitLocations.u_resolution, cw, ch);

        gl.bindBuffer(gl.ARRAY_BUFFER, this._blitBuffer);
        gl.enableVertexAttribArray(this._blitLocations.a_clipPos);
        gl.vertexAttribPointer(this._blitLocations.a_clipPos, 2, gl.FLOAT, false, 0, 0);

        // → canvas framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 同步 temp 纹理（复制 canvas framebuffer 内容，无额外 draw call）
        gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
        gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);

        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.flush();
    }

    // ─────────────────────────────────────────────
    // 历史记录公开 API
    // ─────────────────────────────────────────────

    /**
     * 压入当前画布状态为新历史帧
     * 裁掉当前步之后的所有帧，然后保存快照
     */
    pushHistoryFrame() {
        // 丢弃当前步之后的帧
        const discarded = this._history.splice(this._historyStep + 1);
        for (const frame of discarded) {
            this._releaseFrame(frame);
        }

        const slot = this._acquireGpuSlot();
        this._copyCanvasToSlot(slot);

        const frame = {
            id:        this._frameCounter++,
            timestamp: performance.now(),
            gpuSlot:   slot,
            cpuPixels: null,
            cpuReady:  false,
        };

        this._history.push(frame);

        // 超出上限时移除最老帧
        if (this._history.length > this._maxGpuSlots + 5) {
            const oldest = this._history.shift();
            this._releaseFrame(oldest);
        }

        this._historyStep = this._history.length - 1;

        // 异步写 CPU 备份
        this._scheduleIdleBackup(frame);
    }

    /**
     * 跳转到指定步骤（撤销/重做）
     * @param {number} step - _history 数组下标
     * @returns {boolean} 是否成功
     */
    restoreHistoryFrame(step) {
        if (step < 0 || step >= this._history.length) return false;

        const frame = this._history[step];

        if (frame.gpuSlot) {
            // GPU 路径：blit，零 readPixels
            this._copySlotToCanvas(frame.gpuSlot);
        } else if (frame.cpuReady && frame.cpuPixels) {
            // CPU 回退：重新上传到 GPU
            this.writeFromPixels(frame.cpuPixels, this.canvas.width, this.canvas.height);
            // 重新为此帧分配 GPU slot，避免下次再走 CPU
            const slot = this._acquireGpuSlot();
            this._copyCanvasToSlot(slot);
            frame.gpuSlot = slot;
        } else {
            console.warn('BaseWebGLPainter: 帧数据不可用（GPU 和 CPU 都没有）');
            return false;
        }

        this._historyStep = step;
        return true;
    }

    /** 清空历史记录（切换引擎时调用）*/
    clearHistory() {
        // 取消所有 idle 任务
        for (const frame of this._history) {
            this._cancelIdleBackup(frame);
        }
        // 释放所有 GPU slot（放回空闲池，不销毁纹理，复用成本低）
        for (const frame of this._history) {
            if (frame.gpuSlot) {
                this._gpuFreeSlots.push(frame.gpuSlot);
                frame.gpuSlot = null;
            }
        }
        this._history = [];
        this._historyStep = -1;
    }

    /** 历史记录总帧数 */
    getHistoryLength() {
        return this._history.length;
    }

    /** 当前步骤指针 */
    getHistoryStep() {
        return this._historyStep;
    }

    // ─────────────────────────────────────────────
    // 异步 CPU 备份
    // ─────────────────────────────────────────────

    _scheduleIdleBackup(frame) {
        const doBackup = () => {
            this._pendingIdle.delete(frame.id);
            // 帧可能已被丢弃（新笔画截断历史）
            if (!this._history.includes(frame)) return;
            if (frame.cpuReady || !frame.gpuSlot) return;
            this._syncReadFrameToCPU(frame);
        };

        if (typeof requestIdleCallback !== 'undefined') {
            const handle = requestIdleCallback(doBackup, { timeout: 5000 });
            this._pendingIdle.set(frame.id, { type: 'idle', handle });
        } else {
            const handle = setTimeout(doBackup, 200);
            this._pendingIdle.set(frame.id, { type: 'timeout', handle });
        }
    }

    _cancelIdleBackup(frame) {
        const entry = this._pendingIdle.get(frame.id);
        if (!entry) return;
        if (entry.type === 'idle') cancelIdleCallback(entry.handle);
        else clearTimeout(entry.handle);
        this._pendingIdle.delete(frame.id);
    }

    _releaseFrame(frame) {
        this._cancelIdleBackup(frame);
        if (frame.gpuSlot) {
            this._gpuFreeSlots.push(frame.gpuSlot);
            frame.gpuSlot = null;
        }
        frame.cpuPixels = null;
        frame.cpuReady  = false;
    }

    /**
     * 将 canvas 内容异步写入 localStorage
     * 不阻塞当前帧，toDataURL 在 idle 时执行
     * @param {Function} callback - 接收无参数，负责调用 paletteStorage.save()
     */
    scheduleIdleSave(callback) {
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(callback, { timeout: 3000 });
        } else {
            setTimeout(callback, 100);
        }
    }

    /**
     * 把当前画布内容导出为 dataURL（不读 WebGL canvas，避免触发浏览器合成闪烁）
     * 通过 readPixels → 离屏 2D canvas → toDataURL 实现
     */
    toDataURL(type = 'image/png') {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // 从离屏 canvas framebuffer 读像素（不碰 default framebuffer）
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        const raw = new Uint8Array(cw * ch * 4);
        gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // WebGL 坐标 Y 轴朝上，翻转回屏幕坐标
        const flipped = new Uint8ClampedArray(cw * ch * 4);
        const rowSize = cw * 4;
        for (let row = 0; row < ch; row++) {
            flipped.set(raw.subarray((ch - 1 - row) * rowSize, (ch - row) * rowSize), row * rowSize);
        }

        // 用离屏 2D canvas 生成 dataURL，不触碰 WebGL canvas
        const offscreen = document.createElement('canvas');
        offscreen.width  = cw;
        offscreen.height = ch;
        offscreen.getContext('2d').putImageData(new ImageData(flipped, cw, ch), 0, 0);
        return offscreen.toDataURL(type);
    }

}

window.BaseWebGLPainter = BaseWebGLPainter;
console.log('BaseWebGLPainter 加载成功');