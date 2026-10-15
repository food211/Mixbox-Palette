const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ window: {}, document: { currentScript: null },
    console: { log() {}, error() {} }, Uint8Array, Uint8ClampedArray });
vm.runInContext(fs.readFileSync(process.env.PALETTE_CANDIDATE_FILE || path.join(__dirname, '..', 'js', 'base-painter.js'), 'utf8'), context);
const Painter = context.window.BaseWebGLPainter;

function fixture(w, h) {
    const raw = Uint8Array.from({ length: w * h * 4 }, (_, i) => (i * 71 + 13) % 256);
    const bindings = [];
    let reads = 0;
    const painter = Object.create(Painter.prototype);
    painter.canvas = { width: w, height: h };
    painter.framebuffers = { canvas: 'canvas-fb' };
    painter._cancelIdleBackup = () => {};
    painter.gl = { FRAMEBUFFER: 1, RGBA: 2, UNSIGNED_BYTE: 3,
        bindFramebuffer(target, fb) { bindings.push(fb); },
        readPixels(x, y, width, height, format, type, out) {
            assert.deepEqual([x, y, width, height, format, type], [0, 0, w, h, 2, 3]);
            reads++; out.set(raw);
        }
    };
    const expected = new Uint8ClampedArray(raw.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) expected[y * w * 4 + x] = raw[(h - 1 - y) * w * 4 + x];
    return { painter, raw, expected, bindings, get reads() { return reads; } };
}

for (const [w, h] of [[1, 1], [1, 3], [3, 2], [5, 7], [17, 16]]) {
    test(`storage readback preserves every RGBA byte at ${w}x${h}`, () => {
        const f = fixture(w, h);
        const original = f.raw.slice();
        const frame = {};
        f.painter._readCanvasToCPU(frame);
        assert(frame.cpuPixels instanceof Uint8ClampedArray);
        assert.deepEqual(frame.cpuPixels, f.expected);
        assert.equal(frame.cpuReady, true);
        assert.deepEqual(f.raw, original);
        const saved = frame.cpuPixels.slice();
        f.raw.fill(0);
        const next = {}; f.painter._readCanvasToCPU(next);
        assert.deepEqual(frame.cpuPixels, saved, 'a later snapshot must not overwrite an earlier one');
        assert.deepEqual(next.cpuPixels, new Uint8ClampedArray(w * h * 4));
        assert.equal(f.bindings.at(-1), null);
    });
}

test('GPU history readback uses its own framebuffer and preserves ready frames', () => {
    const f = fixture(7, 5), frame = { gpuSlot: { fb: 'history-fb' } };
    f.painter._syncReadFrameToCPU(frame);
    assert.deepEqual(frame.cpuPixels, f.expected);
    assert.equal(f.bindings[0], 'history-fb');
    assert.equal(frame.cpuReady, true);
    f.painter._syncReadFrameToCPU(frame);
    assert.equal(f.reads, 1);
});

test('failed storage readback unbinds the framebuffer and leaves the frame unready', () => {
    const f = fixture(3, 3);
    f.painter.gl.readPixels = () => { throw new Error('readback failed'); };
    const frame = {}; f.painter._readCanvasToCPU(frame);
    assert.equal(frame.cpuReady, undefined);
    assert.equal(frame.cpuPixels, undefined);
    assert.equal(f.bindings.at(-1), null);
});
