import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { configFrom } from '../src/config.js';
import { cleanProduct } from '../src/catalog.js';
import { createPlan } from '../src/planner.js';
import { AI } from '../src/ai.js';
import { Worker } from '../src/worker.js';

async function fixture(t,optional=false) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'marylee-copy-')),store=new Store(dir);
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  store.setSettings({autoPrepare:false,includeOptionalStory:optional});
  for(const name of ['Лляний комплект із шортами','Літній брючний костюм']) {
    const p=store.put('product',cleanProduct({name,ready:true}));
    store.put('asset',{id:'asset-'+p.id,productId:p.id,source:'original',kind:'video',name:'product.mp4',width:1080,height:1920});
  }
  return {store,plan:createPlan(store,'2026-09-10'),config:configFrom({OPENAI_API_KEY:'test-only'})};
}
const captions={
  morning:'Спокійна основа об’єднує палітру. Додай виразний аксесуар і порівняй враження.',
  'share-morning':'Ранкова підказка вже у стрічці — подивись приклад поєднання кольорів.',
  poll:'Який настрій обереш для наступного образу?',
  carousel:'Лляний комплект із жилетом та шортами запрошує до літніх прогулянок. Розглянь посадку на фото й напиши, який колір тобі ближчий.',
  detail:'Придивись до деталей жилета на наступному фото.',
  teaser:'Увечері покажемо брючний костюм у русі.',
  evening:'Вільний силует брюк і легкий верх залишають простір для власних поєднань. Напиши нам, щоб уточнити наявність.',
  'share-evening':'Вечірній огляд готовий — відкрий відео та розглянь комплект.',
  extra:'Збережи ідею для наступної прогулянки.',
};
function responseFor(plan) {
  return {items:Object.fromEntries([...plan.items].reverse().map(i=>[i.id,{
    slotId:i.id,title:i.label,caption:captions[i.id],
    keywords:i.kind==='reel'?['стиль','образ','одяг','палітра','колір','акцент','поєднання','гардероб','мода','прогулянка','літо','аксесуари','силует','натхнення','вибір']:[],
    hashtags:i.kind==='story'?[]:['#стиль','#образ','#marylee','#одяг','#палітра'],
    lines:i.kind==='reel'?(i.purpose==='sale'?['Лляний брючний костюм','Придивись до жилета','Носи комплектом або окремо','Напиши нам для замовлення']:[
      'Почни зі спокійної основи, яку вже любиш носити на щоденні прогулянки містом.',
      'Тепер додай невелику виразну деталь і подивись, як змінився настрій усього комплекту.',
      'Спробуй повторити цей колір в іншому аксесуарі та порівняй обидва варіанти перед дзеркалом.',
      'Обери поєднання за власним настроєм, адже це лише привід поекспериментувати зі своїм гардеробом.',
    ]):[],pollQuestion:i.purpose==='poll'?'Який акцент ближчий?':'',
    pollOptions:i.purpose==='poll'?['Спокійний','Контрастний']:[],
    imagePrompt:'',detailFocus:'full',assetIds:i.productId?['asset-'+i.productId]:[],
  }]))};
}
function completion(data,overrides={}) {
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)},...overrides}]});
}

test('a two-product day requests and saves every slot, including both repost stories, in schedule order',async t=>{
  const {store,plan,config}=await fixture(t);let calls=0;const rendered=[],requests=[];
  const ai=new AI(config,store,async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');
    const request=JSON.parse(options.body),format=request.response_format.json_schema;
    assert.equal(format.strict,true);
    const requested=format.schema.properties.items;
    assert.equal(requested.type,'object');assert.equal(requested.additionalProperties,false);
    requests.push(requested.required);assert.ok(requested.required.length<=3);
    assert.deepEqual(Object.keys(requested.properties),requested.required);
    for(const id of requested.required)assert.deepEqual(requested.properties[id].properties.slotId.enum,[id]);
    const input=JSON.parse(request.messages[1].content[0].text);
    assert.deepEqual(input.slots.map(i=>i.slotId),requested.required);
    const productIds=[...new Set(input.slots.map(i=>i.productId).filter(Boolean))];
    assert.deepEqual(input.products.map(p=>p.id),productIds);
    const full=responseFor(plan);
    return completion({items:Object.fromEntries(Object.entries(full.items).filter(([id])=>requested.required.includes(id)))});
  });
  const worker=new Worker(store,ai,{configured:()=>false},{renderer:async(_s,_a,_p,item)=>{
    rendered.push(item.id);assert.equal(item.caption,captions[item.id]);item.status='ready';
  }});
  const job=store.enqueue('prepare',plan.id);await worker.tick();
  assert.equal(store.job(job.id).status,'done',store.job(job.id).message);
  assert.deepEqual(requests,[['morning','share-morning','poll'],['carousel','detail'],['teaser','evening','share-evening']]);
  assert.deepEqual(rendered,plan.items.map(i=>i.id));assert.equal(calls,3);
  assert.equal(store.usage().counts.text,3);assert.equal(store.list('copy-history').length,3);
  const saved=store.get('plan',plan.id);
  assert.deepEqual(saved.productIds,plan.productIds);assert.equal(store.list('product').length,2);
  assert.ok(saved.items.every(i=>i.status==='ready'&&i.revision===1&&i.caption===captions[i.id]));
});

