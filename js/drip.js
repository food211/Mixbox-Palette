/**
 * drip.js — 颜料水滴往下流挂（CPU 粒子系统）
 *
 * 模型：
 *   笔触绘制过程中，每走过 DRIP_SPAWN_INTERVAL_PX 像素触发一次"水滴生成"，
 *   在该位置按水彩笔刷的颗粒分布（极坐标 sqrt 半径）虚拟生成 35 个候选颗粒，
 *   随机抽 1~2 个当水滴起点。
 *
 *   每个水滴是一个 CPU 维护的粒子 {x,y,r,color,vy,vxAmp,vxPhase,life,age}。
 *   每帧 RAF tick：
 *     y += vy（重力）
 *     x += sin(age*omega + phase) * vxAmp  （水平蛇形扭动）
 *     r 带轻微脉动
 *     age++; alpha 用 1 - age/life
 *   渲染：用现有 painter.drawBrush 画一个圆形软笔刷（复用 circle/soft 类型）
 *
 *   寿命/重力随当前湿度（_wetness 0~1）线性映射；湿度=0 → 完全跳过。
 *
 * 三层启停门控：DeviceProfile.DRIP_ENABLED / PerfWatchdog / painter._dripUserPref
 */

const DRIP_USER_PREF_KEY = 'drip_user_pref_v1';

// ─── 启停决策 ────────────────────────────────────────────────────────────────

function _initDripCapable() {
    const profileOk = (typeof DeviceProfile !== 'undefined' && DeviceProfile.DRIP_ENABLED);
    let userPref = null;
    try {
        const v = localStorage.getItem(DRIP_USER_PREF_KEY);
        if (v === '1') userPref = true;
        else if (v === '0') userPref = false;
    } catch (e) {}
    this._dripUserPref = userPref;
    this._dripCapable = userPref === true || profileOk;
    this._dripParticles = [];
    this._dripSpawnAccumPx = 0;     // 自上次 spawn 以来累计走过的笔触距离
    this._dripLastSpawnXY = null;
}

function _shouldRunDrip() {
    if (!this._dripCapable) return false;
    const pref = this._dripUserPref;
    if (pref === false) return false;
    if (pref === true)  return true;
    if (typeof PerfWatchdog !== 'undefined') {
        return PerfWatchdog.shouldRun('drip');
    }
    return true;
}

// ─── 笔触期间生成水滴 ────────────────────────────────────────────────────────

/**
 * 由 drawBrush wrapper 在每个采样点调用。
 * 水彩笔触时根据距离闸门按概率生成水滴起点。
 *
 * @param {number} x 当前采样点 x（画布坐标）
 * @param {number} y 当前采样点 y
 * @param {number} brushSize 笔刷直径
 * @param {{r,g,b}} colorRGB 笔刷色（0~1）
 */
function _maybeSpawnDripParticles(x, y, brushSize, colorRGB) {
    if (!this._shouldRunDrip()) return;
    const wet = this._wetness ?? 0.5;
    if (wet < 0.01) return;          // 湿度 0：完全关闭

    // 距离闸门：自上次 spawn 走的总长度 ≥ 间隔才触发
    if (this._dripLastSpawnXY) {
        const dx = x - this._dripLastSpawnXY.x;
        const dy = y - this._dripLastSpawnXY.y;
        this._dripSpawnAccumPx += Math.sqrt(dx * dx + dy * dy);
    }
    this._dripLastSpawnXY = { x, y };

    const spawnInterval = DRIP_SPAWN_INTERVAL_PX_BASE
        + (DRIP_SPAWN_INTERVAL_PX_RANGE * (1 - wet));    // 湿度低 → 间隔更稀
    if (this._dripSpawnAccumPx < spawnInterval) return;
    this._dripSpawnAccumPx = 0;

    // 用与水彩笔刷一致的 35 颗粒分布生成虚拟候选位置（极坐标 sqrt 半径，向中心聚集）
    // 不需要画到 canvas，只取位置；从中随机抽 1~2 个当水滴起点
    const radius = brushSize / 2;
    const distScale = (typeof WC_REF_SIZE !== 'undefined' && brushSize > WC_REF_SIZE)
        ? Math.sqrt(WC_REF_SIZE / brushSize) : 1;
    const candCount = (typeof WC_DOT_COUNT !== 'undefined') ? WC_DOT_COUNT : 35;
    const distRange = (typeof WC_DIST_RANGE !== 'undefined') ? WC_DIST_RANGE : 0.8;

    const pickCount = DRIP_CLUSTER_MIN
        + Math.floor(Math.random() * (DRIP_CLUSTER_MAX - DRIP_CLUSTER_MIN + 1));
    const dropMaxLife = DRIP_LIFE_MIN + (DRIP_LIFE_MAX - DRIP_LIFE_MIN) * wet;
    const dropGravity = DRIP_GRAVITY_MIN + (DRIP_GRAVITY_MAX - DRIP_GRAVITY_MIN) * wet;

    // 限制活跃粒子总数（避免长笔触爆量）；上限随湿度浮动
    const maxParticles = Math.round(
        DRIP_MAX_PARTICLES_MIN + (DRIP_MAX_PARTICLES_MAX - DRIP_MAX_PARTICLES_MIN) * wet
    );
    if (this._dripParticles.length >= maxParticles) return;

    for (let i = 0; i < pickCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.sqrt(Math.random()) * radius * distRange * distScale;
        const px = x + Math.cos(angle) * dist;
        const py = y + Math.sin(angle) * dist;

        const r0 = radius * (DRIP_PARTICLE_R_MIN + Math.random() * DRIP_PARTICLE_R_RANGE);
        this._dripParticles.push({
            x: px,
            y: py,
            r: r0,
            color: { r: colorRGB.r, g: colorRGB.g, b: colorRGB.b },
            vy: dropGravity * (0.7 + Math.random() * 0.6),    // 个体差异
            vxAmp: DRIP_VX_AMP_PX * (0.3 + Math.random() * 1.4),
            vxOmega: DRIP_VX_OMEGA * (0.6 + Math.random() * 0.8),
            vxPhase: Math.random() * Math.PI * 2,
            life: dropMaxLife,
            age: 0,
            // 上次落章位置：初始化为 spawn 位置，下一次走够 r * spacing 才画
            lastStampX: px,
            lastStampY: py,
            stamped: false,   // 标记是否已经画过至少一次（保证 spawn 时立即画一颗）
        });
    }
}

