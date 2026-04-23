/**
 * wetpaper.js — 湿纸效果系统（与主 drawBrush shader 并行运行）
 *
 * 职责：基于 wetHeatmap 的空间梯度，在绘制期间 RAF 每帧叠加两种效果：
 *   1. 梯度区（冷热交界）颜料沉积：_applyWetColor 的 depositAmt，浓度越低越强
 *   2. 高热区颜色稀释：_applyWetColor 的 diluteAmt，往笔刷色与画布色中间偏移
 *
 * 与主 shader 的分工：
 *   - 主 shader（drawBrush）：每次鼠标移动时上色，由 maskCold/maskHot 控制范围
 *   - wetpaper RAF：每帧独立叠加，做实时沉积和稀释，不依赖鼠标移动
 *
 * 松开时流程：
 *   - _wetIsDrawing 置 false，_applyWetColor 停止
 *   - _applyDepositColor 用 depositHeatmap 做 8 帧渐进咖啡环沉积
 *   - clearDepositHeatmap 清空 depositHeatmap
 *
 * 启停控制：
 *   painter.setWetPaperActive(true/false)
 *   目前由 app.js 在 brush 工具 + watercolor 笔刷时启用。
 */

// 所有渲染参数常数见 js/params.js

// ─── 物理演化 ─────────────────────────────────────────────────────────────────

function _initWetPaperProgram() {
    this._initWetColorProgram();
    this._initWetSpreadProgram();
    this._initWetBleedProgram();
    this._initDepositSpreadProgram();
}

function _stepWetPaper() {
    // 无操作
}

/**
 * 初始化热度扩散 shader：对 smudgeHeatmap 做各向同性扩散，热度向外晕染。
 */
function _initWetSpreadProgram() {
    const cached = BaseWebGLPainter._programCache.wetSpread;
    if (cached) {
        this._wetSpreadProgram = cached.program;
        this._wetSpreadLoc     = cached.locations;
        this._wetSpreadBuf     = cached.buffer;
        return;
    }
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, `#version 300 es
        in vec2 a_pos;
        out vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);

    const fs = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        uniform sampler2D u_heatmap;
        uniform vec2 u_resolution;
        uniform float u_radius;    // 采样半径（像素，由湿度决定 → 控制扩散速度）
        uniform float u_falloff;   // 外扩衰减系数（<1，让远处自然渐淡）
        in vec2 v_uv;
        out vec4 outColor;

        void main() {
            vec2 px = 1.0 / u_resolution;
            float center = texture(u_heatmap, v_uv).r;

            float n  = texture(u_heatmap, v_uv + vec2( 0.0,  px.y * u_radius)).r;
            float s  = texture(u_heatmap, v_uv + vec2( 0.0, -px.y * u_radius)).r;
            float e  = texture(u_heatmap, v_uv + vec2( px.x * u_radius,  0.0)).r;
            float w  = texture(u_heatmap, v_uv + vec2(-px.x * u_radius,  0.0)).r;
            float ne = texture(u_heatmap, v_uv + vec2( px.x * u_radius * 0.707,  px.y * u_radius * 0.707)).r;
            float nw = texture(u_heatmap, v_uv + vec2(-px.x * u_radius * 0.707,  px.y * u_radius * 0.707)).r;
            float se = texture(u_heatmap, v_uv + vec2( px.x * u_radius * 0.707, -px.y * u_radius * 0.707)).r;
            float sw = texture(u_heatmap, v_uv + vec2(-px.x * u_radius * 0.707, -px.y * u_radius * 0.707)).r;

            float maxN = max(max(max(n, s), max(e, w)),
                             max(max(ne, nw), max(se, sw)));
            float inherited = maxN * u_falloff;
            outColor = vec4(max(center, inherited), 0.0, 0.0, 1.0);
        }
    `);

    const prog = this.createProgram(vs, fs);
    this._wetSpreadProgram = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this._wetSpreadBuf = buf;

    this._wetSpreadLoc = {
        a_pos:        gl.getAttribLocation(prog,  'a_pos'),
        u_heatmap:    gl.getUniformLocation(prog, 'u_heatmap'),
        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_radius:     gl.getUniformLocation(prog, 'u_radius'),
        u_falloff:    gl.getUniformLocation(prog, 'u_falloff'),
    };

    BaseWebGLPainter._programCache.wetSpread = {
        program: prog,
        locations: this._wetSpreadLoc,
        buffer: this._wetSpreadBuf,
    };
}

/**
 * 对指定热度图执行一次扩散 pass（通用）
 * @param {WebGLTexture} tex 目标纹理
 * @param {WebGLFramebuffer} fb 目标 FB
 * @param {WebGLTexture} tempTex 临时只读纹理
 * @param {number} radius 扩散采样半径
 * @param {number} strength 扩散强度
 */
