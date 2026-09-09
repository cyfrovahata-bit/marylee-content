import { randomUUID } from 'node:crypto';

export function cleanProduct(input, previous={}) {
  const data={...previous};
  for(const [key,max] of [['name',140],['sku',60],['description',6000],['sizes',200],['colors',200],['material',200],['notes',1000]]) {
    if(key in input) {
      if(typeof input[key]!=='string'||input[key].length>max) throw new Error(`Перевір поле ${key}: максимум ${max} символів`);
      data[key]=input[key].trim();
    } else data[key]??='';
  }
  if(!data.name) throw new Error('Вкажи назву товару');
  if('price' in input) {
    data.price=input.price===''||input.price===null?null:Number(input.price);
    if(data.price!==null && (!Number.isFinite(data.price)||data.price<0||data.price>1000000)) throw new Error('Некоректна ціна');
  }
  data.price??=null;
  for(const key of ['active','ready']) { if(key in input && typeof input[key]!=='boolean') throw new Error('Некоректний статус');data[key]=input[key]??previous[key]??(key==='active'); }
  if('assetOrder' in input) {
    if(!Array.isArray(input.assetOrder)||input.assetOrder.length>40||input.assetOrder.some(x=>typeof x!=='string')) throw new Error('Некоректний порядок фото');
    data.assetOrder=[...new Set(input.assetOrder)];
  }
  data.id=previous.id||randomUUID();data.createdAt=previous.createdAt||new Date().toISOString();data.updatedAt=new Date().toISOString();
  return data;
}
export function productAssets(store,product,{originalOnly=false}={}) {
  const order=product.assetOrder||[];
  return store.list('asset').filter(a=>a.productId===product.id && !a.disabled && (!originalOnly||a.source==='original')).sort((a,b)=>{
    const ai=order.indexOf(a.id),bi=order.indexOf(b.id);
    if(ai>=0||bi>=0) return (ai<0?999:ai)-(bi<0?999:bi);
    return b.width*b.height-a.width*a.height || a.createdAt.localeCompare(b.createdAt);
  });
}
