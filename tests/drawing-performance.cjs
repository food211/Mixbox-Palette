// Real pointer input; observes existing scheduling without changing rendering or throttle values.
const { chromium } = require('playwright');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
if (!process.argv[2]) throw new Error('Usage: node tests/drawing-performance.cjs <baseline-base-painter.js> [results.json]');
const original = fs.readFileSync(process.argv[2], 'utf8');
const output = process.argv[3] || 'drawing-results.json';
const scenes = (process.env.PALETTE_SCENES || 'continuous,backlog-resume').split(',');
for (const scene of scenes) if (!['continuous', 'backlog-resume'].includes(scene)) throw new Error('Unknown scene: ' + scene);
const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const percentile = (xs, p) => xs.length ? xs.slice().sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1] : null;
(async () => {
 const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
 const results = { browser: await browser.version(), scenario: 'real mouse events; unmodified scheduler/throttles; watercolor default; container 960', runs: [] };
 try {
  for (let repetition = 0; repetition < 3; repetition++) for (const variant of repetition % 2 ? ['candidate','baseline'] : ['baseline','candidate']) {
   for (const scene of scenes) {
    const context = await browser.newContext({ viewport: { width:1440, height:1400 }, locale:'en-US' });
    try {
     const page = await context.newPage();
     await page.addInitScript(() => {
      localStorage.setItem('mixbox_container_width','960');
      window.__measure={events:[],frames:[],longtasks:[],recording:false,held:false};
      const m=window.__measure;
      const state=()=>({held:m.held, drawing:typeof isDrawing!=='undefined'&&isDrawing,
        stroke:!!window.painter?._strokeActive});
      document.addEventListener('pointerdown',e=>{if(e.target.id==='mixCanvas'){m.held=true;if(m.recording)m.events.push({name:'pointerdown',start:performance.now(),duration:0,...state()});}},true);
      document.addEventListener('pointerup',e=>{m.held=false;if(m.recording)m.events.push({name:'pointerup',start:performance.now(),duration:0,...state()});},true);
      let last=0;
      function raf(vsync){const now=performance.now();if(m.recording&&last)m.frames.push({start:last,end:now,interval:now-last,vsync,...state()});last=now;requestAnimationFrame(raf);}
      requestAnimationFrame(raf);
      try{new PerformanceObserver(list=>{if(m.recording)for(const e of list.getEntries())m.longtasks.push({start:e.startTime,duration:e.duration,...state()});}).observe({type:'longtask',buffered:false});}catch{}
      const idle=requestIdleCallback;
      window.requestIdleCallback=function(fn,options){return idle.call(window,deadline=>{
        const start=performance.now(),s=state();try{return fn(deadline);}finally{if(m.recording)m.events.push({name:'idle:'+fn.name,start,duration:performance.now()-start,...s});}
      },options);};
     });
     if(variant==='baseline')await page.route('**/js/base-painter.js',r=>r.fulfill({contentType:'application/javascript',body:original}));
     await page.route('**/js/announcer.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Announcer={init(){},checkUpdate(){}};'}));
     await page.goto(process.env.PALETTE_TEST_URL || 'http://127.0.0.1:8765/app.html');
     await page.waitForFunction(()=>typeof painter!=='undefined'&&painter&&document.querySelector('#paletteDropdown button'));
     const metadata = await page.evaluate(()=>{
      const m=__measure,p=painter;
      const state=()=>({held:m.held,drawing:isDrawing,stroke:p._strokeActive});
      const stack=[];
      for(const name of ['_idleBackupFrameDirect','_syncReadFrameToCPU','_readCanvasToCPU','toDataURLAsync','_scheduleAsyncRelease','_releaseFrame','_compressFrame']){
       const fn=p[name];p[name]=function(...args){const start=performance.now(),s=state();stack.push(name);let value;
        try{value=fn.apply(this,args);}finally{stack.pop();if(m.recording)m.events.push({name,start,duration:performance.now()-start,...s});}
        return value;
       };
      }
      const read=p.gl.readPixels;p.gl.readPixels=function(...args){const start=performance.now(),s=state();try{return read.apply(this,args);}finally{if(m.recording)m.events.push({name:'readPixels',caller:stack.at(-1),width:args[2],height:args[3],start,duration:performance.now()-start,...s});}};
      const write=paletteStorage.save;paletteStorage.save=function(...args){const start=performance.now(),s=state();try{return write.apply(this,args);}finally{if(m.recording)m.events.push({name:'canvas-storage-write',start,duration:performance.now()-start,...s});}};
      const ext=p.gl.getExtension('WEBGL_debug_renderer_info');
      return {canvas:[p.canvas.width,p.canvas.height],gpuSlots:p._maxGpuSlots,brush:currentBrush.type,renderer:ext?p.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null};
     });
     await delay(600);
     const box=await page.locator('#mixCanvas').boundingBox();
     await page.evaluate(()=>{__measure.recording=true;__measure.started=performance.now();});
     let moves=0;
     async function stroke(index,steps){
      const x=box.x+box.width*(.3+.06*(index%5)), y=box.y+box.height*(.3+.05*(index%5));
      await page.mouse.move(x,y);await page.mouse.down();
      const start=performance.now();
      for(let i=0;i<steps;i++){await delay(start+i*16-performance.now());await page.mouse.move(x+Math.sin(i*.15)*box.width*.18,y+Math.sin(i*.07)*box.height*.17);moves++;}
      await page.mouse.up();
     }
     if(scene==='continuous'){await stroke(0,16);await delay(100);await stroke(1,850);}
     else {for(let i=0;i<48;i++){await stroke(i,10);await delay(80);}await delay(220);await stroke(0,90);}
     await delay(600);
     await page.waitForFunction(() => !painter._workerPending.size && !painter._idleBackupScheduled && !painter._backupDeferred);
     const data=await page.evaluate(()=>{__measure.recording=false;return {...__measure,ended:performance.now(),history:painter.getHistoryLength(),pendingWorker:painter._workerPending.size};});
     const active=data.frames.filter(f=>f.held), stopped=data.frames.filter(f=>!f.held);
     const categories={};for(const e of data.events){if(e.name.startsWith('pointer'))continue;const key=e.name+(e.caller?':'+e.caller:'');const c=categories[key]||={count:0,held:0,stroke:0,totalMs:0,maxMs:0};c.count++;c.held+=+e.held;c.stroke+=+e.stroke;c.totalMs+=e.duration;c.maxMs=Math.max(c.maxMs,e.duration);}
     const summary={activeFrames:active.length,activeP50:percentile(active.map(f=>f.interval),.5),activeP95:percentile(active.map(f=>f.interval),.95),activeP99:percentile(active.map(f=>f.interval),.99),activeMax:Math.max(...active.map(f=>f.interval)),activeOver25:active.filter(f=>f.interval>25).length,stoppedP95:percentile(stopped.map(f=>f.interval),.95),longtasks:data.longtasks.length,categories};
     if(variant==='candidate' && data.events.some(e=>e.name==='_idleBackupFrameDirect' && e.held)) throw new Error('Idle history readback ran during pointer input');
     results.runs.push({repetition,variant,scene,moves,metadata,summary,data});
     fs.writeFileSync(output,JSON.stringify(results,null,2));
     console.log(JSON.stringify({repetition,variant,scene,moves,summary}));
    } finally {await context.close();}
   }
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
