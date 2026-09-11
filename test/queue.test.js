import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, copyFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createBatch } from '../src/planner.js';
import { kyivToday, shiftDate } from '../src/kyiv.js';
import { cleanProduct } from '../src/catalog.js';
import { ContentQueue, QUEUE_HEADER } from '../src/queue.js';
import { readBundle } from '../src/bundle.js';
import { resetContent, restoreContent } from '../src/reset.js';
import { resetIllustration } from '../src/editorial.js';
import { applyCopy } from '../src/worker.js';
import { saveAsset, run, mediaPath, probe } from '../src/files.js';
import { renderItem } from '../src/montage.js';
async function fixture(t,n=5){
  const dir=await mkdtemp(path.join(os.tmpdir(),'marylee-queue-')),s=new Store(dir);
  t.after(async()=>{s.close();await rm(dir,{recursive:true,force:true});});s.setSettings({autoPrepare:false,driveQueueMonitor:false,queueSheetId:'queue-sheet'});
  for(let i=0;i<n;i++){const p=s.put('product',cleanProduct({name:'Товар '+i,ready:true}));s.put('asset',{id:'a-'+p.id,productId:p.id,source:'original',kind:'image'});}
  return s;
}
function fakeDrive(s){
  const roots={id:'drive',root:'marylee-root',input:'marylee-input',output:'marylee-output',briefs:'marylee-briefs',results:'marylee-results',prompts:'marylee-prompts',templateVersion:1,queueSheetId:'queue-sheet',templates:{'reel-tip':{id:'tip-template'},poll:{id:'poll-template'}}};s.put('integration',roots);
  const rows=[],uploads=[];
  return {rows,uploads,configured:()=>true,queueFolders:async()=>roots,
    sheet:async(range,values)=>{if(!values)return {values:[QUEUE_HEADER,...rows.map(r=>r||[])]};const n=Number(range.match(/A(\d+)/)[1])-11;rows[n]=values[0];return {};},
    upload:async(parent,name,file)=>{uploads.push({parent,name,body:await readFile(file,'utf8')});return {id:'file-'+uploads.length};},
    scoped:async id=>({id,name:'result.zip',parents:[roots.results]}),download:async(_m,target)=>copyFile(s.bundlePath,target),trashChildren:async()=>0};
}
test('five products fill 2+2+1 tomorrow onward without duplicated reservations',async t=>{
  const s=await fixture(t),batch=createBatch(s),plans=s.list('plan').sort((a,b)=>a.id.localeCompare(b.id));
  assert.equal(batch.products,5);assert.deepEqual(plans.map(p=>p.productIds.length),[2,2,1]);assert.equal(batch.dates[0],shiftDate(kyivToday(),1));
  assert.equal(plans[2].items.find(i=>i.id==='carousel').productId,plans[2].items.find(i=>i.id==='evening').productId);
  assert.deepEqual(createBatch(s).dates,[]);assert.equal(s.activeJobs().length,3);
});
test('queue export is idempotent; stale generations cancel and leases require manual retry',async t=>{
  const s=await fixture(t,2);createBatch(s);const p=s.list('plan')[0],d=fakeDrive(s),q=new ContentQueue(s,d);
  await q.ensure(p);await q.ensure(p);assert.equal(d.rows.length,2);assert.equal(d.uploads.length,2);
  assert.equal(JSON.parse(d.uploads[0].body).result_folder_id,'marylee-results');
  d.rows[0][1]='WORKING';d.rows[0][9]='2020-01-01T00:00:00Z';await q.sync();assert.equal(d.rows[0][1],'ERROR');
  const old=p.items[0].externalJobId;resetIllustration(p.items[0]);p.items[0].imageGeneration=2;s.put('plan',p);await q.ensure(p);await q.sync();
  assert.equal(s.get('image-job',old).status,'CANCELLED');assert.equal(d.rows.length,3);assert.equal(d.rows[2][10],2);
});
test('content reset is isolated and recoverable, preserving integration and the usage ledger',async t=>{
  const s=await fixture(t,2);createBatch(s);s.reserve('text',1,.1);s.put('integration',{id:'drive',root:'kept'});await writeFile(path.join(s.dir,'media','original.txt'),'original');
  const reset=await resetContent(s,{configured:()=>false});assert.equal(s.list('product').length,0);assert.equal(s.list('plan').length,0);assert.equal(s.list('asset').length,0);assert.equal(s.jobs().length,0);assert.equal(s.get('integration','drive').root,'kept');assert.equal(s.usage().counts.text,1);
  await restoreContent(s,reset.id);assert.equal(s.list('product').length,2);assert.equal(await readFile(path.join(s.dir,'media','original.txt'),'utf8'),'original');assert.equal(s.usage().reserve,.1);
});
test('validated ZIP imports four scenes once, preserves checked script through API copy and renders voiced Reel', {timeout:120000},async t=>{
  const s=await fixture(t,2);createBatch(s);s.db.exec('DELETE FROM jobs');const plan=s.list('plan')[0],d=fakeDrive(s),q=new ContentQueue(s,d);await q.ensure(plan);
  const job=s.list('image-job').find(j=>j.kind==='reel-tip'),bundleDir=path.join(s.dir,'bundle');await mkdir(bundleDir);
  const names=['scene-1.png','scene-2.png','scene-3.png','scene-4.png'];
  for(const [n,name] of names.entries())await run('ffmpeg',['-y','-f','lavfi','-i',`color=c=${['red','green','blue','yellow'][n]}:s=1024x1536`,'-frames:v','1','-threads','1',path.join(bundleDir,name)]);
  const m={version:1,job_id:job.id,generation:job.generation,date:job.date,kind:job.kind,title:'Порівняй два образи',lines:['Спробуй один акцент.','Поглянь на лівий образ.','Тепер порівняй правий.','Обери варіант за настроєм.'],images:names,fact_check:{status:'checked',type:'editorial',note:'Візуальне порівняння без об’єктивних обіцянок',sources:[]}};
  await writeFile(path.join(bundleDir,'manifest.json'),JSON.stringify(m));s.bundlePath=path.join(s.dir,'test.zip');await run('zip',['-q',s.bundlePath,'manifest.json',...names],{cwd:bundleDir});
  const bytes=await readFile(s.bundlePath);assert.equal(readBundle(bytes,job).images.length,4);assert.throws(()=>readBundle(bytes,{...job,generation:999}),/застарілому/);
  // A malicious filename must fail before extraction or media probing.
  const malicious=Buffer.from(bytes);let pos=0;while((pos=malicious.indexOf(Buffer.from('scene-1.png'),pos))>=0){malicious.write('../evil.png',pos);pos+=11;}assert.throws(()=>readBundle(malicious,job),/Некоректний ZIP/);
  const row=d.rows.find(r=>r[0]===job.id);row[1]='READY';row[6]='result-file';
  const sheet=d.sheet;let failAck=true;d.sheet=async(range,values)=>{if(values?.[0]?.[1]==='IMPORTED'&&failAck){failAck=false;throw new Error('Sheets acknowledgement interrupted');}return sheet(range,values);};
  await assert.rejects(()=>q.sync(),/acknowledgement/);assert.equal(s.get('image-job',job.id).status,'IMPORTED');const assetCount=s.list('asset').length;await q.sync();assert.equal(s.list('asset').length,assetCount);
  const current=s.get('plan',plan.id),item=current.items[0];assert.equal(item.selectedAssetIds.length,4);assert.equal(current.items.find(i=>i.id==='poll').selectedAssetIds.length,0,'poll waits for its own image');
  applyCopy(current,[{slotId:'morning',title:'API should not replace checked title',caption:'Порівняй варіанти й обери свій.',keywords:[],hashtags:[],lines:['UNVERIFIED'],pollQuestion:'',pollOptions:[],imagePrompt:'',assetIds:[]}],s);
  assert.deepEqual(item.lines,m.lines);assert.equal(item.title,m.title);assert.equal(item.selectedAssetIds.length,4);
  const voice=path.join(s.dir,'test.mp3');await run('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=220:duration=0.3','-c:a','libmp3lame',voice]);let calls=0;
  await renderItem(s,{voice:async text=>{assert.ok(m.lines.includes(text));calls++;return voice;}},current,item);assert.equal(item.status,'ready');assert.equal(calls,4);
  const info=await probe(mediaPath(s,s.get('asset',item.outputIds[0]).file));assert.equal(info.streams.find(x=>x.codec_type==='video').width,1080);assert.equal(info.streams.find(x=>x.codec_type==='video').height,1920);
  const poll=current.items.find(i=>i.id==='poll');await renderItem(s,{},current,poll);assert.equal(poll.status,'awaiting-image');
  s.put('plan',current);s.db.exec('DELETE FROM jobs');
  const pollJob=s.list('image-job').find(j=>j.kind==='poll');
  const pollManifest={...m,job_id:pollJob.id,kind:'poll',generation:pollJob.generation,poll_question:'Який образ обереш?',poll_options:['Лівий','Правий'],images:['poll.png']};
  await writeFile(path.join(bundleDir,'manifest.json'),JSON.stringify(pollManifest));await copyFile(path.join(bundleDir,'scene-1.png'),path.join(bundleDir,'poll.png'));s.bundlePath=path.join(s.dir,'poll.zip');await run('zip',['-q',s.bundlePath,'manifest.json','poll.png'],{cwd:bundleDir});
  const pollRow=d.rows.find(r=>r[0]===pollJob.id);pollRow[1]='READY';pollRow[6]='poll-file';await q.sync();
  const importedPlan=s.get('plan',plan.id),importedPoll=importedPlan.items.find(i=>i.id==='poll');
  assert.equal(importedPoll.selectedAssetIds.length,1);assert.equal(importedPoll.pollQuestion,pollManifest.poll_question);
  await renderItem(s,{voice:()=>{throw new Error('Poll must not request voice');}},importedPlan,importedPoll);assert.equal(importedPoll.status,'ready');
});
