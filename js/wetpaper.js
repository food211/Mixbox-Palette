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

    const vs = this.createShader(gl.VERTEX_SHADER, `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);

    const fs = this.createShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D u_heatmap;
        uniform vec2 u_resolution;
        uniform float u_radius;    // 采样半径（像素，由湿度决定 → 控制扩散速度）
        uniform float u_falloff;   // 外扩衰减系数（<1，让远处自然渐淡）
        varying vec2 v_uv;

        void main() {
            vec2 px = 1.0 / u_resolution;
            float center = texture2D(u_heatmap, v_uv).r;

            float n  = texture2D(u_heatmap, v_uv + vec2( 0.0,  px.y * u_radius)).r;
            float s  = texture2D(u_heatmap, v_uv + vec2( 0.0, -px.y * u_radius)).r;
            float e  = texture2D(u_heatmap, v_uv + vec2( px.x * u_radius,  0.0)).r;
            float w  = texture2D(u_heatmap, v_uv + vec2(-px.x * u_radius,  0.0)).r;
            float ne = texture2D(u_heatmap, v_uv + vec2( px.x * u_radius * 0.707,  px.y * u_radius * 0.707)).r;
            float nw = texture2D(u_heatmap, v_uv + vec2(-px.x * u_radius * 0.707,  px.y * u_radius * 0.707)).r;
            float se = texture2D(u_heatmap, v_uv + vec2( px.x * u_radius * 0.707, -px.y * u_radius * 0.707)).r;
            float sw = texture2D(u_heatmap, v_uv + vec2(-px.x * u_radius * 0.707, -px.y * u_radius * 0.707)).r;

            float maxN = max(max(max(n, s), max(e, w)),
                             max(max(ne, nw), max(se, sw)));
            float inherited = maxN * u_falloff;
            gl_FragColor = vec4(max(center, inherited), 0.0, 0.0, 1.0);
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
    const radius = WET_SPREAD_RADIUS_MIN + (WET_SPREAD_RADIUS_MAX - WET_SPREAD_RADIUS_MIN) * w;

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
    gl.uniform1f(this._wetSpreadLoc.u_falloff, WET_DEPOSIT_SPREAD_FALLOFF);

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
    const vs = this.createShader(gl.VERTEX_SHADER, `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);
    // max 策略：取邻居最大值，再乘以一个小于 1 的 falloff，让外围自然衰减
    // 这样能稳定向外爬边界，但距离中心越远热度越低
    const fs = this.createShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D u_heatmap;
        uniform vec2 u_resolution;
        uniform float u_radius;
        uniform float u_falloff;   // 0~1，每次传播衰减系数
        varying vec2 v_uv;
        void main() {
            vec2 px = 1.0 / u_resolution;
            float center = texture2D(u_heatmap, v_uv).r;
            float n = texture2D(u_heatmap, v_uv + vec2( 0.0,  px.y * u_radius)).r;
            float s = texture2D(u_heatmap, v_uv + vec2( 0.0, -px.y * u_radius)).r;
            float e = texture2D(u_heatmap, v_uv + vec2( px.x * u_radius,  0.0)).r;
            float w = texture2D(u_heatmap, v_uv + vec2(-px.x * u_radius,  0.0)).r;
            float ne = texture2D(u_heatmap, v_uv + vec2( px.x * u_radius * 0.707,  px.y * u_radius * 0.707)).r;
            float nw = texture2D(u_heatmap, v_uv + vec2(-px.x * u_radius * 0.707,  px.y * u_radius * 0.707)).r;
            float se = texture2D(u_heatmap, v_uv + vec2( px.x * u_radius * 0.707, -px.y * u_radius * 0.707)).r;
            float sw = texture2D(u_heatmap, v_uv + vec2(-px.x * u_radius * 0.707, -px.y * u_radius * 0.707)).r;
            float maxN = max(max(max(n, s), max(e, w)), max(max(ne, nw), max(se, sw)));
            // 从邻居继承最大值，但乘以 falloff 让外围渐淡
            float inherited = maxN * u_falloff;
            // 自己的值和继承值取大：保留核心、同时允许外围生长
            gl_FragColor = vec4(max(center, inherited), 0.0, 0.0, 1.0);
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
    const depositRadius = WET_DEPOSIT_SPREAD_RADIUS_MIN
                        + (WET_DEPOSIT_SPREAD_RADIUS_MAX - WET_DEPOSIT_SPREAD_RADIUS_MIN) * w;
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
    const decayScale = HEAT_DECAY_SCALE_MAX
                     + (HEAT_DECAY_SCALE_MIN - HEAT_DECAY_SCALE_MAX) * w;
    const effectiveDecay = HEAT_DECAY_STEP * decayScale;
    this._wetHeatFrames = Math.ceil(1.0 / effectiveDecay) + 60;
}