function _spreadHeatmapGeneric(tex, fb, tempTex, radius, strength) {
    if (!this._wetSpreadProgram) return;
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // 拷目标 → temp 作为只读输入
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.bindTexture(gl.TEXTURE_2D, tempTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._wetSpreadProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tempTex);
    gl.uniform1i(this._wetSpreadLoc.u_heatmap, 0);
    gl.uniform2f(this._wetSpreadLoc.u_resolution, cw, ch);
    gl.uniform1f(this._wetSpreadLoc.u_radius,   radius);
    gl.uniform1f(this._wetSpreadLoc.u_strength, strength);

    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetSpreadBuf);
    gl.enableVertexAttribArray(this._wetSpreadLoc.a_pos);
    gl.vertexAttribPointer(this._wetSpreadLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * 对 wetHeatmap 执行一次扩散 pass（二值化策略）。
 * 扩散速度只由湿度滑条决定，与画面浓度无关：
 *   - 邻居有没有热度（> threshold） → 本像素拉到 fillLevel
 *   - fillLevel 和 radius 都随湿度线性调制
 * 依赖每帧 _decayHeatmap 衰减核心，避免永久向外生长。
 */
function _spreadWetHeatmap() {
    if (!this._wetSpreadProgram) return;
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    const w = this._wetness ?? 0.5;
    const sizeScale = this._wetSizeScale ?? 1.0;
    const radius = (WET_SPREAD_RADIUS_MIN + (WET_SPREAD_RADIUS_MAX - WET_SPREAD_RADIUS_MIN) * w) * sizeScale;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatTemp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._wetSpreadProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatTemp);
    gl.uniform1i(this._wetSpreadLoc.u_heatmap, 0);
    gl.uniform2f(this._wetSpreadLoc.u_resolution, cw, ch);
    gl.uniform1f(this._wetSpreadLoc.u_radius,  radius);
    gl.uniform1f(this._wetSpreadLoc.u_falloff, WET_SPREAD_FALLOFF);

    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetSpreadBuf);
    gl.enableVertexAttribArray(this._wetSpreadLoc.a_pos);
    gl.vertexAttribPointer(this._wetSpreadLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * 对 depositHeatmap 执行一次扩散 pass，让笔触覆盖区逐渐向外浸润。
 * 用专门的 shader：邻居最大值向外传播（max 策略），让边界以像素级稳定向外爬。
 */
function _initDepositSpreadProgram() {
    const cached = BaseWebGLPainter._programCache.depositSpread;
    if (cached) {
        this._depositSpreadProgram = cached.program;
        this._depositSpreadLoc     = cached.locations;
        this._depositSpreadBuf     = cached.buffer;
        return;
    }
    const gl = this.gl;
    const vs = this.createShader(gl.VERTEX_SHADER, `#version 300 es
        in vec2 a_pos;
        out vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);
    // max 策略：取邻居最大值，再乘以一个小于 1 的 falloff，让外围自然衰减
    // 这样能稳定向外爬边界，但距离中心越远热度越低
    const fs = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        uniform sampler2D u_heatmap;
        uniform vec2 u_resolution;
        uniform float u_radius;
        uniform float u_falloff;   // 0~1，每次传播衰减系数
        in vec2 v_uv;
        out vec4 outColor;
        void main() {
            vec2 px = 1.0 / u_resolution;
            float center = texture(u_heatmap, v_uv).r;
            float n = texture(u_heatmap, v_uv + vec2( 0.0,  px.y * u_radius)).r;
            float s = texture(u_heatmap, v_uv + vec2( 0.0, -px.y * u_radius)).r;
            float e = texture(u_heatmap, v_uv + vec2( px.x * u_radius,  0.0)).r;
            float w = texture(u_heatmap, v_uv + vec2(-px.x * u_radius,  0.0)).r;
            float ne = texture(u_heatmap, v_uv + vec2( px.x * u_radius * 0.707,  px.y * u_radius * 0.707)).r;
            float nw = texture(u_heatmap, v_uv + vec2(-px.x * u_radius * 0.707,  px.y * u_radius * 0.707)).r;
            float se = texture(u_heatmap, v_uv + vec2( px.x * u_radius * 0.707, -px.y * u_radius * 0.707)).r;
            float sw = texture(u_heatmap, v_uv + vec2(-px.x * u_radius * 0.707, -px.y * u_radius * 0.707)).r;
            float maxN = max(max(max(n, s), max(e, w)), max(max(ne, nw), max(se, sw)));
            // 从邻居继承最大值，但乘以 falloff 让外围渐淡
            float inherited = maxN * u_falloff;
            // 自己的值和继承值取大：保留核心、同时允许外围生长
            outColor = vec4(max(center, inherited), 0.0, 0.0, 1.0);
        }
    `);
    const prog = this.createProgram(vs, fs);
    this._depositSpreadProgram = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this._depositSpreadBuf = buf;

    this._depositSpreadLoc = {
        a_pos:        gl.getAttribLocation(prog,  'a_pos'),
        u_heatmap:    gl.getUniformLocation(prog, 'u_heatmap'),
        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_radius:     gl.getUniformLocation(prog, 'u_radius'),
        u_falloff:    gl.getUniformLocation(prog, 'u_falloff'),
    };
    BaseWebGLPainter._programCache.depositSpread = {
        program: prog,
        locations: this._depositSpreadLoc,
        buffer: this._depositSpreadBuf,
    };
}

function _spreadDepositHeatmap() {
    if (!this._depositSpreadProgram) this._initDepositSpreadProgram();

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // 拷 depositHeatmap → depositHeatTemp
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatTemp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._depositSpreadProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatTemp);
    gl.uniform1i(this._depositSpreadLoc.u_heatmap, 0);
    gl.uniform2f(this._depositSpreadLoc.u_resolution, cw, ch);
    const w = this._wetness ?? 0.5;
    const sizeScale = this._wetSizeScale ?? 1.0;
    const depositRadius = (WET_DEPOSIT_SPREAD_RADIUS_MIN
                        + (WET_DEPOSIT_SPREAD_RADIUS_MAX - WET_DEPOSIT_SPREAD_RADIUS_MIN) * w) * sizeScale;
    gl.uniform1f(this._depositSpreadLoc.u_radius,  depositRadius);
    gl.uniform1f(this._depositSpreadLoc.u_falloff, WET_DEPOSIT_SPREAD_FALLOFF);

    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._depositSpreadBuf);
    gl.enableVertexAttribArray(this._depositSpreadLoc.a_pos);
    gl.vertexAttribPointer(this._depositSpreadLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}


/**
 * 向 wetHeatmap 注热（复用 _heatmapProgram，目标为 wetHeatmap/wetHeatTemp）
 * 由 base-painter.js 水彩分支调用，替代写 smudgeHeatmap。
 */
/**
 * 刷新 wetHeatmap 寿命计数器（按当前湿度下的实际衰减速率估算）。
 * 与注热解耦：浓度节流跳过 updateWetHeatmap 时也应调此函数续命，
 * 避免低浓度因注热稀疏被误判为"干得快"。
 */
function refreshWetHeatLifetime() {
    const w = this._wetness ?? 0.5;
    const decayScale = WET_HEAT_DECAY_SCALE_MAX
                     + (WET_HEAT_DECAY_SCALE_MIN - WET_HEAT_DECAY_SCALE_MAX) * w;
    const effectiveDecay = WET_HEAT_DECAY_STEP * decayScale;
    this._wetHeatFrames = Math.ceil(1.0 / effectiveDecay) + 60;
}

/**
 * 生成/缓存固定柔边圆笔的 canvas（径向渐变，与 brush-manager 的 'soft' 类型一致）。
 * wetMaskHeatmap 专用：不论用户实际选了什么笔刷，mask 注入恒用柔边形状，
 * 让水彩"上色区域"边界自然柔和。
 */
