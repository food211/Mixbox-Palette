// Serve the repository over HTTP, then run: node tests/preset-colors.cjs [URL]
// Requires Playwright. Set CHROMIUM_PATH to use an existing Chromium executable.
// The server must send .svg as image/svg+xml (vite does; Python on Windows may send image/svg and break every icon).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const url = process.argv[2] || 'http://127.0.0.1:8765/app.html';
(async () => {
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox']});
    try {
        const context = await browser.newContext({viewport: {width: 320, height: 900}, locale: 'en-US'});
        const page = await context.newPage();
        // The release announcement is unrelated to panel layout and blocks controls.
        await page.route('**/js/announcer.js', route => route.fulfill({contentType: 'application/javascript', body: 'window.Announcer = {init(){}, checkUpdate(){}};'}));
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        if (process.env.DEBUG_BROWSER) page.on('console', m => console.log(m.text()));
        const ready = () => page.waitForFunction(() => typeof painter !== 'undefined' && painter && document.querySelector('#paletteDropdown button'));
        const menu = page.locator('#paletteBtn');
        const hiddenOption = page.locator('.palette-option[data-palette="hidden"]');
        const picker = page.locator('#colorPicker');
        async function choose(key) {
            await menu.click();
            assert.equal(await menu.getAttribute('aria-expanded'), 'true');
            await page.locator(`.palette-option[data-palette="${key}"]`).click();
            assert.equal(await menu.getAttribute('aria-expanded'), 'false');
        }
        await page.goto(url);
        await ready();
        assert(await picker.isVisible());
        // The hidden option is one more entry than the presets and always comes last.
        assert.equal(await page.locator('#paletteDropdown .palette-option').count(), await page.evaluate(() => Object.keys(palettePresets).length + 1));
        assert.equal(await page.locator('#paletteDropdown .palette-option').last().getAttribute('data-palette'), 'hidden');
        // Every toolbar icon must actually load.
        await page.waitForFunction(() => [...document.querySelectorAll('.tool-btn img')].every(i => i.complete));
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('.tool-btn img')].every(i => i.naturalWidth > 0)), true);
        // Brush and smudge are a mode pair in the tool row; the tip picker sits in the pressure row.
        assert.equal(await page.evaluate(() => document.querySelector('.tool-buttons').firstElementChild.id), 'brushBtn');
        assert.equal(await page.locator('.pressure-controls #brushPreviewBtn').count(), 1);
        assert.equal(await page.locator('.palette-info').count(), 0);
        // Every palette needs a short name in every language for the button.
        assert.equal(await page.evaluate(() => Object.keys(palettePresets).concat('hidden').every(k => ['en', 'zh', 'ja'].every(l => I18N.translations[l]['paletteShort_' + k]))), true);
        assert.equal(await page.locator('.header-container #paletteBtn').count(), 1);
        assert.equal(await page.evaluate(() => document.querySelector('.pressure-controls').firstElementChild.dataset.i18n), 'brushLabel');
        assert.equal(await page.evaluate(() => document.querySelector('.pressure-controls button').id), 'brushPreviewBtn');
        assert.equal(await page.evaluate(() => toolStates.smudge.brushType), 'circle');
        assert.equal(await page.locator('#brushBtn.active').count(), 1);
        assert.equal(await page.locator('#smudgeBtn.active').count(), 0);
        assert.equal(await page.locator('#instructionsToggle').getAttribute('aria-expanded'), 'false');
        const canvasY = (await page.locator('#mixCanvas').boundingBox()).y;
        const before = await page.evaluate(() => ({fg: foregroundColor, bg: backgroundColor, pressure: pressureGamma}));
        await choose('hidden');
        assert.equal(await picker.isVisible(), false);
        assert.equal(await page.locator('#colorPicker .color-circle').count(), 0);
        assert.equal(await page.evaluate(() => colors.length), 0);
        assert((await page.locator('#mixCanvas').boundingBox()).y < canvasY);
        assert.deepEqual(await page.evaluate(() => ({fg: foregroundColor, bg: backgroundColor, pressure: pressureGamma})), before);
        assert.equal(await page.evaluate(() => localStorage.getItem('mixbox_palette_preset')), 'hidden');
        await page.reload();
        await ready();
        assert.equal(await picker.isVisible(), false);
        assert.equal(await page.evaluate(() => colors.length), 0);
        // Use the actual language button to exercise every dynamic label refresh.
        for (const lang of ['en', 'zh', 'ja']) {
            const label = {en: 'Hide palette', zh: '隐藏色板', ja: 'パレットを非表示'}[lang];
            assert.equal(await page.evaluate(() => I18N.getLang()), lang);
            assert.equal(await hiddenOption.textContent(), label);
            assert.equal(await page.locator('#paletteBtn span').textContent(), {en: 'Hide palette', zh: '隐藏色板', ja: 'パレット非表示'}[lang]);
            assert.equal(await page.locator('#engineTitle').textContent(), {en: 'KM Palette', zh: 'KM 调色板', ja: 'KM パレット'}[lang]);
            assert.equal(await page.locator('#brushBtn').getAttribute('title'), {en: 'Brush (B)', zh: '画笔 (B)', ja: 'ブラシ (B)'}[lang]);
            assert.equal(await page.locator('.pressure-controls [data-i18n="brushLabel"]').textContent(), {en: 'Brush', zh: '笔刷', ja: 'ブラシ'}[lang]);
            await menu.click();
            const bounds = await page.locator('#paletteDropdown').boundingBox();
            assert(bounds.x >= 0 && bounds.x + bounds.width <= 320);
            await page.keyboard.press('Escape');
            assert.equal(await menu.getAttribute('aria-expanded'), 'false');
            await choose('digitalArtist');
            assert(await picker.isVisible());
            assert.equal(await page.locator('#colorPicker .color-circle').count(), await page.evaluate(() => palettePresets.digitalArtist.colors.length));
            assert.equal(await page.locator('.palette-option.active').count(), 1);
            assert.equal(await page.locator('.palette-option.active').getAttribute('data-palette'), 'digitalArtist');
            await choose('hidden');
            assert.equal(await picker.isVisible(), false);
            assert.equal(await page.locator('.palette-option.active').getAttribute('data-palette'), 'hidden');
            await page.locator('#langBtn').click();
        }
        // Keyboard menu navigation and native Space activation.
        await menu.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Home');
        await page.keyboard.press('Space');
        assert(await picker.isVisible());
        await menu.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('End');
        assert.equal(await page.evaluate(() => document.activeElement.dataset.palette), 'hidden');
        await page.keyboard.press('Space');
        assert.equal(await picker.isVisible(), false);
        assert.equal(await page.evaluate(() => localStorage.getItem('mixbox_palette_preset')), 'hidden');
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
        // Brush and smudge form a mode pair; the tip picker works in both and the brush button leaves other modes.
        // The conditional drip toggle is last in the row, so the tip picker and pressure toggle never move.
        const lefts = () => page.evaluate(() => ['#brushPreviewBtn', '#pressureBtn'].map(s => document.querySelector(s).getBoundingClientRect().left));
        await page.locator('#smudgeBtn').click();
        assert.equal(await page.evaluate(() => currentTool), 'smudge');
        assert.equal(await page.evaluate(() => currentBrush.type), 'circle');
        assert.equal(await page.locator('#dripToggleBtn').isVisible(), false);
        const leftsWithoutDrip = await lefts();
        assert.equal(await page.locator('#brushBtn.active').count(), 0);
        assert.equal(await page.locator('#smudgeBtn.active').count(), 1);
        await page.locator('#brushPreviewBtn').click();
        await page.locator('.brush-option').nth(1).click();
        assert.equal(await page.evaluate(() => toolStates.smudge.brushType), 'soft');
        await page.locator('#brushBtn').click();
        assert.equal(await page.evaluate(() => currentTool), 'brush');
        assert.equal(await page.locator('#dripToggleBtn').isVisible(), true);
        assert.deepEqual(await lefts(), leftsWithoutDrip);
        assert.equal(await page.locator('#brushBtn.active').count(), 1);
        assert.equal(await page.locator('#smudgeBtn.active').count(), 0);
        await page.keyboard.press('s');
        assert.equal(await page.locator('#smudgeBtn.active').count(), 1);
        await page.keyboard.press('b');
        assert.equal(await page.locator('#brushBtn.active').count(), 1);
        await page.locator('#eyedropperBtn').click();
        assert.equal(await page.evaluate(() => isEyedropperMode), true);
        await page.locator('#brushBtn').click();
        assert.equal(await page.evaluate(() => isEyedropperMode), false);
        assert.equal(await page.locator('#eyedropperBtn.active').count(), 0);
        assert.equal(await page.evaluate(() => currentTool), 'brush');
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
                        pressureRowHeight: r('.pressure-row').height,
                        pressureOverlap: [...document.querySelectorAll('.pressure-controls button')].filter(b => b.offsetWidth).some(a => [...document.querySelectorAll('.pressure-sens-btn')].some(b => {
                            const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
                            return p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom;
                        })),
                        foregroundOnTop: document.elementFromPoint(overlapX, overlapY)?.id === 'fgColorBox',
                    };
                });
                assert.equal(geometry.overflow, false);
                assert.equal(geometry.outOfBounds, false);
                assert(Math.abs(geometry.pressureRight - geometry.canvasRight) < 2);
                assert(Math.abs(geometry.historyRight - geometry.canvasRight) < 2);
                assert(geometry.foregroundOnTop);
                assert.equal(geometry.pressureOverlap, false);
                assert(geometry.pressureRowHeight < 40);
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
        await choose('winsorNewtonCotman');
        assert(await picker.isVisible());
        // Fixed-width dropdown (viewport is 1000px wide here): long and short names keep the same box, in the title row.
        const paletteBox = async () => page.locator('#paletteBtn').boundingBox();
        const cotmanBox = await paletteBox();
        assert.equal(cotmanBox.width, 132);
        const actionsBox = await page.locator('.header-actions').boundingBox();
        assert(Math.abs(cotmanBox.y + cotmanBox.height / 2 - (actionsBox.y + actionsBox.height / 2)) < 2);
        assert(cotmanBox.x + cotmanBox.width < actionsBox.x);
        await choose('wnGouache');
        assert.deepEqual(await paletteBox(), cotmanBox);
        // The button shows the short name; the tooltip and the list keep the full one.
        assert.equal(await page.locator('#paletteBtn span').textContent(), 'W&N Gouache');
        assert.equal(await page.locator('#paletteBtn').getAttribute('title'), 'Winsor & Newton Designers Gouache Mix');
        assert.equal(await page.locator('.palette-option[data-palette="wnGouache"]').textContent(), 'Winsor & Newton Designers Gouache Mix');
        await choose('winsorNewtonCotman');
        // Foreground = solid ring, background = dashed ring, identical on the preview boxes and the selected swatches.
        const ring = await page.evaluate(() => {
            const style = (el, ...props) => props.map(p => getComputedStyle(el)[p]);
            const chips = document.querySelectorAll('.color-circle');
            chips[0].click();
            chips[1].dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
            const fgBox = document.getElementById('fgColorBox'), bgBox = document.getElementById('bgColorBox');
            const fgChip = document.querySelector('.color-circle.selected-fg'), bgChip = document.querySelector('.color-circle.selected-bg');
            return {
                boxFg: style(fgBox, 'borderTopStyle', 'borderTopWidth', 'borderTopColor'),
                chipFg: style(fgChip, 'outlineStyle', 'outlineWidth', 'outlineColor'),
                boxBg: style(bgBox, 'borderTopStyle', 'borderTopWidth', 'borderTopColor'),
                chipBg: style(bgChip, 'outlineStyle', 'outlineWidth', 'outlineColor'),
            };
        });
        assert.equal(ring.boxFg[0], 'solid');
        assert.equal(ring.boxBg[0], 'dashed');
        assert.deepEqual(ring.chipFg, ring.boxFg);
        assert.deepEqual(ring.chipBg, ring.boxBg);
        // The same swatch as foreground and background: left half solid, right half dashed.
        const split = await page.evaluate(() => {
            const chip = document.querySelectorAll('.color-circle')[0];
            chip.click();
            chip.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
            const pseudo = which => {
                const s = getComputedStyle(chip, which);
                return [s.borderTopStyle, s.borderTopWidth, s.borderTopColor, s.clipPath];
            };
            return {
                both: chip.classList.contains('selected-fg') && chip.classList.contains('selected-bg'),
                outline: getComputedStyle(chip).outlineStyle,
                left: pseudo('::before'),
                right: pseudo('::after'),
            };
        });
        assert.equal(split.both, true);
        assert.equal(split.outline, 'none');
        assert.equal(split.left[0], 'solid');
        assert.equal(split.right[0], 'dashed');
        assert.deepEqual(split.left.slice(1, 3), ring.boxFg.slice(1));
        assert.deepEqual(split.right.slice(1, 3), ring.boxBg.slice(1));
        assert.notEqual(split.left[3], split.right[3]);
        await page.locator('.color-circle').first().click();
        await page.locator('#instructionsToggle').click();
        await page.reload();
        await ready();
        assert(await picker.isVisible());
        assert.equal(await page.locator('#instructionsToggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.evaluate(() => currentEngine), 'km');
        assert.equal(await page.evaluate(() => pressureGamma), 0.6);
        // Boot through the Photoshop code path with a fake transport, preserving Space handoff.
        const hostContext = await browser.newContext({viewport: {width: 320, height: 900}, locale: 'en-US'});
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
        console.log('PASS: menu/keyboard, hidden palette/persistence, EN/ZH/JA at 320/480/1000px, engine titles, PS bridge, KM/Mixbox painting, eyedropper, undo/redo, sliders/pressure, foreground layering, focus cue');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
