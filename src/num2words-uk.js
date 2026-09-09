// Українські числівники словами — ЛИШЕ для озвучки (щоб ElevenLabs не читав
// числа «російською»/цифрами). Субтитрів не стосується: там лишаються цифри.
const ONES = ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
const ONES_F = ['', 'одна', 'дві', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
// Наголоси проставлені комбінованим акутом (U+0301) прямо в таблицях: ці слова
// йдуть лише в озвучку (numbersToWords викликається з fixPronunciation), а
// ElevenLabs системно ставив наголос не туди — «вісімнадця́того» замість
// «вісімна́дцятого». Норма для десятків: де́сять, але одина́дцять…дев'ятна́дцять.
const TEENS = ['де́сять', 'одина́дцять', 'двана́дцять', 'трина́дцять', 'чотирна́дцять', "п'ятна́дцять", 'шістна́дцять', 'сімна́дцять', 'вісімна́дцять', "дев'ятна́дцять"];
const TENS = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"];
const HUNDREDS = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"];
// [одн., 2-4, 5+, жіночий рід?]
const SCALES = [
  null,
  ['тисяча', 'тисячі', 'тисяч', true],
  ['мільйон', 'мільйони', 'мільйонів', false],
  ['мільярд', 'мільярди', 'мільярдів', false],
];

function group3(n, feminine) {
  const parts = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const t = Math.floor(rest / 10);
  const o = rest % 10;
  if (h) parts.push(HUNDREDS[h]);
  if (t === 1) parts.push(TEENS[o]);
  else {
    if (t >= 2) parts.push(TENS[t]);
    if (o) parts.push((feminine ? ONES_F : ONES)[o]);
  }
  return parts.join(' ');
}

// Форма масштабного слова (тисяча/тисячі/тисяч) за останніми цифрами.
function pluralScale(n, forms) {
  const m100 = n % 100;
  const m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return forms[2];
  if (m10 === 1) return forms[0];
  if (m10 >= 2 && m10 <= 4) return forms[1];
  return forms[2];
}

export function numberToUkrainian(num) {
  const value = Math.trunc(Math.abs(Number(num)));
  if (!Number.isFinite(value)) return String(num);
  if (value === 0) return 'нуль';
  const groups = [];
  let n = value;
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const words = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    const scale = SCALES[i];
    // «1000» → «тисяча» (без «одна»), напр. рік «1947» → «тисяча дев'ятсот…».
    if (scale && scale[3] && g === 1) { words.push(scale[0]); continue; }
    words.push(group3(g, scale ? scale[3] : false));
    if (scale) words.push(pluralScale(g, scale));
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}


// --- Порядкові числівники ----------------------------------------------------
// Дати вимовляються порядковим числівником, а не кількісним: «1 травня» —
// це «першого травня», а не «один травня». Порядковою стає ЛИШЕ остання
// ненульова складова, решта лишається кількісною: 1986 → «тисяча дев'ятсот
// вісімдесят» + «шостого».
const ORD_UNITS = ['', 'перш', 'друг', 'треть', 'четверт', "п'ят", 'шост', 'сьом', 'восьм', "дев'ят"];
// У порядкових наголос інший, ніж у кількісних: де́сять, але деся́тий.
const ORD_TEENS = ['деся́т', 'одина́дцят', 'двана́дцят', 'трина́дцят', 'чотирна́дцят', "п'ятна́дцят", 'шістна́дцят', 'сімна́дцят', 'вісімна́дцят', "дев'ятна́дцят"];
const ORD_TENS = ['', '', 'двадцят', 'тридцят', 'сороков', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яност"];
const ORD_HUNDREDS = ['', 'сот', 'двохсот', 'трьохсот', 'чотирьохсот', "п'ятисот", 'шестисот', 'семисот', 'восьмисот', "дев'ятисот"];
// «двох тисячн» навмисно двома словами: суцільне «двохтисячному» ElevenLabs
// вимовляє гірше. Форма перевірена на слух і закріплена тестом.
const ORD_THOUSANDS = ['', 'тисячн', 'двох тисячн', 'трьох тисячн', 'чотирьох тисячн', "п'яти тисячн"];

// Розкладає число на «кількісний хвіст + порядкова остання складова».
function ordinalParts(value) {
  const m100 = value % 100;
  if (m100 >= 10 && m100 <= 19) return { prefix: value - m100, stem: ORD_TEENS[m100 - 10] };
  const units = value % 10;
  if (units) return { prefix: value - units, stem: ORD_UNITS[units] };
  if (m100) return { prefix: value - m100, stem: ORD_TENS[m100 / 10] };
  const m1000 = value % 1000;
  if (m1000) return { prefix: value - m1000, stem: ORD_HUNDREDS[m1000 / 100] };
  // Кругла тисяча: 1000 → тисячного, 2000 → двохтисячного.
  const thousands = value / 1000;
  if (thousands < ORD_THOUSANDS.length) return { prefix: 0, stem: ORD_THOUSANDS[thousands] };
  return null; // надто велике — краще лишити кількісним, ніж вигадувати форму
}

// «треть» — єдина основа в таблицях, що закінчується на «ь», і вона м'яка:
// «третього» й «третьому» збираються прямо, а от «третьий» — ні, там потрібне
// «третій». Тому перед твердим голосним «ь» замінюється на пару до нього.
const SOFT_PAIR = { и: 'і', а: 'я', е: 'є', у: 'ю' };

function joinOrdinal(stem, ending) {
  if (!stem.endsWith('ь')) return `${stem}${ending}`;
  const pair = SOFT_PAIR[ending[0]];
  return pair ? `${stem.slice(0, -1)}${pair}${ending.slice(1)}` : `${stem}${ending}`;
}

// ending: 'ого' (родовий: «1986 року») або 'ому' (місцевий: «у 1986 році»).
export function ordinalUkrainian(num, ending = 'ого') {
  const value = Math.trunc(Math.abs(Number(num)));
  if (!Number.isFinite(value) || value === 0) return numberToUkrainian(num);
  const parts = ordinalParts(value);
  if (!parts || !parts.stem) return numberToUkrainian(value);
  const head = parts.prefix ? `${numberToUkrainian(parts.prefix)} ` : '';
  return `${head}${joinOrdinal(parts.stem, ending)}`;
}

// Хвіст після дефіса → повне закінчення порядкового числівника.
// Свідомо без «-ю»: «7-ю» може бути і «сьому», і «сьомою», а вгадувати відмінок
// гірше, ніж лишити число кількісним.
const HYPHEN_ENDINGS = {
  го: 'ого', му: 'ому', ому: 'ому', й: 'ий', ий: 'ий', ім: 'ім',
  ї: 'ої', ої: 'ої', х: 'их', их: 'их', ми: 'ими', ими: 'ими',
  а: 'а', я: 'а', е: 'е', є: 'е',
};

// Українською хвіст часто несе ще й приголосну основи: «1-ша», «2-га», «3-тя»,
// «7-ма», «4-те». Основу ordinalUkrainian будує сам, тож таку приголосну просто
// відкидаємо й дивимося на решту. Не впізнали — лишаємо текст як є: краще
// незмінене число, ніж вигаданий відмінок.
function hyphenEnding(tail) {
  return HYPHEN_ENDINGS[tail] || HYPHEN_ENDINGS[tail.slice(1)] || null;
}

const MONTHS_GEN = 'січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня';

// Роздільник тисяч. ChatGPT пише рік то суцільно («1100»), то з пробілом
// («1 100»), і пробіл при цьому буває будь-який: звичайний, нерозривний,
// вузький нерозривний або тонкий. Правила порядкових числівників раніше
// вимагали \d{3,4} підряд, тож «у 1 100 році» повз них проходило й падало
// в загальну кількісну гілку — виходило «у тисяча сто році» замість
// «у тисяча сотому році».
const TSEP = '[\\u0020\\u00A0\\u202F\\u2009]';
const YEAR = String.raw`\d{1,2}${TSEP}\d{3}|\d{3,4}`;
const digits = (s) => s.replace(new RegExp(TSEP, 'g'), '');

// Римські числа. Для каналу про історію це не екзотика: «XIX століття»
// трапляється мало не в кожному сценарії, а рушій читав таке по літерах або
// як чуже слово. Перекладаємо в арабські ДО решти правил — далі спрацьовують
// уже наявні правила століть.
//
// Дві осторóги. По-перше, перекладаємо ТІЛЬКИ поруч зі словом «століття»,
// «сторіччя» чи «ст.»: окрема латинська «I» деінде в тексті може бути не
// числом. По-друге, у класі є й кириличні двійники — «ХІХ» із кириличними Х
// та І виглядає так само, як латинське «XIX», і трапляється в текстах не
// рідше.
const ROMAN = {
  i: 1, v: 5, x: 10, l: 50, c: 100,
  і: 1, х: 10, с: 100,
};
function romanToInt(s) {
  const v = [...s.toLowerCase()].map((c) => ROMAN[c]);
  if (v.some((n) => !n)) return null;
  let total = 0;
  for (let i = 0; i < v.length; i++) total += v[i] < v[i + 1] ? -v[i] : v[i];
  // Століття далі за XXI не буває; більше — майже напевно не римське число.
  return total > 0 && total <= 21 ? total : null;
}
const ROMAN_CHARS = 'IVXLCivxlcХхІіСс';

function romanCenturies(text) {
  const cent = String.raw`століт\p{L}*|сторіч\p{L}*`;
  let out = text;
  // «у XVI ст.» — місцевий відмінок, тож розгортаємо в «столітті».
  out = out.replace(
    new RegExp(String.raw`(?<!\p{L})([ув])\s+([${ROMAN_CHARS}]{1,7})\s+ст\.`, 'giu'),
    (whole, prep, roman) => {
      const n = romanToInt(roman);
      return n ? `${prep} ${n} столітті` : whole;
    },
  );
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])([${ROMAN_CHARS}]{1,7})\s+ст\.`, 'giu'),
    (whole, roman) => {
      const n = romanToInt(roman);
      return n ? `${n} століття` : whole;
    },
  );
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])([${ROMAN_CHARS}]{1,7})\s+(${cent})`, 'giu'),
    (whole, roman, word) => {
      const n = romanToInt(roman);
      return n ? `${n} ${word}` : whole;
    },
  );
  return out;
}

