// Serve the repository over HTTP, then run: node tests/preset-colors.cjs [URL]
// Requires Playwright. Set CHROMIUM_PATH to use an existing Chromium executable.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const url = process.argv[2] || 'http://127.0.0.1:8765/app.html';
(async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox']});
    try {
        const context = await browser.newContext({viewport: {width: 320, height: 900}});
        const page = await context.newPage();
        // The release announcement is unrelated to panel layout and blocks controls.
        await page.route('**/js/announcer.js', route => route.fulfill({contentType: 'application/javascript', body: 'window.Announcer = {init(){}, checkUpdate(){}};'}));
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        if (process.env.DEBUG_BROWSER) page.on('console', m => console.log(m.text()));
        const ready = () => page.waitForFunction(() => typeof painter !== 'undefined' && painter && document.querySelector('#paletteDropdown button'));
        const menu = page.locator('#paletteBtn');
        const action = page.locator('#presetVisibilityOption');
        const picker = page.locator('#colorPicker');
        async function togglePresets() {
            await menu.click();
            assert.equal(await menu.getAttribute('aria-expanded'), 'true');
            await action.click();
            assert.equal(await menu.getAttribute('aria-expanded'), 'false');
        }
        await page.goto(url);
        await ready();
        assert(await picker.isVisible());
        assert.equal(await page.locator('#instructionsToggle').getAttribute('aria-expanded'), 'false');
        const canvasY = (await page.locator('#mixCanvas').boundingBox()).y;
        const before = await page.evaluate(() => ({fg: foregroundColor, bg: backgroundColor, pressure: pressureGamma}));
        await togglePresets();
        assert.equal(await picker.isVisible(), false);
        assert((await page.locator('#mixCanvas').boundingBox()).y < canvasY);
        assert.deepEqual(await page.evaluate(() => ({fg: foregroundColor, bg: backgroundColor, pressure: pressureGamma})), before);
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mixbox_app_settings')).presetColorsVisible), false);
        await page.reload();
        await ready();
        assert.equal(await picker.isVisible(), false);
        // Use the actual language button to exercise every dynamic label refresh.
        for (const lang of ['en', 'zh', 'ja']) {
            assert.equal(await page.evaluate(() => I18N.getLang()), lang);
            assert.equal(await action.textContent(), {en: 'Show preset colors', zh: '显示预设色块', ja: 'プリセットカラーを表示'}[lang]);
            assert.equal(await page.locator('#engineTitle').textContent(), {en: 'KM Palette', zh: 'KM 调色板', ja: 'KM パレット'}[lang]);
            await menu.click();
            await page.locator('.palette-option[data-palette="digitalArtist"]').click();
            assert.equal(await picker.isVisible(), false);
            assert.equal(await menu.getAttribute('aria-expanded'), 'false');
            assert.equal(await page.locator('.palette-option.active').count(), 1);
            await menu.click();
            const bounds = await page.locator('#paletteDropdown').boundingBox();
            assert(bounds.x >= 0 && bounds.x + bounds.width <= 320);
            await page.keyboard.press('Escape');
            assert.equal(await menu.getAttribute('aria-expanded'), 'false');
            await togglePresets();
            assert(await picker.isVisible());
            await togglePresets();
            assert.equal(await picker.isVisible(), false);
            await page.locator('#langBtn').click();
        }
        // Keyboard menu navigation and native Space activation.
        await menu.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'presetVisibilityOption');
        await page.keyboard.press('Space');
        assert(await picker.isVisible());
        await togglePresets();
        await page.evaluate(() => {
            window.sent = [];
            window.uxpHost = {postMessage: m => window.sent.push(m)};
            window.dispatchEvent(new MessageEvent('message', {data: {type: 'psInitColors', foreground: {hex: '#ff0000'}, background: {hex: '#0000ff'}}}));
            window.dispatchEvent(new MessageEvent('message', {data: {type: 'psColorChanged', target: 'foreground', color: {hex: '#00ff00'}}}));
        });
        assert.equal(await page.evaluate(() => currentBrushColor), '#00ff00');
        assert.equal(await page.evaluate(() => backgroundColor), '#0000ff');
        assert.equal(await page.evaluate(() => sent.filter(m => m.type === 'setColor').length), 0);
        // Engine title switches the actual WebGL painter and survives reload.
        for (const engine of ['mixbox', 'km']) {
            await page.locator('#engineBtn').click();
            await page.waitForFunction(engine => currentEngine === engine && !document.getElementById('engineBtn').disabled, engine);
            assert.equal(await page.locator('#engineTitle').textContent(), engine === 'km' ? 'KM Palette' : 'Mixbox Palette');
            assert.equal(await picker.isVisible(), false);
            const pixels = await page.evaluate(() => {
                painter.clear();
                currentBrush.type = 'circle';
                beginStroke('brush', '#ff0000', 100, 100, 1);
                drawBrush(100, 100, '#ff0000');
                endStroke();
                const before = Object.values(painter.readPixelByte(100, 100));
                beginStroke('brush', '#0000ff', 100, 100, 1);
                drawBrush(100, 100, '#0000ff');
                endStroke();
                return {before, after: Object.values(painter.readPixelByte(100, 100))};
            });
            assert.notDeepEqual(pixels.before, [255, 255, 255]);
            assert.notDeepEqual(pixels.after, pixels.before);
        }
        // Verify real pointer drawing + eyedropper, undo, redo, sliders and pressure.
        const canvas = page.locator('#mixCanvas');
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, {steps: 3});
        await page.mouse.up();
        await page.locator('#undoBtn').click();
        await page.locator('#redoBtn').click();
        await page.locator('#eyedropperBtn').click();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        assert(await page.evaluate(() => sent.some(m => m.type === 'setColor' && m.target === 'foreground')));
        await page.locator('#eyedropperBtn').click();
        await page.locator('.custom-range[data-for="brushSize"]').click();
        assert(await page.evaluate(() => toolStates.brush.size > 2));
        await page.locator('#pressureBtn').click();
        assert.equal(await page.locator('#pressureBtn').getAttribute('aria-pressed'), 'true');
        await page.locator('.pressure-sens-btn[data-gamma="0.6"]').click();
        assert.equal(await page.evaluate(() => pressureGamma), 0.6);
        assert.equal(await page.locator('.pressure-sens-btn[aria-pressed="true"]').count(), 1);
        // Geometry checks avoid generating a user-facing preview image.
        for (const width of [320, 480, 1000]) {
            await page.setViewportSize({width, height: 1000});
            for (let i = 0; i < 3; i++) {
                await page.locator('#langBtn').click();
                const geometry = await page.evaluate(() => {
                    const r = selector => document.querySelector(selector).getBoundingClientRect();
                    const fg = r('#fgColorBox'), bg = r('#bgColorBox');
                    const overlapX = (Math.max(fg.left, bg.left) + Math.min(fg.right, bg.right)) / 2;
                    const overlapY = (Math.max(fg.top, bg.top) + Math.min(fg.bottom, bg.bottom)) / 2;
                    const controls = [...document.querySelectorAll('.header-container button, .toolbar-row button, .pressure-row button, .parameter-label, .mix-area-header, .footer-row')];
                    return {
                        overflow: document.documentElement.scrollWidth > innerWidth,
                        outOfBounds: controls.some(el => { const b = el.getBoundingClientRect(); return b.width && (b.left < 0 || b.right > innerWidth); }),
                        pressureRight: r('.pressure-sens-buttons').right,
                        historyRight: r('.history-buttons').right,
                        canvasRight: r('.mix-area').right,
                        foregroundOnTop: document.elementFromPoint(overlapX, overlapY)?.id === 'fgColorBox',
                    };
                });
                assert.equal(geometry.overflow, false);
                assert.equal(geometry.outOfBounds, false);
                assert(Math.abs(geometry.pressureRight - geometry.canvasRight) < 2);
                assert(Math.abs(geometry.historyRight - geometry.canvasRight) < 2);
                assert(geometry.foregroundOnTop);
            }
        }
        // Focus cue remains at the top and never reflows the panel.
        const focusGeometry = await page.evaluate(() => {
            const indicator = document.getElementById('focusIndicator');
            const before = document.getElementById('engineBtn').getBoundingClientRect().top;
            window.dispatchEvent(new Event('blur'));
            const inactive = !indicator.classList.contains('active');
            window.dispatchEvent(new Event('focus'));
            return {inactive, active: indicator.classList.contains('active'), stable: before === document.getElementById('engineBtn').getBoundingClientRect().top, first: indicator === document.querySelector('.container').firstElementChild};
        });
        assert.deepEqual(focusGeometry, {inactive: true, active: true, stable: true, first: true});
        await togglePresets();
        assert(await picker.isVisible());
        await page.locator('.color-circle').first().click();
        await page.locator('#instructionsToggle').click();
        await page.reload();
        await ready();
        assert(await picker.isVisible());
        assert.equal(await page.locator('#instructionsToggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.evaluate(() => currentEngine), 'km');
        assert.equal(await page.evaluate(() => pressureGamma), 0.6);
        // Boot through the Photoshop code path with a fake transport, preserving Space handoff.
        const hostContext = await browser.newContext({viewport: {width: 320, height: 900}});
        await hostContext.addInitScript(() => {
            window.hostMessages = [];
            window.uxpHost = {postMessage: message => window.hostMessages.push(message)};
        });
        const hostPage = await hostContext.newPage();
        hostPage.on('pageerror', e => errors.push(e.message));
        await hostPage.route('**/js/announcer.js', route => route.fulfill({contentType: 'application/javascript', body: 'window.Announcer = {init(){}, checkUpdate(){}};'}));
        await hostPage.goto(url);
        await hostPage.waitForFunction(() => document.querySelector('#paletteDropdown button') && document.querySelector('#selectOverlay'));
        assert(await hostPage.locator('#importBtn').isVisible());
        await hostPage.locator('#engineBtn').focus();
        await hostPage.keyboard.press('Space');
        assert.notEqual(await hostPage.evaluate(() => document.activeElement.id), 'engineBtn');
        assert.equal(await hostPage.evaluate(() => currentEngine), 'km');
        await hostPage.locator('#brushPreviewBtn').click();
        await hostPage.locator('.brush-option').filter({hasText: 'Watercolor'}).click();
        assert(await hostPage.locator('#dripToggleBtn').isVisible());
        await hostPage.locator('#dripToggleBtn').click();
        await hostPage.locator('#smudgeBtn').click();
        assert.equal(await hostPage.evaluate(() => getCurrentMode()), 'smudge');
        assert.equal(await hostPage.locator('#dripToggleBtn').isVisible(), false);
        await hostPage.locator('#smudgeBtn').click();
        // Zoom still changes the visual scale without replacing the panel controls.
        await hostPage.locator('#zoomBtn').click();
        await hostPage.locator('.zoom-option[data-zoom="0.8"]').click();
        assert.equal(await hostPage.locator('#zoomBtn').textContent(), '80%');
        await hostContext.close();
        assert.deepEqual(errors, []);
        console.log('PASS: menu/keyboard, visibility/persistence, EN/ZH/JA at 320/480/1000px, engine titles, PS bridge, KM/Mixbox painting, eyedropper, undo/redo, sliders/pressure, foreground layering, focus cue');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
