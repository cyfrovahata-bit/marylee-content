import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { kyivToday, kyivMinutes, shiftDate } from './kyiv.js';
import { createPlan, createBatch, eligibleProducts } from './planner.js';
import { renderItem } from './montage.js';
import { IMAGE_API_DISABLED, resetIllustration, invalidateDependents } from './editorial.js';
import { exportDay } from './export.js';
import { ContentQueue } from './queue.js';

const errorMessage=error=>['TimeoutError','AbortError'].includes(error.name)
  ?'Сервіс генерації не встиг відповісти. Товари та готові матеріали збережені. Можна продовжити вручну.'
  :error.message;

export function applyCopy(plan,values,store) {
  for(const value of values) {
    const item=plan.items.find(i=>i.id===value.slotId);
    if(item.kind!=='story')store.put('copy-history',{id:randomUUID(),planId:plan.id,slotId:item.id,caption:value.caption,createdAt:new Date().toISOString()});
    const allowed=value.assetIds.filter(id=>{const a=store.get('asset',id);return a&&!a.disabled&&a.productId===item.productId&&(item.productId?a.source==='original':true);});
    Object.assign(item,{title:value.title,caption:value.caption,keywords:value.keywords,hashtags:value.hashtags,lines:value.lines,
      pollQuestion:value.pollQuestion,pollOptions:value.pollOptions,imagePrompt:value.imagePrompt,
      detailFocus:value.detailFocus||'full',
      selectedAssetIds:item.purpose==='useful'?[]:allowed.length?[...new Set(allowed)]:item.selectedAssetIds,status:'draft',revision:item.revision+1});
    if(item.purpose==='useful'&&!item.externalImages){item.imageGeneration=(item.imageGeneration||0)+1;resetIllustration(item);}
    if(item.approvedStory){Object.assign(item,item.approvedStory);item.selectedAssetIds=item.approvedAssetIds||item.selectedAssetIds;}
    invalidateDependents(plan,item);
  }
  store.put('plan',plan);
}
export class Worker {
  constructor(store,ai,drive,{renderer=renderItem}={}) {this.store=store;this.ai=ai;this.drive=drive;this.queue=new ContentQueue(store,drive);this.renderer=renderer;this.busy=false;this.lastImport=0;this.lastQueue=0;}
  start() {this.store.recover();this.timer=setInterval(()=>this.tick().catch(e=>console.error('Worker:',e.message)),15000);this.timer.unref();this.tick().catch(e=>console.error('Worker:',e.message));}
  stop(){clearInterval(this.timer);this.stopping=true;}
  schedule(now=new Date()) {
    const s=this.store.settings(),today=kyivToday(now),tomorrow=shiftDate(today,1);
    const [h,m]=s.prepareTime.split(':').map(Number);
    if(s.autoPrepare&&this.ai.config.openaiKey&&kyivMinutes(now)>=h*60+m&&!this.store.get('schedule',today)) {
      try {
        const importFirst=s.driveAutoImport&&this.drive.configured();
        if(importFirst)this.store.enqueue('import','drive');
        if(importFirst)this.store.enqueue('plan-batch',tomorrow);else createBatch(this.store,tomorrow);
        this.store.put('schedule',{id:today,queuedAt:now.toISOString()});
      }catch(e){this.store.put('notice',{id:'schedule',message:e.message,at:now.toISOString()});}
    }
    if(s.driveAutoImport&&this.drive.configured()&&now.getTime()-this.lastImport>900000) {
      this.lastImport=now.getTime();this.store.enqueue('import','drive');
    }
    const pendingImages=this.store.list('image-job').some(j=>!['IMPORTED','CANCELLED'].includes(j.status));
    if(s.driveQueueMonitor&&pendingImages&&this.queue.configured()&&now.getTime()-this.lastQueue>120000){this.lastQueue=now.getTime();this.store.enqueue('queue-sync','drive');}
  }
  async tick() {
    if(this.busy||this.stopping)return;
    this.schedule();const job=this.store.claim();if(!job)return;
    this.busy=true;
    const progress=(message,n)=>this.store.updateJob(job,{message,...(n!==undefined?{progress:n}:{})});
    try {
      let result;
      if(job.type==='prepare') result=await this.prepare(job,progress);
      else if(job.type==='plan-batch')result=createBatch(this.store,job.target);
      else if(job.type==='queue-sync')result=await this.queue.sync();
      else if(job.type==='import')result=await this.drive.importProducts(progress);
      else if(job.type==='drive-setup')result=this.queue.configured()?await this.queue.setup():await this.drive.queueFolders();
      else if(job.type==='image')throw new Error(IMAGE_API_DISABLED);
      else if(job.type==='export-drive')result=await this.toDrive(job.target,progress);
      else throw new Error('Невідоме завдання');
      this.store.updateJob(job,{status:'done',progress:100,message:result?.waitingForImages?'Товарні матеріали готові. Ілюстрації очікуються з черги GPT.':'Готово',result});
      if(job.type==='queue-sync')this.store.db.prepare("DELETE FROM jobs WHERE type='queue-sync' AND status='done' AND id<>?").run(job.id);
    }catch(e){if(job.type==='queue-sync')this.lastQueue=Date.now()+13*60000;this.store.updateJob(job,{status:'error',message:errorMessage(e)});}
    finally{this.busy=false;}
  }
  async prepare(job,progress) {
    const plan=this.store.get('plan',job.target)||createPlan(this.store,job.target);
    const selected=job.payload.itemId?plan.items.filter(i=>i.id===job.payload.itemId):plan.items.filter(i=>!['posted','skipped'].includes(i.status));
    if(!selected.length||selected.some(i=>i.status==='posted'))throw new Error('Опублікований матеріал не перегенеровується');
    const forceCopy=job.payload.mode==='text'||job.payload.mode==='all';
    if(job.payload.mode==='all'&&!job.payload.imagesInvalidated){
      for(const item of selected.filter(i=>i.externalImages)){resetIllustration(item);item.approvedAssetIds=[];item.imageGeneration=(item.imageGeneration||0)+1;item.caption='';item.status='draft';item.revision++;invalidateDependents(plan,item);}
      this.store.transaction(()=>{this.store.put('plan',plan);this.store.updateJob(job,{payload:{...job.payload,imagesInvalidated:true}});});
    }
    const externalDay=plan.items.some(i=>i.externalImages);
    if(externalDay)for(const i of selected.filter(i=>i.purpose==='repost')){i.caption='Відкрий Reel і пошир у свої сторіз.';i.title=i.label;}
    const needCopy=selected.filter(i=>!(externalDay&&i.purpose==='repost')&&!(i.externalImages&&!i.approvedStory)&&(!i.caption||(forceCopy&&job.payload.copiedRevisions?.[i.id]!==i.revision)));
    const batches=[];
    for(const item of needCopy) {
      const batch=batches.at(-1);
      if(!batch||batch.length>=3||batch[0].productId!==item.productId)batches.push([item]);
      else batch.push(item);
    }
    let copied=0;
    for(const [n,batch] of batches.entries()) {
      progress(`Готую тексти для ${batch[0].time}–${batch.at(-1).time} · частина ${n+1}/${batches.length}`,8+Math.round(n/batches.length*30));
      const values=await this.ai.copy(plan,batch);
      // Save the texts and their retry checkpoint together. A later failure must
      // not discard or charge again for successful parts of this job.
      this.store.transaction(()=>{
        applyCopy(plan,values,this.store);
        this.store.updateJob(job,{payload:{...job.payload,copiedRevisions:{...job.payload.copiedRevisions,...Object.fromEntries(batch.map(i=>[i.id,i.revision]))}}});
      });
      copied+=batch.length;progress(`Тексти збережено: ${copied}/${needCopy.length}`,8+Math.round((n+1)/batches.length*30));
    }
    if(selected.some(i=>i.externalImages))try{await this.queue.ensure(plan);this.store.remove('notice','queue-error');}catch(e){this.store.put('notice',{id:'queue-error',message:e.message,at:new Date().toISOString()});}
    this.store.put('plan',plan);
    if(job.payload.mode==='text')return {date:plan.id,textsReady:true};
    const toRender=selected.filter(i=>!['ready','posted','skipped'].includes(i.status)||job.payload.itemId);
    for(const [n,item] of toRender.entries()) {
      progress(`${item.time} · ${item.label}`,40+Math.round(n/Math.max(1,toRender.length)*55));
      try {
        if(item.productId&&!this.store.get('product',item.productId)?.active)throw new Error('Товар знято з продажу. Пропусти цей слот або заміни план.');
        await this.renderer(this.store,this.ai,plan,item);this.store.put('plan',plan);
        // Reposts always point to the newest prepared parent.
        if(item.status==='ready')invalidateDependents(plan,item);
        this.store.put('plan',plan);
      }catch(e){item.status='error';item.error=errorMessage(e);this.store.put('plan',plan);throw e;}
    }
    for(const child of plan.items.filter(i=>i.purpose==='repost'&&i.status==='draft'&&plan.items.find(p=>p.id===i.dependsOn)?.status==='ready')) {
      await this.renderer(this.store,this.ai,plan,child);this.store.put('plan',plan);
    }
    for(const child of plan.items.filter(i=>i.purpose==='poll'&&i.status==='draft'&&i.caption&&plan.items.find(p=>p.id==='morning')?.status==='ready')) {
      await this.renderer(this.store,this.ai,plan,child);this.store.put('plan',plan);
    }
    if(this.store.settings().driveAutoExport&&this.drive.configured()&&plan.items.every(i=>['ready','posted','skipped'].includes(i.status)))this.store.enqueue('export-drive',plan.id);
    return {date:plan.id,waitingForImages:plan.items.some(i=>i.status==='awaiting-image')};
  }
  async toDrive(date,progress) {
    progress('Збираю ZIP дня',10);const zip=await exportDay(this.store,date);
    try {
      const roots=await this.drive.setup(),folder=await this.drive.folder(roots.output,date,'day-'+date);
      progress('Зберігаю готовий пакет на Drive',50);
      const file=await this.drive.upload(folder,`marylee-${date}.zip`,zip,'application/zip','package-'+date);
      const result={id:date,fileId:file.id,url:`https://drive.google.com/file/d/${file.id}/view`,savedAt:new Date().toISOString()};
      this.store.put('drive-export',result);return result;
    } finally {await rm(zip,{force:true});}
  }
}
