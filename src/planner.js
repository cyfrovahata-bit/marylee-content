import { productAssets } from './catalog.js';
import { validDate, shiftDate, kyivToday } from './kyiv.js';

export const SCHEDULE=[
  {id:'morning',time:'09:00',kind:'reel',purpose:'useful',label:'Актуальний Reel'},
  {id:'carousel',time:'14:00',kind:'carousel',purpose:'product',role:'A',label:'Товар дня · карусель'},
  {id:'evening',time:'19:30',kind:'reel',purpose:'sale',role:'A',label:'Товар дня · Reel'},
];
export const TOPICS=[
  {id:'fashion-news',title:'Актуальна новина моди',mode:'current',brief:'Знайди свіжу новину або помітний актуальний напрям у моді. Перевір дату та щонайменше два надійні джерела. Поясни українською практичне значення для звичайного гардероба.'},
  {id:'clothing-tip',title:'Актуальна порада про одяг',mode:'advice',brief:'Обери одну сезонно доречну практичну пораду про вибір, догляд або носіння одягу. Дай конкретний приклад без довгої розповіді.'},
  {id:'style-tip',title:'Актуальна порада зі стилю',mode:'style',brief:'Обери один сучасний стилістичний прийом і покажи його на конкретному образі. Без оцінювання фігури та без універсальних обіцянок.'},
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
  if(!Array.isArray(productIds)||productIds.length>1||new Set(productIds).size!==productIds.length) throw new Error('Вибери один товар на день');
  const products=productIds.length?productIds.map(id=>store.get('product',id)):eligibleProducts(store,date).slice(0,1);
  if(products.some(p=>!p||!p.active||!p.ready||!productAssets(store,p,{originalOnly:true}).length)) throw new Error('Заверши завантаження товару й додай оригінальне фото або відео');
  if(!products.length) throw new Error('Немає готових товарів без недавнього повтору. Додай новий або вибери товар вручну.');
  const used=store.list('plan').filter(p=>p.id<date).sort((a,b)=>b.id.localeCompare(a.id)).slice(0,13).map(p=>p.topic.id);
  const topic=TOPICS.find(t=>!used.includes(t.id))||TOPICS[0];
  const A=products[0];
  const items=SCHEDULE.map(s=>{
    const product=s.role==='A'?A:null;
    const assets=product?productAssets(store,product,{originalOnly:true}):[];
    const isUsefulPhoto=s.role==='A'&&!A;
    return {...s,externalImages:['useful','poll'].includes(s.purpose),productId:product?.id||null,label:isUsefulPhoto?(s.kind==='carousel'?'Корисний фотопост':'Продовження поради'):s.label,
      purpose:isUsefulPhoto?'useful-photo':s.purpose,status:'draft',title:'',caption:'',keywords:[],hashtags:[],lines:[],
      selectedAssetIds:assets.filter(a=>s.kind==='reel'?a.kind==='video':a.kind==='image').slice(0,6).map(a=>a.id),
      outputIds:[],coverId:null,notes:[],revision:0,postedAt:null};
  });
  return store.put('plan',{id:date,topic,productIds:products.map(p=>p.id),createdAt:new Date().toISOString(),items,version:1});
}
// One inventory batch consumes each ready product once. Future reservations are
// excluded even when a user presses the button again or browses another date.
export function createBatch(store,start=shiftDate(kyivToday(),1)) {
  if(!validDate(start)||start<shiftDate(kyivToday(),1))throw new Error('Новий пакет починається не раніше завтра за Києвом');
  const reserved=new Set(store.list('plan').flatMap(p=>p.productIds));
  const candidates=store.list('product').filter(p=>p.active&&p.ready&&!reserved.has(p.id)&&productAssets(store,p,{originalOnly:true}).length).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const plans=[];let date=start;
  return store.transaction(()=>{
    while(candidates.length) {
      while(store.get('plan',date))date=shiftDate(date,1);
      const eligible=eligibleProducts(store,date).filter(p=>candidates.some(c=>c.id===p.id));
      if(!eligible.length){date=shiftDate(date,1);continue;}
      const chosen=eligible.slice(0,1).map(p=>p.id);
      const plan=createPlan(store,date,chosen);plans.push(plan);
      for(const id of chosen)candidates.splice(candidates.findIndex(p=>p.id===id),1);
      store.enqueue('prepare',date,{mode:'render'});date=shiftDate(date,1);
    }
    return {dates:plans.map(p=>p.id),products:plans.reduce((n,p)=>n+p.productIds.length,0)};
  });
}
export function itemGoal(item) {
  const goals={
    useful:'Дати актуальну новину моди або коротку практичну пораду про одяг чи стиль. Без продажу товару.',
    poll:'Дізнатися, який варіант ближчий аудиторії. Окремий фон за темою дня; справжню наліпку опитування додаєш під час публікації.',
    product:'Показати товар дня у вертикальній повноекранній каруселі з короткими підказками на кожному фото.',
    detail:'Показати ближче одну справжню деталь товару A: застібку, крій або оздоблення.',
    teaser:'Познайомити з товаром B перед вечірнім оглядом, показавши одну його особливість.',
    sale:'Коротко показати той самий товар дня у вечірньому Reel. Без голосу; підказки є прямо у відео.',
    extra:'Необов’язкове нагадування: запропонувати уточнити розмір або наявність товару B.',
    'useful-photo':'Продовжити пораду про стиль у фотоформаті, коли на день вибрано лише один товар.',
  };
  if(item.purpose==='repost')return item.dependsOn==='morning'?'Показати ранкову пораду тим, хто переглядає сторіз. Поширюємо вже опублікований Reel.':'Нагадати про вечірній огляд товару B. Поширюємо той самий Reel у сторіз.';
  return goals[item.purpose]||'';
}
export function itemInstruction(item) {
  if(item.purpose==='repost') return `Відкрий уже опублікований ${item.dependsOn==='morning'?'ранковий':'вечірній'} матеріал → «Поширити у сторіз». Додай текст нижче.`;
  if(item.purpose==='poll') return 'Завантаж фон у сторіз. Додай справжню наліпку «Опитування», скопіюй запитання та два варіанти відповіді.';
  if(item.kind==='carousel') return 'Завантаж фото в зазначеному порядку, встав підпис. Перевір ціну, розміри й наявність перед публікацією.';
  if(item.kind==='reel'&&item.productId)return 'Завантаж відео й обкладинку, встав підпис. Ролик без голосу — за бажанням додай свою музику в соцмережі. Звір ціну й наявність.';
  if(item.kind==='reel') return 'Переглянь відео, вибери обкладинку та встав підпис. Ілюстрації та озвучка створені ШІ; додай відповідну позначку в соцмережі.';
  return 'Завантаж підготовлену сторіз і додай текст. Ціну та наявність звір із каталогом.';
}
