// Shared editorial rules. Supplier prices and operational notes never enter copy.
export function publicDescription(value='') {
  return String(value).split(/\r?\n/).filter(line=>!/(дроп|drop|опт|закуп|собіварт|постачальник|поставщик|https?:|@|\+?380\d)/iu.test(line))
    .map(line=>line.replace(/\b\d+(?:[.,]\d+)?\s*(?:грн|uah|₴)/giu,'')).join('\n').slice(0,3500);
}
export function publicProduct(p) {
  return {id:p.id,name:p.name,material:p.material,sizes:p.sizes,colors:p.colors,description:publicDescription(p.description)};
}
export function reelFacts(p) {
  if(!p)return '';
  const facts=[];
  for(const value of [p.price!==null&&p.price!==undefined?`${p.price} грн`:'',p.sku?`Арт. ${p.sku}`:'',p.sizes?`Розміри: ${p.sizes}`:'']) {
    if(value&&[...facts,value].join(' · ').length<=130)facts.push(value);
  }
  return facts.join(' · ');
}
export function captionLimit(item,product=null) {
  if(item.kind==='story')return 90;
  if(item.kind!=='reel')return 600;
  const facts=reelFacts(product);return 250-(facts?facts.length+2:0);
}
export const VOICE_STYLE='Speak fluent, idiomatic Ukrainian like a lively fashion stylist talking to a friend. Bright, warm and confident, with a smile in the voice. Conversational rhythm, varied intonation, crisp consonants and short natural pauses. Brisk but easy to follow, not a slow announcer, not breathy, no singing. Read only the supplied Ukrainian text; do not add words or stage directions.';
export const salesReel=item=>item.kind==='reel'&&(Boolean(item.productId)||item.purpose==='sale');
export const usesVoice=(item,settings)=>item.kind==='reel'&&!salesReel(item)&&settings.voiceEnabled;

export function slotBrief(item,plan) {
  const briefs={
    useful:'Ранкове мініпорівняння двох конкретних образів. Гачок, лівий образ, правий образ, висновок: рівно чотири сцени, 40–60 слів сумарно. Кожна репліка пояснює видиму річ або зміну. imagePrompt: англійською детально опиши два повні образи поруч (LEFT і RIGHT) з одягом, взуттям, аксесуарами. Сценарій точно відповідає цим образам. Не перелічуй абстрактні правила. Немає продажу.',
    product:'Презентація саме цього товару: що входить у комплект, видимий крій, різні ракурси. Вступ через конкретну річ, потім одна ідея носіння та коротке запрошення уточнити наявність. Вибери до шести різних фото в порядку: загальний вигляд, інший ракурс, ближчий кадр, решта. Не переповідай ранкову пораду.',
    detail:'Одна видима деталь товару, без загального рекламного опису. Вибери ОДНЕ фото, де цю деталь найкраще видно. detailFocus upper для жилета/коміра/застібки, lower для низу/брюк/шортів або full для вже близького фото. Назви лише те, що реально видно, без вигаданих кишень, підкладки чи властивостей тканини. Короткий заголовок і одна фраза.',
    teaser:'Коротке знайомство з другим товаром: назви тип речі й одну видиму особливість. Інший ракурс та ідея, ніж вечірній Reel. Не копіюй пораду про кольори, не обіцяй новинку, рух або примірку, якщо є лише фото.',
    sale:'Продажний Reel БЕЗ ОЗВУЧКИ. Рівно чотири lines — короткі написи по 2–6 слів, до 40 символів кожен: конкретна річ / видима деталь / варіант носіння / звернення для замовлення. Caption: конкретний товар і привід написати, без ранкової теми та без загальної лекції зі стилю. Жодних тверджень про комфорт, склад чи посадку, яких немає в даних. Вибери чотири різні оригінальні ракурси, за наявності відео віддай йому перевагу.',
    poll:'Покажемо два образи з ранкової ілюстрації. Питання про особистий вибір, без правильного/неправильного. Не вигадуй власні кольори чи предмети. Варіанти відповіді рівно «Лівий образ» і «Правий образ». Коротке запитання і короткий caption, без закликів поширювати.',
    repost:item.dependsOn==='morning'?'Одна коротка підводка до ранкового прикладу. Не проси аудиторію поширювати, не повторюй саму пораду.':'Одна коротка підводка до огляду товару. Без повтору опису та без вигаданої знижки.',
    extra:'Одна коротка фраза: запропонуй уточнити розмір або наявність конкретного товару.',
    'useful-photo':'Окрема коротка ідея стилізації, відмінна від ранкового пояснення. Візьми ілюстрацію ранкового Reel, не видавай її за реальний товар.',
  };
  return {task:briefs[item.purpose]||briefs.extra,
    // Old saved plans described abstract three-step diagrams. The topic stays,
    // but the new visual brief is always a concrete two-outfit comparison.
    ...(item.purpose==='useful'?{topic:{id:plan.topic.id,title:plan.topic.title,brief:'Порівняй два повні образи з однією чітко видимою зміною. Рівно два образи, не три кроки й не абстрактна схема.'}}:{}),
    version:(item.revision||0)+1,
    previous:item.caption?{title:item.title,caption:item.caption}:null};
}
