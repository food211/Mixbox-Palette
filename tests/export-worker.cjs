// Local browser regression for asynchronous export snapshot ownership and failure recovery.
const {chromium}=require('playwright');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});});
after(async()=>{await browser?.close();});
for(const mode of ['normal','reply-error','fatal-error','message-error','post-error','unavailable','dom-fallback','clear-history','concurrent']){
 test(`export retains captured pixels through ${mode}`,{timeout:30000},async()=>{
  const context=await browser.newContext();
  try{
   const page=await context.newPage();
   await page.route('**/js/announcer.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Announcer={init(){},checkUpdate(){}};'}));
   await page.goto(process.env.PALETTE_TEST_URL||'http://127.0.0.1:8765/app.html');
   await page.waitForFunction(()=>typeof painter!=='undefined'&&painter&&document.querySelector('#paletteDropdown button'));
   await page.waitForFunction(()=>!painter._workerPending.size&&!painter._idleBackupScheduled);
   const result=await page.evaluate(async mode=>{
    const p=painter,w=p.canvas.width,h=p.canvas.height;
    p.notifyStrokeStart();
    const source=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<source.length;i+=4){source[i]=(i*37)%256;source[i+1]=(i*13+67)%256;source[i+2]=(i*71+11)%256;source[i+3]=i%12?255:128;}
    const changed=source.map((value,i)=>i%4===3?255:255-value);
    p.writeFromPixels(source,w,h);
    const request=p._workerRequest;
    p._workerRequest=()=>Promise.reject(new Error('reference: use original main-thread encoder'));
    const reference=await p.toDataURLAsync('image/webp',1);
    p._workerRequest=request;
    const worker=p._ensureHistoryWorker();
    let sent=0;
    if(['unavailable','dom-fallback'].includes(mode)){
     worker?.terminate();p._historyWorker=null;window.Worker=undefined;
     if(mode==='dom-fallback')window.OffscreenCanvas=undefined;
    }else{
     const post=worker.postMessage.bind(worker);
     worker.postMessage=function(msg,...args){
      if(msg.type==='compress'){
       sent++;
       if(mode==='post-error')throw new Error('injected post failure');
       if(mode==='reply-error'){queueMicrotask(()=>worker.onmessage({data:{type:'error',id:msg.id,reason:'injected codec failure'}}));return;}
       if(mode==='fatal-error'||mode==='message-error'){queueMicrotask(()=>worker[mode==='fatal-error'?'onerror':'onmessageerror']({message:'injected worker failure'}));return;}
      }
      return post(msg,...args);
     };
    }
    const pending=p.toDataURLAsync('image/webp',1);
    if(mode==='clear-history')p.clearHistory();
    p.writeFromPixels(changed,w,h);
    let expectedNext,actualNext;
    if(mode==='concurrent'){
     p._workerRequest=()=>Promise.reject(new Error('second reference'));
     expectedNext=await p.toDataURLAsync('image/webp',1);
     p._workerRequest=request;
     actualNext=await p.toDataURLAsync('image/webp',1);
    }
    const actual=await pending;
    async function hash(url){
     const bitmap=await createImageBitmap(await(await fetch(url)).blob());
     const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
     const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
     const bytes=ctx.getImageData(0,0,w,h).data;
     return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    }
    return {actual:await hash(actual),reference:await hash(reference),pending:p._workerPending.size,sent,
     next:actualNext&&await hash(actualNext),expectedNext:expectedNext&&await hash(expectedNext),mime:actual.slice(0,23)};
   },mode);
   assert.equal(result.actual,result.reference,'worker and every fallback must retain the originally captured image');
   assert.equal(result.next,result.expectedNext);
   assert.equal(result.pending,0,'no orphan worker requests remain');
   assert(result.mime.startsWith('data:image/webp'));
   if(!['unavailable','dom-fallback'].includes(mode))assert(result.sent>0,'exercise the actual worker request boundary');
  }finally{await context.close();}
 });
}
