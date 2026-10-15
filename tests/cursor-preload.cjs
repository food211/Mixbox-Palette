// Browser regression for selected-only hidden cursor resources and original pixels.
const {chromium}=require('playwright');
const {test:nodeTest,before,after}=require('node:test');
const assert=require('node:assert/strict');
const test=(name,fn)=>nodeTest(name,{timeout:30000},fn);
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});});
after(async()=>{await browser?.close();});
async function withPage(run,init,settle=true){
 const context=await browser.newContext({viewport:{width:1440,height:1400},locale:'en-US'});
 try{
  const page=await context.newPage();
  await page.addInitScript(()=>{
   localStorage.setItem('mixbox_container_width','960');
   window.__cursorAudit={textures:0,deletedTextures:0,fences:0,deletedFences:0,polls:[],builds:[],sourceBuilds:[],entries:[],bindingChecks:[]};
   const create=document.createElement.bind(document);
   document.createElement=function(name,...args){const result=create(name,...args);if(name==='canvas'&&(new Error().stack.split('\n')[2]||'').includes('runCursorPreviewPreload'))__cursorAudit.entries.push(result);return result;};
   for(const [createName,deleteName,created,deleted] of [['createTexture','deleteTexture','textures','deletedTextures'],['fenceSync','deleteSync','fences','deletedFences']]){
    const createResource=WebGL2RenderingContext.prototype[createName],deleteResource=WebGL2RenderingContext.prototype[deleteName],owned=new Set();
    WebGL2RenderingContext.prototype[createName]=function(...args){const resource=createResource.apply(this,args);if(resource&&new Error().stack.includes('flushCursorPreview')){owned.add(resource);__cursorAudit[created]++;}return resource;};
    WebGL2RenderingContext.prototype[deleteName]=function(resource){if(owned.delete(resource))__cursorAudit[deleted]++;return deleteResource.call(this,resource);};
   }
   const wait=WebGL2RenderingContext.prototype.clientWaitSync;
   WebGL2RenderingContext.prototype.clientWaitSync=function(...args){__cursorAudit.polls.push({flags:args[1],timeout:args[2]});return wait.apply(this,args);};
  });
  if(init)await page.addInitScript(init);
  await page.route('**/js/brush-manager.js',async route=>{
   const response=await route.fetch(),source=await response.text();
   await route.fulfill({response,body:source+"\n{const original=BrushManager.prototype.createBrushTexture;BrushManager.prototype.createBrushTexture=function(size,brush){__cursorAudit.builds.push({size,type:brush.type});return original.call(this,size,brush);};const build=BrushManager.prototype._buildBrushCanvas;BrushManager.prototype._buildBrushCanvas=function(size,brush){__cursorAudit.sourceBuilds.push({size,type:brush.type});return build.call(this,size,brush);};}"});
  });
  await page.route('**/js/app.js',async route=>{
   const response=await route.fetch(),source=await response.text();
   const probe=`    const originalCursorFlush = flushCursorPreview;
    flushCursorPreview = function(entry, owner) {
        const gl=owner.gl,keys=[gl.ACTIVE_TEXTURE,gl.TEXTURE_BINDING_2D,gl.FRAMEBUFFER_BINDING,gl.CURRENT_PROGRAM,gl.UNPACK_FLIP_Y_WEBGL,gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,gl.PACK_ALIGNMENT,gl.UNPACK_ALIGNMENT];
        const before=keys.map(key=>gl.getParameter(key));
        const pending=originalCursorFlush(entry,owner);
        __cursorAudit.bindingChecks.push(keys.every((key,index)=>gl.getParameter(key)===before[index]));
        return pending;
    };
    const cursorPreviewCache = [];`;
   const capture=`\n{const init=window.initApp;window.initApp=(...args)=>window.__cursorInit=init(...args);}`;
   await route.fulfill({response,body:source.replace('    const cursorPreviewCache = [];',probe)+capture});
  });
  await page.route('**/js/frame-scheduler.js',async r=>{await page.waitForFunction(()=>typeof DeviceProfile!=='undefined');await r.continue();});
  await page.route('**/js/announcer.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Announcer={init(){},checkUpdate(){}};'}));
  await page.goto(process.env.PALETTE_TEST_URL||'http://127.0.0.1:8765/app.html');
  await page.waitForFunction(()=>typeof window.requestBrushCursorPreload==='function'&&typeof painter!=='undefined'&&painter&&document.querySelector('#paletteDropdown button'));
  await page.evaluate(async settle=>{
   if(settle)await window.requestBrushCursorPreload();
   window.__cursorState=()=>({canvas:painter.toDataURL('image/png'),history:painter.getHistoryLength(),step:painter.getHistoryStep(),dirty:_canvasDirty});
   window.__selectCursorBrush=type=>{
    const index=brushManager.getPresetBrushes().findIndex(b=>b.type===type);
    if(index<0)throw new Error('Unknown brush '+type);
    document.querySelectorAll('#brushGrid .brush-option')[index].click();
   };
  },settle);
  await run(page);
 }finally{await context.close();}
}

