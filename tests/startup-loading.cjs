// node --test tests/startup-loading.cjs — deterministic entry/loader/cache contract tests, no GPU.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.PALETTE_STARTUP_ROOT || path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const inline = file => [...source(file).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
function element() {
  const classes = new Set();
  return {style:{},hidden:true,textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},addEventListener(){},remove(){this.removed=true;}};
}
function runtime() {
  const timers = new Map(); let id = 0;
  const elements = new Map();
  const events = new Map();
  const body = element();
  const c = {console:{log(){},warn(){},error(){}},URL,URLSearchParams,AbortController,performance:{mark(){}},
    setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(n){timers.delete(n);},
    navigator:{language:'en'},location:{protocol:'https:',origin:'https://mixbox-palette.pages.dev',search:'?host=1.2.0',reload(){},replace(url){c.destination=url;}},
    document:{body,getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement(tag){return {...element(),tag,getContext:()=>({})};},head:{appendChild(){}}},
    localStorage:{getItem:()=>null},WebGLRenderingContext:function(){},addEventListener(name,fn){events.set(name,fn);},
    I18N:{init(){},getLang:()=> 'en',t:()=>''},Updater:{CURRENT_VERSION:'test'},Announcer:{init(){},checkUpdate(){}},
  };
  c.window=c; vm.createContext(c);
  return {c,timers,elements,events,body,fire(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}
function app(options={}) {
  const r=runtime(); const init=deferred(); const requests=[];
  r.c.initApp=()=>init.promise;
  if(options.sw) r.c.navigator.serviceWorker=options.sw;
  r.c.document.head.appendChild = s => {requests.push(s); if(s.tag==='script') queueMicrotask(()=>options.fail===s.src?s.onerror():s.onload());};
  vm.runInContext(inline('app.html'),r.c);
  const done=r.events.get('DOMContentLoaded')();
  return {...r,init,requests,done};
}
test('loading awaits initApp, including cursor preview; immediate input sees initialized handlers',async()=>{
  const r=app(); await flush();
  assert.equal(r.body.classList.contains('app-ready'),false);
  let inputReady=false; r.c.document.getElementById('mixCanvas').onpointerdown=()=>{inputReady=true;};
  r.init.resolve({ready:true,cursorPreview:{status:'ready'}});await r.done;
  assert.equal(r.body.classList.contains('app-ready'),true);
  r.c.document.getElementById('mixCanvas').onpointerdown();assert.equal(inputReady,true);
  assert(!r.requests.some(s=>s.src==='js/mixbox.js'),'alternate engine executes only on demand');
  assert(r.requests.some(s=>s.tag==='link'&&s.href==='js/app.js'),'app download starts before its dependency execution');
});
for(const status of ['timeout','failed','unavailable','cancelled'])test(`preview ${status} permits core-ready UI`,async()=>{
  const r=app();r.init.resolve({ready:true,cursorPreview:{status}});await r.done;
  assert.equal(r.body.classList.contains('app-ready'),true);
});
test('core rejection keeps UI hidden and exposes Retry',async()=>{
  const r=app();await flush();r.init.reject(Error('core failure'));await r.done;
  assert.equal(r.body.classList.contains('app-ready'),false);
  assert.equal(r.elements.get('appLoadRetry').hidden,false);
});
test('15 s watchdog never declares uninitialized UI ready',async()=>{
  const r=app();await flush();r.fire(15000);
  assert.equal(r.body.classList.contains('app-ready'),false);
  assert.equal(r.elements.get('appLoadRetry').hidden,false);
  r.init.resolve({ready:true,cursorPreview:{status:'ready'}});await r.done;
  assert.equal(r.body.classList.contains('app-ready'),true,'late successful initialization can recover');
});
test('incompatible host stays on its dedicated UI',async()=>{
  const r=app();r.init.resolve({ready:false,reason:'incompatible-host'});await r.done;
  assert.equal(r.body.classList.contains('app-ready'),false);
});
test('a core script failure is handled without revealing an incomplete UI',async()=>{
  const r=app({fail:'js/params.js'});await r.done;
  assert.equal(r.body.classList.contains('app-ready'),false);
  assert.equal(r.elements.get('appLoadRetry').hidden,false);
});
test('SW registration denied still initializes via network',async()=>{
  const r=app({sw:{controller:null,register:()=>Promise.reject(Error('denied')),addEventListener(){},removeEventListener(){}}});
  r.init.resolve({ready:true});await r.done;assert.equal(r.body.classList.contains('app-ready'),true);
});
test('SW claim is awaited, but a stuck worker has a bounded fallback',async()=>{
  const r=app({sw:{controller:null,register:()=>new Promise(()=>{}),addEventListener(){},removeEventListener(){}}});
  await flush();assert.equal(r.requests.length,0);
  r.fire(3000);await flush();assert(r.requests.length>0);
  r.init.resolve({ready:true});await r.done;
});
test('index only probes sources, cancels loser, preserves host query',async()=>{
  const r=runtime();const calls=[];
  r.c.fetch=(url,opts)=>{calls.push({url,opts});return url.includes('pages.dev')?Promise.reject(Error('offline')):Promise.resolve({ok:true});};
  vm.runInContext(inline('index.html'),r.c);await flush();
  assert.equal(calls.length,2);assert(calls.every(c=>c.url.endsWith('js/updater.js')));
  assert.equal(r.c.destination,'https://food211.github.io/Mixbox-Palette/app.html?host=1.2.0');
  assert(calls.every(c=>c.opts.signal.aborted));assert.equal(r.timers.size,0);
});
test('all probes fail: navigate current source for offline snapshot recovery',async()=>{
  const r=runtime();r.c.fetch=()=>Promise.reject(Error('offline'));
  vm.runInContext(inline('index.html'),r.c);await flush();
  assert.equal(r.c.destination,'https://mixbox-palette.pages.dev/app.html?host=1.2.0');
});
test('source timeout is bounded even if a host ignores AbortSignal',async()=>{
  const r=runtime();r.c.fetch=()=>new Promise(()=>{});
  vm.runInContext(inline('index.html'),r.c);r.fire(4000);await flush();
  assert(r.c.destination);assert.equal(r.timers.size,0);
});
function worker(redirect) {
  const stored=new Map();const events=new Map();let deleted=false;const fetched=[];
  const cache={put:async(k,v)=>stored.set(k,v),match:async k=>stored.get(k)};
  const c={URL,Response,Set,Date,console:{log(){},warn(){}},caches:{has:async()=>false,open:async()=>cache,delete:async()=>{deleted=true;stored.clear();}},
    self:{location:new URL('https://palette.test/project/sw.js'),addEventListener:(n,fn)=>events.set(n,fn)},
    fetch:async(url)=>{fetched.push(url);const isApp=url.includes('/app.html');return {ok:true,status:200,statusText:'OK',headers:{},body:'snapshot',redirected:isApp&&!!redirect,url:isApp&&redirect?redirect:url};}};
  vm.createContext(c);vm.runInContext(source('sw.js'),c);
  return {c,stored,events,fetched,get deleted(){return deleted;}};
}
test('SW accepts only expected same-origin app canonicalization and serves alias immutably',async()=>{
  const r=worker('https://palette.test/project/app?sw=test');await vm.runInContext('precacheSnapshot()',r.c);
  assert.equal(r.stored.size,40);assert.equal(r.stored.get('https://palette.test/project/app.html').redirected,false);
  let response; r.events.get('fetch')({request:{method:'GET',url:'https://palette.test/project/app?host=1.2.0'},respondWith:p=>{response=p;}});
  assert.equal(await (await response).text(),'snapshot');assert.equal(r.fetched.length,40);
});
for(const redirect of ['https://other.test/project/app','https://palette.test/login'])test(`SW rejects unexpected redirect ${redirect}`,async()=>{
  const r=worker(redirect);await assert.rejects(vm.runInContext('precacheSnapshot()',r.c));assert(r.deleted);assert.equal(r.stored.size,0);
});