// ─── 每帧 tick：更新粒子 + 渲染 ──────────────────────────────────────────────

function _stepDripParticles() {
    if (!this._dripCapable) return;
    if (!this._dripParticles || this._dripParticles.length === 0) return;
    if (!this._shouldRunDrip()) {
        this._dripParticles.length = 0;
        return;
    }

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const arr = this._dripParticles;
    let writeIdx = 0;
    for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        p.age++;
        if (p.age >= p.life) continue;     // 寿命到 → 丢弃

        p.y += p.vy;
        p.x += Math.sin(p.age * p.vxOmega + p.vxPhase) * p.vxAmp * 0.1;
        // 半径轻微脉动（随机走，不离原值太远）
        p.r += (Math.random() - 0.5) * DRIP_PARTICLE_R_PULSE;
        if (p.r < 1.5) p.r = 1.5;

        // 出画布上下边 → 丢弃
        if (p.y < -p.r || p.y > ch + p.r || p.x < -p.r || p.x > cw + p.r) continue;

        if (writeIdx !== i) arr[writeIdx] = p;
        writeIdx++;
    }
    arr.length = writeIdx;

    if (arr.length === 0) return;

    // 渲染策略：粒子用"距离打章"代替"每帧画"——每颗粒子走够 r * STAMP_SPACING 才画一颗印章。
    // 这样：
    //   1) 同一像素不会被反复盖，wetHeatmap 不会饱和到触发 dilute 把水滴洗白
    //   2) 视觉上像真水滴边滴边走，离散印章串而非连续液柱
    // 颜色用粒子自带 p.color（在 spawn 时锁定），下一笔不会改变上一笔残留水滴的颜色。
    // 不调 _applyWetColor：那会用全局 _wetColor 覆盖所有水滴的颜色（多色混画时串色）。
    if (!this._dripBrushCanvas) {
        this._dripBrushCanvas = _createSoftDropBrushCanvas(64);
    }
    const brushCanvas = this._dripBrushCanvas;
    const origMixStrength = this.baseMixStrength;

    for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        const dx = p.x - p.lastStampX;
        const dy = p.y - p.lastStampY;
        const moved = Math.sqrt(dx * dx + dy * dy);
        const stampThreshold = p.r * DRIP_STAMP_SPACING_FACTOR;
        if (p.stamped && moved < stampThreshold) continue;   // 没走够 → 跳过本帧

        // 浓度按寿命线性衰减（年纪越大越淡，模拟颜料在纸上扩散稀释）
        const t = 1.0 - p.age / p.life;
        const alpha = Math.max(0, t) * DRIP_DRAW_STRENGTH;
        if (alpha < 0.005) continue;
        this.baseMixStrength = origMixStrength * alpha;

        // isWatercolor=false：粒子不注入 wetHeatmap/wetMask/deposit，
        // 避免新笔触落下时被全屏 _applyWetColor 用新色污染旧水滴的浓度。
        // drawBrush 主 shader 仍走 mixbox/km 真实混色（融合下方画布颜色）。
        this.drawBrush(
            p.x, p.y, p.r * 2,
            p.color, brushCanvas,
            1,                          // useFalloff = 径向衰减（软圆形状）
            { x: 0, y: 0 }, 0,
            false, 1.0, false, 0, 0,
            0, 0, false
        );
        p.lastStampX = p.x;
        p.lastStampY = p.y;
        p.stamped = true;
    }
    this.baseMixStrength = origMixStrength;
}

/** 生成一个软圆 canvas 当水滴笔刷。 */
function _createSoftDropBrushCanvas(size) {
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return cv;
}

// ─── Debug 命令 ──────────────────────────────────────────────────────────────

function toggleDrip(value) {
    let next;
    if (value === undefined) {
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
    if (next === false) this._dripParticles.length = 0;

    const label = next === null ? 'auto' : (next ? '强制开' : '强制关');
    console.log(`[toggleDrip] ${label}（capable=${this._dripCapable}, watchdog=${typeof PerfWatchdog !== 'undefined' ? PerfWatchdog.getPhase('drip') : 'n/a'}, particles=${this._dripParticles.length}）`);
}

function debugDripHeatmap() {
    console.log(`[drip] 当前粒子数=${this._dripParticles.length}`,
        this._dripParticles.slice(0, 5));
}

// ─── 注册到 BaseWebGLPainter.prototype ───────────────────────────────────────

Object.assign(BaseWebGLPainter.prototype, {
    _initDripCapable,
    _shouldRunDrip,
    _maybeSpawnDripParticles,
    _stepDripParticles,
    toggleDrip,
    debugDripHeatmap,
});

console.log('drip.js (particle) 加载成功');
