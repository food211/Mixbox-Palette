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
}

function _stepWetPaper() {
    // 无操作
}

/**
 * 初始化热度扩散 shader：对 smudgeHeatmap 做各向同性扩散，热度向外晕染。
 */
function _initWetSpreadProgram() {
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
        uniform float u_radius;    // 采样半径（像素）
        uniform float u_strength;  // 扩散强度（0~1）
        varying vec2 v_uv;

        void main() {
            vec2 px = 1.0 / u_resolution;
            float center = texture2D(u_heatmap, v_uv).r;

            // 4邻居平均
            float n = texture2D(u_heatmap, v_uv + vec2( 0.0,  px.y * u_radius)).r;
            float s = texture2D(u_heatmap, v_uv + vec2( 0.0, -px.y * u_radius)).r;
            float e = texture2D(u_heatmap, v_uv + vec2( px.x * u_radius,  0.0)).r;
            float w = texture2D(u_heatmap, v_uv + vec2(-px.x * u_radius,  0.0)).r;
            float spread = (n + s + e + w) * 0.25;

            // 只允许热度升高（从邻居扩散过来），不允许降低（衰减由 _decayHeatmap 负责）
            float result = mix(center, max(center, spread), u_strength);
            gl_FragColor = vec4(result, 0.0, 0.0, 1.0);
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
        u_strength:   gl.getUniformLocation(prog, 'u_strength'),
    };
}

/**
 * 对 smudgeHeatmap 执行一次扩散 pass，热度向外晕染。
 * 由 RAF tick 在水彩激活时调用，在衰减之前执行。
 */
function _spreadWetHeatmap() {
    if (!this._wetSpreadProgram) return;
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // 拷当前 smudgeHeatmap → smudgeHeatTemp 作为只读输入
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatTemp);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._wetSpreadProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatTemp);
    gl.uniform1i(this._wetSpreadLoc.u_heatmap, 0);
    gl.uniform2f(this._wetSpreadLoc.u_resolution, cw, ch);
    gl.uniform1f(this._wetSpreadLoc.u_radius,   WET_SPREAD_RADIUS);
    gl.uniform1f(this._wetSpreadLoc.u_strength, WET_SPREAD_STRENGTH);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetSpreadBuf);
    gl.enableVertexAttribArray(this._wetSpreadLoc.a_pos);
    gl.vertexAttribPointer(this._wetSpreadLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}


/**
 * 向 wetHeatmap 注热（复用 _heatmapProgram，目标为 wetHeatmap/wetHeatTemp）
 * 由 base-painter.js 水彩分支调用，替代写 smudgeHeatmap。
 */
function updateWetHeatmap(x, y, size, brushCanvas, useFalloff, heatStep = HEAT_ACCUMULATE_STEP) {
    // 注热时重置帧计数：1/HEAT_DECAY_STEP 帧后热度归零，多留余量给扩散消退
    this._wetHeatFrames = Math.ceil(1.0 / HEAT_DECAY_STEP) + 60;

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
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // ── copy 2：depositHeatmap → depositHeatTemp ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.depositHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.depositHeatTemp);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
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
        uniform float u_mixStrength;      // 用户混色强度（0~1）
        uniform float u_gradRadius;       // 梯度采样半径（像素）
        uniform float u_depositStr;       // 沉积强度
        uniform float u_diluteStr;        // 稀释强度
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

            // ── 效果1：梯度区颜料沉积（浓度越高越弱，但保留最低1%）──
            float depositMask = smoothstep(u_depositGradMin, u_depositGradMax, grad);
            float depositAmt  = depositMask * u_depositStr * mix(0.01, 1.0, 1.0 - u_mixStrength);
            vec3 deposited = mix(canvas.rgb, u_color, depositAmt);

            // ── 效果2：高热区稀释（往画布色与笔刷色的中间色偏移）──
            float diluteMask = heat * (1.0 - smoothstep(0.1, u_diluteGradSuppress, grad));
            float diluteAmt  = diluteMask * u_diluteStr * u_mixStrength;
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
        u_mixStrength:gl.getUniformLocation(prog, 'u_mixStrength'),
        u_gradRadius: gl.getUniformLocation(prog, 'u_gradRadius'),
        u_depositStr: gl.getUniformLocation(prog, 'u_depositStr'),
        u_diluteStr:  gl.getUniformLocation(prog, 'u_diluteStr'),
        u_depositGradMin:    gl.getUniformLocation(prog, 'u_depositGradMin'),
        u_depositGradMax:    gl.getUniformLocation(prog, 'u_depositGradMax'),
        u_diluteGradSuppress:gl.getUniformLocation(prog, 'u_diluteGradSuppress'),
    };
}

