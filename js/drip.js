/**
 * drip.js — 湿区往下流动效果
 *
 * 物理直觉：
 *   wetMaskHeatmap 的边缘 = 当前湿区轮廓
 *   每帧从这些湿像素按概率"渗出"到独立的 dripHeatmap，
 *   dripHeatmap 自身向下传播 + 横向抖动 + 衰减，
 *   被 wetHeatmap 门控（流到干区自然停）。
 *   _applyWetColor 的 mask 取 max(wetMask, drip*gain)，
 *   drip 经过的地方继续注入当前 _wetColor，呈现"颜料沿轮廓往下流"的视觉。
 *
 * 三层启停门控（任一关闭都跳过整个 drip 管线，零开销）：
 *   1. DeviceProfile.DRIP_ENABLED            — 启动期硬门槛（小屏幕/低核心）
 *   2. PerfWatchdog 'drip' phase != done-fail — 运行期实测降级
 *   3. painter._dripUserPref ∈ {true,false,null} — 用户手动开关，覆盖前两层
 *
 * 计算 _shouldRunDrip()：
 *   if userPref === false → false
 *   if userPref === true  → true
 *   else 看 DeviceProfile.DRIP_ENABLED && PerfWatchdog.shouldRun('drip')
 */

const DRIP_USER_PREF_KEY = 'drip_user_pref_v1';

// ─── 资源创建（由 setupHeatmapTextures/Framebuffers 调用）─────────────────────

function setupDripTextures(w, h) {
    if (!this._dripCapable) return;
    this.textures.dripHeatmap  = this._createR8Texture(w, h);
    this.textures.dripHeatTemp = this._createR8Texture(w, h);
}

function setupDripFramebuffers() {
    if (!this._dripCapable) return;
    const gl = this.gl;

    this.framebuffers.dripHeatmap = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.dripHeatmap);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.dripHeatmap, 0);

    this.framebuffers.dripHeatTemp = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.dripHeatTemp);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.dripHeatTemp, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── shader 初始化 ───────────────────────────────────────────────────────────

/**
 * 单 pass shader：
 *   读 dripPrev (上一帧 drip) + wetMask (种子源) + wetHeatmap (湿度门)
 *   1. 向下偏移采样上一帧 drip → 重力传播 + 横向 hash 抖动
 *   2. 从 wetMask 按 hash 概率渗出新种子
 *   3. 衰减 + wetHeatmap 门控
 */