function _getOrCreateSoftBrushCanvas(size) {
    if (!this._softBrushCanvasCache) this._softBrushCanvasCache = new Map();
    const key = size | 0;
    const cached = this._softBrushCanvasCache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = size * 2;
    canvas.height = size * 2;
    const ctx = canvas.getContext('2d');
    const cx = size, cy = size;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size);
    grad.addColorStop(0,   'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size * 2, size * 2);

    this._softBrushCanvasCache.set(key, canvas);
    return canvas;
}

/**
 * 取/建 wetMask 专属柔边笔 GPU 纹理；canvas 变化时重建。
 */
function _getOrCreateSoftBrushTexture(size) {
    const canvas = this._getOrCreateSoftBrushCanvas(size);
    if (this._softBrushTexture && this._softBrushTextureCanvas === canvas) {
        return this._softBrushTexture;
    }
    if (this._softBrushTexture) this.gl.deleteTexture(this._softBrushTexture);
    this._softBrushTexture = this.createBrushTextureFromCanvas(canvas);
    this._softBrushTextureCanvas = canvas;
    return this._softBrushTexture;
}

function updateWetHeatmap(x, y, size, brushCanvas, useFalloff, heatStep = HEAT_ACCUMULATE_STEP) {
    this.refreshWetHeatLifetime();

    // 按 brushSize 缩放的扩散/噪点倍率：让大笔刷的湿度扩散范围相对笔刷本身保持一致
    // （size=40 时 1×，size=80 时 2×）。压感缩放后的 effectiveSize 直接传进来，这里同步更新
    this._wetSizeScale = Math.max(
        WET_SIZE_SCALE_MIN,
        Math.min(WET_SIZE_SCALE_MAX, size / WET_SIZE_SCALE_BASE)
    );

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const halfSize = size / 2;
    const heatMax = this._wetHeatCap ?? WET_HEAT_CAP_STEP;

    if (brushCanvas !== this.lastBrushCanvas) {
        if (this.currentBrushTexture) gl.deleteTexture(this.currentBrushTexture);
        this.currentBrushTexture = this.createBrushTextureFromCanvas(brushCanvas);
        this.lastBrushCanvas = brushCanvas;
    }

    // ── copy 1：wetHeatmap → wetHeatTemp ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatTemp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // ── copy 2：depositHeatmap → depositHeatTemp ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatTemp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // ── copy 3：wetMaskHeatmap → wetMaskHeatTemp ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetMaskHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetMaskHeatTemp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 共用 program 绑定、position buffer、uniforms
    gl.useProgram(this._heatmapProgram);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentBrushTexture);
    gl.uniform1i(this._heatmapLocations.u_brushTexture, 0);

    gl.uniform2f(this._heatmapLocations.u_resolution, cw, ch);
    gl.uniform2f(this._heatmapLocations.u_currentPosition, x, y);
    gl.uniform1f(this._heatmapLocations.u_brushRadius, size / 2);
    gl.uniform1f(this._heatmapLocations.u_useFalloff, +useFalloff);
    gl.uniform1f(this._heatmapLocations.u_heatStep, heatStep);
    gl.uniform1f(this._heatmapLocations.u_heatMax, heatMax);
    gl.uniform1f(this._heatmapLocations.u_useMaxMode, 0.0); // 默认累加模式（draw1/2 用）

    const positions = this._quadPos;
    positions[0] = x - halfSize; positions[1] = y - halfSize;
    positions[2] = x + halfSize; positions[3] = y - halfSize;
    positions[4] = x - halfSize; positions[5] = y + halfSize;
    positions[6] = x + halfSize; positions[7] = y + halfSize;
    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this._heatmapLocations.a_position);
    gl.vertexAttribPointer(this._heatmapLocations.a_position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.texCoord);
    gl.enableVertexAttribArray(this._heatmapLocations.a_texCoord);
    gl.vertexAttribPointer(this._heatmapLocations.a_texCoord, 2, gl.FLOAT, false, 0, 0);

    // ── draw 1：wetHeatmap ──
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatTemp);
    gl.uniform1i(this._heatmapLocations.u_heatmapTexture, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── draw 2：depositHeatmap ──
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatTemp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ── draw 3：wetMaskHeatmap ──
    // 固定柔边圆笔，且笔刷尺寸放大到 2×（让 mask 覆盖区比 wetHeatmap 更外扩）
    const maskSize = size * 2;
    const maskHalf = maskSize / 2;
    const softBrushTex = this._getOrCreateSoftBrushTexture(maskSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, softBrushTex);
    gl.uniform1i(this._heatmapLocations.u_brushTexture, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetMaskHeatTemp);
    gl.uniform1i(this._heatmapLocations.u_heatmapTexture, 1);

    // 重写 quad（2×）和半径，配 mask 专属步长。复用 _quadPos（前一次 bufferData 已把旧数据拷到 GPU）
    const maskQuad = this._quadPos;
    maskQuad[0] = x - maskHalf; maskQuad[1] = y - maskHalf;
    maskQuad[2] = x + maskHalf; maskQuad[3] = y - maskHalf;
    maskQuad[4] = x - maskHalf; maskQuad[5] = y + maskHalf;
    maskQuad[6] = x + maskHalf; maskQuad[7] = y + maskHalf;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, maskQuad, gl.DYNAMIC_DRAW);
    gl.uniform1f(this._heatmapLocations.u_brushRadius, maskHalf);
    gl.uniform1f(this._heatmapLocations.u_heatStep, WET_MASK_HEAT_ACCUMULATE_STEP);
    // MAX 模式：每像素热度直接锁定为 brushAlpha × heatMax，不随叠加次数累积
    // 半径方向的形状永远等于 brush alpha 形状
    gl.uniform1f(this._heatmapLocations.u_useMaxMode, 1.0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetMaskHeatmap);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 临时诊断：draw3 后立即读 mask 中心像素
    if (this._wetMaskProbe) {
        const px = new Uint8Array(4);
        gl.readPixels(x | 0, ch - (y | 0), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        console.log(`[mask-probe] @(${x|0},${y|0}) R=${px[0]}`);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 水彩颜色渲染 program ─────────────────────────────────────────────────────

/**
 * 初始化水彩颜色渲染 shader：
 *   - 梯度（冷热交界）驱动颜料沉积
 *   - 高热区稀释已有颜色
 * 结果写回 canvas 纹理（通过 swapTextures）
 */
function _initWetColorProgram() {
    const cached = BaseWebGLPainter._programCache.wetColor;
    if (cached) {
        this._wetColorProgram = cached.program;
        this._wetColorLoc     = cached.locations;
        this._wetColorBuf     = cached.buffer;
        return;
    }
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, `#version 300 es
        in vec2 a_pos;
        out vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);

    const fs = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;

        uniform sampler2D u_canvas;       // 当前画布
        uniform sampler2D u_wetHeatmap;   // 湿度图
        uniform sampler2D u_wetMask;      // 区域 mask：与 wetHeatmap 取交集才上色
        uniform float u_wetMaskEnabled;   // 0=关闭 mask（行为退回老版），1=启用
        uniform vec2 u_resolution;
        uniform vec3 u_color;             // 笔刷颜色
        uniform float u_gradRadius;       // 梯度采样半径（像素）
        uniform float u_depositStr;       // 沉积强度（全权由 wet 控制）
        uniform float u_diluteStr;        // 稀释强度（全权由 wet 控制）
        uniform float u_depositGradMin;   // 沉积 smoothstep 下限
        uniform float u_depositGradMax;   // 沉积 smoothstep 上限
        uniform float u_diluteGradSuppress; // 稀释梯度抑制上限

        in vec2 v_uv;
        out vec4 outColor;

        void main() {
            vec2 px = 1.0 / u_resolution;
            float heat = texture(u_wetHeatmap, v_uv).r;
            float mask = (u_wetMaskEnabled > 0.5) ? texture(u_wetMask, v_uv).r : 1.0;

            // 区域 mask 为 0 直接丢弃（两图取交集）；mask 关闭时恒为 1
            if (mask < 0.001) discard;

            // ── 梯度计算（4邻居）──
            float r  = texture(u_wetHeatmap, v_uv + vec2( px.x * u_gradRadius, 0.0)).r;
            float l  = texture(u_wetHeatmap, v_uv + vec2(-px.x * u_gradRadius, 0.0)).r;
            float up = texture(u_wetHeatmap, v_uv + vec2(0.0,  px.y * u_gradRadius)).r;
            float dn = texture(u_wetHeatmap, v_uv + vec2(0.0, -px.y * u_gradRadius)).r;
            float grad = length(vec2(r - l, up - dn)) * 0.5; // 归一化到 0~1

            vec4 canvas = texture(u_canvas, v_uv);

            // ── 效果1：梯度区颜料沉积（强度全权由 u_depositStr 控制）──
            float depositMask = smoothstep(u_depositGradMin, u_depositGradMax, grad);
            float depositAmt  = depositMask * u_depositStr * mask;
            vec3 deposited = mix(canvas.rgb, u_color, depositAmt);

            // ── 效果2：高热区稀释（强度全权由 u_diluteStr 控制）──
            float diluteMask = heat * (1.0 - smoothstep(0.1, u_diluteGradSuppress, grad));
            float diluteAmt  = diluteMask * u_diluteStr * mask;
            vec3 diluteTarget = mix(canvas.rgb, u_color, 0.5);
            vec3 outRGB = mix(deposited, diluteTarget, diluteAmt);

            // 热度 + 梯度都为0的区域不写入
            float anyEffect = max(depositAmt, diluteAmt);
            if (anyEffect < 0.001) discard;

            outColor = vec4(outRGB, 1.0);
        }
    `);

    const prog = this.createProgram(vs, fs);
    this._wetColorProgram = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,-1,  1,-1,  -1,1,  1,1
    ]), gl.STATIC_DRAW);
    this._wetColorBuf = buf;

    this._wetColorLoc = {
        a_pos:        gl.getAttribLocation(prog,  'a_pos'),
        u_canvas:     gl.getUniformLocation(prog, 'u_canvas'),
        u_wetHeatmap: gl.getUniformLocation(prog, 'u_wetHeatmap'),
        u_wetMask:        gl.getUniformLocation(prog, 'u_wetMask'),
        u_wetMaskEnabled: gl.getUniformLocation(prog, 'u_wetMaskEnabled'),
        u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
        u_color:      gl.getUniformLocation(prog, 'u_color'),
        u_gradRadius: gl.getUniformLocation(prog, 'u_gradRadius'),
        u_depositStr: gl.getUniformLocation(prog, 'u_depositStr'),
        u_diluteStr:  gl.getUniformLocation(prog, 'u_diluteStr'),
        u_depositGradMin:    gl.getUniformLocation(prog, 'u_depositGradMin'),
        u_depositGradMax:    gl.getUniformLocation(prog, 'u_depositGradMax'),
        u_diluteGradSuppress:gl.getUniformLocation(prog, 'u_diluteGradSuppress'),
    };

    BaseWebGLPainter._programCache.wetColor = {
        program: prog,
        locations: this._wetColorLoc,
        buffer: this._wetColorBuf,
    };
}

