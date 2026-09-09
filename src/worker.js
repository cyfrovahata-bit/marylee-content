import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { kyivToday, kyivMinutes, shiftDate } from './kyiv.js';
import { createPlan, eligibleProducts } from './planner.js';
import { renderItem } from './montage.js';
import { saveAsset } from './files.js';
import { exportDay } from './export.js';

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
      selectedAssetIds:allowed.length?allowed:item.selectedAssetIds,status:'draft',revision:item.revision+1});
    for(const child of plan.items.filter(i=>i.dependsOn===item.id&&i.status!=='posted'))child.status='draft';
  }
  store.put('plan',plan);
}
export class Worker {
  constructor(store,ai,drive,{renderer=renderItem}={}) {this.store=store;this.ai=ai;this.drive=drive;this.renderer=renderer;this.busy=false;this.lastImport=0;}
  start() {this.store.recover();this.timer=setInterval(()=>this.tick().catch(e=>console.error('Worker:',e.message)),15000);this.timer.unref();this.tick().catch(e=>console.error('Worker:',e.message));}
  stop(){clearInterval(this.timer);this.stopping=true;}
  schedule(now=new Date()) {
    const s=this.store.settings(),today=kyivToday(now),tomorrow=shiftDate(today,1);
    const [h,m]=s.prepareTime.split(':').map(Number);
    if(s.autoPrepare&&this.ai.config.openaiKey&&kyivMinutes(now)>=h*60+m&&!this.store.get('schedule',today)) {
      try {
        const importFirst=s.driveAutoImport&&this.drive.configured();
        if(importFirst)this.store.enqueue('import','drive');
        const plan=this.store.get('plan',tomorrow);
        if(!plan&&!importFirst&&!eligibleProducts(this.store,tomorrow).length)throw new Error('Додай готовий товар для автоматичної підготовки завтра.');
        if(!plan||plan.items.some(i=>!['ready','posted','skipped'].includes(i.status)))this.store.enqueue('prepare',tomorrow);
        this.store.put('schedule',{id:today,queuedAt:now.toISOString()});
      }catch(e){this.store.put('notice',{id:'schedule',message:e.message,at:now.toISOString()});}
    }
    if(s.driveAutoImport&&this.drive.configured()&&now.getTime()-this.lastImport>900000) {
      this.lastImport=now.getTime();this.store.enqueue('import','drive');
    }
  }
  async tick() {
    if(this.busy||this.stopping)return;
    this.schedule();const job=this.store.claim();if(!job)return;
    this.busy=true;
    const progress=(message,n)=>this.store.updateJob(job,{message,...(n!==undefined?{progress:n}:{})});
    try {
      let result;
      if(job.type==='prepare') result=await this.prepare(job,progress);
      else if(job.type==='import')result=await this.drive.importProducts(progress);
      else if(job.type==='drive-setup')result=await this.drive.setup();
      else if(job.type==='image') {
        progress('Створюю редакційну ілюстрацію',15);
        const bytes=await this.ai.image(job.payload.prompt),temp=path.join(this.store.dir,'work',randomUUID()+'.png');
        try {await writeFile(temp,bytes);result=await saveAsset(this.store,temp,{name:'ai-editorial.png',source:'ai'});}finally{await rm(temp,{force:true});}
      } else if(job.type==='export-drive')result=await this.toDrive(job.target,progress);
      else throw new Error('Невідоме завдання');
      this.store.updateJob(job,{status:'done',progress:100,message:'Готово',result});
    }catch(e){this.store.updateJob(job,{status:'error',message:errorMessage(e)});}
    finally{this.busy=false;}
  }
  async prepare(job,progress) {
    const plan=this.store.get('plan',job.target)||createPlan(this.store,job.target);
    const selected=job.payload.itemId?plan.items.filter(i=>i.id===job.payload.itemId):plan.items.filter(i=>!['posted','skipped'].includes(i.status));
    if(!selected.length||selected.some(i=>i.status==='posted'))throw new Error('Опублікований матеріал не перегенеровується');
    const needCopy=job.payload.mode==='text'||job.payload.mode==='all'?selected:selected.filter(i=>!i.caption);
    if(needCopy.length) {progress('Підбираю фото й пишу різні тексти для кожного слота',8);applyCopy(plan,await this.ai.copy(plan,needCopy),this.store);}
    if(job.payload.mode==='text')return {date:plan.id,textsReady:true};
    const toRender=selected.filter(i=>!['ready','posted','skipped'].includes(i.status)||job.payload.itemId);
    for(const [n,item] of toRender.entries()) {
      progress(`${item.time} · ${item.label}`,15+Math.round(n/Math.max(1,toRender.length)*80));
      try {
        if(item.productId&&!this.store.get('product',item.productId)?.active)throw new Error('Товар знято з продажу. Пропусти цей слот або заміни план.');
        await this.renderer(this.store,this.ai,plan,item);this.store.put('plan',plan);
        // Reposts always point to the newest prepared parent.
        for(const child of plan.items.filter(i=>i.dependsOn===item.id&&i.status!=='posted')) {child.status='draft';child.outputIds=[];}
        this.store.put('plan',plan);
      }catch(e){item.status='error';item.error=errorMessage(e);this.store.put('plan',plan);throw e;}
    }
    for(const child of plan.items.filter(i=>i.purpose==='repost'&&i.status==='draft'&&plan.items.find(p=>p.id===i.dependsOn)?.status==='ready')) {
      await this.renderer(this.store,this.ai,plan,child);this.store.put('plan',plan);
    }
    if(this.store.settings().driveAutoExport&&this.drive.configured()&&plan.items.every(i=>['ready','posted','skipped'].includes(i.status)))this.store.enqueue('export-drive',plan.id);
    return {date:plan.id};
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
