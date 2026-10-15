// Real straight-line pointer input. Includes optional GPU timers; compare minimal instrumentation with STRAIGHT_INSTRUMENT=0.
// The request route pins DeviceProfile -> FrameScheduler loading only in this measurement harness.
const { chromium } = require('playwright');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const quantile = (xs, p) => xs.length ? xs.slice().sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1] : null;
if (!process.argv[2]) throw new Error('Usage: node tests/straight-line-performance.cjs <baseline-directory> [results.json]');
const output = process.argv[3] || 'straight-results.json';
const variants = (process.env.STRAIGHT_VARIANTS || 'baseline,candidate').split(',');
const profiles = (process.env.STRAIGHT_PROFILES || 'clean,pending').split(',');
const repetitions = Number(process.env.STRAIGHT_REPETITIONS || 3);
const duration = Number(process.env.STRAIGHT_DURATION || 22000);
const instrument = process.env.STRAIGHT_INSTRUMENT !== '0';
const baseDirectory = process.argv[2];
for (const variant of variants) if (!['baseline','candidate'].includes(variant)) throw new Error('Unknown variant: '+variant);
for (const profile of profiles) if (!['clean','pending'].includes(profile)) throw new Error('Unknown profile: '+profile);
(async()=>{
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 const result={browser:await browser.version(),durationMs:duration,targetInputHz:60,instrument,
  baselineHashes:Object.fromEntries(['base-painter.js','history-worker.js','app.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(baseDirectory+'/'+f)).digest('hex')])),runs:[]};
 try{
  for(let repetition=0;repetition<repetitions;repetition++)for(const variant of repetition%2?variants.slice().reverse():variants)for(const profile of profiles){
   const context=await browser.newContext({viewport:{width:1440,height:1400},locale:'en-US'});
   try{
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    // Pin the declared dependency order before measurement, not the FPS value or rendering code.
    await page.route('**/js/frame-scheduler.js',async route=>{
     await page.waitForFunction(()=>typeof DeviceProfile!=='undefined');
     await route.continue();
    });
    await page.addInitScript(({instrument})=>{
     localStorage.setItem('mixbox_container_width','960');
     const m=window.__straight={recording:false,held:false,events:[],frames:[],inputs:[],longtasks:[],gpu:[],gpuEvents:[],overheadMs:0};
     const event=(name,start,end,extra={})=>{if(m.recording)m.events.push({name,start,duration:end-start,held:m.held,...extra});};
     window.__straightEvent=event;
     document.addEventListener('pointerdown',e=>{if(e.target.id==='mixCanvas'){m.held=true;event('pointerdown',performance.now(),performance.now());}},true);
     document.addEventListener('pointerup',()=>{event('pointerup',performance.now(),performance.now());m.held=false;},true);
     document.addEventListener('pointermove',e=>{if(m.recording&&m.held)m.inputs.push({at:performance.now(),x:e.clientX,y:e.clientY,trusted:e.isTrusted});},true);
     let last=0;
     const nativeRAF=requestAnimationFrame;
     function observe(vsync){const now=performance.now();if(m.recording&&last)m.frames.push({start:last,end:now,interval:now-last,vsync,held:m.held});last=now;nativeRAF(observe);}
     nativeRAF(observe);
     new PerformanceObserver(list=>{if(m.recording)for(const e of list.getEntries())m.longtasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask'});
     if(!instrument)return;
     window.requestAnimationFrame=function(fn){return nativeRAF(function(vsync){
      const w0=performance.now(),isTick=fn.name==='_tick';
      let query=null;
      if(m.recording&&isTick&&m.timerExt){
       // Poll asynchronously; no finish(), waits or readPixels are added by this probe.
       for(let i=m.pendingGPU.length-1;i>=0;i--){const record=m.pendingGPU[i],q=record.q;if(m.gl.getQueryParameter(q,m.gl.QUERY_RESULT_AVAILABLE)){
        if(!m.gl.getParameter(m.timerExt.GPU_DISJOINT_EXT)){const ms=m.gl.getQueryParameter(q,m.gl.QUERY_RESULT)/1e6;m.gpu.push(ms);m.gpuEvents.push({submittedAt:record.at,duration:ms});}
        m.gl.deleteQuery(q);m.pendingGPU.splice(i,1);
       }}
       if(m.pendingGPU.length<32){query=m.gl.createQuery();m.gl.beginQuery(m.timerExt.TIME_ELAPSED_EXT,query);}
      }
      const start=performance.now();
      try{return fn(vsync);}finally{
       const end=performance.now();
       if(query){m.gl.endQuery(m.timerExt.TIME_ELAPSED_EXT);m.pendingGPU.push({q:query,at:start});}
       if(isTick)event('scheduler-cpu',start,end);
       if(m.recording)m.overheadMs+=start-w0+performance.now()-end;
      }
     });};
    },{instrument});
    if(variant!=='candidate')for(const f of ['base-painter.js','history-worker.js','app.js'])await page.route('**/js/'+f,r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(baseDirectory+'/'+f)}));
    await page.route('**/js/announcer.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Announcer={init(){},checkUpdate(){}};'}));
    await page.goto(process.env.PALETTE_TEST_URL||'http://127.0.0.1:8765/app.html');
    await page.waitForFunction(()=>typeof painter!=='undefined'&&painter&&document.querySelector('#paletteDropdown button'));
    await delay(600);
    const metadata=await page.evaluate(({instrument,variant})=>{
     const m=__straight,p=painter,gl=p.gl,emit=__straightEvent;
     m.pendingGPU=[];m.gl=gl;m.timerExt=instrument?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null;
     const stack=[];
     function wrap(obj,name,label=name){const fn=obj?.[name];if(!fn)return;obj[name]=function(...args){const w0=performance.now(),start=w0;stack.push(label);try{return fn.apply(this,args);}finally{const end=performance.now();stack.pop();emit(label,start,end,{caller:stack.at(-1)});if(m.recording)m.overheadMs+=performance.now()-end;}};}
     if(instrument){
      for(const name of ['_readPixelsForStorage','_idleBackupFrameDirect','_syncReadFrameToCPU','_readCanvasToCPU','toDataURLAsync','_workerRequest','_scheduleAsyncRelease','_releaseFrame','_compressFrame'])wrap(p,name);
      wrap(gl,'readPixels');wrap(gl,'clientWaitSync');wrap(gl,'getBufferSubData');wrap(paletteStorage,'save','storage-write');
      wrap(window.OffscreenCanvas?.prototype,'getContext','offscreen-context');
      wrap(window.OffscreenCanvas?.prototype,'convertToBlob','offscreen-convert-prefix');
      wrap(window.OffscreenCanvasRenderingContext2D?.prototype,'putImageData','offscreen-putImageData');
     }
     const ext=gl.getExtension('WEBGL_debug_renderer_info');
     return {canvas:[p.canvas.width,p.canvas.height],engine:currentEngine,brush:currentBrush.type,size:brushSize,
      targetFPS:FrameScheduler.getTargetFPS(),gpuTimer:!!m.timerExt,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
      dirty:_canvasDirty,lastSavedAt:_lastSavedAt};
    },{instrument,variant});
    const box=await page.locator('#mixCanvas').boundingBox();
    if(profile==='pending'){
     await page.mouse.move(box.x+box.width*.1,box.y+box.height*.35);await page.mouse.down();
     for(let i=0;i<12;i++){await page.mouse.move(box.x+box.width*(.1+i*.002),box.y+box.height*.35);await delay(17);}
     await page.mouse.up();await delay(100);
    }
    const initial=await page.evaluate(()=>({dirty:_canvasDirty,lastSavedAt:_lastSavedAt,history:painter.getHistoryLength()}));
    const x0=box.x+box.width*.08,x1=box.x+box.width*.92,y=box.y+box.height*.55;
    await page.mouse.move(x0,y);
    await page.evaluate(()=>{__straight.recording=true;__straight.started=performance.now();});
    await page.mouse.down();
    const begin=performance.now();let moves=0,next=begin;
    while(performance.now()-begin<duration){
     await delay(Math.max(0,next-performance.now()));
     const fraction=Math.min(1,(performance.now()-begin)/duration);
     await page.mouse.move(x0+(x1-x0)*fraction,y);moves++;
     // Do not replay a backlog of input events after a stall.
     next=Math.max(next+1000/60,performance.now()+1);
    }
    await page.mouse.up();
    await delay(1000);
    const data=await page.evaluate(()=>{
     __straight.recording=false;
     const {gl,timerExt,pendingGPU,...data}=__straight;
     for(const {q} of pendingGPU||[])gl.deleteQuery(q);
     return {...data,ended:performance.now(),dirty:_canvasDirty,lastSavedAt:_lastSavedAt,history:painter.getHistoryLength()};
    });
    const frames=data.frames.filter(f=>f.held).map(f=>f.interval);
    const inputIntervals=data.inputs.slice(1).map((v,i)=>v.at-data.inputs[i].at);
    const cpu=data.events.filter(e=>e.name==='scheduler-cpu'&&e.held).map(e=>e.duration);
    const summarize=xs=>({n:xs.length,p50:quantile(xs,.5),p95:quantile(xs,.95),p99:quantile(xs,.99),max:xs.length?Math.max(...xs):null,over25:xs.filter(x=>x>25).length});
    const summary={frames:summarize(frames),cpu:summarize(cpu),gpu:summarize(data.gpu),input:summarize(inputIntervals),
     longtasks:data.longtasks,overheadMs:data.overheadMs,
     peripheral:data.events.filter(e=>e.held&&e.name!=='scheduler-cpu'&&!e.name.startsWith('pointer'))};
    const run={repetition,variant,profile,metadata,initial,moves,cssSpeedPxPerSecond:(x1-x0)/(duration/1000),errors,summary,data};
    result.runs.push(run);fs.writeFileSync(output,JSON.stringify(result,null,2));
    console.log(JSON.stringify({repetition,variant,profile,metadata,initial,moves,summary}));
    if(errors.length)throw new Error(errors.join('\n'));
   }finally{await context.close();}
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