/**
 * 根据当前 wetHeatmap 将水彩效果写入 canvas 纹理。
 * 每帧由 heatmap RAF tick 调用（仅 _wetPaperActive 时）。
 * @param {{r,g,b}} color 当前笔刷颜色（0~1）
 */
function _applyWetColor(color) {
    if (!this._wetColorProgram) return;

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;


    // 把当前 canvas 拷到 temp，作为 shader 的只读输入
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._copyReadFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.canvas, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._wetColorProgram);
    // 写入 canvas framebuffer（swapTextures 已使 textures.canvas 为当前渲染目标）
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
    gl.uniform1i(this._wetColorLoc.u_canvas, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatmap);
    gl.uniform1i(this._wetColorLoc.u_wetHeatmap, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetMaskHeatmap);
    gl.uniform1i(this._wetColorLoc.u_wetMask, 2);

    // wet低→沉积强、稀释弱；wet高→沉积弱、稀释强
    const w = this._wetness ?? 0.5;
    const sizeScale = this._wetSizeScale ?? 1.0;
    const depositStr = WET_DEPOSIT_STRENGTH * (WET_DEPOSIT_SCALE_MAX + (WET_DEPOSIT_SCALE_MIN - WET_DEPOSIT_SCALE_MAX) * w);
    const diluteStr  = WET_DILUTE_STRENGTH  * (WET_DILUTE_SCALE_MIN  + (WET_DILUTE_SCALE_MAX  - WET_DILUTE_SCALE_MIN)  * w);

    gl.uniform2f(this._wetColorLoc.u_resolution, cw, ch);
    gl.uniform3f(this._wetColorLoc.u_color, color.r, color.g, color.b);
    gl.uniform1f(this._wetColorLoc.u_gradRadius,         WET_GRADIENT_RADIUS * sizeScale);
    gl.uniform1f(this._wetColorLoc.u_depositStr,         depositStr);
    gl.uniform1f(this._wetColorLoc.u_diluteStr,          diluteStr);
    gl.uniform1f(this._wetColorLoc.u_depositGradMin,     WET_DEPOSIT_GRAD_MIN);
    gl.uniform1f(this._wetColorLoc.u_depositGradMax,     WET_DEPOSIT_GRAD_MAX);
    gl.uniform1f(this._wetColorLoc.u_diluteGradSuppress, WET_DILUTE_GRAD_SUPPRESS);
    // 默认启用 mask；用 painter.debugWetMask(false) 可关闭
    gl.uniform1f(this._wetColorLoc.u_wetMaskEnabled, (this._wetMaskEnabled !== false) ? 1.0 : 0.0);

    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetColorBuf);
    gl.enableVertexAttribArray(this._wetColorLoc.a_pos);
    gl.vertexAttribPointer(this._wetColorLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * 松开画笔时，用 depositHeatmap 的梯度交界（maskDeposit）做渐进沉积。
 * 分 8 帧 RAF 叠入，强度线性衰减，完成后清空 depositHeatmap。
 */
let _depositSeq = 0;

function _applyDepositColor() {
    if (!this._wetColorProgram || !this._wetColor) return;

    const TOTAL_FRAMES = 8;
    let frame = 0;
    const color = this._wetColor;
    // 同一 painter 可能短时间内多次落笔，每次用独立 id 防止旧任务覆盖
    const taskName = 'deposit-color-' + this._instanceId + '-' + (++_depositSeq);

    const tick = () => {
        if (this._disposed) {
            FrameScheduler.unregister(taskName);
            return;
        }
        if (frame >= TOTAL_FRAMES) {
            this.clearDepositHeatmap();
            this.flush();
            FrameScheduler.unregister(taskName);
            return;
        }

        // 强度线性衰减：第0帧最强，最后一帧趋近0
        const t = 1.0 - frame / TOTAL_FRAMES;
        const frameStr = WET_DEPOSIT_STRENGTH * t * 0.4;

        this._applyDepositColorPass(color, frameStr);
        this.flush();
        frame++;
    };

    FrameScheduler.register(taskName, tick, 30);
}

/**
 * 单帧沉积 pass：用 depositHeatmap 梯度交界区将笔刷色沉积进画布。
 */
function _applyDepositColorPass(color, depositStr) {
    if (!this._wetColorProgram) return;

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this._copyReadFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.canvas, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._wetColorProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
    gl.uniform1i(this._wetColorLoc.u_canvas, 0);

    // depositHeatmap 传入 u_wetHeatmap 槽，shader 用梯度计算交界 mask
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatmap);
    gl.uniform1i(this._wetColorLoc.u_wetHeatmap, 1);

    const sizeScale = this._wetSizeScale ?? 1.0;
    gl.uniform2f(this._wetColorLoc.u_resolution, cw, ch);
    gl.uniform3f(this._wetColorLoc.u_color, color.r, color.g, color.b);
    gl.uniform1f(this._wetColorLoc.u_gradRadius,         WET_GRADIENT_RADIUS * sizeScale);
    gl.uniform1f(this._wetColorLoc.u_depositStr,         depositStr);
    gl.uniform1f(this._wetColorLoc.u_diluteStr,          0.0);
    gl.uniform1f(this._wetColorLoc.u_depositGradMin,     WET_DEPOSIT_GRAD_MIN);
    gl.uniform1f(this._wetColorLoc.u_depositGradMax,     WET_DEPOSIT_GRAD_MAX);
    gl.uniform1f(this._wetColorLoc.u_diluteGradSuppress, WET_DILUTE_GRAD_SUPPRESS);
    // 抬笔咖啡环 pass 强制不走 mask（它的设计基于 depositHeatmap 梯度本身）
    gl.uniform1f(this._wetColorLoc.u_wetMaskEnabled, 0.0);

    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetColorBuf);
    gl.enableVertexAttribArray(this._wetColorLoc.a_pos);
    gl.vertexAttribPointer(this._wetColorLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 画布颜色扩散 pass ────────────────────────────────────────────────────────
// 每帧 RAF 跑一次：在 depositHeatmap 覆盖区域，把颜色从高浓度区向低浓度区微量扩散。
// 先画的像素经过更多帧 → 渗得远；后画的 → 只渗一点（时间演化天然实现）。

function _initWetBleedProgram() {
    const cached = BaseWebGLPainter._programCache.wetBleed;
    if (cached) {
        this._wetBleedProgram = cached.program;
        this._wetBleedLoc     = cached.locations;
        this._wetBleedBuf     = cached.buffer;
        return;
    }
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, `#version 300 es
        in vec2 a_pos;
        out vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);

    // 8 方向采样，比较邻居 depositRaw：邻居浓度高于自己则吸取其颜色。
    // 结果是颜色从高浓度区缓慢向低浓度区扩散，形状由 depositHeatmap 决定。
    const fs = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        uniform sampler2D u_canvas;
        uniform sampler2D u_deposit;
        uniform sampler2D u_wetHeatmap;  // 会衰减的湿度图：控制"还湿着"才扩散
        uniform vec2 u_resolution;
        uniform float u_radius;          // 采样步长（像素）
        uniform float u_strength;        // 扩散强度
        uniform float u_depositMin;      // deposit 低于此值不扩散
        uniform float u_noiseAmount;     // 噪声扰动量（0~1）
        uniform float u_noiseScale;      // 噪声网格尺寸倍率：1.0=原始（1px/3px 聚簇），随 brushSize 放大
        uniform float u_wetGateMin;      // wetness 低于此值完全停止扩散（已干）
        in vec2 v_uv;
        out vec4 outColor;

        // 像素级 hash 噪声：同一像素恒定值，不同像素随机
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec2 px = 1.0 / u_resolution;
            float myDeposit = texture(u_deposit, v_uv).r;
            vec4 myColor = texture(u_canvas, v_uv);

            if (myDeposit < u_depositMin) {
                outColor = myColor;
                return;
            }

            // 湿度 gate：综合 wetHeatmap（会衰减）和 myDeposit（扩张区域）
            // wetHeatmap 控制"时间维度"——笔触结束后一段时间整体停止扩散
            // myDeposit 控制"空间维度"——未触及的区域不扩散
            float wetness = texture(u_wetHeatmap, v_uv).r;
            if (wetness < u_wetGateMin) {
                outColor = myColor;
                return;
            }
            // wetGate 综合两者：wetHeatmap 决定全局活跃度、myDeposit 决定局部活跃度
            // myDeposit 高 = 颜料多 = 湿得久；myDeposit 低 = 外围 = 只要全局还湿就继续扩
            float wetGate = smoothstep(u_wetGateMin, 0.2, wetness);

            // 像素级纸纤维噪声：扰动半径和吸色强度
            // 低频噪声（hash 分像素坐标）模拟纤维聚集，让相邻像素有相关性
            // 网格尺寸随 brushSize 等比放大（u_noiseScale），颗粒相对笔刷保持一致
            vec2 pixelCoord = floor(v_uv * u_resolution / u_noiseScale);
            float noise1 = hash(pixelCoord);
            float noise2 = hash(pixelCoord + vec2(3.7, 1.3));
            // 低频纤维聚集（每 ~3 像素一组 × noiseScale）
            vec2 clusterCoord = floor(v_uv * u_resolution / (3.0 * u_noiseScale));
            float clusterNoise = hash(clusterCoord);

            // 半径扰动：以本像素为单位，让邻居采样距离不规则
            float radiusJitter = mix(1.0 - u_noiseAmount, 1.0 + u_noiseAmount, noise1);
            float effectiveRadius = u_radius * radiusJitter;

            // 吸水能力扰动：纤维粗的地方吸水快（扩散强）、细的地方慢
            float absorbJitter = mix(1.0 - u_noiseAmount, 1.0 + u_noiseAmount, clusterNoise);

            // 8 方向邻居，每个方向各自还叠一个方向扰动
            vec2 dirs[8];
            dirs[0] = vec2( 1.0,  0.0);
            dirs[1] = vec2(-1.0,  0.0);
            dirs[2] = vec2( 0.0,  1.0);
            dirs[3] = vec2( 0.0, -1.0);
            dirs[4] = vec2( 0.707,  0.707);
            dirs[5] = vec2(-0.707,  0.707);
            dirs[6] = vec2( 0.707, -0.707);
            dirs[7] = vec2(-0.707, -0.707);

            vec3 weightedColor = vec3(0.0);
            float totalWeight = 0.0;

            for (int i = 0; i < 8; i++) {
                // 每个方向再加独立的小随机偏移，让采样点散开
                float di = float(i);
                vec2 perDirJitter = vec2(
                    hash(pixelCoord + vec2(di * 1.7, 0.5)) - 0.5,
                    hash(pixelCoord + vec2(0.3, di * 2.1)) - 0.5
                ) * u_noiseAmount * effectiveRadius;
                vec2 sampleUV = v_uv + (dirs[i] * effectiveRadius + perDirJitter) * px;

                float nDeposit = texture(u_deposit, sampleUV).r;
                float dh = nDeposit - myDeposit;
                if (dh > 0.0) {
                    vec3 nColor = texture(u_canvas, sampleUV).rgb;
                    weightedColor += nColor * dh;
                    totalWeight += dh;
                }
            }

            if (totalWeight < 0.001) {
                outColor = myColor;
                return;
            }

            vec3 avgNeighbor = weightedColor / totalWeight;
            // 浓区抗扩散：myDeposit 越高扩散越弱（内部颜料稳定不被推动）
            // 外围 myDeposit 低 → resist≈1 全速扩散；核心高浓度 → resist≈0 基本不变
            float resist = 1.0 - smoothstep(0.3, 0.8, myDeposit);
            float mixAmt = u_strength * totalWeight * absorbJitter * wetGate * resist;
            vec3 outRGB = mix(myColor.rgb, avgNeighbor, mixAmt);

            outColor = vec4(outRGB, myColor.a);
        }
    `);

    const prog = this.createProgram(vs, fs);
    this._wetBleedProgram = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,-1,  1,-1,  -1,1,  1,1
    ]), gl.STATIC_DRAW);
    this._wetBleedBuf = buf;

    this._wetBleedLoc = {
        a_pos:         gl.getAttribLocation(prog,  'a_pos'),
        u_canvas:      gl.getUniformLocation(prog, 'u_canvas'),
        u_deposit:     gl.getUniformLocation(prog, 'u_deposit'),
        u_wetHeatmap:  gl.getUniformLocation(prog, 'u_wetHeatmap'),
        u_resolution:  gl.getUniformLocation(prog, 'u_resolution'),
        u_radius:      gl.getUniformLocation(prog, 'u_radius'),
        u_strength:    gl.getUniformLocation(prog, 'u_strength'),
        u_depositMin:  gl.getUniformLocation(prog, 'u_depositMin'),
        u_noiseAmount: gl.getUniformLocation(prog, 'u_noiseAmount'),
        u_noiseScale:  gl.getUniformLocation(prog, 'u_noiseScale'),
        u_wetGateMin:  gl.getUniformLocation(prog, 'u_wetGateMin'),
    };

    BaseWebGLPainter._programCache.wetBleed = {
        program: prog,
        locations: this._wetBleedLoc,
        buffer: this._wetBleedBuf,
    };
}