function updateWetHeatmap(x, y, size, brushCanvas, useFalloff, heatStep = HEAT_ACCUMULATE_STEP) {
    this.refreshWetHeatLifetime();

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

    const positions = new Float32Array([
        x - halfSize, y - halfSize,
        x + halfSize, y - halfSize,
        x - halfSize, y + halfSize,
        x + halfSize, y + halfSize,
    ]);
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

    const vs = this.createShader(gl.VERTEX_SHADER, `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);

    const fs = this.createShader(gl.FRAGMENT_SHADER, `
        precision highp float;

        uniform sampler2D u_canvas;       // 当前画布
        uniform sampler2D u_wetHeatmap;   // 湿度图
        uniform vec2 u_resolution;
        uniform vec3 u_color;             // 笔刷颜色
        uniform float u_gradRadius;       // 梯度采样半径（像素）
        uniform float u_depositStr;       // 沉积强度（全权由 wet 控制）
        uniform float u_diluteStr;        // 稀释强度（全权由 wet 控制）
        uniform float u_depositGradMin;   // 沉积 smoothstep 下限
        uniform float u_depositGradMax;   // 沉积 smoothstep 上限
        uniform float u_diluteGradSuppress; // 稀释梯度抑制上限

        varying vec2 v_uv;

        void main() {
            vec2 px = 1.0 / u_resolution;
            float heat = texture2D(u_wetHeatmap, v_uv).r;

            // ── 梯度计算（4邻居，WebGL1 无 dFdx）──
            float r  = texture2D(u_wetHeatmap, v_uv + vec2( px.x * u_gradRadius, 0.0)).r;
            float l  = texture2D(u_wetHeatmap, v_uv + vec2(-px.x * u_gradRadius, 0.0)).r;
            float up = texture2D(u_wetHeatmap, v_uv + vec2(0.0,  px.y * u_gradRadius)).r;
            float dn = texture2D(u_wetHeatmap, v_uv + vec2(0.0, -px.y * u_gradRadius)).r;
            float grad = length(vec2(r - l, up - dn)) * 0.5; // 归一化到 0~1

            vec4 canvas = texture2D(u_canvas, v_uv);

            // ── 效果1：梯度区颜料沉积（强度全权由 u_depositStr 控制）──
            float depositMask = smoothstep(u_depositGradMin, u_depositGradMax, grad);
            float depositAmt  = depositMask * u_depositStr;
            vec3 deposited = mix(canvas.rgb, u_color, depositAmt);

            // ── 效果2：高热区稀释（强度全权由 u_diluteStr 控制）──
            float diluteMask = heat * (1.0 - smoothstep(0.1, u_diluteGradSuppress, grad));
            float diluteAmt  = diluteMask * u_diluteStr;
            vec3 diluteTarget = mix(canvas.rgb, u_color, 0.5);
            vec3 outRGB = mix(deposited, diluteTarget, diluteAmt);

            // 热度 + 梯度都为0的区域不写入
            float anyEffect = max(depositAmt, diluteAmt);
            if (anyEffect < 0.001) discard;

            gl_FragColor = vec4(outRGB, 1.0);
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

    // wet低→沉积强、稀释弱；wet高→沉积弱、稀释强
    const w = this._wetness ?? 0.5;
    const depositStr = WET_DEPOSIT_STRENGTH * (WET_DEPOSIT_SCALE_MAX + (WET_DEPOSIT_SCALE_MIN - WET_DEPOSIT_SCALE_MAX) * w);
    const diluteStr  = WET_DILUTE_STRENGTH  * (WET_DILUTE_SCALE_MIN  + (WET_DILUTE_SCALE_MAX  - WET_DILUTE_SCALE_MIN)  * w);

    gl.uniform2f(this._wetColorLoc.u_resolution, cw, ch);
    gl.uniform3f(this._wetColorLoc.u_color, color.r, color.g, color.b);
    gl.uniform1f(this._wetColorLoc.u_gradRadius,         WET_GRADIENT_RADIUS);
    gl.uniform1f(this._wetColorLoc.u_depositStr,         depositStr);
    gl.uniform1f(this._wetColorLoc.u_diluteStr,          diluteStr);
    gl.uniform1f(this._wetColorLoc.u_depositGradMin,     WET_DEPOSIT_GRAD_MIN);
    gl.uniform1f(this._wetColorLoc.u_depositGradMax,     WET_DEPOSIT_GRAD_MAX);
    gl.uniform1f(this._wetColorLoc.u_diluteGradSuppress, WET_DILUTE_GRAD_SUPPRESS);

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
function _applyDepositColor() {
    if (!this._wetColorProgram || !this._wetColor) return;

    const TOTAL_FRAMES = 8;
    let frame = 0;
    const color = this._wetColor;

    const tick = () => {
        if (this._disposed) return;
        if (frame >= TOTAL_FRAMES) {
            this.clearDepositHeatmap();
            this.flush();
            return;
        }

        // 强度线性衰减：第0帧最强，最后一帧趋近0
        const t = 1.0 - frame / TOTAL_FRAMES;
        const frameStr = WET_DEPOSIT_STRENGTH * t * 0.4;

        this._applyDepositColorPass(color, frameStr);
        this.flush();
        frame++;
        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
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

    gl.uniform2f(this._wetColorLoc.u_resolution, cw, ch);
    gl.uniform3f(this._wetColorLoc.u_color, color.r, color.g, color.b);
    gl.uniform1f(this._wetColorLoc.u_gradRadius,         WET_GRADIENT_RADIUS);
    gl.uniform1f(this._wetColorLoc.u_depositStr,         depositStr);
    gl.uniform1f(this._wetColorLoc.u_diluteStr,          0.0);
    gl.uniform1f(this._wetColorLoc.u_depositGradMin,     WET_DEPOSIT_GRAD_MIN);
    gl.uniform1f(this._wetColorLoc.u_depositGradMax,     WET_DEPOSIT_GRAD_MAX);
    gl.uniform1f(this._wetColorLoc.u_diluteGradSuppress, WET_DILUTE_GRAD_SUPPRESS);

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

    const vs = this.createShader(gl.VERTEX_SHADER, `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);

    // 8 方向采样，比较邻居 depositRaw：邻居浓度高于自己则吸取其颜色。
    // 结果是颜色从高浓度区缓慢向低浓度区扩散，形状由 depositHeatmap 决定。
    const fs = this.createShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D u_canvas;
        uniform sampler2D u_deposit;
        uniform sampler2D u_wetHeatmap;  // 会衰减的湿度图：控制"还湿着"才扩散
        uniform vec2 u_resolution;
        uniform float u_radius;          // 采样步长（像素）
        uniform float u_strength;        // 扩散强度
        uniform float u_depositMin;      // deposit 低于此值不扩散
        uniform float u_noiseAmount;     // 噪声扰动量（0~1）
        uniform float u_wetGateMin;      // wetness 低于此值完全停止扩散（已干）
        varying vec2 v_uv;

        // 像素级 hash 噪声：同一像素恒定值，不同像素随机
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec2 px = 1.0 / u_resolution;
            float myDeposit = texture2D(u_deposit, v_uv).r;
            vec4 myColor = texture2D(u_canvas, v_uv);

            if (myDeposit < u_depositMin) {
                gl_FragColor = myColor;
                return;
            }

            // 湿度 gate：综合 wetHeatmap（会衰减）和 myDeposit（扩张区域）
            // wetHeatmap 控制"时间维度"——笔触结束后一段时间整体停止扩散
            // myDeposit 控制"空间维度"——未触及的区域不扩散
            float wetness = texture2D(u_wetHeatmap, v_uv).r;
            if (wetness < u_wetGateMin) {
                gl_FragColor = myColor;
                return;
            }
            // wetGate 综合两者：wetHeatmap 决定全局活跃度、myDeposit 决定局部活跃度
            // myDeposit 高 = 颜料多 = 湿得久；myDeposit 低 = 外围 = 只要全局还湿就继续扩
            float wetGate = smoothstep(u_wetGateMin, 0.2, wetness);

            // 像素级纸纤维噪声：扰动半径和吸色强度
            // 低频噪声（hash 分像素坐标）模拟纤维聚集，让相邻像素有相关性
            vec2 pixelCoord = floor(v_uv * u_resolution);
            float noise1 = hash(pixelCoord);
            float noise2 = hash(pixelCoord + vec2(3.7, 1.3));
            // 低频纤维聚集（每 ~3 像素一组）
            vec2 clusterCoord = floor(v_uv * u_resolution / 3.0);
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

                float nDeposit = texture2D(u_deposit, sampleUV).r;
                float dh = nDeposit - myDeposit;
                if (dh > 0.0) {
                    vec3 nColor = texture2D(u_canvas, sampleUV).rgb;
                    weightedColor += nColor * dh;
                    totalWeight += dh;
                }
            }

            if (totalWeight < 0.001) {
                gl_FragColor = myColor;
                return;
            }

            vec3 avgNeighbor = weightedColor / totalWeight;
            // 浓区抗扩散：myDeposit 越高扩散越弱（内部颜料稳定不被推动）
            // 外围 myDeposit 低 → resist≈1 全速扩散；核心高浓度 → resist≈0 基本不变
            float resist = 1.0 - smoothstep(0.3, 0.8, myDeposit);
            float mixAmt = u_strength * totalWeight * absorbJitter * wetGate * resist;
            vec3 outRGB = mix(myColor.rgb, avgNeighbor, mixAmt);

            gl_FragColor = vec4(outRGB, myColor.a);
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
    const scale = WET_CANVAS_BLEED_SCALE_MIN
                + (WET_CANVAS_BLEED_SCALE_MAX - WET_CANVAS_BLEED_SCALE_MIN) * w;
    const strength = WET_CANVAS_BLEED_STRENGTH * scale;

    gl.uniform2f(this._wetBleedLoc.u_resolution,  cw, ch);
    gl.uniform1f(this._wetBleedLoc.u_radius,      WET_CANVAS_BLEED_RADIUS);
    gl.uniform1f(this._wetBleedLoc.u_strength,    strength);
    gl.uniform1f(this._wetBleedLoc.u_depositMin,  WET_CANVAS_BLEED_DEPOSIT_MIN);
    gl.uniform1f(this._wetBleedLoc.u_noiseAmount, WET_CANVAS_BLEED_NOISE);
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
 * 清零 wetHeatmap（落笔时 / 松开鼠标后调用）
 * 与 smudgeHeatmap 已分离，互不影响。
 */
function clearWetHeatmap() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatTemp);
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

    this._debugWetPaperEnabled = true;
    this._flushDebugWetPaper();
    console.log('[debugWetPaper] 开启 — 再次调用切换关闭');
}

function _flushDebugWetPaper(opacity = 1.0) {
    if (!this._debugWetPaperEnabled) return;
    this._flushHeatOverlay(this.textures.wetHeatmap, opacity);
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
});

console.log('wetpaper.js 加载成功');
