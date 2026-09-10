import { createHash } from 'node:crypto';

export const IMAGE_API_DISABLED='Малювання через API вимкнено. Скопіюй промпт і завантаж готове зображення в ранковий матеріал.';
export const illustrationSignature=item=>createHash('sha256').update(JSON.stringify([item.imagePrompt,item.imageGeneration||0])).digest('hex');
export function drawingPrompt(item) {
  if(!item?.imagePrompt?.trim())return '';
  return `Create a portrait fashion photograph, aspect ratio 2:3 (1024 x 1536), for a styling comparison. EXACTLY TWO equally wide panels, LEFT and RIGHT, divided at the exact center. In both panels show the same adult woman from head to shoes, centered in her panel with generous margins. Realistic anatomy and wearable clothes. Same pose, lighting, neutral warm background and all clothing details except the change described below. No text, letters, labels, logos, watermarks or extra panels. This is a styling illustration, not a photograph of a product for sale.\n\n${item.imagePrompt}`;
}
export function editorialAssets(store,item) {
  if(!item)return [];
  const allowed=a=>a&&!a.disabled&&!a.productId&&['ai','editorial'].includes(a.source);
  const selected=(item.selectedAssetIds||[]).map(id=>store.get('asset',id)).filter(allowed);
  if(selected.length)return selected;
  const cached=item.illustrationId?store.get('asset',item.illustrationId):null;
  return allowed(cached)&&item.illustrationSignature===illustrationSignature(item)?[cached]:[];
}
export function imageSource(plan,item) {
  if(item.purpose==='useful')return item;
  if(['poll','useful-photo'].includes(item.purpose)||item.dependsOn==='morning')return plan.items.find(i=>i.id==='morning');
  return null;
}
export function pendingMedia(store,plan,item) {
  const source=imageSource(plan,item);
  if(source&&!editorialAssets(store,source).length)return {status:'awaiting-image',sourceId:source.id,message:item.id===source.id?'Промпт готовий. Намалюй зображення й завантаж його сюди.':'Використає зображення з ранкового Reel. Завантаж його в матеріал о 09:00.'};
  if(item.purpose==='repost') {
    const parent=plan.items.find(i=>i.id===item.dependsOn);
    if(!parent||!['ready','posted'].includes(parent.status)||!parent.outputIds?.length)return {status:'waiting-parent',sourceId:parent?.id,message:'Спочатку потрібно завершити Reel, який поширюємо.'};
  }
  return null;
}
export function resetIllustration(item) {
  item.selectedAssetIds=[];item.illustrationId=null;item.illustrationSignature=null;item.mediaAssetIds=[];
  item.outputIds=[];item.coverId=null;
}
export function invalidateDependents(plan,item) {
  for(const child of plan.items.filter(i=>i.id!==item.id&&!['posted','skipped'].includes(i.status)&&(i.dependsOn===item.id||(item.purpose==='useful'&&['poll','useful-photo'].includes(i.purpose))))) {
    child.status='draft';child.outputIds=[];child.coverId=null;
  }
}