/**
 * 画布颜色扩散：每帧把画布在 depositHeatmap 覆盖区内做一次微量扩散。
 * 先画的像素经过更多帧扩散 → 渗得远；后画的 → 只渗一点。
 */
function _applyWetBleed() {
    if (!this._wetBleedProgram) return;

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // 当前 canvas → temp（只读输入）
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._copyReadFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.canvas, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._wetBleedProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.canvas);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
    gl.uniform1i(this._wetBleedLoc.u_canvas, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatmap);
    gl.uniform1i(this._wetBleedLoc.u_deposit, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatmap);
    gl.uniform1i(this._wetBleedLoc.u_wetHeatmap, 2);

    const w = this._wetness ?? 0.5;
    const sizeScale = this._wetSizeScale ?? 1.0;
    const scale = WET_CANVAS_BLEED_SCALE_MIN
                + (WET_CANVAS_BLEED_SCALE_MAX - WET_CANVAS_BLEED_SCALE_MIN) * w;
    const strength = WET_CANVAS_BLEED_STRENGTH * scale;

    gl.uniform2f(this._wetBleedLoc.u_resolution,  cw, ch);
    gl.uniform1f(this._wetBleedLoc.u_radius,      WET_CANVAS_BLEED_RADIUS * sizeScale);
    gl.uniform1f(this._wetBleedLoc.u_strength,    strength);
    gl.uniform1f(this._wetBleedLoc.u_depositMin,  WET_CANVAS_BLEED_DEPOSIT_MIN);
    gl.uniform1f(this._wetBleedLoc.u_noiseAmount, WET_CANVAS_BLEED_NOISE);
    gl.uniform1f(this._wetBleedLoc.u_noiseScale,  sizeScale);
    gl.uniform1f(this._wetBleedLoc.u_wetGateMin,  WET_CANVAS_BLEED_WET_GATE_MIN);

    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetBleedBuf);
    gl.enableVertexAttribArray(this._wetBleedLoc.a_pos);
    gl.vertexAttribPointer(this._wetBleedLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── RAF 启停 ─────────────────────────────────────────────────────────────────

/**
 * 控制湿纸效果是否激活。
 * 目前由 app.js 在 brush 工具 + watercolor 笔刷时设为 true。
 */
function setWetPaperActive(active) {
    const wasActive = !!this._wetPaperActive;
    this._wetPaperActive = !!active;

    if (active && !wasActive) {
        this._startWetPaperRaf();
    } else if (!active && wasActive) {
        this._stopWetPaperRaf();
    }
}

/**
 * 水彩湿画法涂抹 pass：在主混色 pass 之后跑一次涂抹，热度越高推色越强。
 * 复用 drawBrush 的涂抹分支（u_isSmudge=true，mixStrength 已由调用方设为 0）。
 */
function _drawWetSmudgePass(x, y, size, brushCanvas, useFalloff, smearDir, smearLen) {
    this.drawBrush(
        x, y, size,
        { r: 0, g: 0, b: 0 },  // 涂抹模式不用笔刷色
        brushCanvas,
        useFalloff,
        smearDir, smearLen,
        false,          // disableSmear=false → 走 smear 路径
        1.0,            // smudgeAlpha
        true,           // u_isSmudge=true
        size / 2,       // smudgeSampleRadius
        0,              // smudgeAngle
        0,              // brushRotation
        0.38,           // smudgeMix：颜料被推开的强度
        true,           // isWatercolor=true：smudge 热度反向（冷区强、热区弱）
    );
}

function _startWetPaperRaf() {
    // 由 heatmap 主 RAF（startHeatmapFadeOut）统一驱动，无需单独 RAF
}

function _stopWetPaperRaf() {
    // 同上，停止只需清 flag，主 RAF 会跳过
}

/**
 * 清零 wetHeatmap + wetMaskHeatmap（落笔时 / 松开鼠标后调用）
 * 两张图都是水彩独立资源，与 smudgeHeatmap 分离，互不影响。
 */
function clearWetHeatmap() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatTemp);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetMaskHeatmap);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetMaskHeatTemp);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 调试可视化 ───────────────────────────────────────────────────────────────

