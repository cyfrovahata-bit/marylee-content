import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { configFrom, YOUTUBE_STORIS_FOLDER } from '../src/config.js';
import { createPlan, eligibleProducts } from '../src/planner.js';
import { kyivToday, kyivMinutes, shiftDate, validDate } from '../src/kyiv.js';
import { cleanProduct } from '../src/catalog.js';
import { Drive } from '../src/drive.js';
import { AI, validateCopy, similar, captionFor } from '../src/ai.js';
import { Worker } from '../src/worker.js';
import { createApp, signSession, validSession } from '../src/server.js';
import { numbersToWords } from '../src/num2words-uk.js';

async function fixture(t) {const dir=await mkdtemp(path.join(os.tmpdir(),'marylee-test-'));const store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return store;}
function addProduct(store,name) {const p=store.put('product',cleanProduct({name,ready:true}));store.put('asset',{id:'asset-'+p.id,productId:p.id,source:'original',kind:'image',width:1080,height:1920,createdAt:new Date().toISOString()});return p;}

test('configuration cannot inherit the TikTok channel folder or publish flags',()=>{
  const c=configFrom({SHEET_ID:'old-sheet',PROMPT_FOLDER_ID:'old-folder',ENABLE_IG:'1',ENABLE_FB:'1',AUTO_PUBLISH_HOURS:'10'});
  assert.equal(c.driveParent,'');assert.equal(c.publicUrl,'');assert.equal(c.googleRefresh,'');
  assert.throws(()=>configFrom({MARYLEE_DRIVE_PARENT_ID:'1GiHg-j0ytQyfjLU97i5vkXL6XfjIR9Uk'}),/лише всередині/);
  assert.throws(()=>configFrom({RAILWAY_ENVIRONMENT_ID:'production'}),/Volume/);
  assert.throws(()=>configFrom({RAILWAY_VOLUME_MOUNT_PATH:'/data',MARYLEE_DATA_DIR:'/tmp'}),/всередині/);
  assert.throws(()=>configFrom({NODE_ENV:'production',MARYLEE_ADMIN_PASSWORD:'short'}),/12 символів/);
});
test('Kyiv calendar keeps local midnight and DST transitions',()=>{
  assert.equal(kyivToday(new Date('2026-09-09T21:30:00Z')),'2026-09-10');
  assert.equal(kyivMinutes(new Date('2026-01-01T20:30:00Z')),22*60+30);
  assert.equal(kyivMinutes(new Date('2026-07-01T19:30:00Z')),22*60+30);
  assert.equal(shiftDate('2026-10-25',1),'2026-10-26');assert.equal(validDate('2026-02-31'),false);
});
test('two distinct products, chronological slots, cooldown and single-product fallback',async t=>{
  const s=await fixture(t),A=addProduct(s,'Сукня'),B=addProduct(s,'Жакет');
  const p=createPlan(s,'2026-09-10');assert.equal(p.items.length,8);assert.deepEqual(p.items.map(i=>i.time),['09:00','09:30','12:00','14:00','15:30','18:30','19:30','20:00']);
  assert.notEqual(p.items.find(i=>i.id==='carousel').productId,p.items.find(i=>i.id==='evening').productId);
  assert.equal(createPlan(s,'2026-09-10').createdAt,p.createdAt);assert.equal(eligibleProducts(s,'2026-09-11').length,0);
  assert.equal(eligibleProducts(s,'2026-09-17').length,2);
  assert.throws(()=>createPlan(s,'2026-09-11',[A.id,A.id]),/різних/);
  const single=createPlan(s,'2026-09-11',[B.id]);assert.equal(single.items.find(i=>i.id==='carousel').productId,null);assert.equal(single.items.find(i=>i.id==='evening').productId,B.id);
});
test('job deduplication, ledger limits and persisted interruption recovery',async t=>{
  const s=await fixture(t);const a=s.enqueue('prepare','2026-09-10');assert.equal(s.enqueue('prepare','2026-09-10').id,a.id);
  s.claim();s.recover();assert.equal(s.job(a.id).status,'interrupted');assert.notEqual(s.enqueue('prepare','2026-09-10').id,a.id);
  s.reserve('image',1,.3);s.reserve('image',1,.3);assert.throws(()=>s.reserve('image',1,.3),/добовий/);
  s.setSettings({dailyBudget:.7});assert.throws(()=>s.reserve('text',1,.2),/бюджет/);
  s.put('product',{id:'persist',name:'Не зникне'});s.close();s.db=new Store(s.dir).db;assert.equal(s.get('product','persist').name,'Не зникне');assert.equal(s.usage().counts.image,2);
});
test('Drive rejects an unrelated subtree before any write',async t=>{
  const s=await fixture(t),requests=[];const c=configFrom({MARYLEE_DRIVE_PARENT_ID:YOUTUBE_STORIS_FOLDER});
  const drive=new Drive(c,s,async()=>{throw new Error('No network expected');});
  drive.meta=async id=>({id,parents:id==='outside-child'?['outside-root']:[],mimeType:'application/vnd.google-apps.folder'});
  drive.request=async(url,options)=>{requests.push({url,options});throw new Error('Must not call');};
  await assert.rejects(()=>drive.folder('outside-child','bad','bad'),/поза YouTube Storis/);assert.equal(requests.length,0);
});
test('provider failure reserves once and never silently retries or switches provider',async t=>{
  const s=await fixture(t);let calls=0;const c=configFrom({OPENAI_API_KEY:'test-only',TTS_ENGINE:'openai'});
  const ai=new AI(c,s,async()=>{calls++;return new Response('{}',{status:429});});
  await assert.rejects(()=>ai.voice('Перевіряємо український голос.'),/429/);assert.equal(calls,1);assert.ok(s.usage().counts.voice>0);
  assert.equal(similar('Обирай сукню для свого дня та нового настрою','Обирай сукню для свого дня та нового настрою!'),true);
  assert.equal(similar('Додай оливковий акцент до молочної основи','Спробуй нову довжину верхнього шару'),false);
  assert.match(numbersToWords('Ціна 285 гривень'),/двісті/);
});
test('TTS cache survives repeated calls without paying twice',async t=>{
  const s=await fixture(t);let calls=0;const ai=new AI(configFrom({OPENAI_API_KEY:'test-only'}),s,async()=>{calls++;return new Response(Buffer.alloc(150,1));});
  const first=await ai.voice('Один акцент змінює настрій.');const used=s.usage().reserve;assert.equal(await ai.voice('Один акцент змінює настрій.'),first);assert.equal(calls,1);assert.equal(s.usage().reserve,used);
});
test('generation rejects missing slots and copied captions',()=>{
  assert.throws(()=>validateCopy({items:[]},[{id:'morning'}]),/неповний/);
  const base={slotId:'carousel',title:'Колір',caption:'Одна деталь збирає весь образ у цілісну історію',keywords:[],hashtags:['#стиль','#одяг','#мода','#образ','#marylee'],lines:[],pollQuestion:'',pollOptions:[],imagePrompt:'',assetIds:[]};
  assert.throws(()=>validateCopy({items:[base]},[{id:'carousel',kind:'carousel'}],[base.caption]),/схожий/);
});
test('worker resumes only unfinished items after a render failure',async t=>{
  const s=await fixture(t);addProduct(s,'Сукня');addProduct(s,'Жакет');const plan=createPlan(s,'2026-09-10');
  for(const i of plan.items){i.caption='Підготовлений текст';i.lines=['Сцена один','Сцена два'];}s.put('plan',plan);s.setSettings({autoPrepare:false});
  let fail=true,calls=[];const worker=new Worker(s,{config:{}},{configured:()=>false},{renderer:async(_s,_a,_p,i)=>{calls.push(i.id);if(i.id==='carousel'&&fail){fail=false;throw new Error('Test failure');}i.status='ready';i.outputIds=['file'];}});
  const job=s.enqueue('prepare',plan.id);await worker.tick();assert.equal(s.job(job.id).status,'error');assert.equal(s.get('plan',plan.id).items[0].status,'ready');
  calls=[];s.enqueue('prepare',plan.id);await worker.tick();assert.equal(calls.includes('morning'),false);assert.equal(s.get('plan',plan.id).items.every(i=>i.status==='ready'),true);
});
test('session tampering, unauthenticated APIs, CSRF and video ranges',async t=>{
  const s=await fixture(t),password='local-test-password-only',c=configFrom({MARYLEE_ADMIN_PASSWORD:password});s.setSettings({autoPrepare:false});
  const app=createApp(c,{store:s,startWorker:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
  const root=`http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(root+'/api/state')).status,401);
  assert.equal((await fetch(root+'/api/login',{method:'POST',body:'{}'})).status,403);
  const login=await fetch(root+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Marylee':'1'},body:JSON.stringify({password})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await fetch(root+'/api/state',{headers:{cookie}});assert.equal(response.status,200);assert.equal(JSON.stringify(await response.json()).includes(password),false);
  assert.equal((await fetch(root+'/api/products',{method:'POST',headers:{cookie,'X-Marylee':'1',Origin:'https://other.example'},body:'{}'})).status,403);
  const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';await writeFile(path.join(s.dir,'media',id+'.mp4'),Buffer.from('0123456789'));s.put('asset',{id,file:id+'.mp4',mime:'video/mp4',name:'test.mp4'});
  const range=await fetch(root+'/media/'+id,{headers:{cookie,Range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(await range.text(),'2345');
  assert.equal((await fetch(root+'/media/'+id,{headers:{cookie,Range:'bytes=50-100'}})).status,416);
  const token=signSession(password);assert.equal(validSession(token,password),true);assert.equal(validSession(token+'x',password),false);assert.equal(validSession(token,password,Date.now()+8*86400000),false);
});

test('evening scheduling imports Drive before selecting new products and queues once',async t=>{
  const s=await fixture(t);s.setSettings({autoPrepare:true,prepareTime:'22:30',driveAutoImport:true});
  const worker=new Worker(s,{config:{openaiKey:'test-only'}},{configured:()=>true});
  worker.schedule(new Date('2026-09-09T19:31:00Z'));worker.schedule(new Date('2026-09-09T19:32:00Z'));
  assert.deepEqual(s.activeJobs().map(j=>j.type),['import','prepare']);assert.equal(s.get('plan','2026-09-10'),null);
  assert.equal(s.activeJobs()[1].target,'2026-09-10');
});

test('published captions keep the price that was actually marked as posted',async t=>{
  const s=await fixture(t);const p=addProduct(s,'Жакет');p.price=1000;s.put('product',p);
  const item={productId:p.id,caption:'Обери свій настрій.',kind:'carousel',keywords:[],hashtags:[]};
  const old=captionFor(item,s);assert.match(old,/1000 грн/);item.captionSnapshot=old;item.status='posted';
  p.price=1200;s.put('product',p);assert.equal(captionFor(item,s),old);
});

test('replacing a draft is atomic and cannot erase a day with published posts',async t=>{
  const s=await fixture(t);s.setSettings({autoPrepare:false});const A=addProduct(s,'Сукня'),B=addProduct(s,'Жакет');
  createPlan(s,'2026-09-10',[A.id,B.id]);
  const app=createApp(configFrom({}),{store:s,startWorker:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
  const root=`http://127.0.0.1:${app.server.address().port}`;
  const post=data=>fetch(root+'/api/plans',{method:'POST',headers:{'X-Marylee':'1','Content-Type':'application/json'},body:JSON.stringify({date:'2026-09-10',prepare:false,replace:true,...data})});
  assert.equal((await post({productIds:['missing']})).status,400);assert.deepEqual(s.get('plan','2026-09-10').productIds,[A.id,B.id]);assert.equal(s.list('archived-plan').length,0);
  assert.equal((await post({productIds:[B.id]})).status,201);assert.deepEqual(s.get('plan','2026-09-10').productIds,[B.id]);assert.equal(s.list('archived-plan').length,1);
  const p=s.get('plan','2026-09-10');p.items[0].status='posted';s.put('plan',p);
  assert.equal((await post({productIds:[A.id]})).status,400);assert.deepEqual(s.get('plan','2026-09-10').productIds,[B.id]);
});
