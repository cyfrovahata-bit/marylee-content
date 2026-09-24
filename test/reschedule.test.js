import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { configFrom } from '../src/config.js';
import { cleanProduct } from '../src/catalog.js';
import { createPlan } from '../src/planner.js';
import { kyivToday, shiftDate } from '../src/kyiv.js';
import { reschedulePlans } from '../src/reschedule.js';
import { ContentQueue, QUEUE_HEADER } from '../src/queue.js';
import { createApp } from '../src/server.js';

async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'marylee-move-')),s=new Store(dir);
  t.after(async()=>{s.close();await rm(dir,{recursive:true,force:true});});
  s.setSettings({autoPrepare:false,driveQueueMonitor:false,queueSheetId:'queue-sheet'});
  const today=kyivToday(),dates=[shiftDate(today,-1),today],startDate=shiftDate(today,1);
  for(const [n,date] of dates.entries()) {
    const p=s.put('product',cleanProduct({name:'Товар '+n,sku:'sku-'+n,ready:true}));
    s.put('asset',{id:'original-'+n,productId:p.id,source:'original',kind:'image'});
    const plan=createPlan(s,date,[p.id]);
    Object.assign(plan.items.find(i=>i.id==='carousel'),{status:'ready',caption:'Готовий опис',outputIds:['finished-'+n],revision:2});
    s.put('plan',plan);
  }
  return {s,dates,startDate,input:{dates,startDate,requestId:'move-test-001'}};
}
function drive(s) {
  const roots={id:'drive',results:'results',briefs:'briefs',templateVersion:2,queueSheetId:'queue-sheet',templates:{'reel-tip':{id:'tip-template'},poll:{id:'poll-template'}}};
  s.put('integration',roots);const rows=[],uploads=[];
  return {rows,uploads,configured:()=>true,
    sheet:async(range,values)=>{if(!values)return {values:[QUEUE_HEADER,...rows]};rows[Number(range.match(/A(\d+)/)[1])-11]=values[0];return {};},
    upload:async(parent,name,file)=>{uploads.push(JSON.parse(await readFile(file,'utf8')));return {id:'brief-'+uploads.length};}};
}
test('move preserves paid outputs, inventory, queue identities, retry targets and a recoverable snapshot',async t=>{
  const {s,dates,startDate,input}=await fixture(t),before=s.list('plan');
  s.reserve('text',1,.1);const usage=s.usage(),settings=s.settings(),products=s.list('product');
  await writeFile(path.join(s.dir,'media','proof.txt'),'existing media');
  s.put('image-job',{id:'pending',date:dates[0],itemId:'morning',status:'NEW',generation:1,briefFileId:'original-brief'});
  s.put('copy-history',{id:'copy',planId:dates[0],caption:'Keep this copy'});
  const retry=s.enqueue('prepare',dates[0],{copiedRevisions:{carousel:2}});s.updateJob(retry,{status:'error',result:{date:dates[0]}});
  const moved=reschedulePlans(s,input);
  assert.deepEqual(moved.moves,[{from:dates[0],to:startDate},{from:dates[1],to:shiftDate(startDate,1)}]);
  for(const [n,p] of before.entries())assert.deepEqual(s.get('plan',shiftDate(startDate,n)).items,p.items);
  assert.equal(s.get('plan',dates[0]),null);assert.equal(s.get('plan',dates[1]),null);
  assert.deepEqual(s.usage(),usage);assert.deepEqual(s.settings(),settings);assert.deepEqual(s.list('product'),products);
  assert.equal(await readFile(path.join(s.dir,'media','proof.txt'),'utf8'),'existing media');
  assert.equal(s.get('image-job','pending').date,dates[0]);assert.equal(s.get('image-job','pending').planDate,startDate);
  assert.equal(s.get('image-job','pending').briefFileId,'original-brief');assert.equal(s.get('copy-history','copy').planId,startDate);
  assert.equal(s.job(retry.id).target,startDate);assert.equal(s.db.prepare('SELECT target FROM jobs WHERE id=?').get(retry.id).target,startDate);
  assert.equal(s.get('archived-plan','reschedule-'+input.requestId).plans[0].id,dates[0]);
  assert.deepEqual(reschedulePlans(s,input),moved);assert.equal(s.list('plan').length,2);
  assert.throws(()=>reschedulePlans(s,{...input,startDate:shiftDate(startDate,1)}),/іншого перенесення/);
});
test('occupied targets, published posts and active workers reject the whole move',async t=>{
  const {s,dates,startDate,input}=await fixture(t),before=s.list('plan');
  s.put('plan',{...before[0],id:startDate});assert.throws(()=>reschedulePlans(s,input),/зайнята/);s.remove('plan',startDate);
  const published=structuredClone(before[1]);published.items[0].status='posted';s.put('plan',published);
  assert.throws(()=>reschedulePlans(s,input),/опубліковані/);assert.equal(s.get('plan',dates[0]).id,dates[0]);
  s.put('plan',before[1]);const job=s.enqueue('queue-sync','drive');assert.throws(()=>reschedulePlans(s,input),/поточних завдань/);s.updateJob(job,{status:'done'});
  assert.deepEqual(s.list('plan'),before);assert.equal(s.list('archived-plan').length,0);
});
test('overlapping source/target dates move atomically and retain day spacing',async t=>{
  const {s,dates,input}=await fixture(t),first=s.get('plan',dates[0]),second=s.get('plan',dates[1]);
  s.remove('plan',first.id);s.remove('plan',second.id);
  const start=input.startDate;s.put('plan',{...first,id:start});s.put('plan',{...second,id:shiftDate(start,1)});
  reschedulePlans(s,{...input,dates:[start,shiftDate(start,1)],startDate:shiftDate(start,1)});
  assert.equal(s.get('plan',start),null);assert.deepEqual(s.get('plan',shiftDate(start,1)).productIds,first.productIds);
  assert.deepEqual(s.get('plan',shiftDate(start,2)).productIds,second.productIds);
});
test('existing GPT rows and briefs remain valid and sync routes results to the moved plan',async t=>{
  const {s,dates,startDate,input}=await fixture(t),d=drive(s),q=new ContentQueue(s,d);
  await q.ensure(s.get('plan',dates[0]));const original=structuredClone(d.rows),uploadCount=d.uploads.length;
  reschedulePlans(s,input);await q.ensure(s.get('plan',startDate));assert.equal(d.uploads.length,uploadCount);assert.deepEqual(d.rows,original);
  const pending=s.list('image-job')[0],row=d.rows.find(r=>r[0]===pending.id);row[1]='READY';row[6]='result-zip';
  let calls=0;q.importResult=async(job,fileId)=>{
    assert.equal(job.date,dates[0]);assert.equal(job.planDate,startDate);assert.equal(fileId,'result-zip');
    const item=s.get('plan',job.planDate).items.find(i=>i.id===job.itemId);assert.equal(item.externalJobId,job.id);
    s.put('image-job',{...job,status:'IMPORTED'});calls++;
  };
  const busy=s.enqueue('prepare',startDate);await q.sync();assert.equal(calls,0);s.updateJob(busy,{status:'done'});
  await q.sync();assert.equal(calls,1);assert.equal(row[2],dates[0]);assert.equal(s.get('image-job',pending.id).status,'IMPORTED');
  await q.sync();assert.equal(calls,1);
});
test('a not-yet-exported GPT job survives rescheduling and exports once',async t=>{
  const {s,dates,startDate,input}=await fixture(t),d=drive(s),q=new ContentQueue(s,d);
  d.configured=()=>false;await assert.rejects(()=>q.ensure(s.get('plan',dates[0])),/підключи/);
  reschedulePlans(s,input);d.configured=()=>true;await q.exportPending();
  assert.equal(d.uploads.length,1);assert.ok(d.uploads.every(b=>b.date===dates[0]));
  assert.ok(s.list('image-job').every(j=>j.planDate===startDate&&j.status==='NEW'));
  await q.exportPending();assert.equal(d.uploads.length,1);
});
test('HTTP move and state expose the new dates without preparing or generating anything',async t=>{
  const {s,dates,startDate,input}=await fixture(t),d=drive(s),q=new ContentQueue(s,d);await q.ensure(s.get('plan',dates[0]));
  const app=createApp(configFrom({}),{store:s,startWorker:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  try {
    const root='http://127.0.0.1:'+app.server.address().port;
    const denied=await fetch(root+'/api/plans/reschedule',{method:'POST',body:JSON.stringify(input)});assert.equal(denied.status,403);
    const response=await fetch(root+'/api/plans/reschedule',{method:'POST',headers:{'X-Marylee':'1','Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);
    const state=await (await fetch(root+'/api/state?date='+startDate)).json();
    assert.deepEqual(state.dates,[startDate,shiftDate(startDate,1)]);assert.equal(state.plan.id,startDate);assert.equal(state.imageJobs.length,1);assert.equal(state.jobs.length,0);
    const old=await (await fetch(root+'/api/state?date='+dates[0])).json();assert.equal(old.plan,null);assert.equal(old.imageJobs.length,0);
  }finally{await new Promise(r=>app.server.close(r));}
});