/**
 * console 调用：
 *   window._painter.debugWetPaper(true)   → 开启
 *   window._painter.debugWetPaper(false)  → 关闭
 */
function debugWetPaper(enable) {
    if (enable === undefined) enable = !this._debugWetPaperEnabled;
    if (!enable) {
        this._debugWetPaperEnabled = false;
        console.log('[debugWetPaper] 关闭');
        return;
    }

    // 确保 _debugHeatProgram 已初始化（借用其 program/buffer）
    // 静默初始化：调 debugHeatmap(true) 会打印日志，用临时的 noop console.log 屏蔽
    if (!this._debugHeatProgram) {
        const origLog = console.log;
        console.log = () => {};
        try {
            this.debugHeatmap(true);
        } finally {
            console.log = origLog;
        }
    }
    this._debugHeatmapEnabled = false;
    this._debugDepositHeatmapEnabled = false;
    this._debugWetMaskHeatmapEnabled = false;

    this._debugWetPaperEnabled = true;
    this._flushDebugWetPaper();
    console.log('[debugWetPaper] 开启 — 再次调用切换关闭');
}

function _flushDebugWetPaper(opacity = 1.0) {
    if (!this._debugWetPaperEnabled) return;
    this._flushHeatOverlay(this.textures.wetHeatmap, opacity);
}

