/**
 * Frame Scheduler — 统一渲染循环
 *
 * 把分散的持续性 RAF 循环（热度衰减、水彩沉积、pointermove 绘制等）
 * 合并到单一 RAF tick，按优先级顺序执行。
 *
 * 用法：
 *   FrameScheduler.register('heatmap-fade', (dt) => {...}, 40);
 *   FrameScheduler.setActive('heatmap-fade', false);   // 暂停但保留注册
 *   FrameScheduler.unregister('heatmap-fade');         // 彻底移除
 *
 * 优先级约定（数字越小越先执行）：
 *   10  stroke-draw       pointermove 合批绘制
 *   20  wet-diffusion     水彩扩散
 *   30  deposit-color     松笔沉积
 *   40  heatmap-fade      热度衰减
 *   50  默认
 *
 * dt 参数单位 ms；首帧为 0。
 */
(function(global) {
    const tasks = new Map();   // name -> { fn, priority, active }
    let sortedCache = null;    // 按 priority 排序的数组，tasks 变动时失效
    let rafId = 0;
    let lastTick = 0;

    function _invalidateSort() { sortedCache = null; }

    function _sorted() {
        if (!sortedCache) {
            sortedCache = [...tasks.values()].sort((a, b) => a.priority - b.priority);
        }
        return sortedCache;
    }

    function _hasActive() {
        for (const t of tasks.values()) if (t.active) return true;
        return false;
    }

    function _tick(now) {
        const dt = lastTick ? (now - lastTick) : 0;
        lastTick = now;

        for (const t of _sorted()) {
            if (!t.active) continue;
            try {
                t.fn(dt);
            } catch (e) {
                console.error('[FrameScheduler]', t.name, 'threw:', e);
            }
        }

        if (_hasActive()) {
            rafId = requestAnimationFrame(_tick);
        } else {
            rafId = 0;
            lastTick = 0;
        }
    }

    function _ensureRunning() {
        if (!rafId) {
            lastTick = 0;
            rafId = requestAnimationFrame(_tick);
        }
    }

    const FrameScheduler = {
        register(name, fn, priority = 50) {
            if (typeof fn !== 'function') throw new Error('[FrameScheduler] fn must be function');
            tasks.set(name, { name, fn, priority, active: true });
            _invalidateSort();
            _ensureRunning();
        },

        unregister(name) {
            if (tasks.delete(name)) _invalidateSort();
        },

        setActive(name, active) {
            const t = tasks.get(name);
            if (!t) return;
            t.active = !!active;
            if (t.active) _ensureRunning();
        },

        has(name) { return tasks.has(name); },

        // 调试用
        _list() {
            return [...tasks.values()].map(t => ({ name: t.name, priority: t.priority, active: t.active }));
        }
    };

    global.FrameScheduler = FrameScheduler;
})(window);
