// node tests/startup-browser.cjs
// Playwright + CHROMIUM_PATH. Uses isolated HTTP fixtures, never contacts production.
// Real script download/parse/evaluation; mock initApp avoids GPU contention for cache tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require('playwright');
const root = process.env.PALETTE_STARTUP_ROOT || path.resolve(__dirname, '..');
const codeRoot = process.env.PALETTE_CODE_ROOT || root;
const read = file => fs.readFileSync(path.join(['app.html','index.html','sw.js'].includes(file) ? root : codeRoot, file));
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
let origin, version = 1, canonical = false, failedSnapshot = false;
const requests = [];
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const file = decodeURIComponent(url.pathname).replace(/^\/(a|b)\//, '/').slice(1) || 'index.html';
    requests.push(req.url);
    if (canonical && file === 'app.html') {
        res.writeHead(308, {Location:url.pathname.replace(/\.html$/, '') + url.search});
        return res.end();
    }
    if (failedSnapshot && file === 'js/mixbox.js' && url.searchParams.has('sw')) {
        res.writeHead(503); return res.end();
    }
    try {
        let data, ext = path.extname(file);
        if (file === 'app.html' || file === 'app') {
            ext = '.html';
            data = read('app.html').toString()
                .replace('function isWebGLSupported() {', 'function isWebGLSupported() { return true;')
                .replace('var h = location.hostname;', 'return; var h = location.hostname;')
                .replace('</head>', `<script>window.snapshotVersion=${version};</script></head>`);
        } else if (file === 'index.html') {
            data = read(file).toString().replaceAll('https://mixbox-palette.pages.dev/',origin+'/a/').replaceAll('https://food211.github.io/Mixbox-Palette/',origin+'/b/');
        } else if (file === 'sw.js') {
            data = read(file).toString().replace(/const CACHE_NAME = '[^']+'/,`const CACHE_NAME = 'km-palette-test-${version}'`);
        } else data = read(file);
        if (file === 'js/app.js') data += '\nwindow.initApp=async()=>{await new Promise(r=>setTimeout(r,40));window.coreReady=true;return {ready:true,cursorPreview:{status:"ready"}};};';
        if (file === 'js/announcer.js') data += '\nAnnouncer.init=()=>{};';
        res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'max-age=600','Access-Control-Allow-Origin':'*'});
        res.end(data);
    } catch {res.writeHead(404);res.end();}
});
(async()=>{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    origin=`http://palette.test:${server.address().port}`;
    let browser;
    try {
        const launchOptions={headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP palette.test 127.0.0.1',`--unsafely-treat-insecure-origin-as-secure=${origin}`]};
        browser=await chromium.launch(launchOptions);
        const context=await browser.newContext();
        const page=await context.newPage();
        const errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        const ready=p=>p.waitForFunction(()=>window.coreReady&&document.body.classList.contains('app-ready'));
        await page.goto(origin+'/index.html?host=1.2.0');await ready(page);
        assert(page.url().endsWith('app.html?host=1.2.0'));
        assert.equal(requests.filter(p=>p.includes('?sw=')).length,40);
        assert(!requests.some(p=>/\/js\/(params|app|mixbox)\.js$/.test(p)),'no throwaway entry preloads or uncontrolled script requests');
        assert.equal(await page.evaluate(()=>!!navigator.serviceWorker.controller),true);
        const firstApp=page.url();
        const count=requests.length;
        await page.reload();await ready(page);
        assert.equal(requests.length,count,'warm app uses only immutable snapshot');
        await context.setOffline(true);
        await page.reload();await ready(page);
        assert.equal(requests.length,count,'offline app performs no network requests');
        // A new page must also be controlled before scripts are fetched.
        const coldPage=await context.newPage();await coldPage.goto(firstApp);await ready(coldPage);await coldPage.close();
        await context.setOffline(false);
        console.log('PASS cold/warm/offline/new-page startup and zero duplicate core downloads');

        version=2;failedSnapshot=true;
        await page.evaluate(async()=>{
            const registration=await navigator.serviceWorker.getRegistration();
            const failed=new Promise(resolve=>registration.addEventListener('updatefound',()=>{
                const worker=registration.installing;
                worker.addEventListener('statechange',()=>{if(worker.state==='redundant')resolve();});
            },{once:true}));
            await registration.update();await failed;
        });
        assert.deepEqual(await page.evaluate(()=>caches.keys()),['km-palette-test-1']);
        await context.setOffline(true);
        await page.reload();await ready(page);
        assert.equal(await page.evaluate(()=>window.snapshotVersion),1,'failed upgrade retains old complete HTML and scripts');
        await context.setOffline(false);
        console.log('PASS partial upgrade discards new snapshot and retains complete old version');
        failedSnapshot=false;
        await page.evaluate(()=>navigator.serviceWorker.getRegistration().then(r=>r.update()));
        await page.waitForFunction(()=>window.snapshotVersion===2&&window.coreReady&&document.body.classList.contains('app-ready'));
        assert.deepEqual(await page.evaluate(()=>caches.keys()),['km-palette-test-2']);
        await page.reload();await ready(page);
        assert.equal(await page.evaluate(()=>window.snapshotVersion),2);
        assert.deepEqual(errors,[]);
        await context.close();
        console.log('PASS successful upgrade refreshes once and repeated reload remains stable');

        canonical=true;version=3;
        const aliasContext=await browser.newContext();
        const aliasPage=await aliasContext.newPage();
        await aliasPage.goto(origin+'/a/app.html?host=1.2.0');await ready(aliasPage);
        assert(aliasPage.url().endsWith('/app?host=1.2.0'));
        assert.equal(await aliasPage.evaluate(()=>!!navigator.serviceWorker.controller),true);
        await aliasContext.setOffline(true);
        await aliasPage.reload();await ready(aliasPage);
        await aliasPage.goto(origin+'/a/app.html?host=1.2.0');await ready(aliasPage);
        await aliasContext.close();
        console.log('PASS Cloudflare canonical redirect and both URL spellings work offline');

        canonical=false;failedSnapshot=true;version=4;
        const failedContext=await browser.newContext();
        const failedPage=await failedContext.newPage();
        await failedPage.goto(origin+'/a/app.html');await ready(failedPage);
        assert.equal(await failedPage.evaluate(()=>!!navigator.serviceWorker.controller),false);
        assert.deepEqual(await failedPage.evaluate(()=>caches.keys()),[]);
        failedSnapshot=false;
        await failedPage.reload();await ready(failedPage);
        assert.equal(await failedPage.evaluate(()=>!!navigator.serviceWorker.controller),true);
        await failedContext.close();
        console.log('PASS first-install failure falls back to network and retry installs a complete snapshot');

        // Persist the snapshot, stop the browser process, then reopen with network disabled.
        const profile=fs.mkdtempSync(path.join(os.tmpdir(),'palette-startup-'));
        let persistent;
        try {
            persistent=await chromium.launchPersistentContext(profile,launchOptions);
            let p=await persistent.newPage();await p.goto(origin+'/a/app.html');await ready(p);
            await persistent.close();persistent=null;
            persistent=await chromium.launchPersistentContext(profile,launchOptions);
            await persistent.setOffline(true);
            p=await persistent.newPage();await p.goto(origin+'/a/app.html');await ready(p);
            assert.equal(await p.evaluate(()=>!!navigator.serviceWorker.controller),true);
            console.log('PASS offline cold startup after browser-process restart');
        } finally {
            await persistent?.close();
            const resolved=path.resolve(profile),tempRoot=path.resolve(os.tmpdir())+path.sep;
            assert(resolved.startsWith(tempRoot),'test profile cleanup stays within temp');
            fs.rmSync(resolved,{recursive:true,force:true});
        }
    } finally {
        await browser?.close();
        await new Promise(resolve=>server.close(resolve));
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