// «Ціла» і «десята» — іменники ЖІНОЧОГО роду, тож ціла частина теж жіноча:
// не «один цілих п'ять десятих», а «одна ціла п'ять десятих»; 2 → «дві».
// Форма самого слова залежить від останньої цифри так само, як «година»:
// 1 — ціла, 2–4 — цілих, решта — цілих (крім підступного другого десятка).
function feminineUnit(n, one, few) {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return one;
  return few;
}

function decimalToWords(whole, frac) {
  const w = Number(whole);
  const f = Number(frac);
  // \b у JS орієнтується на латиницю й з кирилицею не працює — та сама пастка,
  // що вже ловила нас у словнику наголосів. Прив'язки до кінця рядка досить.
  const toFeminine = (t) => t.replace(/один$/, 'одна').replace(/два$/, 'дві');
  const head = toFeminine(numberToUkrainian(w));
  const tailWord = frac.length === 1
    ? feminineUnit(f, 'десята', 'десятих')
    : feminineUnit(f, 'сота', 'сотих');
  const tail = toFeminine(numberToUkrainian(f));
  return `${head} ${feminineUnit(w, 'ціла', 'цілих')} ${tail} ${tailWord}`;
}

// Замінює числа в тексті на слова (для голосу). Підтримує пробіл-роздільник
// тисяч («15 000», включно з нерозривним пробілом). Числа, зліплені з
// літерами («3D», «COVID19»), НЕ чіпає.
export function numbersToWords(text) {
  let out = romanCenturies(String(text));

  // Десяткові дроби: «19,3 тисячі гектарів» рушій читав як
  // «дев'ятнадцять,три» — кома лишалася символом і збивала інтонацію.
  // Правило має спрацювати РАНІШЕ за загальне, інакше ціла й дробова частини
  // розійдуться на два окремі числа.
  out = out.replace(
    /(?<![\p{L}\d])(\d+),(\d{1,2})(?![\p{L}\d])/gu,
    (_m, whole, frac) => `${decimalToWords(whole, frac)}`,
  );

  // «у 1986 році» / «в 2000 році» — місцевий відмінок.
  out = out.replace(
    new RegExp(String.raw`(?<!\p{L})([ув])\s+(${YEAR})\s+(роц[іе])(?!\p{L})`, 'giu'),
    (_m, prep, year) => `${prep} ${ordinalUkrainian(digits(year), 'ому')} році`,
  );

  // «1986 року» — родовий відмінок.
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])(${YEAR})\s+(року|роках)(?!\p{L})`, 'giu'),
    (_m, year, word) => `${ordinalUkrainian(digits(year), 'ого')} ${word}`,
  );

  // «1100 рік» — називний, «1100 роком» — орудний. Раніше цих двох форм не
  // було зовсім: правила знали тільки «році» й «року», тож рядок «перша
  // згадка — 1100 рік» озвучувався як «тисяча сто рік».
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])(${YEAR})\s+(рік)(?!\p{L})`, 'giu'),
    (_m, year, word) => `${ordinalUkrainian(digits(year), 'ий')} ${word}`,
  );
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])(${YEAR})\s+(роком)(?!\p{L})`, 'giu'),
    (_m, year, word) => `${ordinalUkrainian(digits(year), 'им')} ${word}`,
  );

  // «1 травня», «20 жовтня» — день місяця теж порядковий.
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])(\d{1,2})\s+(${MONTHS_GEN})(?!\p{L})`, 'giu'),
    (_m, day, month) => `${ordinalUkrainian(day, 'ого')} ${month}`,
  );

  // «у 19 столітті» — місцевий відмінок. Століття в історичних сюжетах
  // трапляється не рідше за рік, а без правила виходило «дев'ятнадцять
  // столітті».
  out = out.replace(
    new RegExp(String.raw`(?<!\p{L})([ув])\s+(\d{1,2})\s+(столітт[іі]|сторіччі)(?!\p{L})`, 'giu'),
    (_m, prep, n, word) => `${prep} ${ordinalUkrainian(n, 'ому')} ${word}`,
  );

  // «19 століття» — родовий відмінок.
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])(\d{1,2})\s+(століття|сторіччя)(?!\p{L})`, 'giu'),
    (_m, n, word) => `${ordinalUkrainian(n, 'ого')} ${word}`,
  );

  // «7-го», «3-му», «20-ті» — порядковий числівник із відмінковим хвостом.
  // Без цього правила число йшло в загальну гілку як КІЛЬКІСНЕ, а хвіст
  // лишався висіти: «7-го» → «сім-го», і голос читав «сімого» замість
  // «сьомого». Правило має спрацювати РАНІШЕ за загальне.
  out = out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])(\d+)\s*-\s*(\p{L}{1,4})(?!\p{L})`, 'gu'),
    (whole, num, tail) => {
      const ending = hyphenEnding(tail.toLowerCase());
      return ending ? ordinalUkrainian(num, ending) : whole;
    },
  );

  // Решта чисел — звичайним кількісним числівником. Підтримує пробіл-роздільник
  // тисяч («15 000») у всіх його накресленнях. Числа, зліплені з літерами
  // («3D», «COVID19»), НЕ чіпає.
  return out.replace(
    new RegExp(String.raw`(?<![\p{L}\d])(\d{1,3}(?:${TSEP}\d{3})+|\d+)(?![\p{L}\d])`, 'gu'),
    (m) => numberToUkrainian(digits(m)),
  );
}

