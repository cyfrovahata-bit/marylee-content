import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { configFrom, validateSettings } from './config.js';
import { Store } from './store.js';
import { AI, captionFor, factBlock } from './ai.js';
import { Drive } from './drive.js';
import { Worker } from './worker.js';
import { cleanProduct, productAssets } from './catalog.js';
import { createPlan, createBatch, eligibleProducts, itemInstruction, itemGoal } from './planner.js';
import { hourlyPrompt } from './queue.js';
import { resetContent, restoreContent } from './reset.js';
import { IMAGE_API_DISABLED, drawingPrompt, imageSource, illustrationSignature, resetIllustration, invalidateDependents } from './editorial.js';
import { kyivToday, shiftDate, validDate } from './kyiv.js';
import { saveAsset, boundedDownload, mediaPath } from './files.js';
import { exportDay } from './export.js';

const PUBLIC=fileURLToPath(new URL('../web/',import.meta.url));
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req,limit=100000) {let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw new Error('Забагато даних');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new Error('Некоректні дані форми');}}

async function serveFile(req,res,filename,mime,{download=false,name='file',cleanup=false}={}) {
  const info=await stat(filename);let start=0,end=info.size-1,status=200;
  if(req.headers.range&&!download) {
    const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(!m||(!m[1]&&!m[2])) {res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();}
    if(!m[1])start=Math.max(0,info.size-Number(m[2]));else {start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();}status=206;
  }
  const headers={'Content-Type':mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
  if(download)headers['Content-Disposition']=`attachment; filename="marylee${path.extname(filename)}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g,'%27')}`;
  res.writeHead(status,headers);
  try {if(req.method==='HEAD')res.end();else await pipeline(createReadStream(filename,{start,end}),res);}finally{if(cleanup)await rm(filename,{force:true});}
}

export function createApp(config,{store=new Store(config.dataDir),ai=new AI(config,store),drive=new Drive(config,store),startWorker=true,renderer}={}) {
  const worker=new Worker(store,ai,drive,renderer?{renderer}:{});let uploads=0,maintenance=false;
  const isBusy=date=>store.activeJobs().some(j=>(j.type==='prepare'&&j.target===date)||(j.type==='queue-sync'&&j.status==='running'));
  const requireIdle=date=>{if(isBusy(date))throw new Error('Цей день зараз готується. Дочекайся завершення перед редагуванням.');};
  function checkProductBusy(id) {
    if(store.activeJobs().some(j=>j.type==='import'&&j.status==='running'))throw new Error('Зараз триває імпорт товарів. Дочекайся завершення.');
    for(const plan of store.list('plan'))if(plan.productIds.includes(id))requireIdle(plan.id);
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://web.telegram.org");
    try {
      const url=new URL(req.url,'http://localhost'),p=url.pathname,method=req.method;
      if(p==='/healthz')return json(res,200,{ok:true,app:'marylee-content',version:'1.0.0'});
      if(['POST','PUT','PATCH','DELETE'].includes(method)) {
        if(maintenance)return json(res,409,{error:'Завершується очищення матеріалів. Зачекай.'});
        if(req.headers['x-marylee']!=='1')return json(res,403,{error:'Онови сторінку та повтори дію'});
        if(req.headers.origin) {
          const expected=config.publicUrl?new URL(config.publicUrl).origin:`${config.production?'https':'http'}://${req.headers.host}`;
          if(req.headers.origin!==expected)return json(res,403,{error:'Запит з іншого сайту заблоковано'});
        }
      }
      const staticFiles={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/icon.svg':['icon.svg','image/svg+xml']};
      if(staticFiles[p]&&['GET','HEAD'].includes(method)){const [name,mime]=staticFiles[p];return await serveFile(req,res,path.join(PUBLIC,name),mime);}
      if(p==='/api/state'&&method==='GET') {
        const date=url.searchParams.get('date')||shiftDate(kyivToday(),1);if(!validDate(date))throw new Error('Некоректна дата');
        const plan=store.get('plan',date);if(plan)for(const item of plan.items){item.fullCaption=captionFor(item,store);item.instruction=itemInstruction(item);item.goal=itemGoal(item);const source=imageSource(plan,item);item.imageSourceId=source?.id||null;item.drawingPrompt=drawingPrompt(source);item.productFacts=factBlock(item.productId?store.get('product',item.productId):null);}
        return json(res,200,{today:kyivToday(),tomorrow:shiftDate(kyivToday(),1),date,plan,
          dates:store.list('plan').map(p=>p.id).sort(),products:store.list('product').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),
          assets:store.list('asset').filter(a=>!a.disabled),eligible:eligibleProducts(store,date).map(p=>p.id),
          jobs:store.jobs(),settings:store.settings(),usage:store.usage(),drive:store.get('integration','drive'),driveExport:store.get('drive-export',date),
          imageJobs:store.list('image-job').filter(j=>j.date===date),queueNotice:store.get('notice','queue-error')||store.get('notice','queue-sync'),
          resets:store.list('reset').filter(r=>r.status==='complete').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,1),maintenance,
          setup:{text:Boolean(config.openaiKey),imageGeneration:false,voice:config.voiceProvider==='elevenlabs'?Boolean(config.elevenKey&&config.elevenVoice):Boolean(config.openaiKey),drive:drive.configured(),voiceProvider:config.voiceProvider},notices:store.list('notice')});
      }
      if(p==='/api/settings'&&method==='PUT')return json(res,200,store.setSettings(validateSettings(await body(req))));
      if(p==='/api/plans/batch'&&method==='POST'){
        if(uploads||store.activeJobs().some(j=>j.type==='import'))throw new Error('Дочекайся завершення завантаження товарів');
        return json(res,201,createBatch(store));
      }
      if(p==='/api/content/reset'&&method==='POST'){
        const input=await body(req);if(input.confirm!=='MARYLEE')throw new Error('Підтвердь очищення матеріалів Marylee');
        if(uploads||worker.busy||store.activeJobs().some(j=>j.type!=='queue-sync'))throw new Error('Дочекайся завершення поточних завдань');
        maintenance=true;worker.busy=true;
        try{return json(res,200,await resetContent(store,drive));}finally{maintenance=false;worker.busy=false;}
      }
      if(p==='/api/content/restore'&&method==='POST'){
        const input=await body(req);
        if(uploads||worker.busy||store.activeJobs().some(j=>j.type!=='queue-sync'))throw new Error('Дочекайся завершення поточних завдань');
        maintenance=true;worker.busy=true;try{return json(res,200,await restoreContent(store,input.id));}finally{maintenance=false;worker.busy=false;}
      }
      if(p==='/api/queue/prompt'&&method==='GET'){
        const roots=store.get('integration','drive');if(!roots?.results||!store.settings().queueSheetId)throw new Error('Спочатку підготуй чергу Google Drive');
        return json(res,200,{prompt:hourlyPrompt(store.settings().queueSheetId,roots)});
      }
      if(p==='/api/queue/sync'&&method==='POST')return json(res,202,store.enqueue('queue-sync','drive'));
      if(p==='/api/products'&&method==='POST')return json(res,201,store.put('product',cleanProduct(await body(req))));
      let m;
      if((m=/^\/api\/products\/([a-f0-9-]+)$/.exec(p))&&method==='PUT') {
        const old=store.get('product',m[1]);if(!old)return json(res,404,{error:'Товар не знайдено'});checkProductBusy(old.id);
        const input=await body(req),product=cleanProduct(input,old);
        if(product.assetOrder?.some(id=>store.get('asset',id)?.productId!==product.id))throw new Error('Вибрано фото іншого товару');
        if(product.ready&&!productAssets(store,product,{originalOnly:true}).length)throw new Error('Додай оригінальне фото або відео');
        return json(res,200,store.put('product',product));
      }
      if((m=/^\/api\/products\/([a-f0-9-]+)\/assets$/.exec(p))&&method==='POST') {
        const product=store.get('product',m[1]);if(!product)return json(res,404,{error:'Товар не знайдено'});checkProductBusy(product.id);
        if(uploads>=2)return json(res,429,{error:'Дочекайся завершення попереднього завантаження'});
        if(productAssets(store,product).length>=40)throw new Error('До 40 фото й відео на один товар');
        const name=url.searchParams.get('name')||'',ext=path.extname(name).toLowerCase();
        if(!['.jpg','.jpeg','.png','.webp','.mp4','.mov','.webm'].includes(ext))throw new Error('Підтримуються JPG, PNG, WebP, MP4, MOV і WebM');
        if(Number(req.headers['content-length'])>config.maxUploadBytes)throw new Error('Максимум 200 МБ на файл');
        const temp=path.join(store.dir,'work',randomUUID()+ext);uploads++;
        store.put('product',{...product,ready:false});
        try {
          await boundedDownload(req,temp,config.maxUploadBytes);
          const asset=await saveAsset(store,temp,{name,productId:product.id,source:'original'});
          return json(res,201,asset);
        }finally{uploads--;await rm(temp,{force:true});}
      }
      if(p==='/api/editorial-assets'&&method==='POST') {
        const name=url.searchParams.get('name')||'',ext=path.extname(name).toLowerCase();
        if(!['.jpg','.jpeg','.png','.webp','.mp4','.mov','.webm'].includes(ext))throw new Error('Непідтримуваний файл');
        if(uploads>=2)return json(res,429,{error:'Дочекайся завантаження'});
        const temp=path.join(store.dir,'work',randomUUID()+ext);uploads++;
        try {await boundedDownload(req,temp,config.maxUploadBytes);return json(res,201,await saveAsset(store,temp,{name,source:url.searchParams.get('ai')==='1'?'ai':'editorial'}));}finally{uploads--;await rm(temp,{force:true});}
      }
      if((m=/^\/api\/assets\/([a-f0-9-]+)$/.exec(p))&&method==='PATCH') {
        const asset=store.get('asset',m[1]);if(!asset)return json(res,404,{error:'Файл не знайдено'});
        if(asset.productId)checkProductBusy(asset.productId);
        const input=await body(req);if(typeof input.disabled!=='boolean')throw new Error('Некоректний статус');
        return json(res,200,store.put('asset',{...asset,disabled:input.disabled}));
      }
      if(p==='/api/plans'&&method==='POST') {
        const input=await body(req);requireIdle(input.date);
        const old=store.get('plan',input.date);let plan;
        if(input.replace===true&&old) {
          if(old.items.some(i=>i.status==='posted'))throw new Error('У цьому дні вже є опубліковані матеріали. Зберігаємо його історію; редагуй решту окремо.');
          plan=store.transaction(()=>{
            store.put('archived-plan',{...old,id:old.id+'-'+randomUUID(),originalDate:old.id});
            store.remove('plan',old.id);return createPlan(store,input.date,input.productIds||[]);
          });
        } else plan=createPlan(store,input.date,input.productIds||[]);
        return json(res,201,{plan,job:input.prepare===false?null:store.enqueue('prepare',plan.id)});
      }
      if((m=/^\/api\/plans\/(\d{4}-\d{2}-\d{2})\/prepare$/.exec(p))&&method==='POST') {
        requireIdle(m[1]);
        const plan=store.get('plan',m[1]);if(!plan)throw new Error('Спочатку створи план дня');
        const input=await body(req),mode=input.mode||'render';if(!['render','text','all'].includes(mode))throw new Error('Невідома дія');
        if(input.itemId&&!plan.items.some(i=>i.id===input.itemId))throw new Error('Матеріал не знайдено');
        if(input.itemId&&plan.items.find(i=>i.id===input.itemId).status==='posted')throw new Error('Опублікований матеріал не перегенеровується');
        return json(res,202,store.enqueue('prepare',plan.id,{mode,...(input.itemId?{itemId:input.itemId}:{})}));
      }
      if((m=/^\/api\/plans\/(\d{4}-\d{2}-\d{2})\/items\/([a-z-]+)\/illustration$/.exec(p))&&method==='POST') {
        const date=m[1],id=m[2];requireIdle(date);
        const plan=store.get('plan',date),item=plan?.items.find(i=>i.id===id);
        if(!item||item.purpose!=='useful'||item.productId)throw new Error('Зображення за промптом завантажується в ранкову пораду');
        if(['posted','skipped'].includes(item.status))throw new Error('Цей матеріал не можна змінювати');
        if(!item.imagePrompt?.trim())throw new Error('Спочатку сформуй тексти й промпт дня');
        if(uploads>=2)return json(res,429,{error:'Дочекайся завершення попереднього завантаження'});
        const name=url.searchParams.get('name')||'',ext=path.extname(name).toLowerCase();
        if(!['.jpg','.jpeg','.png','.webp'].includes(ext))throw new Error('Завантаж зображення JPG, PNG або WebP з двома образами');
        const revision=item.revision,temp=path.join(store.dir,'work',randomUUID()+ext);uploads++;
        try {
          await boundedDownload(req,temp,config.maxUploadBytes);
          const asset=await saveAsset(store,temp,{name,source:'ai'});
          if(asset.kind!=='image')throw new Error('Потрібне зображення, а не відео');
          asset.layout='diptych';store.put('asset',asset);
          requireIdle(date);const current=store.get('plan',date),target=current?.items.find(i=>i.id===id);
          if(!target||target.revision!==revision||['posted','skipped'].includes(target.status))throw new Error('Матеріал змінився під час завантаження. Зображення збережено в студії; перевір промпт перед вибором.');
          target.selectedAssetIds=[asset.id];target.illustrationId=asset.id;target.illustrationSignature=illustrationSignature(target);
          target.status='draft';target.revision++;target.outputIds=[];target.coverId=null;target.notes=[];invalidateDependents(current,target);store.put('plan',current);
          return json(res,201,{asset,job:store.enqueue('prepare',date,{mode:'render'})});
        }finally{uploads--;await rm(temp,{force:true});}
      }
      if((m=/^\/api\/plans\/(\d{4}-\d{2}-\d{2})\/items\/([a-z-]+)$/.exec(p))&&method==='PUT') {
        requireIdle(m[1]);const plan=store.get('plan',m[1]),item=plan?.items.find(i=>i.id===m[2]);if(!item)throw new Error('Матеріал не знайдено');
        if(item.status==='posted')throw new Error('Опублікований матеріал збережено в історії й не редагується');
        const input=await body(req);let rerender=false;const previousCaption=item.caption,promptChanged=item.purpose==='useful'&&'imagePrompt' in input&&input.imagePrompt!==item.imagePrompt;
        for(const [key,max] of [['title',140],['caption',3000],['pollQuestion',120],['imagePrompt',2500]])if(key in input){if(typeof input[key]!=='string'||input[key].length>max)throw new Error(`Перевір ${key}`);if((['title','pollQuestion','imagePrompt'].includes(key)||(key==='caption'&&item.kind==='story'))&&input[key]!==item[key])rerender=true;item[key]=input[key];}
        for(const [key,max] of [['lines',6],['selectedAssetIds',6],['keywords',20],['hashtags',5],['pollOptions',2]])if(key in input){if(!Array.isArray(input[key])||input[key].length>max||input[key].some(v=>typeof v!=='string'||v.length>2200))throw new Error(`Перевір ${key}`);if(['lines','selectedAssetIds'].includes(key)&&JSON.stringify(item[key])!==JSON.stringify(input[key]))rerender=true;item[key]=input[key];}
        if(item.selectedAssetIds.some(id=>{const a=store.get('asset',id);return !a||a.disabled||(item.productId?a.productId!==item.productId||a.source!=='original':Boolean(a.productId));}))throw new Error('Медіафайл не належить цьому матеріалу');
        item.hashtags=[...new Set(item.hashtags.map(t=>'#'+t.replace(/^#+/,'').toLowerCase().replace(/[^\p{L}\p{N}_]/gu,'')))].filter(t=>t.length>1);
        if(promptChanged)resetIllustration(item);
        if(rerender){item.status='draft';item.revision++;invalidateDependents(plan,item);}
        if(item.kind!=='story'&&item.caption&&item.caption!==previousCaption)store.put('copy-history',{id:randomUUID(),planId:plan.id,slotId:item.id,caption:item.caption,createdAt:new Date().toISOString()});
        return json(res,200,store.put('plan',plan));
      }
      if((m=/^\/api\/plans\/(\d{4}-\d{2}-\d{2})\/items\/([a-z-]+)\/status$/.exec(p))&&method==='POST') {
        requireIdle(m[1]);const plan=store.get('plan',m[1]),item=plan?.items.find(i=>i.id===m[2]);if(!item)throw new Error('Матеріал не знайдено');
        const input=await body(req);
        if(input.status==='posted'&&item.status==='ready'){item.captionSnapshot=captionFor(item,store);item.status='posted';item.postedAt=new Date().toISOString();}
        else if(input.status==='skipped'&&item.status!=='posted')item.status='skipped';
        else if(input.status==='draft'&&item.status==='skipped')item.status='draft';
        else throw new Error('Спочатку заверши підготовку матеріалу');
        store.put('plan',plan);return json(res,200,{ok:true});
      }
      if((m=/^\/api\/plans\/(\d{4}-\d{2}-\d{2})\/export$/.exec(p))&&method==='GET') {
        requireIdle(m[1]);const file=await exportDay(store,m[1]);return await serveFile(req,res,file,'application/zip',{download:true,name:`marylee-${m[1]}.zip`,cleanup:true});
      }
      if((m=/^\/media\/([a-f0-9-]+)(\/thumbnail)?$/.exec(p))&&['GET','HEAD'].includes(method)) {
        const asset=store.get('asset',m[1]);if(!asset)return json(res,404,{error:'Файл не знайдено'});
        const file=m[2]&&asset.thumbnail?asset.thumbnail:asset.file;
        return await serveFile(req,res,mediaPath(store,file),m[2]&&asset.thumbnail?'image/jpeg':asset.mime,{download:url.searchParams.has('download'),name:asset.name});
      }
      if(p==='/api/image'&&method==='POST')return json(res,410,{error:IMAGE_API_DISABLED});
      if(p==='/api/drive/setup'&&method==='POST')return json(res,202,store.enqueue('drive-setup','drive'));
      if(p==='/api/drive/import'&&method==='POST')return json(res,202,store.enqueue('import','drive'));
      if(p==='/api/drive/export'&&method==='POST'){const input=await body(req);if(!validDate(input.date))throw new Error('Некоректна дата');return json(res,202,store.enqueue('export-drive',input.date));}
      if((m=/^\/api\/jobs\/([a-f0-9-]+)\/retry$/.exec(p))&&method==='POST') {
        const old=store.job(m[1]);if(!old||!['error','interrupted'].includes(old.status))throw new Error('Немає невдалого завдання');
        return json(res,202,store.enqueue(old.type,old.target,old.payload));
      }
      json(res,404,{error:'Не знайдено'});
    }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.destroy();}
  });
  server.requestTimeout=300000;server.headersTimeout=15000;
  if(startWorker)worker.start();
  return {server,store,worker,close:async()=>{worker.stop();await new Promise(resolve=>server.close(resolve));store.close();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const config=configFrom(),app=createApp(config);
    app.server.listen(config.port,config.host,()=>console.log(`Marylee Content listening on ${config.host}:${config.port}`));
    for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.worker.stop();app.server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),8000).unref();});
  }catch(e){console.error(e.message);process.exitCode=1;}
}
