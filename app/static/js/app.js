import {MODEL_NAMES,TERMINAL,createState,acceptEvent,mergeImage,comparisonText,formatNumber as number,formatPercent as pct} from './state.js';
const $=id=>document.getElementById(id), state=createState();
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusText=job=>`${job.status.replaceAll('_',' ')}${job.cancel_requested?' · cancellation requested':''}`;
let page=1,pageIds=[],total=0,files=[],filePage=1,previewUrl=null,uploading=false,mode='upload',stream=null,sampleTimer=null,skipped=0,lanes=[],events=null,pollTimer=null,refreshTimer=null,refreshRunning=false,refreshAgain=false,figureRows=[],dataAction=null,dataBusy=false,settingsData=null;

function notice(message) { $('notice').textContent=message; $('notice').hidden=!message; }
async function api(path,options={}) {
  const response=await fetch(path,{...options,headers:{...(options.method==='POST'?{'X-Fruispect':'1'}:{}),...options.headers}});
  let data;
  try { data=await response.json(); } catch { throw new Error(`Service returned HTTP ${response.status}.`); }
  if(!response.ok && !data.rejected) {const error=new Error(data.error?.message||`HTTP ${response.status}`);error.status=response.status;throw error;}
  return data;
}
const post=(path)=>api(path,{method:'POST'});