/**
 * 切换 wetMaskHeatmap 在 _applyWetColor 中的启用状态。
 *   painter.toggleWetMask()       → 切换
 *   painter.toggleWetMask(true)   → 启用 mask（默认行为）
 *   painter.toggleWetMask(false)  → 关闭 mask（_applyWetColor 行为退回老版）
 */
function toggleWetMask(enable) {
    if (enable === undefined) enable = (this._wetMaskEnabled === false);
    this._wetMaskEnabled = !!enable;
    console.log(`[toggleWetMask] ${this._wetMaskEnabled ? '启用' : '关闭'}`);
}

/**
 * 可视化 wetMask × wetHeatmap 的交集（即 _applyWetColor 实际生效区域）。
 * 与 debugHeatmap / debugWetPaper / debugDepositHeatmap 互斥。
 *   painter.debugWetMask()        → 切换
 *   painter.debugWetMask(true)    → 开启
 *   painter.debugWetMask(false)   → 关闭
 */
function debugWetMask(enable) {
    if (enable === undefined) enable = (this._debugWetMaskHeatmapEnabled !== true);
    if (!enable) {
        this._debugWetMaskHeatmapEnabled = false;
        console.log('[debugWetMask] 关闭');
        return;
    }
    // 借用 _debugHeatProgram；未初始化则借 debugHeatmap(true) 静默启动
    if (!this._debugHeatProgram) {
        const origLog = console.log;
        console.log = () => {};
        try { this.debugHeatmap(true); } finally { console.log = origLog; }
    }
    // 互斥
    this._debugHeatmapEnabled = false;
    this._debugWetPaperEnabled = false;
    this._debugDepositHeatmapEnabled = false;

    this._debugWetMaskHeatmapEnabled = true;
    this._flushDebugWetMaskHeatmap();
    console.log('[debugWetMask] 开启 — 再次调用切换关闭');
}

