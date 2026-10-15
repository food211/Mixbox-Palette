// Serve the repository first. NODE_PATH and CHROMIUM_PATH may select local test dependencies.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const url = process.argv[2] || 'http://127.0.0.1:8765/app.html';

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
    try {
        for (const engine of ['km', 'mixbox']) {
            const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, locale: 'en-US' });
            await context.addInitScript(engine => {
                localStorage.setItem('mixbox_engine', engine);
            }, engine);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/js/announcer.js', route => route.fulfill({
                contentType: 'application/javascript', body: 'window.Announcer = {init(){}, checkUpdate(){}};'
            }));
            const ready = () => page.waitForFunction(() => document.body.classList.contains('app-ready') &&
                document.getElementById('resizeHandleLeft').hasAttribute('aria-disabled'));
            const lock = page.locator('#resizeLockBtn');
            const dimensions = () => page.evaluate(() => ({
                width: getContainerMaxWidth(), canvas: [mixCanvas.width, mixCanvas.height],
                preview: document.querySelector('.container').style.maxWidth
            }));
            async function drag(side) {
                const box = await page.locator('#resizeHandle' + side).boundingBox();
                await page.mouse.move(box.x + box.width / 2, 300);
                await page.mouse.down();
                await page.mouse.move(box.x + (side === 'Left' ? -40 : 40), 300, { steps: 5 });
            }
            await page.goto(url);
            await ready();
            assert.equal(await lock.getAttribute('aria-pressed'), 'false');
            assert.equal(await lock.evaluate(el => el.nextElementSibling.id), 'undoBtn');
            const original = await dimensions();
            // Unlocked: both real pointer targets work and cancelling restores the preview.
            for (const side of ['Left', 'Right']) {
                await drag(side);
                await page.mouse.up();
                assert(await page.locator('#resizeConfirmModal').evaluate(el => el.classList.contains('active')));
                await page.locator('#resizeConfirmCancelBtn').click();
                await page.locator('#resizeConfirmModal').waitFor({ state: 'hidden' });
                assert.deepEqual(await dimensions(), original);
            }
            await lock.click();
            assert.equal(await lock.getAttribute('aria-pressed'), 'true');
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mixbox_app_settings')).canvasResizeLocked), true);
            for (const side of ['Left', 'Right']) {
                const handle = page.locator('#resizeHandle' + side);
                assert.equal(await handle.isVisible(), false);
                // Even direct dispatch must not bypass the lock's drag/hover guard.
                await handle.dispatchEvent('mouseenter');
                await handle.dispatchEvent('pointerdown', { pointerId: 8, clientX: 300 });
                await handle.dispatchEvent('pointermove', { pointerId: 8, clientX: 400 });
                await handle.dispatchEvent('pointerup', { pointerId: 8, clientX: 400 });
            }
            assert.deepEqual(await dimensions(), original);
            assert.equal(await page.locator('.container').evaluate(el => /glow-/.test(el.className)), false);
            assert.equal(await page.locator('#resizeConfirmModal').evaluate(el => el.classList.contains('active')), false);
            await page.reload();
            await ready();
            assert.equal(await lock.getAttribute('aria-pressed'), 'true');
            assert.equal(await page.locator('#resizeHandleLeft').isVisible(), false);
            assert.equal(await page.locator('#resizeHandleRight').isVisible(), false);
            // The existing translation pass must preserve the SVG and pressed state.
            for (const title of ['锁定画布大小', 'キャンバスサイズをロック', 'Lock canvas size']) {
                await page.locator('#langBtn').click();
                assert.equal(await lock.getAttribute('title'), title);
                assert.equal(await lock.locator('svg').count(), 1);
                assert.equal(await lock.getAttribute('aria-pressed'), 'true');
            }
            await lock.click();
            assert.equal(await page.locator('#resizeHandleLeft').isVisible(), true);
            assert.equal(await page.locator('#resizeHandleRight').isVisible(), true);
            // A second pointer can lock while a handle is captured; no resize may survive it.
            await drag('Left');
            await lock.dispatchEvent('click');
            await page.mouse.up();
            assert.deepEqual(await dimensions(), original);
            assert.equal(await page.locator('#resizeConfirmModal').evaluate(el => el.classList.contains('active')), false);
            await lock.click();
            await drag('Right');
            await page.mouse.up();
            await page.locator('#resizeConfirmOkBtn').click();
            await page.waitForFunction(oldWidth => mixCanvas.width > oldWidth, original.canvas[0]);
            assert((await dimensions()).width > original.width);
            await page.reload();
            await ready();
            assert.equal(await lock.getAttribute('aria-pressed'), 'false');
            assert.deepEqual(errors, []);
            await context.close();
        }
        console.log('PASS: KM/Mixbox resize lock, both handles, drag cancellation, reload, translations, unlock and committed resize');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