function _initDripStepProgram() {
    const cached = BaseWebGLPainter._programCache.dripStep;
    if (cached) {
        this._dripStepProgram = cached.program;
        this._dripStepLoc     = cached.locations;
        this._dripStepBuf     = cached.buffer;
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
        uniform sampler2D u_dripPrev;
        uniform sampler2D u_wetMask;
        uniform sampler2D u_wetHeatmap;
        uniform vec2  u_resolution;
        uniform float u_gravityPx;
        uniform float u_jitterXPx;
        uniform float u_decay;
        uniform float u_wetGate;
        uniform float u_seedChance;
        uniform float u_seedMaskGate;
        uniform float u_time;       // 帧累积量，hash 噪声去相关
        in vec2 v_uv;
        out vec4 outColor;

        // 廉价 hash（单帧调用 ~2 次）
        float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
        }

        void main() {
            vec2 px = 1.0 / u_resolution;
            vec2 fragCoord = v_uv * u_resolution;

            // ── 1. 重力传播：从"上方某点"采样上一帧的 drip ──
            //    采样源 = (当前像素正上方 gravityPx + 横向抖动)
            float jitter = (hash21(fragCoord + u_time) - 0.5) * 2.0 * u_jitterXPx;
            //  注：v_uv.y 通常 0=底, 1=顶（取决于 FB 朝向），但本管线渲染目标
            //  的 v_uv 习惯 = 上=1。"向下流动"对显示坐标 = uv.y 减小。
            //  我们要从"上方"采样 drip：source.y = v_uv.y + gravityPx*px.y
            vec2 srcUv = v_uv + vec2(jitter * px.x, u_gravityPx * px.y);
            float dripFromAbove = texture(u_dripPrev, srcUv).r;

            // ── 2. 自身衰减 ──
            float dripCarried = dripFromAbove * u_decay;

            // ── 3. 种子注入：wetMask 按概率渗出 ──
            float mask = texture(u_wetMask, v_uv).r;
            float seed = 0.0;
            if (mask > u_seedMaskGate) {
                float h = hash21(fragCoord * 0.13 + u_time * 1.7);
                if (h < u_seedChance) {
                    seed = mask;  // 用 mask 强度作为种子幅度，边缘渐变保留
                }
            }

            // ── 4. wetHeatmap 门控 ──
            float wet = texture(u_wetHeatmap, v_uv).r;
            float gate = step(u_wetGate, wet);

            float drip = max(dripCarried, seed) * gate;
            outColor = vec4(drip, 0.0, 0.0, 1.0);
        }
    `);

    const prog = this.createProgram(vs, fs);
    this._dripStepProgram = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this._dripStepBuf = buf;

    this._dripStepLoc = {
        a_pos:           gl.getAttribLocation(prog,  'a_pos'),
        u_dripPrev:      gl.getUniformLocation(prog, 'u_dripPrev'),
        u_wetMask:       gl.getUniformLocation(prog, 'u_wetMask'),
        u_wetHeatmap:    gl.getUniformLocation(prog, 'u_wetHeatmap'),
        u_resolution:    gl.getUniformLocation(prog, 'u_resolution'),
        u_gravityPx:     gl.getUniformLocation(prog, 'u_gravityPx'),
        u_jitterXPx:     gl.getUniformLocation(prog, 'u_jitterXPx'),
        u_decay:         gl.getUniformLocation(prog, 'u_decay'),
        u_wetGate:       gl.getUniformLocation(prog, 'u_wetGate'),
        u_seedChance:    gl.getUniformLocation(prog, 'u_seedChance'),
        u_seedMaskGate:  gl.getUniformLocation(prog, 'u_seedMaskGate'),
        u_time:          gl.getUniformLocation(prog, 'u_time'),
    };

    BaseWebGLPainter._programCache.dripStep = {
        program: prog,
        locations: this._dripStepLoc,
        buffer: this._dripStepBuf,
    };
}

// ─── 主 step：每帧（按 stride）跑一次 ─────────────────────────────────────────

function _stepDrip() {
    if (!this._dripCapable) return;
    if (!this._dripStepProgram) return;
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // copy dripHeatmap → dripHeatTemp（作为只读输入）
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.dripHeatmap);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.dripHeatTemp);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, cw, ch);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(this._dripStepProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.dripHeatmap);
    gl.viewport(0, 0, cw, ch);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.dripHeatTemp);
    gl.uniform1i(this._dripStepLoc.u_dripPrev, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetMaskHeatmap);
    gl.uniform1i(this._dripStepLoc.u_wetMask, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.wetHeatmap);
    gl.uniform1i(this._dripStepLoc.u_wetHeatmap, 2);

    gl.uniform2f(this._dripStepLoc.u_resolution, cw, ch);
    gl.uniform1f(this._dripStepLoc.u_gravityPx,    DRIP_GRAVITY_PX);
    gl.uniform1f(this._dripStepLoc.u_jitterXPx,    DRIP_JITTER_X_PX);
    gl.uniform1f(this._dripStepLoc.u_decay,        DRIP_DECAY);
    gl.uniform1f(this._dripStepLoc.u_wetGate,      DRIP_WET_GATE);
    gl.uniform1f(this._dripStepLoc.u_seedChance,   DRIP_CHANCE_PER_FRAME);
    gl.uniform1f(this._dripStepLoc.u_seedMaskGate, DRIP_SEED_MASK_GATE);
    this._dripTime = (this._dripTime ?? 0) + 1.0;
    gl.uniform1f(this._dripStepLoc.u_time, this._dripTime);

    this._disableAllVertexAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._dripStepBuf);
    gl.enableVertexAttribArray(this._dripStepLoc.a_pos);
    gl.vertexAttribPointer(this._dripStepLoc.a_pos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function _clearDripHeatmap() {
    if (!this._dripCapable) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.dripHeatmap);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.dripHeatTemp);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ─── 启停决策 ────────────────────────────────────────────────────────────────

function _initDripCapable() {
    // 加载期决定本 painter 实例是否分配 drip 资源
    const profileOk = (typeof DeviceProfile !== 'undefined' && DeviceProfile.DRIP_ENABLED);
    let userPref = null;
    try {
        const v = localStorage.getItem(DRIP_USER_PREF_KEY);
        if (v === '1') userPref = true;
        else if (v === '0') userPref = false;
    } catch (e) {}
    this._dripUserPref = userPref;
    // 用户显式启用 → 即使 DeviceProfile 不通过也分配资源
    this._dripCapable = userPref === true || profileOk;
}

/**
 * 每帧决策：是否真的要跑 drip pass。
 * 与 _dripCapable 解耦：capable=分配了资源；shouldRun=本帧要不要跑。
 */
function _shouldRunDrip() {
    if (!this._dripCapable) return false;
    const pref = this._dripUserPref;
    if (pref === false) return false;
    if (pref === true)  return true;
    // 自动模式：看 PerfWatchdog 判定
    if (typeof PerfWatchdog !== 'undefined') {
        return PerfWatchdog.shouldRun('drip');
    }
    return true;
}

/**
 * Debug 命令：toggle drip 用户偏好。
 *   toggleDrip()      → 三态循环 auto → on → off → auto
 *   toggleDrip(true)  → 强制开
 *   toggleDrip(false) → 强制关
 *   toggleDrip(null)  → 回到 auto
 */
function toggleDrip(value) {
    let next;
    if (value === undefined) {
        // 三态循环
        if (this._dripUserPref === null)       next = true;
        else if (this._dripUserPref === true)  next = false;
        else                                    next = null;
    } else {
        next = (value === null) ? null : !!value;
    }
    this._dripUserPref = next;
    try {
        if (next === null) localStorage.removeItem(DRIP_USER_PREF_KEY);
        else               localStorage.setItem(DRIP_USER_PREF_KEY, next ? '1' : '0');
    } catch (e) {}
    // 切回关闭时立即清空 dripHeatmap，避免残留
    if (next === false) this._clearDripHeatmap();

    // 用户显式开启但当前 painter 未分配资源 → 提示需重启
    if (next === true && !this._dripCapable) {
        console.warn('[toggleDrip] 当前 painter 启动期未分配 drip 资源（设备未通过 DeviceProfile 门槛）。已记录用户偏好，下次刷新生效。');
    } else {
        const label = next === null ? 'auto' : (next ? '强制开' : '强制关');
        console.log(`[toggleDrip] ${label}（capable=${this._dripCapable}, watchdog=${typeof PerfWatchdog !== 'undefined' ? PerfWatchdog.getPhase('drip') : 'n/a'}）`);
    }
}

// ─── 调试可视化 ──────────────────────────────────────────────────────────────

function debugDripHeatmap(enable) {
    if (enable === undefined) enable = !this._debugDripHeatmapEnabled;
    if (!enable) {
        this._debugDripHeatmapEnabled = false;
        console.log('[debugDripHeatmap] 关闭');
        return;
    }
    if (!this._dripCapable) {
        console.warn('[debugDripHeatmap] 本 painter 未分配 drip 资源，无可视化对象');
        return;
    }
    // 复用 debugHeatmap 的 program（懒初始化）
    if (!this._debugHeatProgram) this.debugHeatmap(true), this.debugHeatmap(false);
    this._debugHeatmapEnabled = false;
    this._debugWetPaperEnabled = false;
    this._debugDepositHeatmapEnabled = false;
    this._debugWetMaskHeatmapEnabled = false;
    this._debugDripHeatmapEnabled = true;
    this._flushDebugDripHeatmap();
    console.log('[debugDripHeatmap] 开启 — 再次调用切换关闭');
}

function _flushDebugDripHeatmap(opacity = 1.0) {
    if (!this._debugDripHeatmapEnabled) return;
    if (!this.textures.dripHeatmap) return;
    this._flushHeatOverlay(this.textures.dripHeatmap, opacity);
}

// ─── 注册到 BaseWebGLPainter.prototype ───────────────────────────────────────

Object.assign(BaseWebGLPainter.prototype, {
    setupDripTextures,
    setupDripFramebuffers,
    _initDripStepProgram,
    _stepDrip,
    _clearDripHeatmap,
    _initDripCapable,
    _shouldRunDrip,
    toggleDrip,
    debugDripHeatmap,
    _flushDebugDripHeatmap,
});

console.log('drip.js 加载成功');
