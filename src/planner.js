import { productAssets } from './catalog.js';
import { validDate, shiftDate } from './kyiv.js';

export const SCHEDULE=[
  {id:'morning',time:'09:00',kind:'reel',purpose:'useful',label:'Корисний Reel'},
  {id:'share-morning',time:'09:30',kind:'story',purpose:'repost',dependsOn:'morning',label:'Поширити ранковий Reel'},
  {id:'poll',time:'12:00',kind:'story',purpose:'poll',label:'Опитування'},
  {id:'carousel',time:'14:00',kind:'carousel',purpose:'product',role:'A',label:'Товар A · карусель'},
  {id:'detail',time:'15:30',kind:'story',purpose:'detail',role:'A',label:'Деталь товару A'},
  {id:'teaser',time:'18:30',kind:'story',purpose:'teaser',role:'B',label:'Знайомство з товаром B'},
  {id:'evening',time:'19:30',kind:'reel',purpose:'sale',role:'B',label:'Товар B · Reel'},
  {id:'share-evening',time:'20:00',kind:'story',purpose:'repost',role:'B',dependsOn:'evening',label:'Поширити вечірній Reel'},
  {id:'extra',time:'21:30',kind:'story',purpose:'extra',role:'B',optional:true,label:'Додаткова сторіз'},
];
export const TOPICS=[
  {id:'color-accent',title:'Один акцент: як зібрати кольори в образі',mode:'palette',brief:'Покажи три поступові кроки: спокійна основа, другий близький колір, один контрастний аксесуар. Це варіант стилізації, а не обов’язкове правило.'},
  {id:'repeat-color',title:'Повтори один колір у двох деталях',mode:'palette',brief:'Покажи як один і той самий акцент у взутті та сумці пов’язує образ. Порівняй два варіанти без оцінок фігури.'},
  {id:'length',title:'Змінюємо довжину верхнього шару',mode:'proportion',brief:'На умовній схемі порівняй коротший і довший верх із тим самим низом. Поясни як змінюється розташування візуальної межі. Жодних універсальних обіцянок стрункості.'},
  {id:'three-tones',title:'Три відтінки одного кольору',mode:'palette',brief:'Збери умовний комплект із світлого, середнього та темного відтінків. Запропонуй поміняти їх місцями. Це експеримент зі стилем.'},
  {id:'layering',title:'Два шари й одна відкрита лінія',mode:'proportion',brief:'Покажи на схемі базовий комплект і розстебнутий верхній шар. Поясни появу вертикальної лінії без обіцянок зміни фігури.'},
  {id:'warm-cool',title:'Бежевий із синім: спробуй цю пару',mode:'palette',brief:'Поступово поєднай бежеву основу з синім акцентом, потім поміняй домінантний колір. Не роби тверджень про колір шкіри.'},
  {id:'small-accent',title:'Акцент може бути маленьким',mode:'palette',brief:'Порівняй нейтральний комплект із невеликою кольоровою деталлю та з великим кольоровим шаром. Запитай, який настрій ближчий.'},
  {id:'waist-line',title:'Де проходить межа між верхом і низом?',mode:'proportion',brief:'Змісти умовну межу верху й низу на схемі. Поясни, що сприйняття пропорцій змінюється, але немає єдиного правильного варіанту.'},
  {id:'olive-cream',title:'Оливковий, молочний і темний акцент',mode:'palette',brief:'Збери варіант палітри оливковий, молочний, графітовий. Порівняй, який із них зробити основою.'},
  {id:'contrast',title:'М’який контраст чи виразний?',mode:'palette',brief:'Порівняй близькі відтінки та світло-темну пару на умовній схемі. Запропонуй обрати за настроєм, без обіцянок універсального ефекту.'},
  {id:'outer-layer',title:'Один комплект, два верхні шари',mode:'proportion',brief:'На схемі додай до умовного комплекту короткий і довгий зовнішні шари. Запропонуй користувачеві порівняти силуети.'},
  {id:'burgundy',title:'Бордовий акцент у спокійній палітрі',mode:'palette',brief:'Поєднай молочний, графітовий та бордовий як приклад. Покажи акцент на двох різних місцях.'},
  {id:'blue-brown',title:'Синій із коричневим: два варіанти',mode:'palette',brief:'Поступово склади умовну палітру синій, коричневий, світлий нейтральний. Міняй великі та малі кольорові площини.'},
  {id:'balance',title:'Одна об’ємна річ у комплекті',mode:'proportion',brief:'Порівняй на схемі широкий верх із прямим низом та прямий верх із широким низом. Жодного оцінювання тіл чи універсальних правил.'},
];
export function lastUse(store,id,beforeDate) {
  return store.list('plan').filter(p=>p.id<beforeDate && p.items.some(i=>i.productId===id)).map(p=>p.id).sort().at(-1)||null;
}
export function eligibleProducts(store,date) {
  const boundary=shiftDate(date,-store.settings().cooldownDays);
  return store.list('product').filter(p=>p.active&&p.ready&&productAssets(store,p,{originalOnly:true}).length>0).filter(p=>!lastUse(store,p.id,date)||lastUse(store,p.id,date)<=boundary).sort((a,b)=>(lastUse(store,a.id,date)||'').localeCompare(lastUse(store,b.id,date)||'')||a.createdAt.localeCompare(b.createdAt));
}
export function createPlan(store,date,productIds=[]) {
  if(!validDate(date)) throw new Error('Некоректна дата плану');
  const existing=store.get('plan',date);
  if(existing) {
    if(Array.isArray(productIds)&&productIds.length&&JSON.stringify(productIds)!==JSON.stringify(existing.productIds))throw new Error('Для цієї дати вже вибрані інші товари. Увімкни «Замінити чернетку дня» або обери іншу дату.');
    return existing;
  }
  if(!Array.isArray(productIds)||productIds.length>2||new Set(productIds).size!==productIds.length) throw new Error('Вибери до двох різних товарів');
  const products=productIds.length?productIds.map(id=>store.get('product',id)):eligibleProducts(store,date).slice(0,2);
  if(products.some(p=>!p||!p.active||!p.ready||!productAssets(store,p,{originalOnly:true}).length)) throw new Error('Заверши завантаження товару й додай оригінальне фото або відео');
  if(!products.length) throw new Error('Немає готових товарів без недавнього повтору. Додай новий або вибери товар вручну.');
  const used=store.list('plan').filter(p=>p.id<date).sort((a,b)=>b.id.localeCompare(a.id)).slice(0,13).map(p=>p.topic.id);
  const topic=TOPICS.find(t=>!used.includes(t.id))||TOPICS[0];
  const A=products.length>1?products[0]:null, B=products.at(-1);
  const items=SCHEDULE.filter(s=>!s.optional||store.settings().includeOptionalStory).map(s=>{
    const product=s.role==='A'?A:s.role==='B'?B:null;
    const assets=product?productAssets(store,product,{originalOnly:true}):[];
    const isUsefulPhoto=s.role==='A'&&!A;
    return {...s,productId:product?.id||null,label:isUsefulPhoto?(s.kind==='carousel'?'Корисний фотопост':'Продовження поради'):s.label,
      purpose:isUsefulPhoto?'useful-photo':s.purpose,status:'draft',title:'',caption:'',keywords:[],hashtags:[],lines:[],
      selectedAssetIds:assets.filter(a=>s.kind==='reel'?a.kind==='video':a.kind==='image').slice(0,6).map(a=>a.id),
      outputIds:[],coverId:null,notes:[],revision:0,postedAt:null};
  });
  return store.put('plan',{id:date,topic,productIds:products.map(p=>p.id),createdAt:new Date().toISOString(),items,version:1});
}
export function itemInstruction(item) {
  if(item.purpose==='repost') return `Відкрий уже опублікований ${item.dependsOn==='morning'?'ранковий':'вечірній'} матеріал → «Поширити у сторіз». Додай текст нижче.`;
  if(item.purpose==='poll') return 'Завантаж фон у сторіз. Додай справжню наліпку «Опитування», скопіюй запитання та два варіанти відповіді.';
  if(item.kind==='carousel') return 'Завантаж фото в зазначеному порядку, встав підпис. Перевір ціну, розміри й наявність перед публікацією.';
  if(item.kind==='reel') return 'Переглянь відео зі звуком, вибери обкладинку та встав підпис. За потреби познач використання ШІ; озвучка синтетична.';
  return 'Завантаж підготовлену сторіз і додай текст. Ціну та наявність звір із каталогом.';
}
