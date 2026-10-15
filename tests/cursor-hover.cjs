// Trusted mouse input through Chromium; no synthetic dispatchEvent pointer moves.
// Run serially with GPU tests: node tests/cursor-hover.cjs [http://127.0.0.1:8765/app.html]
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const url=process.argv[2]||process.env.PALETTE_TEST_URL||'http://127.0.0.1:8765/app.html';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
 try{
  for(const engine of ['km','mixbox']){
   const context=await browser.newContext({viewport:{width:460,height:1000}});
   try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/js/announcer.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Announcer={init(){},checkUpdate(){}};'}));
    await page.addInitScript(engine=>{
     localStorage.setItem('mixbox_engine',engine);
     window.hoverChecks={active:false,events:[],gpu:0};
     for(const name of ['texImage2D','texSubImage2D','fenceSync','clientWaitSync','finish','readPixels']){
      const original=WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name]=function(...args){if(hoverChecks.active)hoverChecks.gpu++;return original.apply(this,args);};
     }
     document.addEventListener('pointermove',e=>{if(hoverChecks.active&&e.target.id==='mixCanvas')hoverChecks.events.push({trusted:e.isTrusted,buttons:e.buttons});},true);
    },engine);
    await page.goto(url);
    await page.waitForFunction(()=>document.body.classList.contains('app-ready'));
    await page.waitForTimeout(350);
    const box=await page.locator('#mixCanvas').boundingBox();
    const client=await context.newCDPSession(page);
    // Test the initial cached canvas, then a replacement after selecting another brush.
    for(const brush of ['watercolor','dry']){
     await page.evaluate(async type=>{
      const i=brushManager.getPresetBrushes().findIndex(b=>b.type===type);
      document.querySelectorAll('#brushGrid .brush-option')[i].click();
      const size=document.getElementById('brushSize');size.value='80';size.dispatchEvent(new Event('input',{bubbles:true}));
      await requestBrushCursorPreload();
     },brush);
     await page.mouse.move(box.x+80,box.y+80);
     await page.waitForTimeout(100);
     const before=await page.evaluate(()=>({pixels:painter.toDataURL('image/png'),history:painter.getHistoryStep(),dirty:_canvasDirty,cursor:document.getElementById('brushCursor').toDataURL()}));
     const trace=[];const collect=e=>trace.push(...e.value);client.on('Tracing.dataCollected',collect);
     await client.send('Tracing.start',{categories:'devtools.timeline,benchmark,latencyInfo',transferMode:'ReportEvents'});
     await page.evaluate(()=>{hoverChecks.events=[];hoverChecks.gpu=0;hoverChecks.active=true;});
     for(const idle of [0,120,800,2000]){
      await page.waitForTimeout(idle);
      for(let i=0;i<8;i++){await page.mouse.move(box.x+80+i*8,box.y+100+idle%3);await page.waitForTimeout(16);}
     }
     await page.waitForTimeout(60);
     await page.evaluate(()=>hoverChecks.active=false);
     const complete=new Promise(r=>client.once('Tracing.tracingComplete',r));await client.send('Tracing.end');await complete;
     client.off('Tracing.dataCollected',collect);
     const state=await page.evaluate(()=>({checks:hoverChecks,pixels:painter.toDataURL('image/png'),history:painter.getHistoryStep(),dirty:_canvasDirty,cursor:document.getElementById('brushCursor').toDataURL(),shown:getComputedStyle(document.getElementById('brushCursor')).display,transform:document.getElementById('brushCursor').style.transform}));
     const cursorPaints=trace.filter(e=>e.name==='Paint'&&e.args?.data?.nodeName?.includes("id='brushCursor'"));
     assert.equal(state.checks.events.length,32);assert(state.checks.events.every(e=>e.trusted&&e.buttons===0));
     assert.equal(state.checks.gpu,0,'pure hovering must not sample, upload, fence-wait, or paint on the mixing context');
     assert.equal(state.pixels,before.pixels);assert.equal(state.history,before.history);assert.equal(state.dirty,before.dirty);assert.equal(state.cursor,before.cursor);
     assert.equal(state.shown,'block');assert.match(state.transform,/translate\(/);
     // The cursor image is unchanged; moving it must not repaint that image on every input.
     assert.equal(cursorPaints.length,0,`${engine}/${brush}: warm stationary/resumed hover repainted the cursor ${cursorPaints.length} times`);
     assert.deepEqual(errors,[]);
     console.log(`PASS ${engine}/${brush}: 32 trusted hover moves, 0 cursor Paints, 0 GPU calls, unchanged pixels/history/save state`);
    }
   }finally{await context.close();}
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
