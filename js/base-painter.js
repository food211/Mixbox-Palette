// 所有渲染参数常数见 js/params.js

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

        this.baseMixStrength = DEFAULT_MIX_STRENGTH;

        // GPU 历史池
        this._history = [];          // HistoryFrame[]
        this._historyStep = -1;      // 当前指针
        this._frameCounter = 0;      // 单调递增帧 ID
        this._maxGpuSlots = GPU_SLOTS_MAX;  // init 后由 _calcGpuBudget 设定
        this._gpuFreeSlots = [];     // 可用 GPU slot 对象 { tex, fb }
        this._engineBirthTime = performance.now();

        // blit 程序（用于历史帧还原）
        this._blitProgram = null;
        this._blitLocations = {};
        this._blitBuffer = null;

        // 待处理的 idle 任务 Map<frameId, handle>
        this._pendingIdle = new Map();

        // 历史压缩 Worker（惰性创建）
        this._historyWorker = null;
        this._workerMsgId = 0;
        this._workerPending = new Map();   // msgId → { resolve, reject }
        this._decompressCache = new Map(); // frameId → Uint8ClampedArray（LRU 简版）
        this._decompressCacheMax = 3;
        this._lastRestoreDir = 0;          // +1 redo, -1 undo, 0 未知
        this._lastRestoreStep = -1;
        this._restoreSeq = 0;              // 异步 restore 令牌，防止乱序解压结果覆盖正确帧
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
        this._initWetPaperProgram();
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

    _calcGpuBudget(budgetMB = GPU_BUDGET_MB) {
        this._gpuBudgetMB = budgetMB;
        const bytesPerFrame = this.canvas.width * this.canvas.height * 4;
        const budgetBytes = (budgetMB - GPU_RUNTIME_OVERHEAD_MB) * 1024 * 1024;
        this._maxGpuSlots = Math.min(GPU_SLOTS_MAX, Math.max(GPU_SLOTS_MIN, Math.floor(budgetBytes / bytesPerFrame)));
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
            u_wetHeatmap:         gl.getUniformLocation(this.program, 'u_wetHeatmap'),
            u_depositHeatmap:     gl.getUniformLocation(this.program, 'u_depositHeatmap'),
            u_isWatercolor:       gl.getUniformLocation(this.program, 'u_isWatercolor'),
            u_wetSmudgeMix:       gl.getUniformLocation(this.program, 'u_wetSmudgeMix'),
            u_wetDepositPeak:     gl.getUniformLocation(this.program, 'u_wetDepositPeak'),
            u_wetBleedRadius:     gl.getUniformLocation(this.program, 'u_wetBleedRadius'),
            u_wetBleedMix:        gl.getUniformLocation(this.program, 'u_wetBleedMix'),
            u_wetColdMix:         gl.getUniformLocation(this.program, 'u_wetColdMix'),
            u_wetSmearReach:      gl.getUniformLocation(this.program, 'u_wetSmearReach'),
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
        // wetHeatmap 纹理/FB 由 heatmap.js 统一建立别名，无需单独创建
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
        // wetHeatmap FB 由 heatmap.js 统一建立别名，无需单独创建

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
     * 设置水彩湿度（0~1）。
     * 控制每笔热度上限的基础值：1.0 = 最湿，0.0 = 最干（仍保留 WET_HEAT_CAP_STEP 下限）。
     */
    setWetness(wetness) {
        const w = Math.max(0, Math.min(1, wetness));
        this._wetness = w;
        // 映射到 [WET_HEAT_CAP_STEP, 1.0]，避免完全干燥时失去水彩感
        this._wetHeatCapBase = WET_HEAT_CAP_STEP + (1.0 - WET_HEAT_CAP_STEP) * w;
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
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
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
              brushRotation = 0, smudgeMix = 0, isWatercolor = false) {
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

        // 水彩模式：向 wetHeatmap 注热，同时走主混色 pass（mixbox_lerp 负责颜色，RAF 的 _applyWetColor 叠加湿纸效果）
        if (isWatercolor) {
            // 方向追踪：方向变化超过阈值时提升热度上限
            const curAngle = Math.atan2(smearDir.y, smearDir.x);
            if (this._wetHeatCap === undefined) {
                this._wetHeatCap = this._wetHeatCapBase ?? WET_HEAT_CAP_STEP;
                this._wetHeatBaseAngle = curAngle;
            } else if (smearLen > 0) {
                let angleDiff = Math.abs(curAngle - this._wetHeatBaseAngle);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                const threshRad = WET_HEAT_DIR_THRESHOLD_DEG * Math.PI / 180;
                if (angleDiff > threshRad) {
                    this._wetHeatCap = Math.min(1.0, this._wetHeatCap + WET_HEAT_CAP_STEP);
                    this._wetHeatBaseAngle = curAngle;
                }
            }
            this.updateWetHeatmap(x, y, size, brushCanvas, useFalloff, HEAT_ACCUMULATE_STEP * this.baseMixStrength);
            this._wetSmearDir = smearDir;
            this._wetSmearLen = smearLen;
        }

        // 渲染前先把 canvas 完整同步到 temp，保证 temp 笔刷区域之外的像素正确
        // 注意：不能用 this.framebuffers.canvas（会随 swapTextures 轮换），
        // 必须用辅助 FB 直接绑定当前 textures.canvas 来读取。
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._copyReadFB);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.canvas, 0);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
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

        // 湿纸热度图绑定到 TEXTURE5（非水彩时传空纹理，shader 不使用）
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatmap);
        gl.uniform1i(this.locations.u_wetHeatmap, 5);
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatmap);
        gl.uniform1i(this.locations.u_depositHeatmap, 6);
        // wet低→颜料浓（coldMix高）；wet高→晕染强、smudge强（bleedMix/bleedRadius/smudgeMix高）
        const w = this._wetness ?? 0.5;
        const wetBleedMix    = WET_BLEED_MIX    * (WET_BLEED_SCALE_MIN  + (WET_BLEED_SCALE_MAX  - WET_BLEED_SCALE_MIN)  * w);
        const wetBleedRadius = WET_BLEED_RADIUS * (WET_BLEED_SCALE_MIN  + (WET_BLEED_SCALE_MAX  - WET_BLEED_SCALE_MIN)  * w);
        const wetColdMix     = WET_COLD_MIX     * (WET_COLD_SCALE_MAX   + (WET_COLD_SCALE_MIN   - WET_COLD_SCALE_MAX)   * w);
        const wetSmudgeMix   = WET_SMUDGE_MIX   * (WET_SMUDGE_SCALE_MIN + (WET_SMUDGE_SCALE_MAX - WET_SMUDGE_SCALE_MIN) * w);
        gl.uniform1f(this.locations.u_isWatercolor,   isWatercolor ? 1.0 : 0.0);
        gl.uniform1f(this.locations.u_wetSmudgeMix,   isWatercolor ? wetSmudgeMix     : 0.0);
        gl.uniform1f(this.locations.u_wetDepositPeak, isWatercolor ? WET_DEPOSIT_PEAK  : 0.0);
        gl.uniform1f(this.locations.u_wetBleedRadius, isWatercolor ? wetBleedRadius    : 0.0);
        gl.uniform1f(this.locations.u_wetBleedMix,    isWatercolor ? wetBleedMix       : 0.0);
        gl.uniform1f(this.locations.u_wetColdMix,     isWatercolor ? wetColdMix        : 0.0);
        gl.uniform1f(this.locations.u_wetSmearReach,  isWatercolor ? WET_SMEAR_REACH   : 0.0);

        const positions = new Float32Array([
            x - halfSize, y - halfSize,
            x + halfSize, y - halfSize,
            x - halfSize, y + halfSize,
            x + halfSize, y + halfSize,
        ]);
        this._disableAllVertexAttribs();
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

        // 涂抹模式：每次 drawcall 后更新热度图
        if (u_isSmudge) {
            this.updateSmudgeHeatmap(x, y, size, brushCanvas, useFalloff, HEAT_ACCUMULATE_STEP);
        }

        // 水彩 smudge 已内联进主 pass shader（u_wetSmudgeMix），无需额外 pass

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

        this._disableAllVertexAttribs();

        gl.bindBuffer(gl.ARRAY_BUFFER, this._blitBuffer);
        gl.enableVertexAttribArray(this._blitLocations.a_clipPos);
        gl.vertexAttribPointer(this._blitLocations.a_clipPos, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindTexture(gl.TEXTURE_2D, null);

        // 调试：热度图 / 湿纸 overlay（互斥，各自检查自己的 flag）
        if (this._debugHeatmapEnabled)  this._flushDebugHeatmap(this._debugHeatOpacity ?? 1.0);
        if (this._debugWetPaperEnabled) this._flushDebugWetPaper(this._debugHeatOpacity ?? 1.0);
        if (this._debugDepositHeatmapEnabled) this._flushDebugDepositHeatmap(this._debugHeatOpacity ?? 1.0);
    }

    /**
     * 禁用所有 vertex attribute。
     * WebGL 的 attribute enabled 状态是全局共享的（不随 program 切换重置），
     * 切换 program 前统一禁用，避免上个 program 启用的 attribute 在当前 program 上
     * 造成 "no buffer is bound to enabled attribute" 错误。
     */
    _disableAllVertexAttribs() {
        const gl = this.gl;
        if (this._maxVertexAttribs === undefined) {
            this._maxVertexAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        }
        for (let i = 0; i < this._maxVertexAttribs; i++) {
            gl.disableVertexAttribArray(i);
        }
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
            const slot = this._createGpuSlot();
            if (slot) return slot;
            // 创建失败（已触发降级）→ 退路：驱逐最老帧
        }

        // 超出预算或创建失败，驱逐最老的、不是当前步的帧
        return this._evictOldestGpuSlot();
    }

    _createGpuSlot() {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        // 清空先前的错误状态，避免误判
        while (gl.getError() !== gl.NO_ERROR) {}

        const tex = this.createEmptyTexture(cw, ch);
        const err = gl.getError();
        if (!tex || err === gl.OUT_OF_MEMORY) {
            if (tex) gl.deleteTexture(tex);
            this._tryDowngradeGpuBudget();
            return null;
        }

        const fb  = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { tex, fb };
    }

    /**
     * 检测到 GPU 分配失败时降级到备用预算。
     * 只降级一次（再失败就保持 MIN 保底，后续靠 CPU 备份救场）。
     */
    _tryDowngradeGpuBudget() {
        if (this._gpuBudgetDowngraded) return;
        this._gpuBudgetDowngraded = true;
        const oldMax = this._maxGpuSlots;
        this._calcGpuBudget(GPU_BUDGET_FALLBACK_MB);
        console.warn(`[GPU] 分配失败，历史槽位 ${oldMax} → ${this._maxGpuSlots}`);
        try {
            if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
                window.gtag('event', 'gpu_budget_downgrade', {
                    canvas_w: this.canvas.width,
                    canvas_h: this.canvas.height,
                    old_slots: oldMax,
                    new_slots: this._maxGpuSlots
                });
            }
        } catch (_) {}
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
        const slot = this._createGpuSlot();
        if (slot) return slot;
        // 极端兜底：连新建都失败（极小显存），复用当前步的 slot
        // 这里返回 null 让上层决定是否跳过保存这一帧
        console.error('BaseWebGLPainter: GPU 分配彻底失败，跳过本次历史保存');
        return null;
    }

    /** 同步从当前 canvas framebuffer 读取像素到 frame.cpuPixels（GPU slot 无法分配时的兜底）*/
    _readCanvasToCPU(frame) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        try {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
            const raw = new Uint8Array(cw * ch * 4);
            gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, raw);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            const flipped = new Uint8ClampedArray(raw.length);
            const rowSize = cw * 4;
            for (let row = 0; row < ch; row++) {
                flipped.set(raw.subarray((ch - 1 - row) * rowSize, (ch - row) * rowSize), row * rowSize);
            }
            frame.cpuPixels = flipped;
            frame.cpuReady  = true;
        } catch (e) {
            console.error('BaseWebGLPainter: readPixels 失败', e);
        }
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
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
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

        this._disableAllVertexAttribs();
        gl.bindBuffer(gl.ARRAY_BUFFER, this._blitBuffer);
        gl.enableVertexAttribArray(this._blitLocations.a_clipPos);
        gl.vertexAttribPointer(this._blitLocations.a_clipPos, 2, gl.FLOAT, false, 0, 0);

        // → canvas framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 同步 temp 纹理（复制 canvas framebuffer 内容，无额外 draw call）
        gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);

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
        // 丢弃当前步之后的帧。
        // 先从 _history 断开引用让新帧不被它们干扰，然后分批异步释放，
        // 避免一次性解引用大量 Blob / 同步扫 Map 造成笔画结束时的卡顿。
        const discarded = this._history.splice(this._historyStep + 1);
        if (discarded.length > 0) this._scheduleAsyncRelease(discarded);

        const slot = this._acquireGpuSlot();
        const frame = {
            id:        this._frameCounter++,
            timestamp: performance.now(),
            gpuSlot:   slot,
            cpuPixels: null,
            cpuReady:  false,
        };
        if (slot) {
            this._copyCanvasToSlot(slot);
        } else {
            // GPU 彻底无法分配：同步 readPixels 到 CPU 保底，避免撤销链断档
            console.warn('BaseWebGLPainter: GPU 分配失败，历史帧回退 CPU 快照');
            this._readCanvasToCPU(frame);
            if (!frame.cpuReady) return; // 连 CPU 也失败（极罕见）→ 放弃
        }

        this._history.push(frame);

        // 软上限：超过 GPU slot 配额一定缓冲后驱逐最老帧
        if (this._history.length > this._maxGpuSlots + HISTORY_OVERFLOW_BUFFER) {
            const oldest = this._history.shift();
            this._releaseFrame(oldest);
        }
        // 硬上限：防止长时间绘制时 cpuBlob 无限累积
        while (this._history.length > HISTORY_FRAMES_HARD_CAP) {
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
    async restoreHistoryFrame(step) {
        if (step < 0 || step >= this._history.length) return false;

        const frame = this._history[step];
        const seq = ++this._restoreSeq;
        let pixels = null;

        if (frame.gpuSlot) {
            // GPU 路径：blit，零 readPixels（同步完成，无竞态）
            this._copySlotToCanvas(frame.gpuSlot);
        } else if (frame.cpuPixels) {
            pixels = frame.cpuPixels;
        } else if (this._decompressCache.has(frame.id)) {
            pixels = this._decompressCache.get(frame.id);
        } else if (frame.cpuBlob) {
            // 从压缩 blob 解压
            try {
                pixels = await this._decompressFrame(frame);
            } catch (e) {
                console.warn('BaseWebGLPainter: 解压失败', e);
                return false;
            }
            // 异步返回后校验：如果期间又触发了新的 restore（用户连续点撤销/重做），丢弃本次结果
            if (seq !== this._restoreSeq || this._disposed) return false;
        } else {
            console.warn('BaseWebGLPainter: 帧数据不可用');
            return false;
        }

        if (pixels) {
            this.writeFromPixels(pixels, this.canvas.width, this.canvas.height);
            // 回写 GPU slot，下次零延迟
            const slot = this._acquireGpuSlot();
            if (slot) {
                this._copyCanvasToSlot(slot);
                frame.gpuSlot = slot;
            }
        }

        // 方向追踪：用于预解下一帧
        if (this._lastRestoreStep >= 0) {
            const diff = step - this._lastRestoreStep;
            if (diff !== 0) this._lastRestoreDir = diff > 0 ? 1 : -1;
        }
        this._lastRestoreStep = step;
        this._historyStep = step;

        // 触发朝同方向预解下一帧
        this._prefetchAdjacentFrame();
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
    // 历史压缩 Worker
    // ─────────────────────────────────────────────

    _ensureHistoryWorker() {
        if (this._historyWorker) return this._historyWorker;
        try {
            // 基于 base-painter.js 的 URL 解析 worker 路径，避免 app 部署在子目录时相对路径失效
            const base = BaseWebGLPainter._scriptURL;
            const workerURL = base ? new URL('./history-worker.js', base).href : 'js/history-worker.js';
            this._historyWorker = new Worker(workerURL);
            this._historyWorker.onmessage = (e) => {
                const { type, id } = e.data;
                const entry = this._workerPending.get(id);
                if (!entry) return;
                this._workerPending.delete(id);
                if (type === 'error') entry.reject(new Error(e.data.reason));
                else if (type === 'compressed') entry.resolve(e.data.blob);
                else if (type === 'decompressed') entry.resolve(new Uint8ClampedArray(e.data.pixels));
            };
            this._historyWorker.onerror = (err) => {
                console.error('[history-worker] error:', err);
            };
        } catch (err) {
            console.warn('[history-worker] 创建失败，历史压缩禁用', err);
            this._historyWorker = null;
        }
        return this._historyWorker;
    }

    _workerRequest(msg, transfer) {
        const w = this._ensureHistoryWorker();
        if (!w) return Promise.reject(new Error('worker unavailable'));
        const id = ++this._workerMsgId;
        return new Promise((resolve, reject) => {
            this._workerPending.set(id, { resolve, reject });
            w.postMessage({ ...msg, id }, transfer || []);
        });
    }

    /** 把已经读到 CPU 的帧压缩成 blob，压完释放 cpuPixels */
    async _compressFrame(frame) {
        if (!frame.cpuReady || !frame.cpuPixels || frame.cpuBlob) return;
        // 防止同一帧被多次压缩：idle 循环密集触发时，上一次 await 未完成前可能又被扫到
        if (frame._compressing) return;
        frame._compressing = true;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const buf = frame.cpuPixels.buffer.slice(0); // 拷贝一份给 worker transfer
        try {
            const blob = await this._workerRequest(
                { type: 'compress', pixels: buf, w, h },
                [buf]
            );
            // 帧可能已经被丢弃
            if (!this._history.includes(frame)) return;
            frame.cpuBlob = blob;
            frame.cpuBlobW = w;
            frame.cpuBlobH = h;
            frame.cpuPixels = null; // 释放未压缩数据
        } catch (e) {
            // 压缩失败保留 cpuPixels
        } finally {
            frame._compressing = false;
        }
    }

    /** 从 blob 解压回 Uint8ClampedArray（带缓存） */
    async _decompressFrame(frame) {
        if (frame.cpuPixels) return frame.cpuPixels;
        if (this._decompressCache.has(frame.id)) {
            const px = this._decompressCache.get(frame.id);
            // LRU 触达
            this._decompressCache.delete(frame.id);
            this._decompressCache.set(frame.id, px);
            return px;
        }
        if (!frame.cpuBlob) return null;
        const pixels = await this._workerRequest({
            type: 'decompress',
            blob: frame.cpuBlob,
            w: frame.cpuBlobW,
            h: frame.cpuBlobH,
        });
        this._decompressCachePut(frame.id, pixels);
        return pixels;
    }

    _decompressCachePut(frameId, pixels) {
        if (this._decompressCache.has(frameId)) {
            this._decompressCache.delete(frameId);
        }
        this._decompressCache.set(frameId, pixels);
        while (this._decompressCache.size > this._decompressCacheMax) {
            const firstKey = this._decompressCache.keys().next().value;
            this._decompressCache.delete(firstKey);
        }
    }

    /**
     * 把"距离当前步较远"的帧异步压缩成 blob，释放 cpuPixels。
     * 每次只挑"最远离当前步"的一帧丢给 worker，避免一次 idle 就把几十帧全扔进队列：
     * - 减少主线程 ArrayBuffer slice(0) 拷贝次数
     * - 避免 worker 队列堆 N 份未完成任务，内存峰值爆炸
     * 下一次 idle 还会再扫，所以迟早都会压完。
     */
    _maybeCompressOldFrames() {
        const keepNear = HISTORY_UNCOMPRESSED_NEAR;
        let bestIdx = -1;
        let bestDist = keepNear;
        for (let i = 0; i < this._history.length; i++) {
            const frame = this._history[i];
            if (!frame.cpuReady || !frame.cpuPixels) continue;
            if (frame.cpuBlob) continue;
            if (frame._compressing) continue;
            const dist = Math.abs(i - this._historyStep);
            if (dist <= keepNear) continue;
            if (dist > bestDist) { bestDist = dist; bestIdx = i; }
        }
        if (bestIdx >= 0) {
            this._compressFrame(this._history[bestIdx]).catch(() => {});
        }
    }

    /** 朝上次撤销方向预解一帧（fire-and-forget） */
    _prefetchAdjacentFrame() {
        if (!this._lastRestoreDir) return;
        const next = this._historyStep + this._lastRestoreDir;
        if (next < 0 || next >= this._history.length) return;
        const frame = this._history[next];
        if (!frame) return;
        if (frame.gpuSlot || frame.cpuPixels) return;
        if (this._decompressCache.has(frame.id)) return;
        if (!frame.cpuBlob) return;
        // 异步解，不等结果
        this._decompressFrame(frame).catch(() => {});
    }

    // ─────────────────────────────────────────────
    // 异步 CPU 备份
    // ─────────────────────────────────────────────

    /**
     * 为新帧 schedule idle 备份，但全实例只保留一个 pending 任务。
     * 之前每个 pushHistoryFrame 都会 schedule 一次，用户画 30 笔就有 30 个 idle 回调排队，
     * 每个回调都做全画布 readPixels（~10-30ms）和 _maybeCompressOldFrames 扫全表，主线程压力巨大。
     * 现在改成：已有 pending 任务就不再 schedule；任务执行时找"最老的需要处理的帧"来做，
     * 处理完如果还有剩余的就再 schedule 一次。
     */
    _scheduleIdleBackup(frame) {
        // _pendingIdle 仍然用 frame.id 作 key（为了 _cancelIdleBackup 在 _releaseFrame 时能找到
        // 挂在这一帧上的 pending 记录）。但我们让同一时刻只存在一条"真实"idle handle。
        if (this._idleBackupScheduled) {
            // 记录这一帧需要备份即可；共用 idle 任务会扫到它
            this._pendingIdle.set(frame.id, { type: 'shared' });
            return;
        }
        this._idleBackupScheduled = true;

        const doBackup = () => {
            this._idleBackupScheduled = false;
            if (this._disposed) return;

            // 挑一个最需要读到 CPU 的帧：有 GPU slot、还没 cpuReady、距当前步最远
            let readIdx = -1;
            let readDist = -1;
            for (let i = 0; i < this._history.length; i++) {
                const f = this._history[i];
                if (!f.gpuSlot || f.cpuReady) continue;
                const d = Math.abs(i - this._historyStep);
                if (d > readDist) { readDist = d; readIdx = i; }
            }
            if (readIdx >= 0) {
                const f = this._history[readIdx];
                this._syncReadFrameToCPU(f);
                this._pendingIdle.delete(f.id);
            }

            // 压缩一个最远的未压缩帧
            this._maybeCompressOldFrames();

            // 如果还有待处理的（未 cpuReady 或 有 cpuPixels 未压缩），排下一次 idle
            const hasMore = this._history.some(f =>
                (f.gpuSlot && !f.cpuReady) ||
                (f.cpuReady && f.cpuPixels && !f.cpuBlob && !f._compressing)
            );
            if (hasMore && !this._disposed) {
                this._scheduleIdleBackup(this._history[this._history.length - 1]);
            }
        };

        if (typeof requestIdleCallback !== 'undefined') {
            const handle = requestIdleCallback(doBackup, { timeout: IDLE_BACKUP_TIMEOUT_MS });
            this._pendingIdle.set(frame.id, { type: 'idle', handle });
        } else {
            const handle = setTimeout(doBackup, IDLE_BACKUP_FALLBACK_MS);
            this._pendingIdle.set(frame.id, { type: 'timeout', handle });
        }
    }

    _cancelIdleBackup(frame) {
        const entry = this._pendingIdle.get(frame.id);
        if (!entry) return;
        if (entry.type === 'idle') cancelIdleCallback(entry.handle);
        else if (entry.type === 'timeout') clearTimeout(entry.handle);
        // type === 'shared' 不持有真实 handle，只需从表里删除
        this._pendingIdle.delete(frame.id);
    }

    /**
     * 把一批被丢弃的帧异步分批释放。每 idle 处理一小批，避免大批 Blob 解引用 + Map 清理
     * 造成单帧长卡顿（撤销很多次后落新笔会 splice 掉 N 个旧帧）。
     */
    _scheduleAsyncRelease(frames) {
        if (!this._releaseQueue) this._releaseQueue = [];
        for (const f of frames) this._releaseQueue.push(f);
        if (this._releaseScheduled) return;
        this._releaseScheduled = true;

        const BATCH = 8;
        const tick = () => {
            if (this._disposed) { this._releaseScheduled = false; return; }
            const n = Math.min(BATCH, this._releaseQueue.length);
            for (let i = 0; i < n; i++) {
                this._releaseFrame(this._releaseQueue.shift());
            }
            if (this._releaseQueue.length > 0) {
                if (typeof requestIdleCallback !== 'undefined') {
                    requestIdleCallback(tick, { timeout: 500 });
                } else {
                    setTimeout(tick, 0);
                }
            } else {
                this._releaseScheduled = false;
            }
        };
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(tick, { timeout: 500 });
        } else {
            setTimeout(tick, 0);
        }
    }

    _releaseFrame(frame) {
        this._cancelIdleBackup(frame);
        if (frame.gpuSlot) {
            this._gpuFreeSlots.push(frame.gpuSlot);
            frame.gpuSlot = null;
        }
        frame.cpuPixels = null;
        frame.cpuReady  = false;
        frame.cpuBlob   = null;
        if (this._decompressCache && this._decompressCache.has(frame.id)) {
            this._decompressCache.delete(frame.id);
        }
    }

    /**
     * 释放该 painter 持有的所有 GPU/CPU 资源。
     * 切换引擎或修改画布尺寸前调用，避免旧实例资源泄漏。
     * 调用后此实例不可再用。
     */
    dispose() {
        if (this._disposed) return;
        this._disposed = true;

        const gl = this.gl;
        if (!gl) return;

        // 停 RAF
        if (typeof this.stopHeatmapFadeOut === 'function') {
            try { this.stopHeatmapFadeOut(); } catch (_) {}
        }

        // 取消挂起的画布保存任务
        if (this._pendingSaveHandle !== undefined) {
            if (this._pendingSaveIsIdle) cancelIdleCallback(this._pendingSaveHandle);
            else clearTimeout(this._pendingSaveHandle);
            this._pendingSaveHandle = undefined;
        }

        // 终止压缩 Worker
        if (this._historyWorker) {
            try { this._historyWorker.terminate(); } catch (_) {}
            this._historyWorker = null;
        }
        if (this._workerPending) {
            for (const { reject } of this._workerPending.values()) {
                try { reject(new Error('disposed')); } catch (_) {}
            }
            this._workerPending.clear();
        }
        if (this._decompressCache) this._decompressCache.clear();

        // 清空异步释放队列中未处理的帧（把它们的 slot 也回收到 _gpuFreeSlots，
        // 这样下面统一销毁 GPU 资源时能覆盖到）
        if (this._releaseQueue && this._releaseQueue.length) {
            for (const f of this._releaseQueue) {
                if (f.gpuSlot) {
                    this._gpuFreeSlots.push(f.gpuSlot);
                    f.gpuSlot = null;
                }
            }
            this._releaseQueue.length = 0;
        }

        // 销毁历史帧
        if (this._history) {
            for (const frame of this._history) {
                this._cancelIdleBackup(frame);
                if (frame.gpuSlot) {
                    gl.deleteTexture(frame.gpuSlot.tex);
                    gl.deleteFramebuffer(frame.gpuSlot.fb);
                    frame.gpuSlot = null;
                }
                frame.cpuPixels = null;
            }
            this._history.length = 0;
        }

        // 销毁空闲池
        if (this._gpuFreeSlots) {
            for (const slot of this._gpuFreeSlots) {
                gl.deleteTexture(slot.tex);
                gl.deleteFramebuffer(slot.fb);
            }
            this._gpuFreeSlots.length = 0;
        }

        // 销毁运行时纹理
        if (this.textures) {
            const seen = new Set();
            for (const key in this.textures) {
                const tex = this.textures[key];
                if (tex && !seen.has(tex)) {
                    seen.add(tex);
                    gl.deleteTexture(tex);
                }
            }
            this.textures = {};
        }

        // 销毁 framebuffer
        if (this.framebuffers) {
            const seen = new Set();
            for (const key in this.framebuffers) {
                const fb = this.framebuffers[key];
                if (fb && !seen.has(fb)) {
                    seen.add(fb);
                    gl.deleteFramebuffer(fb);
                }
            }
            this.framebuffers = {};
        }
        if (this._copyReadFB) {
            gl.deleteFramebuffer(this._copyReadFB);
            this._copyReadFB = null;
        }

        // 销毁笔刷纹理
        if (this.currentBrushTexture) {
            gl.deleteTexture(this.currentBrushTexture);
            this.currentBrushTexture = null;
        }
        this.lastBrushCanvas = null;

        // 销毁 vertex buffers
        if (this.buffers) {
            for (const key in this.buffers) {
                if (this.buffers[key]) gl.deleteBuffer(this.buffers[key]);
            }
            this.buffers = {};
        }
        if (this._blitBuffer) {
            gl.deleteBuffer(this._blitBuffer);
            this._blitBuffer = null;
        }

        // 销毁 shader programs
        if (this.program) {
            gl.deleteProgram(this.program);
            this.program = null;
        }
        if (this._blitProgram) {
            gl.deleteProgram(this._blitProgram);
            this._blitProgram = null;
        }
    }

    /**
     * 将 canvas 内容异步写入 localStorage
     * 不阻塞当前帧，toDataURL 在 idle 时执行
     * @param {Function} callback - 接收无参数，负责调用 paletteStorage.save()
     */
    scheduleIdleSave(callback) {
        // 只保留最新一次请求：前一次还没跑就取消，避免连续笔画时 PNG 编码 + localStorage 写入堆积
        if (this._pendingSaveHandle !== undefined) {
            if (this._pendingSaveIsIdle) cancelIdleCallback(this._pendingSaveHandle);
            else clearTimeout(this._pendingSaveHandle);
        }
        if (typeof requestIdleCallback !== 'undefined') {
            this._pendingSaveIsIdle = true;
            this._pendingSaveHandle = requestIdleCallback(() => {
                this._pendingSaveHandle = undefined;
                callback();
            }, { timeout: IDLE_SAVE_TIMEOUT_MS });
        } else {
            this._pendingSaveIsIdle = false;
            this._pendingSaveHandle = setTimeout(() => {
                this._pendingSaveHandle = undefined;
                callback();
            }, IDLE_SAVE_FALLBACK_MS);
        }
    }

    /**
     * 把当前画布内容导出为 dataURL（不读 WebGL canvas，避免触发浏览器合成闪烁）
     * 通过 readPixels → 离屏 2D canvas → toDataURL 实现
     */
    toDataURL(type = 'image/png', quality) {
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
        return quality !== undefined ? offscreen.toDataURL(type, quality) : offscreen.toDataURL(type);
    }

    /**
     * 异步导出 dataURL，编码走浏览器后台线程（不阻塞主线程）。
     * 大画布下比同步 toDataURL 快很多，适合 idle-save 场景。
     */
    async toDataURLAsync(type = 'image/webp', quality = 1.0) {
        const gl = this.gl;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
        const raw = new Uint8Array(cw * ch * 4);
        gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, raw);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        const flipped = new Uint8ClampedArray(cw * ch * 4);
        const rowSize = cw * 4;
        for (let row = 0; row < ch; row++) {
            flipped.set(raw.subarray((ch - 1 - row) * rowSize, (ch - row) * rowSize), row * rowSize);
        }

        // OffscreenCanvas + convertToBlob：编码走浏览器后台，主线程不阻塞
        let blob;
        if (typeof OffscreenCanvas !== 'undefined') {
            const oc = new OffscreenCanvas(cw, ch);
            oc.getContext('2d').putImageData(new ImageData(flipped, cw, ch), 0, 0);
            blob = await oc.convertToBlob({ type, quality });
        } else {
            // 回退路径
            const c = document.createElement('canvas');
            c.width = cw; c.height = ch;
            c.getContext('2d').putImageData(new ImageData(flipped, cw, ch), 0, 0);
            blob = await new Promise(r => c.toBlob(r, type, quality));
        }
        // blob → dataURL（FileReader 异步）
        return await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
        });
    }

}

// 记录本脚本 URL，用于 Worker 等相对资源的绝对路径解析（避免子目录部署坏路径）
BaseWebGLPainter._scriptURL = (document.currentScript && document.currentScript.src) || '';

window.BaseWebGLPainter = BaseWebGLPainter;
console.log('BaseWebGLPainter 加载成功');