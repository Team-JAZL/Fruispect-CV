export const MODEL_NAMES = {resnet18:'ResNet-18', mobilenet_v3_small:'MobileNetV3-Small', efficientnet_b0:'EfficientNet-B0'};
export const TERMINAL = new Set(['COMPLETED','FAILED','CANCELLED','UNAVAILABLE']);
const numeric=value=>(typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value));
export const formatNumber=(value,digits=1)=>numeric(value)?Number(value).toFixed(digits):'Not available';
export const formatPercent=value=>numeric(value)?`${(Number(value)*100).toFixed(1)}%`:'Not available';
export function createState() { return {batchId:null, selectedId:null, images:new Map(), versions:new Map(), cursor:0}; }
export function acceptEvent(state,event) {
  if (event.batch_id!==state.batchId || event.event_id<=state.cursor) return false;
  state.cursor=event.event_id;
  const key=`${event.image_id}/${event.model_key}`;
  if(event.model_key && (state.versions.get(key)||0)>=event.version) return false;
  if(event.model_key) state.versions.set(key,event.version);
  return true;
}
export function mergeImage(state,image) {
  if(image.batch_id!==state.batchId) return false;
  const previous=state.images.get(image.image_id);
  if(previous) for(const [key,job] of Object.entries(image.jobs)) {
    if(previous.jobs[key]?.version>job.version) image.jobs[key]=previous.jobs[key];
  }
  if(image.consensus) {
    const jobs=Object.values(image.jobs), results=jobs.filter(j=>j.status==='COMPLETED').map(j=>j.result);
    image.terminal=jobs.length===3&&jobs.every(j=>TERMINAL.has(j.status));
    image.consensus={successful_models:results.length,scope:results.length===3?'complete':image.terminal?'incomplete':'provisional',
      fruit_disagreement:new Set(results.map(r=>r.predicted_fruit)).size>1,
      quality_disagreement:new Set(results.map(r=>r.predicted_quality)).size>1};
  }
  state.images.set(image.image_id,image);
  return image.image_id===state.selectedId;
}
export function comparisonText(image) {
  const c=image.consensus;
  if(c.successful_models<2) return image.terminal?'Comparison incomplete · fewer than two successful models':'Waiting for independent results';
  const kind=c.fruit_disagreement&&c.quality_disagreement?'Fruit & quality disagreement':c.fruit_disagreement?'Fruit disagreement':c.quality_disagreement?'Quality disagreement':'Fruit & quality agree';
  return `${kind} · ${c.scope==='complete'?'3/3 models':c.scope==='incomplete'?'incomplete':`${c.successful_models}/3 · provisional`}`;
}
