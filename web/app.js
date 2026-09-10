const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={data:null,date:new URLSearchParams(location.search).get('date')||'',tab:'plan',editingProduct:null,editingItem:null,assetOrder:[],formBusy:false};
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={draft:'Чернетка',ready:'Готово',posted:'Опубліковано',error:'Потрібна дія',skipped:'Пропущено',interrupted:'Перезапуск',queued:'У черзі',running:'Готується',done:'Готово'};
const kindLabels={reel:'REEL',carousel:'КАРУСЕЛЬ',story:'СТОРІЗ'};
const url=id=>'/media/'+encodeURIComponent(id);
let toastTimer;
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.hidden=false;el.className=error?'error':'';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,error?9000:4000);}
async function api(endpoint,{method='GET',data,raw}={}) {
  const headers={'X-Marylee':'1'};if(data!==undefined)headers['Content-Type']='application/json';
  const res=await fetch(endpoint,{method,headers,body:raw|| (data!==undefined?JSON.stringify(data):undefined),credentials:'same-origin'});
  const value=await res.json();
  if(!res.ok)throw new Error(value.error||'Не вдалося виконати дію');return value;
}
async function action(fn){try{await fn();}catch(e){toast(e.message,true);}}
async function copy(text){try{await navigator.clipboard.writeText(text);}catch{const input=document.createElement('textarea');input.value=text;document.body.append(input);input.select();if(!document.execCommand('copy'))throw new Error('Копіювання недоступне. Виділи текст і скопіюй вручну.');input.remove();}toast('Скопійовано');}
function asset(id){return state.data?.assets.find(a=>a.id===id);}
function product(id){return state.data?.products.find(p=>p.id===id);}
function item(id){return state.data?.plan?.items.find(i=>i.id===id);}
function busy(){return state.data?.jobs.some(j=>j.type==='prepare'&&j.target===state.date&&['queued','running'].includes(j.status));}
async function refresh({quiet=false}={}) {
  try {
    state.data=await api('/api/state'+(state.date?'?date='+encodeURIComponent(state.date):''));state.date=state.data.date;history.replaceState(null,'','?date='+encodeURIComponent(state.date));
    render();
  }catch(e){if(!quiet)toast(e.message,true);}
}
function tab(name){state.tab=name;for(const page of ['plan','products','studio','settings'])$('#'+page+'-page').hidden=page!==name;$$('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$('#breadcrumb').textContent='Майстерня / '+({plan:'План дня',products:'Каталог',studio:'ШІ студія',settings:'Налаштування'}[name]);if(name==='settings')fillSettings();}
function render() {
  const d=state.data;$('#plan-date').value=state.date;$('#catalog-count').textContent=d.products.filter(p=>p.active).length;
  $('#auto-summary').textContent=d.settings.autoPrepare?`Підготовка щовечора о ${d.settings.prepareTime} · Київ`:'Автоматична підготовка вимкнена';
  const items=d.plan?.items||[],ready=items.filter(i=>['ready','posted'].includes(i.status)).length;
  $('#feed-count').textContent=items.length?items.filter(i=>i.kind!=='story').length:3;$('#story-count').textContent=items.length?items.filter(i=>i.kind==='story').length:(d.settings.includeOptionalStory?6:5);
  $('#ready-count').innerHTML=`${ready}<span>/ ${items.length||8}</span>`;$('#readiness-label').textContent=items.length?`${items.filter(i=>i.status==='posted').length} уже опубліковано`:'Почнемо з товарів';
  $('#prepare-day').disabled=!d.plan||busy();$('#export-day').href='/api/plans/'+state.date+'/export';
  $('#export-day').classList.toggle('disabled',!items.length||busy()||items.some(i=>!['ready','posted','skipped'].includes(i.status)));
  $('#export-drive').disabled=!d.setup.drive||$('#export-day').classList.contains('disabled');
  $('#open-create').disabled=busy();
  if(!items.length)$('#plan-list').innerHTML=`<div class="empty-state"><div class="empty-icon">✧</div><h2>У цього дня ще немає історії</h2><p>${d.products.some(p=>p.ready&&p.active)?'Товари вже в каталозі. Сформуй розклад — і майстерня підготує тексти, відео та сторіз.':'Додай перший товар: фото, відео, назву й ціну. Його матеріали залишаться в каталозі для наступних публікацій.'}</p><button class="primary" data-action="${d.products.some(p=>p.ready&&p.active)?'create':'add-product'}">${d.products.some(p=>p.ready&&p.active)?'Сформувати день':'＋ Додати перший товар'}</button></div>`;
  else $('#plan-list').innerHTML=items.map(i=>{
    const cover=asset(i.coverId),p=product(i.productId);
    return `<div class="timeline-row"><div class="slot-time">${i.time}</div><article class="content-card ${i.status}"><div class="card-visual">${cover?`<img loading="lazy" src="${url(cover.id)}${cover.thumbnail?'/thumbnail':''}" alt="${escape(i.title)}">`:i.kind==='reel'?'▷':i.kind==='story'?'◌':'▧'}</div><div class="card-copy"><div class="card-meta"><span class="badge ${i.kind}">${kindLabels[i.kind]}</span><span class="badge ${i.status}">${labels[i.status]}</span>${i.optional?'<span class="badge">НЕОБОВ’ЯЗКОВО</span>':''}</div><div class="card-title">${escape(i.title||i.label)}</div><div class="card-subtitle">${escape(p?p.name:i.purpose==='repost'?'Поширення у сторіз':d.plan.topic.title)}</div></div><div class="card-buttons"><button class="secondary" data-open-item="${i.id}">${i.status==='posted'?'Переглянути':'Відкрити'}</button>${i.caption?`<button class="secondary" data-copy-item="${i.id}">Копіювати</button>`:''}</div></article></div>`;
  }).join('');
  const active=d.jobs.filter(j=>['running','queued'].includes(j.status));
  const failed=d.jobs.find(j=>['error','interrupted'].includes(j.status)&&!d.jobs.some(n=>n.type===j.type&&n.target===j.target&&n.createdAt>j.createdAt));
  $('#job-area').innerHTML=active.length?active.map(j=>`<div class="job-card"><strong>${labels[j.status]}</strong> · ${escape(j.message)}<progress value="${j.progress}" max="100"></progress></div>`).join(''):failed?`<div class="job-card error"><div class="actions"><button class="secondary" data-retry="${failed.id}">Продовжити</button></div>${escape(failed.message)}</div>`:!d.setup.text?'<div class="job-card">Додай <code>OPENAI_API_KEY</code> у Variables Marylee, щоб увімкнути тексти й озвучку. Уже можна завантажувати товари та редагувати розклад вручну.</div>':'';
  renderProducts();renderStudio();if(state.tab==='settings'&&!$('#settings-form').contains(document.activeElement))fillSettings();
}
function renderProducts(){
  if(!state.data)return;const search=$('#product-search').value.toLowerCase(),archived=$('#show-archived').checked;
  const products=state.data.products.filter(p=>(p.active||archived)&&[p.name,p.sku].join(' ').toLowerCase().includes(search));
  $('#product-grid').innerHTML=products.length?products.map(p=>{
    const assets=state.data.assets.filter(a=>a.productId===p.id),cover=asset(p.assetOrder?.[0])||assets[0];
    return `<article class="product-card"><div class="product-photo" data-edit-product="${p.id}">${cover?`<img src="${url(cover.id)}/thumbnail" alt="${escape(p.name)}" loading="lazy">`:'▧'}</div><div class="product-info"><h3>${escape(p.name)}</h3><p>${escape(p.sku?'Арт. '+p.sku:'Без артикула')} · ${assets.length} файлів</p><span class="product-price">${p.price!==null?escape(p.price)+' грн':'Ціну не вказано'}</span><div class="actions"><span class="badge ${p.ready&&p.active?'ready':'draft'}">${!p.active?'АРХІВ':p.ready?'У КАТАЛОЗІ':'ДОДАЙ МЕДІА'}</span><button class="text-button" data-edit-product="${p.id}">Редагувати</button></div></div></article>`;
  }).join(''):'<div class="empty-state"><h2>Місце для нових речей</h2><p>Додай товар із готовими фото чи відео.</p><button class="primary" data-action="add-product">＋ Додати товар</button></div>';
}
function renderStudio(){const list=state.data.assets.filter(a=>!a.productId&&['ai','editorial'].includes(a.source));$('#studio-grid').innerHTML=list.length?list.map(a=>`<article class="product-card"><div class="product-photo"><img src="${url(a.id)}/thumbnail" alt="Редакційний матеріал" loading="lazy"></div><div class="product-info"><h3>${escape(a.name)}</h3><p>${a.source==='ai'?'ШІ ілюстрація':'Власний матеріал'}</p><a class="secondary" href="${url(a.id)}?download=1">↓ Завантажити</a></div></article>`).join(''):'<p class="hint">Тут з’являться твої ілюстрації та редакційні відео.</p>';}
function fillSettings(){const d=state.data;if(!d)return;const f=$('#settings-form');for(const [key,value] of Object.entries(d.settings)){const input=f.elements.namedItem(key);if(input){if(input.type==='checkbox')input.checked=value;else input.value=value;}}
  $('#setup-status').innerHTML=[['Тексти й ілюстрації',d.setup.text],['Озвучка · '+d.setup.voiceProvider,d.setup.voice],['Google Drive',d.setup.drive]].map(([name,ready])=>`<div class="setup-row"><span>${name}</span><span class="${ready?'status-ok':'status-off'}">${ready?'● Налаштовано':'○ Потрібен ключ'}</span></div>`).join('');
  $('#drive-links').innerHTML=d.drive?`<a class="external" href="https://drive.google.com/drive/folders/${encodeURIComponent(d.drive.input)}" target="_blank" rel="noopener">Відкрити папку товарів ↗</a>`:'';
  $('#usage-details').textContent=`$${d.usage.reserve.toFixed(2)} із $${d.settings.dailyBudget.toFixed(2)}. Текстових запитів: ${d.usage.counts.text||0}; ілюстрацій: ${d.usage.counts.image||0}; символів озвучки: ${d.usage.counts.voice||0}.`;
}
function openProduct(id=null){state.editingProduct=id;const p=id?product(id):null,f=$('#product-form');f.reset();for(const key of ['id','name','sku','price','sizes','colors','material','description','notes'])f.elements.namedItem(key).value=p?.[key]??'';
  state.assetOrder=p?.assetOrder?[...p.assetOrder]:state.data.assets.filter(a=>a.productId===id&&id).map(a=>a.id);
  $('#product-dialog-title').textContent=p?'Редагувати товар':'Новий товар';$('#archive-product').hidden=!p;$('#archive-product').textContent=p?.active?'Зняти з продажу':'Повернути в продаж';$('#upload-progress').textContent='';$('#selected-files').textContent='JPG, PNG, WebP, MP4, MOV, WebM · до 200 МБ/файл';renderProductAssets();$('#product-dialog').showModal();}
function renderProductAssets(){const assets=state.data.assets.filter(a=>a.productId===state.editingProduct&&state.editingProduct);for(const a of assets)if(!state.assetOrder.includes(a.id))state.assetOrder.push(a.id);$('#product-assets').innerHTML=state.assetOrder.map(id=>asset(id)).filter(Boolean).map((a,n)=>`<div class="asset-mini"><img src="${url(a.id)}/thumbnail" alt="Ракурс ${n+1}"><div class="actions"><button type="button" class="icon-button" data-move-asset="${a.id}" aria-label="Перемістити фото ліворуч">←</button><button type="button" class="icon-button" data-remove-asset="${a.id}" aria-label="Прибрати фото">×</button></div></div>`).join('');}
function openCreate(){const f=$('#create-form');f.reset();f.elements.date.value=state.date;const options='<option value="">Автоматично</option>'+state.data.products.filter(p=>p.active&&p.ready).map(p=>`<option value="${p.id}">${escape(p.name)}${state.data.eligible.includes(p.id)?'':' · був нещодавно'}</option>`).join('');f.elements.productA.innerHTML=options;f.elements.productB.innerHTML=options;$('#create-dialog').showModal();}
function openItem(id){const i=item(id);if(!i)return;state.editingItem=id;const f=$('#item-form');f.reset();for(const key of ['id','title','caption','pollQuestion','imagePrompt'])f.elements.namedItem(key).value=i[key]||'';
  f.elements.lines.value=i.lines.join('\n');f.elements.pollOptions.value=(i.pollOptions||[]).join('\n');f.elements.keywords.value=i.keywords.join(', ');f.elements.hashtags.value=i.hashtags.join(' ');
  $('#item-heading').textContent=i.title||i.label;$('#item-slot').textContent=i.time+' · '+kindLabels[i.kind]+' · '+labels[i.status];$('#poll-fields').hidden=i.purpose!=='poll';
  const preview=i.outputIds.map(asset).find(a=>a?.kind==='video')||asset(i.coverId)||i.outputIds.map(asset).find(a=>a?.kind==='image');
  $('#item-media').innerHTML=preview?(preview.kind==='video'?`<video src="${url(preview.id)}" ${i.coverId?`poster="${url(i.coverId)}"`:""} controls playsinline preload="metadata"></video>`:`<img src="${url(preview.id)}" alt="${escape(i.title)}">`):'<div class="empty-state"><div class="empty-icon">✧</div><p>Тут буде готовий матеріал</p></div>';
  $('#item-downloads').innerHTML=[...new Set([...i.outputIds,i.coverId].filter(Boolean))].map(asset).filter(Boolean).map(a=>`<a class="secondary" href="${url(a.id)}?download=1">↓ ${a.id===i.coverId?'Обкладинка':a.kind==='video'?'Відео':a.kind==='image'?'Фото':escape(a.name)}</a>`).join('');
  $('#item-notes').textContent=(i.outputIds.length&&i.renderedRevision!==i.revision?'Є правки, які ще не змонтовано. Натисни «Перемонтувати». ':'')+(i.notes||[]).join(' ');$('#item-instruction').textContent=i.instruction;
  $('#script-field').hidden=i.kind!=='reel';$('#script-label').textContent=i.productId?'Написи на відео · без озвучки':'Озвучка · один рядок = одна сцена';$('#keywords-field').hidden=i.kind!=='reel';$('#hashtags-field').hidden=i.kind==='story';$('#caption-limit').textContent=i.kind==='reel'?'Короткий опис із параметрами — до 250 символів. Далі ключові слова та хештеги.':i.kind==='story'?'Одна коротка фраза — до 90 символів.':'';
  const p=product(i.productId);$('#product-facts').textContent=p?'Назва, артикул, ціна й параметри з каталогу додадуться автоматично до повного підпису.':'';
  const assets=state.data.assets.filter(a=>i.productId?a.productId===i.productId&&a.source==='original':!a.productId&&['ai','editorial'].includes(a.source));
  $('#item-asset-options').innerHTML=assets.map(a=>`<label class="asset-option"><img src="${url(a.id)}/thumbnail" alt="${escape(a.name)}"><input type="checkbox" name="assetIds" value="${a.id}" ${i.selectedAssetIds.includes(a.id)?'checked':''}>${escape(a.name)}</label>`).join('')||'<p class="hint">Додай файли у каталог або ШІ студію.</p>';
  const locked=i.status==='posted'||busy();[...f.elements].forEach(el=>{if(el.tagName!=='BUTTON')el.disabled=locked;});$('#mark-posted').disabled=i.status!=='ready'||busy();$('#regen-text').disabled=locked;$('#regen-all').disabled=locked;$('#rerender').disabled=locked;$('#skip-item').disabled=locked;f.querySelector('[type=submit]').disabled=locked;
  $('#skip-item').textContent=i.status==='skipped'?'Повернути в розклад':'Пропустити';$('#item-dialog').showModal();
}
function itemPayload(){const f=$('#item-form');return {title:f.elements.title.value,caption:f.elements.caption.value,lines:f.elements.lines.value.split('\n').map(x=>x.trim()).filter(Boolean),pollQuestion:f.elements.pollQuestion.value,pollOptions:f.elements.pollOptions.value.split('\n').map(x=>x.trim()).filter(Boolean),keywords:f.elements.keywords.value.split(',').map(x=>x.trim()).filter(Boolean),hashtags:f.elements.hashtags.value.split(/\s+/).filter(Boolean),imagePrompt:f.elements.imagePrompt.value,selectedAssetIds:[...f.querySelectorAll('[name=assetIds]:checked')].map(x=>x.value)};}
async function saveItem(){return api(`/api/plans/${state.date}/items/${state.editingItem}`,{method:'PUT',data:itemPayload()});}
async function regenerate(mode){if(state.formBusy)return;state.formBusy=true;for(const id of ['regen-text','regen-all','rerender'])$('#'+id).disabled=true;try{if(mode!=='all')await saveItem();await api(`/api/plans/${state.date}/prepare`,{method:'POST',data:{itemId:state.editingItem,mode}});$('#item-dialog').close();await refresh();toast(mode==='all'?'Готую весь матеріал заново':mode==='text'?'Готую новий текст':'Монтаж додано до черги');}finally{state.formBusy=false;for(const id of ['regen-text','regen-all','rerender'])$('#'+id).disabled=busy()||item(state.editingItem)?.status==='posted';}}

$$('[data-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
$$('[data-close]').forEach(b=>b.onclick=()=>{const dialog=$('#'+b.dataset.close);if(state.formBusy&&b.dataset.close==='product-dialog')return;dialog.querySelectorAll('video').forEach(v=>v.pause());dialog.close();});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.action==='add-product')openProduct();if(b.dataset.action==='create')openCreate();
  if(b.dataset.openItem)openItem(b.dataset.openItem);if(b.dataset.copyItem)action(()=>copy(item(b.dataset.copyItem).fullCaption));
  if(b.dataset.editProduct)openProduct(b.dataset.editProduct);
  if(b.dataset.retry)action(async()=>{await api('/api/jobs/'+b.dataset.retry+'/retry',{method:'POST',data:{}});await refresh();});
  if(b.dataset.moveAsset){const n=state.assetOrder.indexOf(b.dataset.moveAsset);if(n>0)[state.assetOrder[n-1],state.assetOrder[n]]=[state.assetOrder[n],state.assetOrder[n-1]];renderProductAssets();}
  if(b.dataset.removeAsset)action(async()=>{await api('/api/assets/'+b.dataset.removeAsset,{method:'PATCH',data:{disabled:true}});state.assetOrder=state.assetOrder.filter(id=>id!==b.dataset.removeAsset);await refresh();renderProductAssets();});
});
$('#product-grid').addEventListener('click',e=>{const target=e.target.closest('.product-photo[data-edit-product]');if(target)openProduct(target.dataset.editProduct);});
$('#add-product').onclick=()=>openProduct();$('#open-create').onclick=openCreate;$('#product-search').oninput=renderProducts;$('#show-archived').onchange=renderProducts;
$('#product-form').elements.files.onchange=e=>$('#selected-files').textContent=`Вибрано файлів: ${e.target.files.length}`;
$('#product-form').onsubmit=e=>{e.preventDefault();action(async()=>{
  if(state.formBusy)return;state.formBusy=true;$('#save-product').disabled=true;
  try {
    const f=e.target,input={};for(const key of ['name','sku','price','sizes','colors','material','description','notes'])input[key]=f.elements.namedItem(key).value;
    let p;if(state.editingProduct)p=await api('/api/products/'+state.editingProduct,{method:'PUT',data:{...input,assetOrder:state.assetOrder}});else {p=await api('/api/products',{method:'POST',data:input});state.editingProduct=p.id;f.elements.id.value=p.id;}
    const files=[...f.elements.files.files];
    for(const [n,file] of files.entries()){$('#upload-progress').textContent=`Завантажую ${n+1}/${files.length}: ${file.name}`;const a=await api(`/api/products/${p.id}/assets?name=${encodeURIComponent(file.name)}`,{method:'POST',raw:file});if(!state.assetOrder.includes(a.id))state.assetOrder.push(a.id);}
    await api('/api/products/'+p.id,{method:'PUT',data:{ready:true,assetOrder:state.assetOrder}});$('#product-dialog').close();await refresh();toast('Товар збережено в каталозі');
  }finally{state.formBusy=false;$('#save-product').disabled=false;$('#upload-progress').textContent='';}
});};
$('#product-dialog').addEventListener('cancel',e=>{if(state.formBusy)e.preventDefault();});
$('#archive-product').onclick=()=>action(async()=>{const p=product(state.editingProduct);await api('/api/products/'+p.id,{method:'PUT',data:{active:!p.active}});$('#product-dialog').close();await refresh();toast(p.active?'Товар знято з продажу':'Товар повернено в каталог');});
$('#create-form').onsubmit=e=>{e.preventDefault();action(async()=>{const f=e.target;const ids=[f.elements.productA.value,f.elements.productB.value].filter(Boolean);if(new Set(ids).size!==ids.length)throw new Error('Для A та B вибери різні товари');const d=await api('/api/plans',{method:'POST',data:{date:f.elements.date.value,productIds:ids,prepare:e.submitter?.name!=='draft',replace:f.elements.replace.checked}});state.date=d.plan.id;$('#create-dialog').close();await refresh();toast(d.job?'Підготовку додано до черги':'Розклад створено');});};
$('#prepare-day').onclick=()=>action(async()=>{await api(`/api/plans/${state.date}/prepare`,{method:'POST',data:{mode:'render'}});await refresh();});
$('#export-drive').onclick=()=>action(async()=>{await api('/api/drive/export',{method:'POST',data:{date:state.date}});await refresh();toast('Пакет додано до черги збереження на Drive');});
$('#plan-date').onchange=e=>{state.date=e.target.value;refresh();};
function shift(n){state.date=new Date(Date.parse(state.date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);refresh();}
$('#prev-day').onclick=()=>shift(-1);$('#next-day').onclick=()=>shift(1);$('#tomorrow').onclick=()=>{state.date=state.data.tomorrow;refresh();};
$('#item-form').onsubmit=e=>{e.preventDefault();action(async()=>{await saveItem();await refresh();toast('Правки збережено');});};
$('#copy-caption').onclick=()=>action(async()=>{if(item(state.editingItem).status!=='posted'&&!busy())await saveItem();await refresh();await copy(item(state.editingItem).fullCaption);});
$('#copy-image-prompt').onclick=()=>action(()=>copy($('#item-form').elements.imagePrompt.value));$('#regen-all').onclick=()=>action(()=>regenerate('all'));$('#regen-text').onclick=()=>action(()=>regenerate('text'));$('#rerender').onclick=()=>action(()=>regenerate('render'));
$('#mark-posted').onclick=()=>action(async()=>{await api(`/api/plans/${state.date}/items/${state.editingItem}/status`,{method:'POST',data:{status:'posted'}});$('#item-dialog').close();await refresh();toast('Позначено як опубліковане');});
$('#skip-item').onclick=()=>action(async()=>{await api(`/api/plans/${state.date}/items/${state.editingItem}/status`,{method:'POST',data:{status:item(state.editingItem).status==='skipped'?'draft':'skipped'}});$('#item-dialog').close();await refresh();});
$('#settings-form').onsubmit=e=>{e.preventDefault();action(async()=>{const f=e.target,data={};for(const key of ['autoPrepare','voiceEnabled','includeOptionalStory','driveAutoImport','driveAutoExport'])data[key]=f.elements.namedItem(key).checked;for(const key of ['prepareTime','cooldownDays','dailyBudget'])data[key]=f.elements.namedItem(key).value;await api('/api/settings',{method:'PUT',data});await refresh();toast('Налаштування збережено');});};
$('#setup-drive').onclick=()=>action(async()=>{await api('/api/drive/setup',{method:'POST',data:{}});await refresh();});$('#import-drive').onclick=()=>action(async()=>{await api('/api/drive/import',{method:'POST',data:{}});await refresh();});
$('#image-form').onsubmit=e=>{e.preventDefault();action(async()=>{await api('/api/image',{method:'POST',data:{prompt:e.target.elements.prompt.value}});await refresh();toast('Ілюстрацію додано до черги');});};
$('#editorial-upload').onchange=e=>action(async()=>{const files=[...e.target.files];for(const file of files){toast('Завантажую '+file.name);await api(`/api/editorial-assets?name=${encodeURIComponent(file.name)}&ai=${$('#editorial-ai').checked?'1':'0'}`,{method:'POST',raw:file});}e.target.value='';await refresh();toast('Матеріали додано до студії');});
setInterval(()=>{if(!document.hidden&&!state.formBusy)refresh({quiet:true});},8000);refresh();
