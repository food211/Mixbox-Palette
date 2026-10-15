// node tests/storage-performance.cjs <original-base-painter.js> [results.json]
// Uses Playwright and a local app server; CHROMIUM_PATH selects an installed browser.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const changedMethods = ['_readPixelsForStorage', '_readCanvasToCPU', '_syncReadFrameToCPU', 'toDataURL', 'toDataURLAsync'];
function readPainter(file) {
    const source = fs.readFileSync(file, 'utf8');
    const context = vm.createContext({ window: {}, document: { currentScript: null }, console: { log() {} } });
    vm.runInContext(source, context);
    const prototype = context.window.BaseWebGLPainter.prototype;
    return { hash: createHash('sha256').update(source).digest('hex'),
        methods: Object.fromEntries(Object.getOwnPropertyNames(prototype).filter(k => k !== 'constructor').map(k => [k, prototype[k].toString()])) };
}
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
(async () => {
    if (!process.argv[2]) throw new Error('Usage: node tests/storage-performance.cjs <original-base-painter.js> [results.json]');
    const baseline = readPainter(process.argv[2]);
    const candidate = readPainter(process.env.PALETTE_CANDIDATE_FILE || path.join(__dirname, '..', 'js', 'base-painter.js'));
    assert.notEqual(candidate.hash, baseline.hash, 'Candidate must differ from baseline');
    for (const [name, source] of Object.entries(baseline.methods)) {
        if (!changedMethods.includes(name) && !['_scheduleIdleBackup', '_ensureHistoryWorker', '_workerRequest'].includes(name)) assert.equal(candidate.methods[name], source, `${name} must remain unchanged`);
    }
    const selected = painter => Object.fromEntries(changedMethods.filter(k => painter.methods[k]).map(k => [k, painter.methods[k]]));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
    const result = { browser: await browser.version(), baseline: baseline.hash, candidate: candidate.hash,
        unchangedMethods: Object.keys(baseline.methods).filter(k => !changedMethods.includes(k) && !['_scheduleIdleBackup', '_ensureHistoryWorker', '_workerRequest'].includes(k)),
        conditions: { warmupsPerVariant: 3, repetitionsPerVariant: 9, cpuFramesPerSample: 10,
            order: 'alternating AB/BA pairs', memory: 'heap/process memory not measured' }, runs: [] };
    try {
        for (const width of [480, 960, 1440]) {
            const context = await browser.newContext({ locale: 'en-US' });
            try {
                const page = await context.newPage();
                await page.addInitScript(w => localStorage.setItem('mixbox_container_width', String(w)), width);
                await page.route('**/js/announcer.js', r => r.fulfill({ contentType: 'application/javascript', body: 'window.Announcer={init(){},checkUpdate(){}};' }));
                await page.goto(process.env.PALETTE_TEST_URL || 'http://127.0.0.1:8765/app.html');
                await page.waitForFunction(() => typeof painter !== 'undefined' && painter && document.querySelector('#paletteDropdown button'));
                const run = await page.evaluate(async ({ baseline, candidate, conditions }) => {
                    const p = painter, gl = p.gl, w = p.canvas.width, h = p.canvas.height;
                    for (const task of FrameScheduler._list()) FrameScheduler.setActive(task.name, false);
                    p.notifyStrokeStart(); // keep idle backups out of controlled data-transfer measurements
                    function compile(methods) {
                        return Object.fromEntries(Object.entries(methods).map(([k, source]) => {
                            const expression = source.startsWith('async ') ? 'async function ' + source.slice(6) : 'function ' + source;
                            return [k, new Function('return ' + expression)()];
                        }));
                    }
                    const variants = { baseline: compile(baseline), candidate: compile(candidate) };
                    const apply = variant => Object.assign(p, variants[variant]);
                    const bytes = new Uint8ClampedArray(w * h * 4);
                    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                        const i = (y * w + x) * 4;
                        bytes[i] = Math.round(x / w * 255); bytes[i + 1] = Math.round(y / h * 255);
                        bytes[i + 2] = (x + y) % 256; bytes[i + 3] = 255;
                    }
                    p.writeFromPixels(bytes, w, h);
                    const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
                        .map(v => v.toString(16).padStart(2, '0')).join('');
                    const sourceHash = await hash(p.readPixelRegion(0, 0, w, h));
                    async function decode(url) {
                        const image = await createImageBitmap(await (await fetch(url)).blob());
                        const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d');
                        ctx.drawImage(image, 0, 0); image.close();
                        return hash(ctx.getImageData(0, 0, w, h).data);
                    }
                    const validation = {};
                    for (const variant of ['baseline', 'candidate']) {
                        apply(variant);
                        const frame = {}; p._readCanvasToCPU(frame);
                        const syncPNG = p.toDataURL('image/png');
                        const asyncPNG = await p.toDataURLAsync('image/png');
                        const webp = await p.toDataURLAsync('image/webp', 1);
                        const Offscreen = window.OffscreenCanvas, workerRequest = p._workerRequest;
                        let fallback;
                        try {
                            window.OffscreenCanvas = undefined;
                            p._workerRequest = () => Promise.reject(new Error('worker unavailable for DOM fallback'));
                            fallback = await p.toDataURLAsync('image/webp', 1);
                        } finally { window.OffscreenCanvas = Offscreen; p._workerRequest = workerRequest; }
                        const concurrent = await Promise.all([p.toDataURLAsync('image/png'), p.toDataURLAsync('image/png')]);
                        if (concurrent[0] !== asyncPNG || concurrent[1] !== asyncPNG) throw new Error('Concurrent exports differ');
                        p.clearHistory(); p.pushHistoryFrame();
                        const history = p._history[0]; p._syncReadFrameToCPU(history);
                        const historyHash = await hash(history.cpuPixels);
                        await p._compressFrame(history);
                        if (!history.cpuBlob) throw new Error('History compression did not complete');
                        if (history.gpuSlot) { p._gpuFreeSlots.push(history.gpuSlot); history.gpuSlot = null; }
                        p._decompressCache.clear();
                        if (!await p.restoreHistoryFrame(0)) throw new Error('Compressed history restore failed');
                        const restoredHash = await hash(p.readPixelRegion(0, 0, w, h));
                        p.clearHistory();
                        validation[variant] = { frameHash: await hash(frame.cpuPixels), syncPNGHash: await decode(syncPNG),
                            asyncPNGHash: await decode(asyncPNG), webpHash: await decode(webp), fallbackHash: await decode(fallback),
                            historyHash, restoredHash, sourceHash: await hash(p.readPixelRegion(0, 0, w, h)) };
                        if (Object.values(validation[variant]).some(value => value !== sourceHash)) throw new Error(`${variant}: storage roundtrip changed data`);
                    }
                    // No GPU work in this diagnostic: both methods receive the same simulated readback bytes.
                    const mockGL = { FRAMEBUFFER: gl.FRAMEBUFFER, RGBA: gl.RGBA, UNSIGNED_BYTE: gl.UNSIGNED_BYTE,
                        bindFramebuffer() {}, readPixels(x, y, w, h, format, type, out) { out.set(bytes); } };
                    const workloads = {
                        cpuReorder10Frames() {
                            p.gl = mockGL;
                            try { for (let i = 0; i < conditions.cpuFramesPerSample; i++) p._readCanvasToCPU({}); }
                            finally { p.gl = gl; }
                        },
                        gpuReadbackOneFrame() { p._readCanvasToCPU({}); },
                        synchronousPNG() { p.toDataURL('image/png'); },
                        asynchronousWebP() { return p.toDataURLAsync('image/webp', 1); },
                        applicationSave() { saveCanvasToStorage(); return flushCanvasSave(); },
                        workerCompressAndDecompress() {
                            const copy = bytes.buffer.slice(0);
                            return p._workerRequest({ type: 'compress', pixels: copy, w, h }, [copy]).then(blob =>
                                p._workerRequest({ type: 'decompress', blob, w, h }));
                        }
                    };
                    async function measure(work) {
                        const start = performance.now();
                        const pending = work();
                        const blockingMs = performance.now() - start;
                        if (pending?.then) await pending;
                        if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error during storage benchmark');
                        return { blockingMs, completionMs: performance.now() - start };
                    }
                    const metrics = {};
                    for (const [name, work] of Object.entries(workloads)) {
                        for (let i = 0; i < conditions.warmupsPerVariant; i++) for (const variant of ['baseline', 'candidate']) {
                            apply(variant); await measure(work);
                        }
                        const samples = { baseline: [], candidate: [] };
                        for (let i = 0; i < conditions.repetitionsPerVariant; i++) {
                            for (const variant of i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
                                apply(variant); samples[variant].push(await measure(work));
                            }
                        }
                        metrics[name] = samples;
                    }
                    const renderer = gl.getExtension('WEBGL_debug_renderer_info');
                    return { canvas: [w, h], renderer: renderer ? gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                        validation, sourceHash, metrics };
                }, { baseline: selected(baseline), candidate: selected(candidate), conditions: result.conditions });
                assert.deepEqual(run.validation.candidate, run.validation.baseline);
                run.summary = Object.fromEntries(Object.entries(run.metrics).map(([name, samples]) => [name,
                    Object.fromEntries(Object.entries(samples).map(([variant, values]) => [variant,
                        { blockingMedianMs: median(values.map(v => v.blockingMs)), completionMedianMs: median(values.map(v => v.completionMs)) }]))]));
                result.runs.push(run);
                for (const [name, values] of Object.entries(run.summary)) console.log(`${run.canvas.join('x')} ${name}: blocking ${values.baseline.blockingMedianMs.toFixed(2)} -> ${values.candidate.blockingMedianMs.toFixed(2)} ms; total ${values.baseline.completionMedianMs.toFixed(2)} -> ${values.candidate.completionMedianMs.toFixed(2)} ms`);
            } finally { await context.close(); }
        }
        if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
        else console.log(JSON.stringify(result, null, 2));
        console.log('PASS: exact data roundtrips, unchanged rendering methods and paired storage benchmarks');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
