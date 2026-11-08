import assert from 'node:assert/strict';
import {createState,acceptEvent,mergeImage,formatPercent,formatNumber} from '../app/static/js/state.js';
const state=createState();state.batchId='b';state.selectedId='50';
const fixture=(id,version)=>({batch_id:'b',image_id:id,jobs:{resnet18:{version}}});
mergeImage(state,fixture('50',2));
assert.equal(acceptEvent(state,{batch_id:'b',image_id:'2',model_key:'resnet18',version:4,event_id:20}),true);
assert.equal(mergeImage(state,fixture('2',4)),false);
assert.equal(state.selectedId,'50');assert.equal(state.images.get('50').jobs.resnet18.version,2);
assert.equal(acceptEvent(state,{batch_id:'b',image_id:'2',model_key:'resnet18',version:4,event_id:20}),false);
assert.equal(acceptEvent(state,{batch_id:'b',image_id:'2',model_key:'resnet18',version:3,event_id:21}),false);
mergeImage(state,fixture('2',1));assert.equal(state.images.get('2').jobs.resnet18.version,4);
assert.equal(mergeImage(state,{...fixture('2',6),batch_id:'other'}),false);
console.log('Frontend reconciliation passed: late image #2 leaves selection #50 intact; stale versions and duplicates ignored.');
for(const missing of [null,undefined,'',' ','NaN',Infinity]){
  assert.equal(formatPercent(missing),'Not available');assert.equal(formatNumber(missing),'Not available');
}
assert.equal(formatPercent('0'),'0.0%');assert.equal(formatPercent('0.99166667'),'99.2%');
console.log('Research formatting passed: missing metrics remain unavailable; measured zero remains zero.');


// Exercise the real controller with a small DOM and HTTP harness. No server or model mocks
// participate in the backend tests; here the harness isolates browser selection races.
const {readFile} = await import('node:fs/promises');
const elements=new Map();
const element=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,disabled:false,textContent:'',innerHTML:'',dataset:{},handlers:{},
    classList:{toggle(){}},setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},
    addEventListener(name,handler){this.handlers[name]=handler;},append(){},showModal(){this.open=true;},close(){this.open=false;}});
  return elements.get(id);
};
globalThis.document={getElementById:element,querySelectorAll:()=>[],querySelector:element,createElement:element,addEventListener(){},activeElement:{tagName:'BODY'},hidden:false};
globalThis.window={addEventListener(){}};
const savedSetInterval=globalThis.setInterval,intervals=[];
globalThis.setInterval=callback=>{intervals.push(callback);return null;};
const stored=new Map([['unrelated.preference','keep']]);
globalThis.localStorage={getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
let snapshots=[],nextId=0;
const emptySummary={accepted:0,preprocessing:0,queued:0,running:0,partial:0,fully_complete:0,failed:0,cancelled:0,rejected:0};
const browserImage=(id,name)=>({batch_id:'browser-batch',image_id:id,admission_seq:Number(id),width:53,height:71,original_filename:name,thumbnail_url:'/thumb',terminal:false,
  consensus:{successful_models:0},jobs:Object.fromEntries(['resnet18','mobilenet_v3_small','efficientnet_b0'].map(key=>[key,{status:'QUEUED',version:1,result:null}]))});
globalThis.fetch=async(path,options={})=>{
  if(path.includes('/missing/events?'))return {ok:false,status:404,json:async()=>({error:{message:'Collection removed'}})};
  let data;
  if(options.method==='POST'&&path.endsWith('/images')){
    const image=browserImage(String(++nextId),options.body.get('images').name);snapshots.unshift(image);data={accepted:[{image_id:image.image_id}],rejected:[]};
  }else if(path.endsWith('/delete')){snapshots=[];data={deleted:{collections:1,photos:2,cleanup_pending:0}};}
  else if(path==='/api/settings')data={collections:0,photos:0,local_operator:true,all_collections:0,all_photos:0};
  else if(path==='/api/queues')data={lanes:[]};
  else if(path==='/api/batches')data={batches:snapshots.length?[{batch_id:'browser-batch',created_at:new Date().toISOString(),summary:{accepted:snapshots.length}}]:[]};
  else if(path.startsWith('/api/images/'))data={image:snapshots.find(i=>i.image_id===path.split('/').pop())};
  else if(path.includes('/images?'))data={images:snapshots,total:snapshots.length};
  else data={batch:{summary:{...emptySummary,accepted:snapshots.length}}};
  return {ok:true,status:200,json:async()=>structuredClone(data)};
};
let controller=await readFile(new URL('../app/static/js/app.js',import.meta.url),'utf8');
controller=controller.replace("from './state.js'",`from '${new URL('../app/static/js/state.js',import.meta.url).href}'`);
controller=controller.replace(/initialize\(\);\s*$/,'');
controller+='\nexport {state,addFiles,submitFiles,onEvent,resetWorkspace,openDataDialog,connectEvents};\n//# sourceURL=fruispect-controller-test.js';
const app=await import(`data:text/javascript;base64,${Buffer.from(controller).toString('base64')}`);
app.state.batchId='browser-batch';element('sort').value='newest';
app.addFiles([new File(['first'],'first.png',{type:'image/png'})]);await app.submitFiles();
assert.equal(app.state.selectedId,'1');
app.addFiles([new File(['second'],'second.png',{type:'image/png'})]);await app.submitFiles();
assert.equal(app.state.selectedId,'2');assert.equal(element('image-name').textContent,'second.png');
await app.onEvent({batch_id:'browser-batch',image_id:'1',model_key:'resnet18',event_id:10,version:2});
assert.equal(app.state.selectedId,'2');assert.equal(element('image-name').textContent,'second.png');
app.openDataDialog({kind:'current',title:'Delete collection',description:'Test deletion'});
assert.equal(element('data-dialog').open,true);
await element('data-form').handlers.submit({preventDefault(){}});
assert.equal(app.state.batchId,null);assert.equal(app.state.selectedId,null);
assert.equal(element('compare-content').hidden,true);assert.equal(element('sort').value,'newest');
assert.equal(element('export-csv')['aria-disabled'],'true');assert.equal(element('data-dialog').open,false);
assert.equal(stored.get('unrelated.preference'),'keep');assert.equal(stored.has('fruispect.batch'),false);
app.state.batchId='missing';app.connectEvents();await intervals.at(-1)();
assert.equal(app.state.batchId,null);assert.equal(element('compare-content').hidden,true);
globalThis.setInterval=savedSetInterval;
console.log('Controller passed: new uploads select their results, late events preserve selection, deletion and polling clear removed collections.');
