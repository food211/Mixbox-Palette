// Real WebGL startup + first pointer input. Run serially with other GPU tests.
// node tests/startup-input.cjs [http://127.0.0.1:8765/app.html]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = process.argv[2] || process.env.PALETTE_TEST_URL || 'http://127.0.0.1:8765/app.html';
(async()=>{
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
    try {
        for(const [engine,holdFence] of [['km',false],['mixbox',false],['km',true]]) {
            const context=await browser.newContext({viewport:{width:1440,height:1400}});
            try {
                const page=await context.newPage();
                const errors=[];page.on('pageerror',error=>errors.push(error.message));
                if(process.env.PALETTE_APP_HTML) await page.route('**/app.html',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync(process.env.PALETTE_APP_HTML,'utf8')}));
                await page.route('**/js/announcer.js',route=>route.fulfill({contentType:'text/javascript',body:'window.Announcer={init(){},checkUpdate(){}};'}));
                await page.route('**/js/app.js',async route=>{
                    const response=await route.fetch();
                    const body=await response.text();
                    await route.fulfill({response,body:body+'\n{const original=window.initApp;window.initApp=async()=>{const result=await original();window.startupResult=result;return result;};}'});
                });
                await page.addInitScript(({engine,holdFence})=>{
                    localStorage.setItem('mixbox_engine',engine);
                    window.holdStartupFence=holdFence;
                    const wait=WebGL2RenderingContext.prototype.clientWaitSync;
                    WebGL2RenderingContext.prototype.clientWaitSync=function(...args){return window.holdStartupFence?this.TIMEOUT_EXPIRED:wait.apply(this,args);};
                    new MutationObserver(()=>{
                        if(!document.body?.classList.contains('app-ready')||window.firstInputAudit)return;
                        window.firstInputAudit={result:window.startupResult,before:painter.getHistoryStep(),at:performance.now()};
                        // Same microtask as loader reveal: the pointer handlers and painter must already exist.
                        window.holdStartupFence=false;
                        const r=mixCanvas.getBoundingClientRect();
                        const options={bubbles:true,pointerId:41,pointerType:'pen',pressure:.7,buttons:1,button:0,clientX:r.left+100,clientY:r.top+100};
                        mixCanvas.dispatchEvent(new PointerEvent('pointerdown',options));
                        mixCanvas.dispatchEvent(new PointerEvent('pointermove',{...options,clientX:r.left+130}));
                        mixCanvas.dispatchEvent(new PointerEvent('pointerup',{...options,buttons:0,pressure:0,clientX:r.left+130}));
                    }).observe(document,{subtree:true,attributes:true,attributeFilter:['class']});
                },{engine,holdFence});
                await page.goto(url);
                await page.waitForFunction(()=>window.firstInputAudit&&painter.getHistoryStep()>window.firstInputAudit.before);
                const result=await page.evaluate(()=>({audit:window.firstInputAudit,step:painter.getHistoryStep(),engine:currentEngine}));
                assert.equal(result.audit.result.ready,true,'loader must wait for initApp result');
                assert.equal(result.audit.result.cursorPreview.status,holdFence?'timeout':'ready');
                assert.equal(result.engine,engine);assert.deepEqual(errors,[]);
                console.log(`PASS ${engine} / ${holdFence?'preview timeout':'preview ready'}: first input at loader reveal produced history step ${result.step}`);
            } finally {await context.close();}
        }
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