test('initApp remains pending until the current hidden preview is GPU ready, then permits immediate drawing',async()=>withPage(async page=>{
 await page.waitForFunction(()=>__cursorAudit.fences>0);
 const pending=await page.evaluate(async()=>Promise.race([__cursorInit.then(()=>false),new Promise(resolve=>setTimeout(()=>resolve(true),25))]));
 assert(pending,'initApp must wait for the preview fence');
 const result=await page.evaluate(async()=>{window.__holdCursorFence=false;return await __cursorInit;});
 assert.equal(result.ready,true);assert.equal(result.cursorPreview.status,'ready');
 const before=await page.evaluate(()=>({textures:__cursorAudit.textures,history:painter.getHistoryLength()}));
 const box=await page.locator('#mixCanvas').boundingBox();
 await page.mouse.move(box.x+100,box.y+100);await page.mouse.down();await page.mouse.move(box.x+150,box.y+100);await page.mouse.up();
 await page.waitForFunction(n=>painter.getHistoryLength()>n,before.history);
 assert.equal(await page.evaluate(()=>__cursorAudit.textures),before.textures);
},()=>{
 window.__holdCursorFence=true;const wait=WebGL2RenderingContext.prototype.clientWaitSync;
 WebGL2RenderingContext.prototype.clientWaitSync=function(...args){return window.__holdCursorFence?this.TIMEOUT_EXPIRED:wait.apply(this,args);};
},false));

test('startup preview failure returns a fallback result and releases resources',async()=>withPage(async page=>{
 const result=await page.evaluate(async()=>({init:await __cursorInit,balanced:__cursorAudit.textures===__cursorAudit.deletedTextures&&__cursorAudit.fences===__cursorAudit.deletedFences}));
 assert.equal(result.init.ready,true);assert.equal(result.init.cursorPreview.status,'failed');assert(result.balanced);
 const box=await page.locator('#mixCanvas').boundingBox();await page.mouse.move(box.x+100,box.y+100);
 assert.equal(await page.locator('#brushCursor').evaluate(c=>getComputedStyle(c).display),'block');
},()=>{WebGL2RenderingContext.prototype.fenceSync=()=>null;},false));

test('startup timeout bounds the entire batch, cancels pending GPU resources and permits a later retry',async()=>withPage(async page=>{
 const result=await page.evaluate(async()=>{
  const init=await __cursorInit;
  const balanced=__cursorAudit.textures===__cursorAudit.deletedTextures&&__cursorAudit.fences===__cursorAudit.deletedFences;
  window.__holdCursorFence=false;
  const retry=await requestBrushCursorPreload();
  return {init,balanced,retry,retained:__cursorAudit.entries.filter(c=>!c.isConnected&&c.width>0).length};
 });
 assert.equal(result.init.ready,true);assert.equal(result.init.cursorPreview.status,'timeout');assert(result.balanced);
 assert.equal(result.retry.status,'ready');assert(result.retained<=3);
},()=>{
 window.__holdCursorFence=true;const wait=WebGL2RenderingContext.prototype.clientWaitSync;
 WebGL2RenderingContext.prototype.clientWaitSync=function(...args){return window.__holdCursorFence?this.TIMEOUT_EXPIRED:wait.apply(this,args);};
},false));

test('rapid selection during the startup wait resolves readiness for the latest brush only',async()=>withPage(async page=>{
 await page.waitForFunction(()=>__cursorAudit.fences>0);
 const result=await page.evaluate(async()=>{
  __selectCursorBrush('circle');__selectCursorBrush('splatter');__selectCursorBrush('dry');
  window.__holdCursorFence=false;
  return {init:await __cursorInit,type:currentBrush.type};
 });
 assert.equal(result.init.cursorPreview.status,'ready');assert.equal(result.type,'dry');assert(result.init.cursorPreview.key.startsWith('dry_'));
},()=>{
 window.__holdCursorFence=true;const wait=WebGL2RenderingContext.prototype.clientWaitSync;
 WebGL2RenderingContext.prototype.clientWaitSync=function(...args){return window.__holdCursorFence?this.TIMEOUT_EXPIRED:wait.apply(this,args);};
},false));

