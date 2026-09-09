import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { cleanProduct } from '../src/catalog.js';
import { createPlan } from '../src/planner.js';
import { saveAsset, run, probe, mediaPath } from '../src/files.js';
import { Worker } from '../src/worker.js';
import { exportDay } from '../src/export.js';
import { renderReel } from '../src/montage.js';

test('full day renders real MP4/JPEG/SRT/ZIP, preserves portrait dimensions and republish references', {timeout:180000},async t=>{
  const preview=process.env.MARYLEE_TEST_PREVIEW_DIR;
  const dir=preview||await mkdtemp(path.join(os.tmpdir(),'marylee-render-'));await mkdir(dir,{recursive:true});
  const s=new Store(dir);t.after(async()=>{s.close();if(!preview)await rm(dir,{recursive:true,force:true});});
  s.setSettings({autoPrepare:false,voiceEnabled:true});
  const A=s.put('product',cleanProduct({name:'Тестова сукня · приклад',sku:'DEMO-A',price:1290,sizes:'S, M, L',ready:true}));
  const B=s.put('product',cleanProduct({name:'Тестовий жакет · приклад',sku:'DEMO-B',price:1590,sizes:'S, M',ready:true}));
  const input=path.join(dir,'work','source.png'),clip=path.join(dir,'work','motion.mp4'),voice=path.join(dir,'work','test-voice.mp3');
  await run('ffmpeg',['-y','-f','lavfi','-i','color=c=0xd5c3ad:s=640x900','-frames:v','1','-threads','1',input]);
  await run('ffmpeg',['-y','-f','lavfi','-i','testsrc2=s=360x640:r=25:d=1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',clip]);
  await run('ffmpeg',['-y','-f','lavfi','-i','sine=frequency=220:duration=0.6','-c:a','libmp3lame',voice]);
  await saveAsset(s,input,{name:'photo.png',productId:A.id});await saveAsset(s,clip,{name:'video.mp4',productId:B.id});
  const plan=createPlan(s,'2026-09-10',[A.id,B.id]);
  const titles=['Один акцент — інший настрій','Збережи кольорову підказку','Яка палітра ближча?','Знайомство з сукнею','Розглянь деталь','Вечірня примірка ідей','Жакет у русі','Поділись вечірнім образом'];
  for(const [n,i] of plan.items.entries()) {i.title=titles[n];i.caption='Тестовий матеріал для перевірки застосунку. Не є товарною публікацією.';i.lines=['Спокійна основа.','Додай кольоровий акцент.'];i.hashtags=i.kind==='story'?[]:['#стиль','#marylee','#образ','#одяг','#україна'];i.pollQuestion='Яка палітра ближча?';i.pollOptions=['Спокійна','Контрастна'];}
  s.put('plan',plan);const ai={config:{},voice:async()=>voice};const worker=new Worker(s,ai,{configured:()=>false});
  const job=s.enqueue('prepare',plan.id);await worker.tick();
  assert.equal(s.job(job.id).status,'done',s.job(job.id).message);
  const ready=s.get('plan',plan.id);assert.ok(ready.items.every(i=>i.status==='ready'));
  for(const id of ['morning','evening']) {
    const reel=ready.items.find(i=>i.id===id),media=s.get('asset',reel.outputIds[0]);const info=await probe(mediaPath(s,media.file));
    const v=info.streams.find(x=>x.codec_type==='video'),audio=info.streams.find(x=>x.codec_type==='audio');assert.equal(v.width,1080);assert.equal(v.height,1920);assert.equal(v.pix_fmt,'yuv420p');assert.equal(audio.codec_name,'aac');assert.equal(Number(audio.sample_rate),48000);assert.equal(audio.channels,2);assert.ok(Number(info.format.duration)>=1.8);
  }
  assert.deepEqual(ready.items.find(i=>i.id==='share-evening').outputIds,ready.items.find(i=>i.id==='evening').outputIds);
  const zip=await exportDay(s,plan.id);const listing=(await run('unzip',['-Z1',zip])).stdout;assert.match(listing,/09-00-morning\/1.mp4|09-00-morning\/01.mp4/);assert.match(listing,/12-00-poll\/instructions.txt/);assert.match(listing,/START-HERE.txt/);
  const jpg=s.get('asset',ready.items.find(i=>i.id==='carousel').outputIds[0]);const imageInfo=await probe(mediaPath(s,jpg.file));assert.equal(imageInfo.streams[0].width,1080);assert.equal(imageInfo.streams[0].height,1350);
  const productPhoto=s.list('asset').find(a=>a.productId===A.id);
  const photoReel={...ready.items.find(i=>i.id==='evening'),productId:A.id,selectedAssetIds:[productPhoto.id],notes:[]};
  const work=path.join(dir,'work','photo-reel');await mkdir(work,{recursive:true});
  await renderReel(s,ai,ready,photoReel,work);assert.match(photoReel.notes.join(' '),/Не розраховуй на монетизацію/);
  const editorialInput=path.join(dir,'work','editorial.png');await copyFile(mediaPath(s,productPhoto.file),editorialInput);
  const editorial=await saveAsset(s,editorialInput,{name:'editorial.png',source:'ai'});
  const educational={...ready.items.find(i=>i.id==='morning'),selectedAssetIds:[editorial.id],notes:[]};
  await renderReel(s,ai,ready,educational,work);assert.equal(educational.kind,'carousel');assert.ok(educational.outputIds.length>0);
  if(preview)console.log('Preview data:',dir);
});