function modelPanel(key,job) {
  const result=job.result;
  const output=result?`
    <div class="prediction">${escape(result.predicted_fruit)}</div>
    <div class="score-label"><span>Fruit confidence</span><span>${pct(result.fruit_confidence)}</span></div>
    <progress max="1" value="${Number(result.fruit_confidence)}" aria-label="Fruit confidence"></progress>
    <div class="quality">${escape(result.predicted_quality)}</div>
    <div class="score-label"><span>Quality confidence</span><span>${pct(result.quality_confidence)}</span></div>
    <progress class="quality-score" max="1" value="${Number(result.quality_confidence)}" aria-label="Quality confidence"></progress>
    <p class="forward-time">${number(result.inference_ms)} ms inference</p>
    <details><summary>Result details</summary>
      <div class="timings">Queue <strong>${number(result.queue_wait_ms)} ms</strong><br>Preparation <strong>${number(result.preprocess_ms)} ms</strong><br>End to end <strong>${number(result.end_to_end_ms)} ms</strong></div>
      <div class="probabilities">${Object.entries(result.fruit_probabilities).map(([label,score])=>`<span>${escape(label)}</span><span>${pct(score)}</span>`).join('')}</div>
      <div class="probabilities">${Object.entries(result.quality_probabilities).map(([label,score])=>`<span>${escape(label)}</span><span>${pct(score)}</span>`).join('')}</div>
      <p>${escape(result.device)} ? PyTorch ${escape(result.framework_versions?.torch)}</p>
      <p>Checkpoint SHA-256: ${escape(result.checkpoint_sha256)}</p><p>Preprocessing: ${escape(result.preprocessing_sha256)}</p>
    </details>`:`<p class="pending-copy">${escape(job.error_message||(job.status==='RUNNING'?'Checking your photo…':job.status==='QUEUED'&&job.attempt_count?'Retrying this photo.':job.status==='QUEUED'?'Your photo is in this model’s queue.':job.status==='WAITING_FOR_INPUT'?'Preparing your photo.':job.status==='CANCELLED'?'This scan was cancelled.':'No result available.'))}</p>`;
  return `<article class="model-card" data-model="${key}"><h4>${escape(MODEL_NAMES[key])}</h4><div class="job-status ${job.status.toLowerCase()}" role="status">${escape(statusText(job))}</div>${output}</article>`;
}
function renderSelected() {
  const image=state.images.get(state.selectedId);
  $('compare-empty').hidden=!!image; $('compare-content').hidden=!image;
  if(!image) {
    for(const id of ['image-seq','image-name','consensus'])$(id).textContent='';
    $('model-panels').innerHTML='';$('cancel-image').disabled=true;return;
  }
  $('image-seq').textContent=`IMAGE ${String(image.admission_seq).padStart(4,'0')} · ${image.width} × ${image.height}`;
  $('image-name').textContent=image.original_filename;
  $('consensus').textContent=comparisonText(image);
  const expanded=Array.from(document.querySelectorAll('.model-card details[open]')).map(detail=>detail.closest('[data-model]')?.dataset.model);
  $('model-panels').innerHTML=Object.keys(MODEL_NAMES).map(key=>modelPanel(key,image.jobs[key])).join('');
  for(const key of expanded){const detail=document.querySelector(`[data-model="${key}"] details`);if(detail)detail.open=true;}
  $('cancel-image').disabled=image.terminal;
}
function renderGallery() {
  if(!pageIds.length) { $('gallery').innerHTML='<tr><td colspan="5" class="table-empty">No images match this view. Add photographs or adjust the filters.</td></tr>'; return; }
  $('gallery').innerHTML=pageIds.map(id=>{
    const image=state.images.get(id); if(!image) return '';
    return `<tr class="${id===state.selectedId?'selected':''}"><td><button class="image-button" data-image="${id}" aria-pressed="${id===state.selectedId}"><img src="${image.thumbnail_url}" alt="" loading="lazy"><span><strong>${escape(image.original_filename)}</strong><small>#${String(image.admission_seq).padStart(4,'0')} · ${image.width}×${image.height}</small></span></button></td>${Object.keys(MODEL_NAMES).map(key=>{const job=image.jobs[key];return `<td data-label="${escape(MODEL_NAMES[key])}">${job.result?`${escape(job.result.predicted_fruit)}<span class="cell-quality">${escape(job.result.predicted_quality)} · ${pct(job.result.quality_confidence)}</span>`:`<span class="job-status ${job.status.toLowerCase()}">${escape(statusText(job))}</span>`}</td>`;}).join('')}<td><span class="agreement ${image.consensus.fruit_disagreement||image.consensus.quality_disagreement?'disagree':''}">${escape(comparisonText(image))}</span></td></tr>`;
  }).join('');
}
function renderSummary(batch) {
  const s=batch.summary;
  $('collection-count').textContent=String(s.accepted);
  $('summary-strip').innerHTML=[['Photos',s.accepted],['In progress',s.accepted-s.fully_complete],['Finished',s.fully_complete],['Needs attention',s.failed+s.rejected]].map(([label,value])=>`<div class="summary-item"><strong>${value}</strong><span>${label}</span></div>`).join('');
  $('summary-details').innerHTML=[['Preparing photos',s.preprocessing],['Waiting jobs',s.queued],['Active jobs',s.running],['Partial results',s.partial],['Failed / unavailable',s.failed],['Cancelled',s.cancelled],['Rejected files',s.rejected]].map(([label,value])=>`<dt>${label}</dt><dd>${value}</dd>`).join('');
  $('cancel-batch').disabled=!s.accepted||s.fully_complete===s.accepted;
}
function filtersQuery() {
  return new URLSearchParams({page,limit:20,search:$('search').value,status:$('status-filter').value,fruit:$('fruit-filter').value,quality:$('quality-filter').value,agreement:$('agreement-filter').value,sort:$('sort').value});
}
async function refreshWorkspace() {
  if(!state.batchId) return;
  if(refreshRunning){refreshAgain=true;return;}
  refreshRunning=true;
  const batchId=state.batchId,selectedId=state.selectedId;
  try {
    const [batchData,listData,selectedData]=await Promise.all([api(`/api/batches/${batchId}`),api(`/api/batches/${batchId}/images?${filtersQuery()}`),selectedId?api(`/api/images/${selectedId}`):null]);
    if(state.batchId!==batchId||dataBusy) return;
    renderSummary(batchData.batch);
    pageIds=listData.images.map(i=>i.image_id); total=listData.total;
    for(const image of listData.images) mergeImage(state,image);
    if(selectedData) mergeImage(state,selectedData.image);
    if(!state.selectedId&&pageIds.length) state.selectedId=pageIds[0];
    // Keep only a page plus the selected image in browser memory.
    for(const id of state.images.keys()) if(id!==state.selectedId&&!pageIds.includes(id)) state.images.delete(id);
    $('page-info').textContent=total?`Page ${page} · ${total} matching photos`:'No matching photos';
    $('previous').disabled=page<=1; $('next').disabled=page*20>=total;
    renderGallery();renderSelected();
  } catch(error){if(state.batchId===batchId&&!dataBusy){if(error.status===404)await collectionRemoved();else notice(error.message);}}
  finally { refreshRunning=false;if(refreshAgain){refreshAgain=false;scheduleRefresh();} }
}
function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshWorkspace,120);}
async function onEvent(event) {
  if(!acceptEvent(state,event)) return;
  // A late result updates its immutable image ID, never the currently selected panel.
  if(event.image_id&&(pageIds.includes(event.image_id)||event.image_id===state.selectedId)) {
    try {
      const {image}=await api(`/api/images/${event.image_id}`);
      const selected=mergeImage(state,image);
      if(selected) renderSelected();
      if(image.batch_id===state.batchId) renderGallery();
    } catch(error){if(error.status!==404&&event.batch_id===state.batchId)notice(error.message);}
  }
  scheduleRefresh();
}
function connectEvents() {
  events?.close();clearInterval(pollTimer);
  const batchId=state.batchId;
  if(!batchId) return;
  if(window.EventSource) {
    events=new EventSource(`/api/events?batch_id=${batchId}&after=${state.cursor}`);
    events.addEventListener('update',event=>onEvent(JSON.parse(event.data)));
    events.addEventListener('removed',()=>{if(state.batchId===batchId&&!dataBusy)collectionRemoved().catch(error=>notice(error.message));});
    events.onopen=()=>{$('connection').textContent='Live';};
    events.onerror=()=>{$('connection').textContent='Reconnecting';};
  }
  // Snapshot polling repairs missed events and is also the fallback without EventSource.
  pollTimer=setInterval(async()=>{
    if(state.batchId!==batchId) return;
    try {
      if(!events||events.readyState!==EventSource.OPEN){const data=await api(`/api/batches/${batchId}/events?after=${state.cursor}`);for(const event of data.events) await onEvent(event);}
      await refreshWorkspace();
    }catch(error){
      if(error.status===404&&state.batchId===batchId&&!dataBusy)await collectionRemoved();
      else $('connection').textContent='Reconnecting';
    }
  },2500);
}
async function selectBatch(batchId) {
  events?.close();clearInterval(pollTimer);
  state.batchId=batchId;state.images.clear();state.versions.clear();state.cursor=0;state.selectedId=null;page=1;pageIds=[];
  renderSelected();renderGallery();updateDataControls();
  localStorage.setItem('fruispect.batch',batchId);
  for(const format of ['csv','json']){$(`export-${format}`).href=`/api/export/${batchId}?format=${format}`;$(`export-${format}`).removeAttribute('aria-disabled');}
  await refreshWorkspace();
  // Replaying from zero is deliberate: snapshots and event versions make this idempotent.
  if(state.batchId===batchId)connectEvents();
}
async function history() {
  const data=await api('/api/batches');
  $('batch-history').innerHTML='<option value="">Recent collections</option>'+data.batches.map(b=>`<option value="${b.batch_id}">${new Date(b.created_at).toLocaleString()} · ${b.summary.accepted} images</option>`).join('');
  $('batch-history').value=state.batchId||'';
  return data.batches;
}
async function newBatch() {
  const {batch}=await api('/api/batches',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()}});
  await selectBatch(batch.batch_id);await history();return batch.batch_id;
}
function resetWorkspace() {
  events?.close();events=null;clearInterval(pollTimer);clearTimeout(refreshTimer);refreshAgain=false;
  Object.assign(state,createState());page=1;pageIds=[];total=0;
  localStorage.removeItem('fruispect.batch');
  for(const id of ['search','status-filter','fruit-filter','quality-filter','agreement-filter'])$(id).value='';
  $('sort').value='newest';
  for(const format of ['csv','json']){$(`export-${format}`).removeAttribute('href');$(`export-${format}`).setAttribute('aria-disabled','true');}
  $('page-info').textContent='No photos yet';$('previous').disabled=true;$('next').disabled=true;
  renderSummary({summary:{accepted:0,preprocessing:0,queued:0,running:0,partial:0,fully_complete:0,failed:0,cancelled:0,rejected:0}});
  renderSelected();renderGallery();updateDataControls();
  $('connection').textContent='Live';
}
async function collectionRemoved() {
  resetWorkspace();clearFiles();
  notice('This collection was removed. Choose another collection or add a new photo.');
  await history();await refreshQueues();
}
function updateDataControls() {
  const busy=uploading||dataBusy;
  for(const id of ['delete-current','delete-collection'])$(id).disabled=busy||!state.batchId;
  $('delete-collections').disabled=busy||!settingsData?.collections;
  $('reset-data').disabled=busy||!settingsData?.local_operator;
}
async function refreshSettings() {
  settingsData=await api('/api/settings');
  $('storage-summary').textContent=`${settingsData.collections} collections and ${settingsData.photos} photos saved by this browser.`;
  $('reset-summary').textContent=settingsData.local_operator?`${settingsData.all_collections} collections and ${settingsData.all_photos} photos across all browsers.`:'Open Settings on the server computer to reset all data.';
  $('reset-local-note').hidden=settingsData.local_operator;updateDataControls();
}
function openDataDialog(action) {
  if(uploading||dataBusy)return;
  dataAction={...action,batchId:state.batchId};
  const reset=action.kind==='reset';
  $('data-dialog-title').textContent=action.title;
  $('data-dialog-description').textContent=action.description;
  $('reset-confirmation').hidden=!reset;$('reset-word').value='';$('reset-word').required=reset;
  $('data-confirm').textContent=reset?'Reset all data':'Delete permanently';
  $('data-error').textContent='';$('data-dialog').showModal();
}
$('data-cancel').addEventListener('click',()=>$('data-dialog').close());
$('data-dialog').addEventListener('cancel',event=>{if(dataBusy)event.preventDefault();});
const currentDeletion=()=>openDataDialog({kind:'current',title:'Delete this collection?',description:'Permanently remove this collection, its photos, results and activity. Unfinished checks will be discarded. This cannot be undone.'});
$('delete-current').addEventListener('click',currentDeletion);$('delete-collection').addEventListener('click',currentDeletion);
$('delete-collections').addEventListener('click',()=>openDataDialog({kind:'browser',title:'Delete your collections?',description:'Permanently remove all collections, photos, results and activity saved by this browser. Unfinished checks will be discarded. This cannot be undone.'}));
$('reset-data').addEventListener('click',()=>openDataDialog({kind:'reset',title:'Reset all saved data?',description:'Permanently remove all photos, collections, results and activity for every browser connected to this server. Unfinished checks will be discarded. Export anything you want to keep before continuing.'}));
$('data-form').addEventListener('submit',async event=>{
  event.preventDefault();if(dataBusy||!dataAction)return;
  if(uploading){$('data-error').textContent='Wait for your upload to finish, then try again.';return;}
  if(dataAction.kind==='reset'&&$('reset-word').value!=='RESET'){$('data-error').textContent='Type RESET to confirm.';return;}
  dataBusy=true;stopCamera();updateDataControls();$('data-confirm').disabled=true;$('data-cancel').disabled=true;
  $('data-error').textContent='';
  try {
    const path=dataAction.kind==='current'?`/api/batches/${dataAction.batchId}/delete`:dataAction.kind==='browser'?'/api/settings/collections/delete':'/api/settings/reset';
    const response=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:$('reset-word').value})});
    resetWorkspace();clearFiles();skipped=0;
    $('upload-progress').textContent='Choose a photo to get started.';
    $('data-dialog').close();
    notice(`${response.deleted.collections} collections and ${response.deleted.photos} photos removed.${response.deleted.cleanup_pending?' Files still in use will be cleared automatically.':''}`);
  } catch(error){$('data-error').textContent=error.message;}
  finally {
    dataBusy=false;$('data-confirm').disabled=false;$('data-cancel').disabled=false;updateDataControls();
  }
  await Promise.all([history(),refreshSettings(),refreshQueues()]).catch(error=>notice(error.message));
});
function clearFiles(){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;files=[];filePage=1;$('files').value='';$('folder').value='';$('native-camera').value='';$('preview').removeAttribute('src');$('file-list').innerHTML='';$('selection-title').textContent='';$('selection-meta').textContent='';renderFiles();}
function renderFiles() {
  $('selection').hidden=!files.length;
  $('submit').disabled=uploading||!files.some(f=>f.status!=='accepted');
  $('rescan').hidden=!files.some(f=>f.status==='accepted');$('rescan').disabled=uploading;
  $('submit').textContent=uploading?'Adding photos…':mode==='batch'||files.length>1?`Check ${files.filter(f=>f.status!=='accepted').length} photos ↗`:'Check fruit ↗';
  if(!files.length)return;
  $('selection-title').textContent=files.length===1?files[0].file.name:`${files.length} photographs selected`;
  $('selection-meta').textContent=`${number(files.reduce((sum,f)=>sum+f.file.size,0)/1024**2)} MB · ${files.filter(f=>f.status==='accepted').length} accepted`;
  // Bounded list and one object URL avoid decoding a 100-image batch at once.
  $('file-list').start=(filePage-1)*25+1;
  $('file-list').innerHTML=files.slice((filePage-1)*25,filePage*25).map(f=>`<li>${escape(f.file.name)} · ${escape(f.message||f.status)}</li>`).join('');
  $('file-pages').hidden=files.length<=25;$('file-previous').disabled=filePage<=1;$('file-next').disabled=filePage*25>=files.length;
  $('file-page-info').textContent=`Files ${(filePage-1)*25+1}–${Math.min(filePage*25,files.length)} of ${files.length}`;
}
function addFiles(list) {
  if(uploading||dataBusy)return;
  const incoming=Array.from(list);
  if(!incoming.length)return;
  if(mode!=='batch'&&incoming.length>1)setMode('batch');
  if(mode!=='batch')clearFiles();
  for(const file of incoming)files.push({file,status:'selected',key:crypto.randomUUID()});
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl=URL.createObjectURL(files[0].file);$('preview').src=previewUrl;
  renderFiles();$('upload-progress').textContent='Ready when you are. Review your photos, then check fruit.';
}
async function submitFiles() {
  if(uploading||dataBusy||!files.length)return;
  uploading=true;notice('');$('clear-files').disabled=true;$('files').disabled=true;$('new-batch').disabled=true;$('batch-history').disabled=true;
  updateDataControls();
  try{
    if(!state.batchId)await newBatch();
    const batchId=state.batchId;
    // One file per request bounds memory and gives every retry a stable key.
    for(let index=0;index<files.length;index++){
      const item=files[index];if(item.status==='accepted')continue;
      item.status='uploading';renderFiles();
      const body=new FormData();body.append('images',item.file,item.file.name);body.append('offset',String(index));
      let data;
      for(let attempt=0;attempt<3;attempt++){
        try {data=await api(`/api/batches/${batchId}/images`,{method:'POST',headers:{'Idempotency-Key':item.key},body});break;}
        catch(error){if(attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
      }
      const accepted=data.accepted?.[0],rejected=data.rejected?.[0];
      if(accepted){item.status='accepted';item.message=accepted.input_error?'Accepted · preprocessing failed':'Accepted';state.selectedId=accepted.image_id;page=1;}
      else {item.status='rejected';item.message=rejected?.message||'Upload rejected';}
      $('upload-progress').textContent=`${index+1}/${files.length} checked · ${files.filter(f=>f.status==='accepted').length} accepted · ${files.filter(f=>f.status==='rejected').length} rejected`;
      renderFiles();scheduleRefresh();
    }
    await refreshWorkspace();await history();
  }catch(error){notice(`${error.message} Accepted images continue processing. Tap Check fruit again to retry the remaining photos.`);}
  finally{uploading=false;$('clear-files').disabled=false;$('files').disabled=false;$('new-batch').disabled=false;$('batch-history').disabled=false;renderFiles();updateDataControls();}
}
function stopCamera(){clearInterval(sampleTimer);sampleTimer=null;$('sampling').checked=false;stream?.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;$('capture').disabled=true;}
function setMode(next){
  mode=next;
  for(const button of document.querySelectorAll('[data-mode]')){const active=button.dataset.mode===mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);}
  $('camera-mode').hidden=mode!=='camera';$('upload-mode').hidden=mode==='camera';$('folder-button').hidden=mode!=='batch';$('files').multiple=mode==='batch';
  $('drop-caption').textContent=mode==='batch'?'or drop a batch here':'or drop it here';
  document.querySelector('#dropzone strong').textContent=mode==='batch'?'Choose your fruit photos':'Choose a fruit photo';
  if(mode!=='camera')stopCamera();renderFiles();
}
async function startCamera(){
  stopCamera();
  if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){$('camera-message').textContent='Open the secure phone link, or use the phone camera button below.';return;}
  try {
    stream=await navigator.mediaDevices.getUserMedia({video:$('cameras').value?{deviceId:{exact:$('cameras').value}}:{facingMode:{ideal:'environment'},width:{ideal:1920}},audio:false});
    $('video').srcObject=stream;await $('video').play();$('capture').disabled=false;
    $('camera-message').textContent='Ready. Take a photo, or take another to retake.';
    try {
      const devices=await navigator.mediaDevices.enumerateDevices();const current=stream.getVideoTracks()[0].getSettings().deviceId;
      $('cameras').innerHTML=devices.filter(d=>d.kind==='videoinput').map((d,i)=>`<option value="${escape(d.deviceId)}" ${d.deviceId===current?'selected':''}>${escape(d.label||`Camera ${i+1}`)}</option>`).join('');
    } catch { /* Capture remains available if camera enumeration is unsupported. */ }
  } catch(error) {
    stopCamera();
    $('camera-message').textContent=error.name==='NotAllowedError'?'Camera permission was denied. Allow it in your browser, or choose a photo.':'Camera unavailable. Try the phone camera button or choose a photo.';
  }
}
async function capture(){if(uploading||!stream||!$('video').videoWidth)return;const canvas=document.createElement('canvas');const video=$('video');const scale=Math.min(1,2000/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95));if(!blob){notice('The photo could not be captured. Please try again.');return;}clearFiles();addFiles([new File([blob],`camera-${Date.now()}.jpg`,{type:'image/jpeg'})]);}
function renderQueues(){
  $('queue-lanes').innerHTML=lanes.map(lane=>`<section class="panel lane"><div class="lane-heading"><h2>${escape(lane.display_name)}</h2><span class="chip">${escape(lane.state==='READY'?'Ready':lane.state==='LOADING'?'Starting':lane.state==='UNAVAILABLE'?'Unavailable':'Offline')}</span></div><div class="lane-track">${lane.active?`<div class="lane-job active">Photo #${lane.active.admission_seq}<small>Checking · ${number(lane.active_duration_ms/1000)} s</small></div>`:'<div class="lane-job">All clear<small>No photo being checked</small></div>'}${lane.up_next.map(job=>`<div class="lane-job">→ Photo #${job.admission_seq}<small>${job.status==='WAITING_FOR_INPUT'?'Preparing':'Waiting'}</small></div>`).join('')}</div><div class="lane-stats"><span>Waiting <strong>${lane.queue_depth}</strong></span><span>Finished <strong>${lane.counts.COMPLETED||0}</strong></span><span>Failed / unavailable <strong>${(lane.counts.FAILED||0)+(lane.counts.UNAVAILABLE||0)}</strong></span></div><details class="small-details"><summary>Performance details</summary><p class="muted">Mean ${number(lane.mean_inference_ms)} ms · p95 ${number(lane.p95_inference_ms)} ms · ${number(lane.throughput_model_jobs_s,2)} jobs/s · ${escape(lane.device||'CPU')}</p></details>${lane.last_error?`<p class="lane-error">${escape(lane.last_error)}</p>`:''}</section>`).join('');
}
async function refreshQueues(){try{const data=await api('/api/queues');lanes=data.lanes;const ready=lanes.filter(l=>l.state==='READY').length;$('system-state').textContent=ready===3?'Ready':`${ready} of 3 models ready`;$('device').textContent=lanes.find(l=>l.device)?.device?.toUpperCase()||'CPU';renderQueues();}catch(error){$('system-state').textContent='Reconnecting';}}
function genericTable(rows,columns){return rows.length?`<div class="table-wrap"><table><thead><tr>${columns.map(([key,label])=>`<th>${escape(label)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(([key,label,format])=>`<td>${escape(format?format(row[key]):row[key]||'Not available')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="muted">Not available in saved artifacts.</p>';}
async function loadEvaluation(){
  try{const [data,catalog]=await Promise.all([api('/api/evaluation/summary'),api('/api/evaluation/figures')]);
    $('evaluation-content').innerHTML=`<details class="research-context"><summary>About these test results</summary><p class="provenance">${escape(data.manifest?.evaluation_scope||'Evaluation scope not available.')}<br>Source: ${escape(data.metrics_source)} · ${escape(data.training_versions?.gpu||'Benchmark device not available')} · Batch-1 latency, batch-32 throughput. These measurements do not describe current application speed.<br>One recorded seed per architecture; confidence scores on new photographs do not measure accuracy.</p></details><div class="evaluation-cards">${data.models.map(model=>`<article class="panel evaluation-card"><span class="chip">HELD-OUT TEST · n=${escape(model.test_n)}</span><h3>${escape(model.model)}</h3><div class="metric-big">${pct(model.joint_accuracy)}<small>Both predictions correct</small></div>${[['Fruit accuracy',pct(model.fruit_accuracy)],['Quality accuracy',pct(model.quality_accuracy)]].map(([label,value])=>`<div class="metric-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}<details><summary>More test metrics</summary>${[['Fruit macro F1',number(model.fruit_f1_macro,4)],['Quality macro F1',number(model.quality_f1_macro,4)],['Trainable parameters',number(model.trainable_parameters,0)],['Checkpoint size',`${number(model.model_size_mib)} MiB`],['Recorded training',`${number(model.training_minutes)} min`],['Recorded mean / p95',`${number(model.latency_mean_ms)} / ${number(model.latency_p95_ms)} ms`],['Recorded batch throughput',`${number(model.throughput_images_s)} images/s`]].map(([label,value])=>`<div class="metric-row"><span>${label}</span><strong>${value}</strong></div>`).join('')}</details></article>`).join('')}</div><details class="evaluation-table"><summary>Fruit and quality macro precision, recall & F1</summary>${genericTable(data.models,[['model','Model'],['fruit_precision_macro','Fruit precision',v=>number(v,4)],['fruit_recall_macro','Fruit recall',v=>number(v,4)],['fruit_f1_macro','Fruit F1',v=>number(v,4)],['quality_precision_macro','Quality precision',v=>number(v,4)],['quality_recall_macro','Quality recall',v=>number(v,4)],['quality_f1_macro','Quality F1',v=>number(v,4)]])}</details><details class="evaluation-table"><summary>Controlled photographic stress tests · saved held-out images</summary>${genericTable(data.stress.rows,[['model','Model'],['condition','Condition'],['fruit_accuracy','Fruit accuracy',pct],['quality_accuracy','Quality accuracy',pct],['joint_accuracy','Joint accuracy',pct]])}</details><details class="evaluation-table"><summary>Per-fruit visual quality evaluation</summary>${genericTable(data.quality_by_fruit,[['model','Model'],['fruit','Fruit'],['test_n','Test images'],['quality_accuracy','Quality accuracy',pct],['joint_accuracy','Joint accuracy',pct]])}</details>${data.unavailable.length?`<p class="lane-error">Unavailable: ${escape(data.unavailable.join('; '))}</p>`:''}`;
    figureRows=catalog.figures;$('figure-select').innerHTML=figureRows.map((figure,i)=>`<option value="${i}">${escape(figure.title)}</option>`).join('');renderFigure();
  }catch(error){$('evaluation-content').textContent=error.message;}
}
function renderFigure(){const figure=figureRows[Number($('figure-select').value)||0];if(!figure){$('research-figure').textContent='No research figures available.';return;}$('research-figure').querySelector('figcaption').textContent=figure.title;$('figure-note').textContent=`${figure.provenance} · ${figure.note||''}`;$('figure-image').hidden=!figure.png;if(figure.png)$('figure-image').src=figure.png;$('figure-image').alt=figure.title;$('figure-link').href=figure.pdf||figure.png||'#';}
function route(){const active=['workspace','queues','evaluation','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'workspace';for(const view of document.querySelectorAll('.view'))view.hidden=view.id!==active;for(const link of document.querySelectorAll('nav a'))link.classList.toggle('active',link.hash===`#${active}`);if(active!=='workspace')stopCamera();if(active==='evaluation'&&!figureRows.length)loadEvaluation();if(active==='queues')refreshQueues();if(active==='settings')refreshSettings().catch(error=>notice(error.message));}

document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
$('files').addEventListener('change',event=>addFiles(event.target.files));$('native-camera').addEventListener('change',event=>addFiles(event.target.files));$('folder').addEventListener('change',event=>addFiles(event.target.files));$('folder-button').addEventListener('click',()=>$('folder').click());
for(const name of ['dragover','dragleave','drop'])$('dropzone').addEventListener(name,event=>{event.preventDefault();$('dropzone').classList.toggle('dragover',name==='dragover');if(name==='drop')addFiles(event.dataTransfer.files);});
window.addEventListener('paste',event=>{if(['INPUT','TEXTAREA'].includes(document.activeElement.tagName))return;const pasted=Array.from(event.clipboardData.items).filter(i=>i.kind==='file').map(i=>i.getAsFile());if(pasted.length)addFiles(pasted);});
$('clear-files').addEventListener('click',clearFiles);$('submit').addEventListener('click',submitFiles);
$('file-previous').addEventListener('click',()=>{filePage--;renderFiles();});$('file-next').addEventListener('click',()=>{filePage++;renderFiles();});
$('rescan').addEventListener('click',()=>{for(const item of files){item.status='selected';item.message='New intentional scan';item.key=crypto.randomUUID();}renderFiles();});
$('new-batch').addEventListener('click',()=>newBatch().catch(error=>notice(error.message)));
$('batch-history').addEventListener('change',event=>{if(event.target.value)selectBatch(event.target.value);});
$('gallery').addEventListener('click',async event=>{const button=event.target.closest('[data-image]');if(!button)return;state.selectedId=button.dataset.image;renderSelected();renderGallery();});
$('cancel-image').addEventListener('click',async()=>{if(state.selectedId&&confirm('Cancel this photo’s unfinished checks? Completed results will be kept.')){await post(`/api/images/${state.selectedId}/cancel`);scheduleRefresh();}});
$('cancel-batch').addEventListener('click',async()=>{if(state.batchId&&confirm('Cancel all unfinished checks in this collection? Completed results will be kept.')){await post(`/api/batches/${state.batchId}/cancel`);scheduleRefresh();}});
for(const id of ['status-filter','fruit-filter','quality-filter','agreement-filter','sort'])$(id).addEventListener('change',()=>{page=1;scheduleRefresh();});
$('search').addEventListener('input',()=>{page=1;scheduleRefresh();});$('previous').addEventListener('click',()=>{page--;scheduleRefresh();});$('next').addEventListener('click',()=>{page++;scheduleRefresh();});
$('camera-start').addEventListener('click',startCamera);$('camera-stop').addEventListener('click',stopCamera);$('capture').addEventListener('click',capture);$('cameras').addEventListener('change',()=>{if(stream)startCamera();});
$('sampling').addEventListener('change',()=>{clearInterval(sampleTimer);if(!$('sampling').checked)return;if(!stream){$('sampling').checked=false;notice('Start the camera before enabling sampling.');return;}sampleTimer=setInterval(async()=>{if(uploading||document.hidden||lanes.some(l=>l.queue_depth>20||l.state!=='READY')){skipped++;$('skipped').textContent=`${skipped} samples skipped before acceptance (busy or unavailable).`;return;}await capture();await submitFiles();},5000);});
$('figure-select').addEventListener('change',renderFigure);window.addEventListener('hashchange',route);
const contrast=document.createElement('button');contrast.className='contrast-toggle';contrast.textContent='Contrast';contrast.setAttribute('aria-pressed','false');contrast.addEventListener('click',()=>{const enabled=document.body.classList.toggle('high-contrast');contrast.setAttribute('aria-pressed',enabled);});document.querySelector('.system').append(contrast);
window.addEventListener('beforeunload',()=>{events?.close();stopCamera();if(previewUrl)URL.revokeObjectURL(previewUrl);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&stream){stopCamera();$('camera-message').textContent='Camera paused. Start it again when you are ready.';}});
let initialized=false, phoneConnection=null, connectionSignature='';
function showPairing(required){
  $('pairing-screen').hidden=!required;
  for(const surface of document.querySelectorAll('main,header,footer'))surface.inert=required;
  if(required)$('pairing-code').focus();
}
async function refreshConnection(){
  const {connection}=await api('/api/connection');phoneConnection=connection;
  $('tunnel-summary').textContent=connection.message+(connection.error_code?` (${connection.error_code})`:'');
  $('retry-tunnel').hidden=!connection.local_operator||['ready','starting','disabled'].includes(connection.status);
  $('phone-connection').hidden=!connection.local_operator;
  const signature=JSON.stringify(connection);
  if(signature!==connectionSignature){
    connectionSignature=signature;
    $('phone-details').innerHTML=connection.status==='ready'&&connection.local_operator?
      `<p class="muted">Open on your phone. The link connects automatically.</p><a href="${escape(connection.connect_url)}" target="_blank" rel="noopener noreferrer">${escape(connection.public_url)}</a><button id="copy-phone-link" class="secondary">Copy phone link</button><small>Or enter this pairing code:</small><code class="pair-code">${escape(connection.pair_code)}</code>`:
      `<p class="muted">${escape(connection.message||'Use this device to scan.')}</p>`;
  }
  return connection;
}
$('phone-details').addEventListener('click',async event=>{
  const button=event.target.closest('#copy-phone-link');if(!button||!phoneConnection?.connect_url)return;
  try {await navigator.clipboard.writeText(phoneConnection.connect_url);button.textContent='Link copied';}
  catch {prompt('Copy this phone link:',phoneConnection.connect_url);}
});
$('pairing-form').addEventListener('submit',async event=>{
  event.preventDefault();$('pairing-error').textContent='';
  try {await api('/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('pairing-code').value})});await initialize();}
  catch(error){$('pairing-error').textContent=error.message;}
});
async function initialize(){
  try {
    const connection=await refreshConnection();
    if(connection.requires_pairing){
      const code=new URLSearchParams(location.hash.slice(1)).get('connect');
      if(code){
        window.history.replaceState(null,'',location.pathname+location.search+'#workspace');
        try {await api('/api/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});}
        catch(error){$('pairing-error').textContent=error.message;showPairing(true);return;}
      } else {showPairing(true);return;}
    }
    showPairing(false);route();await refreshQueues();
    if(!initialized){initialized=true;setInterval(refreshQueues,3000);setInterval(()=>refreshConnection().catch(()=>{}),3000);}
    const batches=await history();const saved=localStorage.getItem('fruispect.batch');
    if(batches.some(b=>b.batch_id===saved))await selectBatch(saved);else if(batches.length)await selectBatch(batches[0].batch_id);
    else renderSummary({summary:{accepted:0,preprocessing:0,queued:0,running:0,partial:0,fully_complete:0,failed:0,cancelled:0,rejected:0}});
  } catch(error){notice(error.message);}
}
$('retry-tunnel').addEventListener('click',async()=>{
  $('retry-tunnel').disabled=true;
  try {await post('/api/connection/retry');$('tunnel-summary').textContent='Retry requested. Preparing a new phone link...';}
  catch(error){notice(error.message);}
  finally{$('retry-tunnel').disabled=false;}
});
initialize();
