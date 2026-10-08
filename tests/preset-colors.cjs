// Run against a local server: node tests/preset-colors.cjs [URL]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || undefined, args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:320,height:900}, serviceWorkers:'allow'});
    const page = await context.newPage();
    // Keep release announcements from covering the controls under test.
    await page.route('**/js/announcer.js', route => route.fulfill({contentType:'application/javascript', body:'window.Announcer = {init(){}, checkUpdate(){}};'}));
    const errors = [];
    if (process.env.DEBUG_BROWSER) page.on('console', m => console.log(m.text()));
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.argv[2] || 'http://127.0.0.1:8765/app.html');
    await page.waitForFunction(() => typeof painter !== 'undefined' && painter && document.querySelectorAll('.color-circle').length > 0);
    const toggle = page.locator('#presetColorsToggle');
    const picker = page.locator('#colorPicker');
    assert(await toggle.isChecked());
    const y = (await page.locator('#mixCanvas').boundingBox()).y;
    await toggle.uncheck();
    assert.equal(await picker.isVisible(), false);
    assert((await page.locator('#mixCanvas').boundingBox()).y < y);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('mixbox_app_settings')).presetColorsVisible), false);
    await page.reload();
    await page.waitForFunction(() => typeof painter !== 'undefined' && painter && document.querySelectorAll('.color-circle').length > 0);
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await picker.isVisible(), false);
    for (const lang of ['en','zh','ja']) {
      await page.evaluate(lang => { I18N.setLang(lang); I18N.applyToDOM(); updateColorPicker(); initPaletteDropdown(); }, lang);
      assert.equal(await page.locator('[data-i18n="presetColors"]').textContent(), {en:'Preset colors',zh:'预设色块',ja:'プリセットカラー'}[lang]);
      assert.equal(await picker.isVisible(), false);
      const bounds = await page.locator('.preset-colors-toggle').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 320);
    }
    await page.evaluate(() => switchPalette(Object.keys(palettePresets).find(k => k !== currentPalette)));
    assert.equal(await picker.isVisible(), false);
    // Exercise the real host message handler with a mock UXP transport.
    await page.evaluate(() => {
      window.sent = [];
      window.uxpHost = {postMessage: m => window.sent.push(m)};
      window.dispatchEvent(new MessageEvent('message',{data:{type:'psInitColors', foreground:{hex:'#ff0000'},background:{hex:'#0000ff'}}}));
      window.dispatchEvent(new MessageEvent('message',{data:{type:'psColorChanged',target:'foreground',color:{hex:'#00ff00'}}}));
    });
    assert.equal(await page.evaluate(() => currentBrushColor), '#00ff00');
    assert.equal(await page.evaluate(() => backgroundColor), '#0000ff');
    assert.equal(await page.evaluate(() => sent.filter(m => m.type === 'setColor').length), 0);
    for (const engine of ['km','mixbox']) {
      await page.evaluate(engine => switchEngine(engine), engine);
      const pixels = await page.evaluate(() => {
        painter.clear();
        beginStroke('brush','#ff0000',100,100,1);
        drawBrush(100,100,'#ff0000');
        endStroke();
        const before = Object.values(painter.readPixelByte(100,100));
        beginStroke('brush','#0000ff',100,100,1);
        drawBrush(100,100,'#0000ff');
        endStroke();
        return {before,after:Object.values(painter.readPixelByte(100,100))};
      });
      assert.notDeepEqual(pixels.before.slice(0,3), [255,255,255]);
      assert.notDeepEqual(pixels.after, pixels.before);
    }
    await toggle.check();
    assert(await picker.isVisible());
    await page.locator('.color-circle').first().click();
    assert(await page.evaluate(() => sent.some(m => m.type === 'setColor' && m.target === 'foreground')));
    await page.reload();
    await page.waitForFunction(() => typeof painter !== 'undefined' && painter);
    assert(await toggle.isChecked());
    assert(await picker.isVisible());
    assert.deepEqual(errors, []);
    console.log('PASS: visibility, layout, persistence, EN/ZH/JA, palettes, PS bridge, KM/Mixbox painting');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