test('early pen input can continue while startup is pending and pen-up resumes the latest preview',async()=>withPage(async page=>{
 await page.waitForFunction(()=>__cursorAudit.fences>0);
 const before=await page.evaluate(()=>{
  const rect=mixCanvas.getBoundingClientRect(),options={bubbles:true,pointerId:41,pointerType:'pen',pressure:.7,buttons:1,button:0,clientX:rect.left+100,clientY:rect.top+100};
  mixCanvas.dispatchEvent(new PointerEvent('pointerdown',options));
  mixCanvas.dispatchEvent(new PointerEvent('pointermove',{...options,clientX:rect.left+130}));
  __selectCursorBrush('dry');window.__holdCursorFence=false;
  return {drawing:isDrawing,textures:__cursorAudit.textures};
 });
 assert(before.drawing);await page.waitForTimeout(30);
 assert.equal(await page.evaluate(()=>__cursorAudit.textures),before.textures);
 const result=await page.evaluate(async()=>{
  const rect=mixCanvas.getBoundingClientRect();mixCanvas.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:41,pointerType:'pen',buttons:0,clientX:rect.left+130,clientY:rect.top+100}));
  return {init:await __cursorInit,drawing:isDrawing};
 });
 assert.equal(result.drawing,false);assert.equal(result.init.cursorPreview.status,'ready');assert(result.init.cursorPreview.key.startsWith('dry_'));
},()=>{
 window.__holdCursorFence=true;const wait=WebGL2RenderingContext.prototype.clientWaitSync;
 WebGL2RenderingContext.prototype.clientWaitSync=function(...args){return window.__holdCursorFence?this.TIMEOUT_EXPIRED:wait.apply(this,args);};
},false));

test('startup stays hidden, resources finish, duplicate request reuses the current preview',async()=>withPage(async page=>{
 const result=await page.evaluate(async()=>{
  const state=__cursorState(),audit=__cursorAudit;
  const before={textures:audit.textures,fences:audit.fences,builds:audit.sourceBuilds.length};
  await requestBrushCursorPreload();await requestBrushCursorPreload();
  return {stateStable:JSON.stringify(state)===JSON.stringify(__cursorState()),display:getComputedStyle(document.getElementById('brushCursor')).display,
   before,after:{textures:audit.textures,fences:audit.fences,builds:audit.sourceBuilds.length},
   balanced:audit.textures===audit.deletedTextures&&audit.fences===audit.deletedFences,
   hidden:audit.entries.every(c=>!c.isConnected),onlySelected:audit.builds.every(b=>b.type===currentBrush.type),polls:audit.polls,bindingChecks:audit.bindingChecks};
 });
 assert(result.stateStable);assert.equal(result.display,'none');assert(result.hidden);assert(result.balanced);assert(result.onlySelected);
 assert.deepEqual(result.after,result.before);assert(result.polls.length>0);assert(result.polls.every(p=>p.flags===0&&p.timeout===0));
 assert(result.bindingChecks.length>0);assert(result.bindingChecks.every(Boolean));
}));

test('history queue wait also times out without changing palette state or starting GPU work',async()=>withPage(async page=>{
 const result=await page.evaluate(async()=>{
  const before=__cursorState(),scheduled=painter._idleBackupScheduled,count=__cursorAudit.textures;
  painter._idleBackupScheduled=true;
  const status=await requestBrushCursorPreload();
  painter._idleBackupScheduled=scheduled;
  return {status,stable:JSON.stringify(before)===JSON.stringify(__cursorState()),textures:__cursorAudit.textures,count};
 });
 assert.equal(result.status.status,'timeout');assert(result.stable);assert.equal(result.textures,result.count);
}));

test('startup restores and prepares only the saved selected brush',async()=>withPage(async page=>{
 const result=await page.evaluate(()=>({type:currentBrush.type,builds:__cursorAudit.builds.map(b=>b.type)}));
 assert.equal(result.type,'circle');assert(result.builds.length>0);assert(result.builds.every(type=>type==='circle'));
},()=>localStorage.setItem('mb_tool_brush',JSON.stringify({brushType:'circle',size:40}))));

