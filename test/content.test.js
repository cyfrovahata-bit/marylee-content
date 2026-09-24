import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { configFrom } from '../src/config.js';
import { AI, captionFor, copySchema, speechText, validateCopy } from '../src/ai.js';
import { publicProduct, captionLimit, slotBrief, usesVoice } from '../src/content.js';
import { createPlan } from '../src/planner.js';
import { createApp } from '../src/server.js';
import { Worker } from '../src/worker.js';
import { cleanProduct } from '../src/catalog.js';

async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'marylee-content-')),store=new Store(dir);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  store.setSettings({autoPrepare:false});return store;
}
test('public copy excludes wholesale data and sales briefs never inherit the morning topic',()=>{
  const safe=publicProduct({id:'p',name:'Лляний костюм',price:1170,description:'Тканина: льон\nЦіна 1170 грн\nДроп ціна 935 грн\nhttps://supplier.example\nКишені на шортах',notes:'Private operational note'});
  assert.doesNotMatch(JSON.stringify(safe),/935|1170|supplier|Private/);assert.match(safe.description,/льон/);assert.match(safe.description,/Кишені/);
  const plan={topic:{id:'color-accent',title:'COLOR_ACCENT_TOPIC'}};
  for(const purpose of ['sale','product','detail','teaser'])assert.doesNotMatch(JSON.stringify(slotBrief({purpose},plan)),/COLOR_ACCENT_TOPIC/);
  assert.match(JSON.stringify(slotBrief({purpose:'useful'},plan)),/COLOR_ACCENT_TOPIC/);
});
test('the complete Reel description including sales facts fits before keywords and hashtags',async t=>{
  const s=await fixture(t),p=s.put('product',{id:'p',name:'Брючний костюм',price:1350,sku:'468',sizes:'42–44, 46–48, 48–50'});
  const item={kind:'reel',purpose:'sale',productId:p.id,keywords:['льон'],hashtags:['#стиль']};
  item.caption='а'.repeat(captionLimit(item,p));
  const main=captionFor(item,s).split('\n\nльон')[0];assert.equal(main.length,250);assert.match(main,/1350 грн/);
  const schema=copySchema([{...item,id:'evening'}],s).properties.items.properties.evening.properties;
  assert.equal(schema.caption.maxLength,captionLimit(item,p));assert.equal(schema.lines.items.maxLength,40);
  assert.equal(copySchema([{id:'detail',kind:'story',purpose:'detail'}]).properties.items.properties.detail.properties.caption.maxLength,90);
});
test('sales stay silent for every global voice setting; the new stylist voice ignores legacy channel settings',async t=>{
  for(const voiceEnabled of [true,false]) {
    assert.equal(usesVoice({kind:'reel',productId:'p'},{voiceEnabled}),false);
    assert.equal(usesVoice({kind:'reel',purpose:'sale'},{voiceEnabled}),false);
  }
  assert.equal(usesVoice({kind:'reel',purpose:'useful'},{voiceEnabled:true}),true);
  const s=await fixture(t),config=configFrom({OPENAI_API_KEY:'test',TTS_ENGINE:'elevenlabs',TTS_OPENAI_VOICE:'coral'});
  const ai=new AI(config,s,async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/audio/speech');const body=JSON.parse(options.body);
    assert.equal(body.voice,'marin');assert.match(body.instructions,/natural.*Ukrainian.*real woman.*friend/);assert.match(body.instructions,/Avoid presenter, announcer and advertising cadence/);assert.equal(body.speed,0.98);
    return new Response(Buffer.alloc(150,1));
  });await ai.voice('Порівняй ці образи.');
});
test('ElevenLabs becomes the Marylee voice when its key is configured',async t=>{
  const s=await fixture(t),config=configFrom({ELEVENLABS_API_KEY:'test',TTS_ELEVEN_VOICE_ID:'2OXYbN1uGomXXJtv9Dq6'});
  assert.equal(config.voiceProvider,'elevenlabs');
  const ai=new AI(config,s,async(url,options)=>{
    assert.match(url,/\/v1\/text-to-speech\/2OXYbN1uGomXXJtv9Dq6/);assert.equal(options.headers['xi-api-key'],'test');
    const body=JSON.parse(options.body);assert.equal(body.model_id,'eleven_multilingual_v2');assert.equal(body.language_code,'uk');assert.equal(body.text,'Ця спідни́ця пасує до спідни́ці.');
    assert.deepEqual(body.voice_settings,{stability:.45,similarity_boost:.75,style:.12,use_speaker_boost:true,speed:.98});
    return new Response(Buffer.alloc(150,1));
  });await ai.voice('Ця спідниця пасує до спідниці.');
});
test('speech pronunciation hints never alter the visible copy',()=>{
  const visible='Спідниця, спідницю та спідницею';
  assert.equal(speechText(visible),'Спідни́ця, спідни́цю та спідни́цею');assert.equal(visible,'Спідниця, спідницю та спідницею');
});
test('quality validation rejects overly long stories and Russian keywords',()=>{
  const value={slotId:'poll',title:'Обери образ',caption:'а'.repeat(91),keywords:[],hashtags:[],lines:[],pollQuestion:'Що обереш?',pollOptions:['Лівий образ','Правий образ'],imagePrompt:'',assetIds:[],detailFocus:'full'};
  const slots=[{id:'poll',kind:'story',purpose:'poll'}];
  assert.throws(()=>validateCopy({items:[value]},slots),/довжину caption/);
  value.caption='Який образ тобі ближчий?';value.keywords=['лето'];assert.throws(()=>validateCopy({items:[value]},slots),/мовну помилку/);
});
test('full regeneration replaces one unpublished item; posted items and originals survive',async t=>{
  const s=await fixture(t);
  for(const name of ['Костюм','Сукня']) {const p=s.put('product',cleanProduct({name,ready:true}));s.put('asset',{id:'source-'+p.id,productId:p.id,source:'original',kind:'video'});}
  const plan=createPlan(s,'2026-09-10');
  for(const i of plan.items){i.title='Стара назва';i.caption='Збережений підпис';i.status='ready';i.outputIds=['old-'+i.id];i.coverId='cover-old';}
  plan.items[0].status='posted';plan.items[0].captionSnapshot='Опублікований текст';s.put('plan',plan);
  const originals=s.list('asset'),unrelated=structuredClone(plan.items.filter(i=>i.id!=='evening'));
  const requested=[];const ai={config:{},copy:async(_p,items)=>{requested.push(items.map(i=>i.id));return items.map(i=>({slotId:i.id,title:'Новий огляд сукні',caption:'Розглянь інший ракурс.',keywords:[],hashtags:[],lines:['Сукня','Деталь','Поєднання','Замовлення'],pollQuestion:'',pollOptions:[],imagePrompt:'',assetIds:[],detailFocus:'full'}));}};
  const worker=new Worker(s,ai,{configured:()=>false},{renderer:async(_s,_a,_p,i)=>{i.outputIds=['new-video'];i.coverId='new-cover';i.status='ready';}});
  const app=createApp(configFrom({}),{store:s,startWorker:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
  const endpoint=`http://127.0.0.1:${app.server.address().port}/api/plans/${plan.id}/prepare`;
  const request=itemId=>fetch(endpoint,{method:'POST',headers:{'X-Marylee':'1','Content-Type':'application/json'},body:JSON.stringify({itemId,mode:'all'})});
  assert.equal((await request('morning')).status,400);assert.equal(s.activeJobs().length,0);
  assert.equal((await request('evening')).status,202);assert.equal((await request('evening')).status,400);await worker.tick();
  const saved=s.get('plan',plan.id);assert.deepEqual(requested,[['evening']]);
  assert.equal(saved.items.find(i=>i.id==='evening').title,'Новий огляд сукні');assert.equal(saved.items.find(i=>i.id==='evening').coverId,'new-cover');
  assert.equal(saved.items.some(i=>i.kind==='story'),false);
  assert.deepEqual(saved.items.filter(i=>i.id!=='evening'),unrelated);assert.deepEqual(s.list('asset'),originals);
});

test('direct image generation is disabled before network or budget use',async t=>{
  const s=await fixture(t);let calls=0;
  const ai=new AI(configFrom({OPENAI_API_KEY:'test'}),s,async()=>{calls++;throw new Error('Unexpected image API request');});
  await assert.rejects(ai.image('A fashion comparison'),/Малювання через API вимкнено/);
  assert.equal(calls,0);assert.equal(s.usage().counts.image||0,0);
});
