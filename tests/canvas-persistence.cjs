// Serve the repository first, then: node --test tests/canvas-persistence.cjs
// Requires Playwright; CHROMIUM_PATH can select an installed Chromium browser.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const url = process.env.PALETTE_TEST_URL || 'http://127.0.0.1:8765/app.html';
let browser;

before(async () => {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
});
after(async () => { if (browser) await browser.close(); });

async function withPage(run) {
    const context = await browser.newContext({ locale: 'en-US' });
    try {
        const page = await context.newPage();
        await page.route('**/js/announcer.js', route => route.fulfill({
            contentType: 'application/javascript',
            body: 'window.Announcer = {init(){}, checkUpdate(){}};'
        }));
        await page.goto(url);
        await page.waitForFunction(() => typeof painter !== 'undefined' && painter &&
            painter.getHistoryLength() > 0 && document.querySelector('#paletteDropdown button'));
        await run(page);
    } finally { await context.close(); }
}

for (const direction of ['undo', 'redo']) {
    test(`${direction} survives autosave and reload`, { timeout: 30000 }, async () => {
        await withPage(async page => {
            await page.evaluate(async direction => {
                painter.clearHistory();
                painter.clear(CANVAS_BG);
                painter.pushHistoryFrame();
                painter.clear({ r: 1, g: 0, b: 0 });
                painter.pushHistoryFrame();
                updateHistoryButtons();
                if (direction === 'redo') await restoreState(0);
                // Persist the starting frame so the tested history action must save a change.
                saveCanvasToStorage();
                await flushCanvasSave();
            }, direction);
            await page.locator(`#${direction}Btn`).click();
            await page.waitForFunction(step => painter.getHistoryStep() === step, direction === 'undo' ? 0 : 1);
            await page.evaluate(() => flushCanvasSave());
            const restored = page.waitForEvent('console', message => message.text().includes('画布内容已从快照恢复'));
            await page.reload();
            await restored;
            assert.deepEqual(await page.evaluate(() => painter.readPixelByte(100, 100)),
                direction === 'undo' ? { r: 255, g: 255, b: 255 } : { r: 255, g: 0, b: 0 });
        });
    });
}

test('a failed storage write remains dirty and can be retried', { timeout: 30000 }, async () => {
    await withPage(async page => {
        const result = await page.evaluate(async () => {
            const setItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
                if (key === paletteStorage.key) throw new DOMException('Simulated quota error', 'QuotaExceededError');
                return setItem.call(this, key, value);
            };
            saveCanvasToStorage();
            await _doSave();
            const dirtyAfterFailure = _canvasDirty;
            Storage.prototype.setItem = setItem;
            await flushCanvasSave();
            return { dirtyAfterFailure, dirtyAfterRetry: _canvasDirty,
                stored: !!localStorage.getItem(paletteStorage.key) };
        });
        assert.deepEqual(result, { dirtyAfterFailure: true, dirtyAfterRetry: false, stored: true });
    });
});

test('reload saves synchronously while an async encoding is pending', { timeout: 30000 }, async () => {
    await withPage(async page => {
        const inFlight = await page.evaluate(async () => {
            painter.clear(CANVAS_BG);
            saveCanvasToStorage();
            await flushCanvasSave();
            painter.clear({ r: 1, g: 0, b: 0 });
            // Hold only the asynchronous encoder; unload must save the actual new canvas.
            painter.toDataURLAsync = () => new Promise(() => {});
            saveCanvasToStorage();
            void _doSave();
            return _saveInFlight;
        });
        assert.equal(inFlight, true);
        const restored = page.waitForEvent('console', message => message.text().includes('画布内容已从快照恢复'));
        await page.reload();
        await restored;
        assert.deepEqual(await page.evaluate(() => painter.readPixelByte(100, 100)), { r: 255, g: 0, b: 0 });
    });
});