test('real selection prepares without hover, rapid switches keep only the latest pending brush',async()=>withPage(async page=>{
 await page.locator('#brushPreviewBtn').click();
 const index=await page.evaluate(()=>brushManager.getPresetBrushes().findIndex(b=>b.type==='circle'));
 await page.locator('#brushGrid .brush-option').nth(index).click();
 await page.evaluate(()=>requestBrushCursorPreload());
 const result=await page.evaluate(async()=>{
  const state=__cursorState();__cursorAudit.builds=[];
  const gl=painter.gl,wait=gl.clientWaitSync;
  gl.clientWaitSync=()=>gl.TIMEOUT_EXPIRED;
  __selectCursorBrush('splatter');
  await new Promise(requestAnimationFrame);
  __selectCursorBrush('watercolor');__selectCursorBrush('circle');__selectCursorBrush('dry');
  await new Promise(requestAnimationFrame);
  gl.clientWaitSync=wait;
  await requestBrushCursorPreload();
  return {types:__cursorAudit.builds.map(b=>b.type),current:currentBrush.type,
   stateStable:JSON.stringify(state)===JSON.stringify(__cursorState()),display:getComputedStyle(document.getElementById('brushCursor')).display};
 });
 assert.deepEqual(result.types,['splatter','dry']);assert.equal(result.current,'dry');assert(result.stateStable);assert.equal(result.display,'none');
}));

test('preview cache is bounded and repeated previous selections reuse retained canvases',async()=>withPage(async page=>{
 const result=await page.evaluate(async()=>{
  for(const type of ['circle','dry']){__selectCursorBrush(type);await requestBrushCursorPreload();}
  const count=__cursorAudit.textures;
  __selectCursorBrush('circle');await requestBrushCursorPreload();
  const reused=__cursorAudit.textures===count;
  for(let size=30;size<45;size++){brushSizeInput.value=size;brushSizeInput.dispatchEvent(new Event('input'));await requestBrushCursorPreload();}
  return {reused,retained:__cursorAudit.entries.filter(c=>!c.isConnected&&c.width>0).length,
   balanced:__cursorAudit.textures===__cursorAudit.deletedTextures&&__cursorAudit.fences===__cursorAudit.deletedFences};
 });
 assert(result.reused);assert(result.retained<=3);assert(result.balanced);
}));

test('returning to a brush refreshes a cached preview when its source variant changed',async()=>withPage(async page=>{
 const box=await page.locator('#mixCanvas').boundingBox();
 await page.mouse.move(box.x+100,box.y+100);
 const before=await page.locator('#brushCursor').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 await page.evaluate(async()=>{__selectCursorBrush('circle');await requestBrushCursorPreload();});
 await page.mouse.move(box.x+110,box.y+100);
 await page.evaluate(async()=>{
  const diameter=brushSize*mixCanvas.getBoundingClientRect().width/mixCanvas.width/getCurrentZoom();
  brushManager.refreshRandomBrush(Math.ceil(diameter/2),{type:'watercolor',image:null});
  __selectCursorBrush('watercolor');await requestBrushCursorPreload();
 });
 await page.mouse.move(box.x+120,box.y+100);
 const after=await page.locator('#brushCursor').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 let alphaDifference=0;for(let i=3;i<before.length;i+=4)alphaDifference+=Math.abs(before[i]-after[i]);
 assert(alphaDifference>128,'a changed underlying brush source must not reuse its old outline');
}));

test('input continues while a newer preview is deferred until pen-up',async()=>withPage(async page=>{
 const box=await page.locator('#mixCanvas').boundingBox();
 await page.mouse.move(box.x+100,box.y+100);await page.mouse.down();
 const result=await page.evaluate(()=>{
  const count=__cursorAudit.textures;brushSizeInput.value=65;brushSizeInput.dispatchEvent(new Event('input'));
  return {count,drawing:isDrawing};
 });
 await page.mouse.move(box.x+140,box.y+100);await page.waitForTimeout(50);
 assert.equal(await page.evaluate(()=>__cursorAudit.textures),result.count);assert(result.drawing);
 await page.mouse.up();await page.evaluate(()=>requestBrushCursorPreload());
 const after=await page.evaluate(()=>({drawing:isDrawing,width:document.getElementById('brushCursor').width,
  expected:Math.ceil(brushSize*mixCanvas.getBoundingClientRect().width/mixCanvas.width/getCurrentZoom())+6}));
 assert.equal(after.drawing,false);assert.equal(after.width,after.expected);
}));