/**
 * 根据当前 wetHeatmap 将水彩效果写入 canvas 纹理。
 * 每帧由 heatmap RAF tick 调用（仅 _wetPaperActive 时）。
 * @param {{r,g,b}} color      当前笔刷颜色（0~1）
 * @param {number}  mixStrength 用户混色强度（0~1）
 */
function _applyWetColor(color, mixStrength) {
    if (!this._wetColorProgram) return;

    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;


    // 把当前 canvas 拷到 temp，作为 shader 的只读输入
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._copyReadFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.canvas, 0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.temp);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
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
    gl.uniform1f(this._wetColorLoc.u_mixStrength, mixStrength);
    gl.uniform1f(this._wetColorLoc.u_gradRadius,         WET_GRADIENT_RADIUS);
    gl.uniform1f(this._wetColorLoc.u_depositStr,         depositStr);
    gl.uniform1f(this._wetColorLoc.u_diluteStr,          diluteStr);
    gl.uniform1f(this._wetColorLoc.u_depositGradMin,     WET_DEPOSIT_GRAD_MIN);
    gl.uniform1f(this._wetColorLoc.u_depositGradMax,     WET_DEPOSIT_GRAD_MAX);
    gl.uniform1f(this._wetColorLoc.u_diluteGradSuppress, WET_DILUTE_GRAD_SUPPRESS);

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
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
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
    gl.uniform1f(this._wetColorLoc.u_mixStrength,        0.0); // 提笔沉积不受用户浓度影响
    gl.uniform1f(this._wetColorLoc.u_gradRadius,         WET_GRADIENT_RADIUS);
    gl.uniform1f(this._wetColorLoc.u_depositStr,         depositStr);
    gl.uniform1f(this._wetColorLoc.u_diluteStr,          0.0);
    gl.uniform1f(this._wetColorLoc.u_depositGradMin,     WET_DEPOSIT_GRAD_MIN);
    gl.uniform1f(this._wetColorLoc.u_depositGradMax,     WET_DEPOSIT_GRAD_MAX);
    gl.uniform1f(this._wetColorLoc.u_diluteGradSuppress, WET_DILUTE_GRAD_SUPPRESS);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetColorBuf);
    gl.enableVertexAttribArray(this._wetColorLoc.a_pos);
    gl.vertexAttribPointer(this._wetColorLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

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
 * 清零热度图（落笔时 / 松开鼠标后调用）
 * wetHeatmap 已与 smudgeHeatmap 合并，直接清零同一张纹理。
 */
function clearWetHeatmap() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatmap);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.smudgeHeatTemp);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 调试可视化 ───────────────────────────────────────────────────────────────

/**
 * console 调用：
 *   window._painter.debugWetPaper(true)   → 开启
 *   window._painter.debugWetPaper(false)  → 关闭
 */
function debugWetPaper(enable = true) {
    if (!enable) {
        this._debugWetPaperEnabled = false;
        console.log('[debugWetPaper] 关闭');
        return;
    }

    // 确保 _debugHeatProgram 已初始化（借用其 program/buffer），
    // 直接调内部初始化逻辑，不触发 debugHeatmap 的互斥逻辑
    if (!this._debugHeatProgram) {
        // 临时允许 debugHeatmap 跑完初始化，再把两个 flag 都清掉
        this.debugHeatmap(true);
        this._debugHeatmapEnabled = false;
        this._debugWetPaperEnabled = false; // debugHeatmap 内互斥会清掉，这里再加回来前先确保干净
    }
    this._debugHeatmapEnabled = false;

    this._debugWetPaperEnabled = true;
    this._flushDebugWetPaper();
    console.log('[debugWetPaper] 开启 — 调用 window._painter.debugWetPaper(false) 关闭');
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
    _spreadWetHeatmap,
    _drawWetSmudgePass,
    updateWetHeatmap,
    _initWetColorProgram,

    _applyWetColor,
    _applyDepositColor,
    _applyDepositColorPass,
    setWetPaperActive,
    _startWetPaperRaf,
    _stopWetPaperRaf,
    clearWetHeatmap,
    debugWetPaper,
    _flushDebugWetPaper,
});

console.log('wetpaper.js 加载成功');
