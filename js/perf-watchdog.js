/**
 * perf-watchdog.js — GPU 预算守门员
 *
 * 通用机制：在某个特性运行的帧 vs 不运行的帧之间做 A/B 实测，
 * 用 EMA 帧时差判断特性是否拖慢，超阈值自动降级。
 *
 * 不依赖 EXT_disjoint_timer_query（手机端支持率低），用 RAF tick 整体帧时近似。
 *
 * 当前唯一用户：drip（湿区流动）。未来可扩展给纸纹凹凸、湿区反光等。
 *
 * 用法：
 *   PerfWatchdog.register('drip', {
 *       budgetMs: 4,                  // 特性允许增加的最大平均帧时（ms）
 *       sampleFrames: 60,             // 每段 A/B 各采样多少帧
 *       warmupMs: 5000,               // 启动后多久开始测（避免首笔抖动）
 *       onDowngrade: () => {...},     // 实测超预算时回调
 *   });
 *   每帧 tick：PerfWatchdog.beginFrame('drip', isFeatureActive);
 *              ... 跑特性 pass ...
 *              PerfWatchdog.endFrame('drip');
 *   sessionStorage 缓存判定结果，本会话不重测。
 */
(function(global) {
    const KEY_PREFIX = 'perfwatchdog_v1_';
    const watchers = Object.create(null);
    const startTs = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    function _cacheKey(name) { return KEY_PREFIX + name; }

    function _readCache(name) {
        try {
            const v = sessionStorage.getItem(_cacheKey(name));
            return v === null ? null : v === '1';
        } catch (e) { return null; }
    }

    function _writeCache(name, ok) {
        try { sessionStorage.setItem(_cacheKey(name), ok ? '1' : '0'); } catch (e) {}
    }

    function register(name, opts) {
        opts = opts || {};
        const cached = _readCache(name);
        watchers[name] = {
            name,
            budgetMs: opts.budgetMs ?? 4,
            sampleFrames: opts.sampleFrames ?? 60,
            warmupMs: opts.warmupMs ?? 5000,
            onDowngrade: opts.onDowngrade || function () {},
            // 状态：cached=已下结论；measuring=采样中；done=本会话完成
            phase: cached === false ? 'done-fail'
                 : cached === true  ? 'done-pass'
                 : 'pending',
            // 采样状态
            activeSum: 0, activeCount: 0,
            inactiveSum: 0, inactiveCount: 0,
            tToggle: 0,            // 当前段已经采样的帧数（满 sampleFrames 切换）
            currentMode: 'inactive', // 当前段在测哪一边（active/inactive）
            // 帧时打点
            frameStart: 0,
        };
        return watchers[name].phase;
    }

    function shouldRun(name) {
        const w = watchers[name];
        if (!w) return true;
        // 已判定失败 → 不再跑；其余阶段都跑（包括 measuring 期间，靠对照采样）
        return w.phase !== 'done-fail';
    }

    /**
     * 在特性 pass 跑之前调一次。featureActive=本帧实际是否会跑特性（用于 A/B 切换）。
     * 注：A/B 阶段会临时强行关闭特性几帧来取对照，调用方需检查 PerfWatchdog.isMeasuringInactive()。
     */
    function beginFrame(name, featureActive) {
        const w = watchers[name];
        if (!w) return;
        if (w.phase.startsWith('done')) return;
        if ((performance.now() - startTs) < w.warmupMs) return;

        // 进入采样阶段
        if (w.phase === 'pending') {
            w.phase = 'measuring';
            w.currentMode = 'active';
            w.tToggle = 0;
        }
        w.frameStart = performance.now();
    }

    function endFrame(name) {
        const w = watchers[name];
        if (!w || w.phase !== 'measuring') return;
        const dt = performance.now() - w.frameStart;
        // 抛弃明显异常的帧（>50ms 通常是 tab 切换 / GC）
        if (dt > 50 || dt <= 0) return;

        if (w.currentMode === 'active') {
            w.activeSum += dt; w.activeCount++;
        } else {
            w.inactiveSum += dt; w.inactiveCount++;
        }
        w.tToggle++;

        if (w.tToggle >= w.sampleFrames) {
            w.tToggle = 0;
            if (w.currentMode === 'active') {
                w.currentMode = 'inactive';
            } else {
                // 一轮 A/B 完成，做判定
                const avgActive = w.activeSum / Math.max(1, w.activeCount);
                const avgInactive = w.inactiveSum / Math.max(1, w.inactiveCount);
                const overhead = avgActive - avgInactive;
                const pass = overhead <= w.budgetMs;
                w.phase = pass ? 'done-pass' : 'done-fail';
                _writeCache(w.name, pass);
                console.log(`[PerfWatchdog:${w.name}] active=${avgActive.toFixed(2)}ms inactive=${avgInactive.toFixed(2)}ms overhead=${overhead.toFixed(2)}ms budget=${w.budgetMs}ms → ${pass ? 'PASS' : 'FAIL（自动降级）'}`);
                if (!pass) {
                    try { w.onDowngrade(); } catch (e) { console.error(e); }
                }
            }
        }
    }

    /**
     * 给调用方判断：当前帧是否处于"对照组"（应该跳过特性 pass）。
     * 在 measuring 且 currentMode=inactive 时返回 true。
     */
    function isMeasuringInactive(name) {
        const w = watchers[name];
        return !!(w && w.phase === 'measuring' && w.currentMode === 'inactive');
    }

    function getPhase(name) {
        const w = watchers[name];
        return w ? w.phase : 'unregistered';
    }

    /** 清空缓存，下次会话重新测（debug 用）。 */
    function reset(name) {
        try {
            if (name) sessionStorage.removeItem(_cacheKey(name));
            else {
                for (let i = sessionStorage.length - 1; i >= 0; i--) {
                    const k = sessionStorage.key(i);
                    if (k && k.startsWith(KEY_PREFIX)) sessionStorage.removeItem(k);
                }
            }
        } catch (e) {}
        if (name && watchers[name]) {
            const w = watchers[name];
            w.phase = 'pending';
            w.activeSum = w.activeCount = w.inactiveSum = w.inactiveCount = 0;
            w.tToggle = 0;
        }
    }

    global.PerfWatchdog = {
        register, shouldRun, beginFrame, endFrame,
        isMeasuringInactive, getPhase, reset,
    };
    console.log('perf-watchdog.js 加载成功');
})(window);