test('pagehide cancels pending GPU resources and bfcache resume prepares the current selection',async()=>withPage(async page=>{
 const result=await page.evaluate(async()=>{
  const gl=painter.gl,wait=gl.clientWaitSync;gl.clientWaitSync=()=>gl.TIMEOUT_EXPIRED;
  brushSizeInput.value=77;brushSizeInput.dispatchEvent(new Event('input'));
  await new Promise(requestAnimationFrame);
  window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
  await requestBrushCursorPreload();
  const balanced=__cursorAudit.textures===__cursorAudit.deletedTextures&&__cursorAudit.fences===__cursorAudit.deletedFences;
  gl.clientWaitSync=wait;
  window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
  await requestBrushCursorPreload();
  return {balanced,retained:__cursorAudit.entries.filter(c=>!c.isConnected&&c.width>0).length};
 });
 assert(result.balanced);assert(result.retained<=3);
}));

test('engine replacement during preparation preserves pixels and settles the old job',async()=>withPage(async page=>{
 const result=await page.evaluate(async()=>{
  const before=painter.toDataURL('image/png'),gl=painter.gl,wait=gl.clientWaitSync;
  gl.clientWaitSync=()=>gl.TIMEOUT_EXPIRED;
  brushSizeInput.value=67;brushSizeInput.dispatchEvent(new Event('input'));
  await new Promise(requestAnimationFrame);
  await switchEngine(currentEngine==='km'?'mixbox':'km');
  gl.clientWaitSync=wait;
  await requestBrushCursorPreload();
  return {same:before===painter.toDataURL('image/png'),engine:currentEngine};
 });
 assert(result.same);assert.equal(result.engine,'mixbox');
}));

test('failed fence falls back to the ordinary visible preview without hanging',async()=>withPage(async page=>{
 await page.evaluate(async()=>{
  const gl=painter.gl,fence=gl.fenceSync;gl.fenceSync=()=>null;
  brushSizeInput.value=93;brushSizeInput.dispatchEvent(new Event('input'));await requestBrushCursorPreload();gl.fenceSync=fence;
 });
 const box=await page.locator('#mixCanvas').boundingBox();await page.mouse.move(box.x+200,box.y+100);
 assert.equal(await page.locator('#brushCursor').evaluate(c=>getComputedStyle(c).display),'block');
}));

test('hidden preload preserves original cursor RGBA and actual canvas/history/dirty state',async()=>withPage(async page=>{
 const comparisons=await page.evaluate(async()=>{
  const state=__cursorState(),results=[];
  // Frozen b4407933 cursor recipe: compare to the original GPU backend, with one
  // read per fresh canvas so readback heuristics cannot change the reference backend.
  function reference(source,size){
   const pad=3,total=size+6,c=document.createElement('canvas');c.width=c.height=total;
   const ctx=c.getContext('2d'),mask=document.createElement('canvas');mask.width=mask.height=total;
   const mc=mask.getContext('2d');mc.fillStyle='#000';mc.drawImage(source,pad,pad,size,size);
   ctx.save();ctx.shadowColor='rgba(0,0,0,0.9)';ctx.shadowBlur=2;ctx.globalCompositeOperation='source-over';ctx.drawImage(mask,0,0);ctx.restore();
   ctx.save();ctx.shadowColor='rgba(255,255,255,0.95)';ctx.shadowBlur=1;ctx.drawImage(mask,0,0);ctx.restore();
   ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over';
   return ctx.getImageData(0,0,total,total).data;
  }
  for(let pattern=0;pattern<2;pattern++){
   const source=document.createElement('canvas');source.width=source.height=31;
   const ctx=source.getContext('2d',{willReadFrequently:true}),pixels=ctx.createImageData(31,31);
   for(let y=0;y<31;y++)for(let x=0;x<31;x++){const i=(y*31+x)*4;pixels.data[i]=33;pixels.data[i+1]=77;pixels.data[i+2]=129;pixels.data[i+3]=pattern?((x*17+y*37)%256):((x-15)**2+(y-15)**2<150?255:0);}
   ctx.putImageData(pixels,0,0);const image=new Image();image.src=source.toDataURL();await image.decode();currentBrush.image=image;
   for(const size of [20,40,100,240]){
    brushSize=size;await requestBrushCursorPreload();
    const rect=mixCanvas.getBoundingClientRect();
    mixCanvas.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.left+100,clientY:rect.top+100,bubbles:true}));
    const c=document.getElementById('brushCursor'),actual=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const expected=reference(image,c.width-6);let changed=0;
    for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])changed++;
    results.push({pattern,size,changed});
   }
  }
  return {results,stateStable:JSON.stringify(state)===JSON.stringify(__cursorState())};
 });
 assert(comparisons.stateStable);assert(comparisons.results.every(r=>r.changed===0),JSON.stringify(comparisons.results));
}));
