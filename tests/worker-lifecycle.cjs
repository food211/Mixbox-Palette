const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function fixture(){
 const workers=[];
 class Worker{
  constructor(){workers.push(this);this.messages=[];}
  postMessage(msg){if(this.failPost)throw new Error('post failed');this.messages.push(msg);}
  terminate(){this.terminated=true;}
 }
 const context=vm.createContext({window:{},document:{currentScript:null},Worker,console:{log(){},warn(){},error(){}},Uint8ClampedArray});
 vm.runInContext(fs.readFileSync(process.env.PALETTE_CANDIDATE_FILE||path.join(__dirname,'..','js','base-painter.js'),'utf8'),context);
 const p=Object.create(context.window.BaseWebGLPainter.prototype);
 Object.assign(p,{_historyWorker:null,_workerPending:new Map(),_workerMsgId:0});
 return {p,workers};
}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('worker request did not settle')),100);})]);}finally{clearTimeout(timer);}}
for(const event of ['onerror','onmessageerror'])test(`${event} rejects all in-flight requests and allows a fresh worker`,async()=>{
 const {p,workers}=fixture();
 const a=p._workerRequest({type:'compress'}),b=p._workerRequest({type:'decompress'});
 const settled=Promise.allSettled([a,b]);
 const failed=workers[0];
 failed[event]?.({message:'worker failed'});
 const result=await bounded(settled);
 assert(result.every(r=>r.status==='rejected'));
 assert.equal(p._workerPending.size,0);
 assert.equal(failed.terminated,true);
 assert.equal(p._historyWorker,null);
 const next=p._workerRequest({type:'compress'}),current=workers[1];
 failed.onerror({message:'late old error'});
 assert.equal(p._historyWorker,current,'stale errors must not kill the replacement worker');
 const msg=current.messages[0];
 const blob={snapshot:'new'};
 current.onmessage({data:{type:'compressed',id:msg.id,blob}});
 assert.equal(await bounded(next),blob);
});
test('postMessage failure rejects the request without retaining a pending entry',async()=>{
 const {p}=fixture();p._ensureHistoryWorker().failPost=true;
 await assert.rejects(p._workerRequest({type:'compress'}),/post failed/);
 assert.equal(p._workerPending.size,0);
});