test('single-slot regeneration and the optional story require only the requested slots',async t=>{
  const {store,plan,config}=await fixture(t,true);const requests=[];
  const ai=new AI(config,store,async(_url,options)=>{
    const body=JSON.parse(options.body),ids=body.response_format.json_schema.schema.properties.items.required;
    requests.push(ids);const full=responseFor(plan);
    return completion({items:Object.fromEntries(ids.map(id=>[id,full.items[id]]))});
  });
  assert.equal((await ai.copy(plan)).length,9);assert.ok(requests[0].includes('extra'));
  const poll=await ai.copy(plan,plan.items.filter(i=>i.id==='poll'));
  assert.deepEqual(requests[1],['poll']);assert.deepEqual(poll.map(i=>i.slotId),['poll']);
  assert.equal(poll[0].pollOptions.length,2);
  assert.deepEqual(await ai.copy(plan,[]),[]);assert.equal(requests.length,2);
});

test('bad or interrupted provider responses leave the existing day intact without paid retries',async t=>{
  const scenarios=[
    ['missing story',data=>{delete data.items['share-morning'];return completion(data);},/неповний план \(2\/3/],
    ['unexpected slot',data=>{data.items.unrequested=data.items.poll;delete data.items.poll;return completion(data);},/неповний/],
    ['wrong slot identity',data=>{data.items.poll.slotId='share-morning';return completion(data);},/слоти/],
    ['null material',data=>{data.items.poll=null;return completion(data);},/некоректний матеріал/],
    ['token limit',data=>completion(data,{finish_reason:'length'}),/не завершена/],
    ['refusal',()=>completion(null,{message:{content:null,refusal:'Cannot comply'}}),/відмовився/],
    ['provider timeout',()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError');},/не встиг відповісти/],
    ['response body timeout',()=>({ok:true,json:async()=>{throw new DOMException('The operation was aborted','AbortError');}}),/не встиг відповісти/],
  ];
  for(const [name,reply,expected] of scenarios)await t.test(name,async t=>{
    const {store,plan,config}=await fixture(t);let calls=0,renders=0;
    const ai=new AI(config,store,async(_url,options)=>{
      calls++;const ids=JSON.parse(options.body).response_format.json_schema.schema.properties.items.required;
      const full=responseFor(plan);return reply({items:Object.fromEntries(ids.map(id=>[id,full.items[id]]))});
    });
    const worker=new Worker(store,ai,{configured:()=>false},{renderer:async()=>{renders++;}});
    const job=store.enqueue('prepare',plan.id);await worker.tick();
    assert.equal(store.job(job.id).status,'error');assert.match(store.job(job.id).message,expected);
    assert.equal(calls,1);assert.equal(renders,0);assert.equal(store.usage().counts.text,1);
    assert.deepEqual(store.get('plan',plan.id),plan);assert.equal(store.list('copy-history').length,0);
  });
});

test('retry preserves completed text batches, including an explicit full-text regeneration',async t=>{
  for(const mode of ['render','all'])await t.test(mode,async t=>{
    const {store,plan,config}=await fixture(t);const requests=[];let fail=true;
    if(mode==='all'){
      for(const i of plan.items)i.caption='Попередня версія для перевірки відновлення';
      store.put('plan',plan);
    }
    const ai=new AI(config,store,async(_url,options)=>{
      const ids=JSON.parse(options.body).response_format.json_schema.schema.properties.items.required;
      requests.push(ids);
      if(ids.includes('carousel')&&fail){fail=false;return new Response('{}',{status:429});}
      const full=responseFor(plan);return completion({items:Object.fromEntries(ids.map(id=>[id,full.items[id]]))});
    });
    const worker=new Worker(store,ai,{configured:()=>false},{renderer:async(_s,_a,_p,i)=>{i.status='ready';}});
    const job=store.enqueue('prepare',plan.id,{mode});await worker.tick();
    assert.equal(store.job(job.id).status,'error');assert.equal(requests.length,2);
    const partial=store.get('plan',plan.id),morning=partial.items.find(i=>i.id==='morning');
    assert.equal(morning.caption,captions.morning);assert.equal(morning.revision,1);
    assert.equal(store.job(job.id).payload.copiedRevisions.morning,1);
    assert.equal(store.list('product').length,2);
    const next=store.enqueue('prepare',plan.id,store.job(job.id).payload);await worker.tick();
    assert.equal(store.job(next.id).status,'done',store.job(next.id).message);
    assert.deepEqual(requests,[['morning','share-morning','poll'],['carousel','detail'],['carousel','detail'],['teaser','evening','share-evening']]);
    assert.ok(store.get('plan',plan.id).items.every(i=>i.status==='ready'&&i.caption===captions[i.id]&&i.revision===1));
    assert.equal(store.list('copy-history').length,3);
  });
});
