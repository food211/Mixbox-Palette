/**
 * wetpaper.js — 湿纸效果系统
 *
 * 以 mixin 形式扩展 BaseWebGLPainter。
 * 从 smudgeHeatmap 单向读取热度作为"注入源"，
 * 在独立的 wetHeatmap 纹理上做物理演化（重力下落 + 横向扩散 + 蒸发），
 * 不修改原始 smudgeHeatmap。
 *
 * 启停控制：
 *   painter.setWetPaperActive(true/false)
 * 目前由 app.js 在 brush 工具 + watercolor 笔刷时启用。
 */

// ─── 湿纸效果参数常量 ─────────────────────────────────────────────────────────

/** 每帧从 smudgeHeatmap 注入到 wetHeatmap 的比例（0~1） */
const WET_INJECT_RATE = 0.08;

/** 重力下落速度（像素/帧），控制液体下坠的快慢 */
const WET_GRAVITY_SPEED = 0.8;

/** 横向扩散系数（0~1），模拟表面张力导致的侧向蔓延 */
const WET_SPREAD = 0.12;

/** 每帧蒸发量（0~1），湿度自然消散的速率 */
const WET_EVAPORATE_STEP = 0.004;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * 创建湿纸纹理与 Framebuffer
 * 由 BaseWebGLPainter.setupTextures / setupFramebuffers 之后调用
 */
function setupWetPaperTextures(w, h) {
    this.textures.wetHeatmap  = this._createR8Texture(w, h);
    this.textures.wetHeatTemp = this._createR8Texture(w, h);
}

function setupWetPaperFramebuffers() {
    const gl = this.gl;

    this.framebuffers.wetHeatmap = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.wetHeatmap, 0);

    this.framebuffers.wetHeatTemp = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatTemp);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.wetHeatTemp, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 物理演化 shader ──────────────────────────────────────────────────────────

function _initWetPaperProgram() {
    const gl = this.gl;

    const vs = this.createShader(gl.VERTEX_SHADER, `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
            v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `);

    // 物理演化：重力平流 + 横向扩散 + 蒸发 + 注入
    const fs = this.createShader(gl.FRAGMENT_SHADER, `
        precision highp float;
        uniform sampler2D u_wet;        // 上一帧 wetHeatmap
        uniform sampler2D u_heat;       // smudgeHeatmap（注入源，只读）
        uniform vec2 u_resolution;
        uniform float u_gravity;        // 重力下落像素数
        uniform float u_spread;         // 横向扩散系数
        uniform float u_evaporate;      // 蒸发量
        uniform float u_injectRate;     // 注入比例
        varying vec2 v_uv;

        void main() {
            vec2 px = 1.0 / u_resolution;

            // 重力平流：从上方 u_gravity 像素处采样（屏幕 Y 向下，纹理 UV Y 向上，所以加 px.y）
            vec2 uvFrom = v_uv + vec2(0.0, px.y * u_gravity);
            float advected = texture2D(u_wet, uvFrom).r;

            // 横向扩散：左右邻居各贡献 u_spread/2
            float left  = texture2D(u_wet, v_uv + vec2(-px.x, 0.0)).r;
            float right = texture2D(u_wet, v_uv + vec2( px.x, 0.0)).r;
            float spread = (left + right) * 0.5 * u_spread;

            float wet = mix(advected, spread, u_spread);

            // 蒸发
            wet = max(wet - u_evaporate, 0.0);

            // 从 smudgeHeatmap 注入新热度
            float inject = texture2D(u_heat, v_uv).r;
            wet = min(1.0, wet + inject * u_injectRate);

            gl_FragColor = vec4(wet, 0.0, 0.0, 1.0);
        }
    `);

    const prog = this.createProgram(vs, fs);
    this._wetProgram = prog;
    this._wetAPos         = gl.getAttribLocation(prog, 'a_pos');
    this._wetUWet         = gl.getUniformLocation(prog, 'u_wet');
    this._wetUHeat        = gl.getUniformLocation(prog, 'u_heat');
    this._wetUResolution  = gl.getUniformLocation(prog, 'u_resolution');
    this._wetUGravity     = gl.getUniformLocation(prog, 'u_gravity');
    this._wetUSpread      = gl.getUniformLocation(prog, 'u_spread');
    this._wetUEvaporate   = gl.getUniformLocation(prog, 'u_evaporate');
    this._wetUInjectRate  = gl.getUniformLocation(prog, 'u_injectRate');

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1,-1,  1,-1,  -1,1,  1,1
    ]), gl.STATIC_DRAW);
    this._wetBuf = buf;
}

// ─── 单帧物理步进 ─────────────────────────────────────────────────────────────

function _stepWetPaper() {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // 把当前 wetHeatmap 拷到 temp，作为本帧输入
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatTemp);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, cw, ch, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._wetProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.wetHeatmap);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatTemp);
    gl.uniform1i(this._wetUWet, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.smudgeHeatmap);
    gl.uniform1i(this._wetUHeat, 1);

    gl.uniform2f(this._wetUResolution, cw, ch);
    gl.uniform1f(this._wetUGravity,    WET_GRAVITY_SPEED);
    gl.uniform1f(this._wetUSpread,     WET_SPREAD);
    gl.uniform1f(this._wetUEvaporate,  WET_EVAPORATE_STEP);
    gl.uniform1f(this._wetUInjectRate, WET_INJECT_RATE);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._wetBuf);
    gl.enableVertexAttribArray(this._wetAPos);
    gl.vertexAttribPointer(this._wetAPos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── RAF 启停 ─────────────────────────────────────────────────────────────────

/**
 * 控制湿纸效果是否激活。
 * 目前由 app.js 在 brush 工具 + watercolor 笔刷时设为 true。
 * 未来如需支持其他模式，只需在 app.js 对应位置调用此方法。
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

function _startWetPaperRaf() {
    // 湿纸步进由 heatmap 主 RAF（startHeatmapFadeOut）统一驱动，无需单独 RAF
}

function _stopWetPaperRaf() {
    // 同上，停止只需清 flag，主 RAF 会跳过步进
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

    // 互斥：关闭热度图 debug，确保 _debugHeatProgram 已初始化
    this._debugHeatmapEnabled = false;
    // 触发 debugHeatmap 的懒初始化（借用其 program 和 buffer）
    // 必须传 true 才会走初始化分支，初始化完再手动关掉 flag
    if (!this._debugHeatProgram) {
        this.debugHeatmap(true);
        this._debugHeatmapEnabled = false;
    }

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
    setupWetPaperTextures,
    setupWetPaperFramebuffers,
    _initWetPaperProgram,
    _stepWetPaper,
    setWetPaperActive,
    _startWetPaperRaf,
    _stopWetPaperRaf,
    debugWetPaper,
    _flushDebugWetPaper,
});

console.log('wetpaper.js 加载成功');
