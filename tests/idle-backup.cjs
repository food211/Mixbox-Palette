const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(useIdleCallback = true) {
    let sequence = 0;
    const idle = new Map(), timers = new Map(), reads = [];
    let compressions = 0;
    const context = vm.createContext({
        window: {}, document: { currentScript: null }, console: { log() {} },
        STROKE_QUIET_DELAY_MS: 250, IDLE_BACKUP_TIMEOUT_MS: 5000, IDLE_BACKUP_FALLBACK_MS: 200,
        setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
        ...(useIdleCallback ? {
            requestIdleCallback(fn) { const id = ++sequence; idle.set(id, fn); return id; },
            cancelIdleCallback(id) { idle.delete(id); }
        } : {})
    });
    vm.runInContext(fs.readFileSync(process.env.PALETTE_CANDIDATE_FILE || path.join(__dirname, '..', 'js', 'base-painter.js'), 'utf8'), context);
    const painter = Object.create(context.window.BaseWebGLPainter.prototype);
    Object.assign(painter, { _pendingIdle: new Map(), _idleBackupScheduled: false,
        _strokeActive: false, _quietDelayHandle: null, _backupDeferred: false,
        _disposed: false, _history: [{ id: 1, gpuSlot: {} }, { id: 2, gpuSlot: {} }], _historyStep: 1,
        _idleBackupFrameDirect(frame) { reads.push(frame.id); frame.cpuReady = true; this._pendingIdle.delete(frame.id); return true; },
        _maybeCompressOldFrames() { compressions++; }
    });
    function runIdle() {
        const queue = useIdleCallback ? idle : timers;
        const [id, callback] = queue.entries().next().value;
        queue.delete(id);
        (useIdleCallback ? callback : callback.fn)();
    }
    function runQuiet() {
        const [id, entry] = [...timers].find(([, t]) => t.delay === 250);
        timers.delete(id); entry.fn();
    }
    return { painter, idle, timers, reads, runIdle, runQuiet,
        get compressions() { return compressions; },
        get queued() { return useIdleCallback ? idle.size : [...timers.values()].filter(t => t.delay === 200).length; } };
}

for (const useIdleCallback of [true, false]) {
    test(`queued ${useIdleCallback ? 'idle' : 'timeout'} backup waits if drawing resumes before execution`, () => {
        const f = fixture(useIdleCallback), p = f.painter;
        p._scheduleIdleBackup(p._history[0]);
        p._scheduleIdleBackup(p._history[1]);
        assert.equal(f.queued, 1, 'all frames share one callback');
        p.notifyStrokeStart();
        f.runIdle();
        assert.deepEqual(f.reads, [], 'queued callback must not read GPU history during a stroke');
        assert.equal(f.compressions, 0, 'compression preparation also waits');
        assert.equal(p._idleBackupScheduled, false);
        assert.equal(p._backupDeferred, true);
        assert.equal(p._pendingIdle.size, 2, 'both frames remain pending');
        assert.equal(p._pendingIdle.get(1).type, 'shared', 'executed handle must not remain cancellable');
        p._cancelIdleBackup(p._history[0]);
        assert.equal(f.queued, 0, 'cancelling a completed handle must not queue another callback');
        p.notifyStrokeEnd();
        assert.equal(f.queued, 0);
        assert.deepEqual([...f.timers.values()].map(t => t.delay), [250], 'existing quiet period is unchanged');
        f.runQuiet();
        assert.equal(f.queued, 1);
        f.runIdle(); f.runIdle();
        assert.deepEqual(f.reads, [1, 2], 'existing farthest-first ordering and all history data survive');
        assert(p._history.every(frame => frame.cpuReady));
        assert.equal(f.queued, 0);
        assert.equal(p._pendingIdle.size, 0);
    });
}

test('new strokes cancel the quiet period and disposed painters do no backup work', () => {
    const f = fixture(), p = f.painter;
    p.notifyStrokeStart(); p._scheduleIdleBackup(p._history[1]); p.notifyStrokeEnd();
    assert.equal(f.timers.size, 1);
    p.notifyStrokeStart();
    assert.equal(f.timers.size, 0);
    assert.equal(f.queued, 0);
    p.notifyStrokeEnd(); f.runQuiet();
    p._disposed = true; f.runIdle();
    assert.deepEqual(f.reads, []);
    assert.equal(f.compressions, 0);
});