/**
 * 初始化"交集 overlay" shader：采样 wetMaskHeatmap 与 wetHeatmap，按 min 显示
 * 表示 _applyWetColor 真实生效的区域（两图取交集）。
 */
function _initWetMaskIntersectProgram() {
    if (this._wetMaskIntersectProgram) return;
    const cached = BaseWebGLPainter._programCache.wetMaskIntersect;
    if (cached) {
        this._wetMaskIntersectProgram = cached.program;
        this._wetMaskIntersectLoc     = cached.locations;
        this._wetMaskIntersectBuf     = cached.buffer;
        return;
    }
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, `#version 300 es
        in vec2 a_pos;
        out vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);
    const fs = this.createShader(gl.FRAGMENT_SHADER, `#version 300 es
        precision mediump float;
        uniform sampler2D u_mask;
        uniform sampler2D u_wet;
        uniform float u_opacity;
        in vec2 v_uv;
        out vec4 outColor;

        vec3 heatColor(float t) {
            vec3 c0 = vec3(0.0, 0.0, 1.0);
            vec3 c1 = vec3(0.0, 1.0, 1.0);
            vec3 c2 = vec3(0.0, 1.0, 0.0);
            vec3 c3 = vec3(1.0, 1.0, 0.0);
            vec3 c4 = vec3(1.0, 0.0, 0.0);
            vec3 c5 = vec3(1.0, 1.0, 1.0);
            if (t < 0.2) return mix(c0, c1, t / 0.2);
            if (t < 0.4) return mix(c1, c2, (t - 0.2) / 0.2);
            if (t < 0.6) return mix(c2, c3, (t - 0.4) / 0.2);
            if (t < 0.8) return mix(c3, c4, (t - 0.6) / 0.2);
            return mix(c4, c5, (t - 0.8) / 0.2);
        }

        void main() {
            float m = texture(u_mask, v_uv).r;
            float w = texture(u_wet,  v_uv).r;
            float t = min(m, w);   // 交集 = 两边都有热度的区域
            if (t < 0.01) discard;
            float alpha = pow(t, 0.5) * 0.75 * u_opacity;
            outColor = vec4(heatColor(t), alpha);
        }
    `);

    const prog = this.createProgram(vs, fs);
    this._wetMaskIntersectProgram = prog;
    this._wetMaskIntersectLoc = {
        a_pos:     gl.getAttribLocation(prog,  'a_pos'),
        u_mask:    gl.getUniformLocation(prog, 'u_mask'),
        u_wet:     gl.getUniformLocation(prog, 'u_wet'),
        u_opacity: gl.getUniformLocation(prog, 'u_opacity'),
    };

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this._wetMaskIntersectBuf = buf;

    BaseWebGLPainter._programCache.wetMaskIntersect = {
        program: prog,
        locations: this._wetMaskIntersectLoc,
        buffer: buf,
    };
}

function _flushDebugWetMaskHeatmap(opacity = 1.0) {
    if (!this._debugWetMaskHeatmapEnabled) return;
    const maskTex = this.textures && this.textures.wetMaskHeatmap;
    const wetTex  = this.textures && this.textures.wetHeatmap;
    if (!maskTex || !wetTex) return;

    this._initWetMaskIntersectProgram();
    if (!this._wetMaskIntersectProgram) return;

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this._wetMaskIntersectProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.uniform1i(this._wetMaskIntersectLoc.u_mask, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, wetTex);
    gl.uniform1i(this._wetMaskIntersectLoc.u_wet, 1);
    gl.uniform1f(this._wetMaskIntersectLoc.u_opacity, opacity);

    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetMaskIntersectBuf);
    gl.enableVertexAttribArray(this._wetMaskIntersectLoc.a_pos);
    gl.vertexAttribPointer(this._wetMaskIntersectLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
}

/**
 * 诊断：在画布中心 8 个采样点读 wetMaskHeatmap.r，打印到 console。
 * console 调用：painter.dumpWetMask()
 */
function dumpWetMask() {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (!this.framebuffers || !this.framebuffers.wetMaskHeatmap) {
        console.warn('[dumpWetMask] wetMaskHeatmap FB 不存在 — 刷新页面');
        return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetMaskHeatmap);
    const px = new Uint8Array(4);
    const samples = [];
    for (let i = 0; i < 9; i++) {
        const x = Math.floor((i % 3 + 1) / 4 * cw);
        const y = Math.floor((Math.floor(i / 3) + 1) / 4 * ch);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        samples.push(`(${x},${y})=${px[0]}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    console.log('[dumpWetMask] R-channel:', samples.join('  '));
}

/**
 * wetMaskHeatmap 独立衰减（与 wetHeatmap 解耦）
 */
function _decayWetMaskHeatmap(decay = 0.04) {
    this._decayHeatmapGeneric(
        decay,
        this.framebuffers.wetMaskHeatmap,
        this.textures.wetMaskHeatmap,
        this.textures.wetMaskHeatTemp
    );
}

// ─── 挂载 ─────────────────────────────────────────────────────────────────────

Object.assign(BaseWebGLPainter.prototype, {
    _initWetPaperProgram,
    _stepWetPaper,
    _initWetSpreadProgram,
    _spreadHeatmapGeneric,
    _spreadWetHeatmap,
    _initDepositSpreadProgram,
    _spreadDepositHeatmap,
    _drawWetSmudgePass,
    updateWetHeatmap,
    _initWetColorProgram,

    _applyWetColor,
    _applyDepositColor,
    _applyDepositColorPass,
    _initWetBleedProgram,
    _applyWetBleed,
    setWetPaperActive,
    _startWetPaperRaf,
    _stopWetPaperRaf,
    clearWetHeatmap,
    refreshWetHeatLifetime,
    debugWetPaper,
    _flushDebugWetPaper,
    toggleWetMask,
    debugWetMask,
    _flushDebugWetMaskHeatmap,
    _initWetMaskIntersectProgram,
    dumpWetMask,
    _decayWetMaskHeatmap,
    _getOrCreateSoftBrushCanvas,
    _getOrCreateSoftBrushTexture,
});

console.log('wetpaper.js 加载成功');
