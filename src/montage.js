// Portrait montage, explicit sales voice policy, and original product media only.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { run, probe, mediaPath, registerOutput, saveAsset } from './files.js';
import { productAssets } from './catalog.js';
import { salesReel, usesVoice } from './content.js';

const W=1080,H=1920,FPS=25,FONT='DejaVu Sans';
const getAsset=(store,id)=>id?store.get('asset',id):null;
const codec=['-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-r',String(FPS),'-g','50','-keyint_min','50','-sc_threshold','0','-threads','2'];
const clean=s=>String(s).replace(/[{}\\]/g,'').replace(/[\r\n]+/g,' ').trim();
function stamp(seconds) {const cs=Math.round(seconds*100),s=Math.floor(cs/100);return `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;}
function wrap(text,width=28) {
  const lines=[''];for(const word of clean(text).split(/\s+/)) {if(lines.at(-1).length+word.length>width&&lines.at(-1))lines.push('');lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}
  return lines.join('\\N');
}
function assHeader(height=H) {return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${height}\nWrapStyle: 2\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,${FONT},54,&H00FFFFFF,&H00FFFFFF,&H002C422E,&H002C422E,0,0,0,0,100,100,0,0,3,12,0,2,85,85,310,1\nStyle: Title,${FONT},60,&H0024382B,&H0024382B,&H00F4F0E8,&H00F4F0E8,-1,0,0,0,100,100,0,0,1,0,0,8,80,80,170,1\nStyle: Brand,${FONT},28,&H0024382B,&H0024382B,&H00F4F0E8,&H00F4F0E8,0,0,0,0,100,100,3,0,1,0,0,8,50,50,90,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;}
const event=(start,end,style,text)=>`Dialogue: 0,${stamp(start)},${stamp(end)},${style},,0,0,0,,${text}\n`;
function captionAss(text,duration,{title='',sale=false,scene=0,aiIllustration=false}={}) {
  let ass=assHeader()+event(0,duration,'Brand',aiIllustration?'MARYLEE / ІЛЮСТРАЦІЯ ШІ':'MARYLEE SHOP');
  if(title)ass+=event(0,duration,'Title',`{\\fs48}${wrap(title,34)}`);
  ass+=event(0,duration,'Brand',`{\\an9\\pos(975,280)\\fs26}${String(scene+1).padStart(2,'0')}`);
  if(sale)return ass+event(0,duration,'Caption',`{\\fs62}${wrap(text,24)}`);
  const words=clean(text).split(/\s+/).filter(Boolean),chunks=[];
  for(let i=0;i<words.length;i+=6)chunks.push(words.slice(i,i+6).join(' '));
  const total=Math.max(1,chunks.reduce((sum,c)=>sum+c.length,0));let cursor=0;
  for(const [i,chunk] of chunks.entries()) {
    const end=i===chunks.length-1?duration:cursor+duration*chunk.length/total;
    ass+=event(cursor,end,'Caption',wrap(chunk,30));cursor=end;
  }
  return ass;
}
const detailCrop=focus=>focus==='upper'?'crop=trunc(iw*0.76/2)*2:trunc(ih*0.58/2)*2:trunc(iw*0.12/2)*2:trunc(ih*0.12/2)*2,':focus==='lower'?'crop=trunc(iw*0.82/2)*2:trunc(ih*0.58/2)*2:trunc(iw*0.09/2)*2:trunc(ih*0.42/2)*2,':'';

export async function card(store,{asset=null,title='',detail='',height=H,name='story.jpg',focus='full',poll=false},dir) {
  const id=randomUUID(),out=path.join(dir,id+'.jpg'),sub=path.join(dir,id+'.ass');
  const titleY=height===H?(poll?300:1530):1060,detailY=height===H?1695:1200;
  let ass=assHeader(height)+event(0,1,'Brand',asset?.source==='ai'?'MARYLEE / ІЛЮСТРАЦІЯ ШІ':'MARYLEE SHOP');
  if(title)ass+=event(0,1,'Title',`{\\an8\\pos(540,${titleY})\\fs${title.length>46?50:60}}${wrap(title,28)}`);
  if(detail)ass+=event(0,1,'Title',`{\\an8\\pos(540,${detailY})\\fs38}${wrap(detail,42)}`);
  if(poll) {
    ass+=event(0,1,'Brand','{\\an8\\pos(270,1550)\\fs32}ЛІВИЙ ОБРАЗ');
    ass+=event(0,1,'Brand','{\\an8\\pos(810,1550)\\fs32}ПРАВИЙ ОБРАЗ');
  }
  await writeFile(sub,ass);
  const args=['-y','-filter_threads','1','-threads','1'];
  if(asset)args.push('-i',mediaPath(store,asset.file));else args.push('-f','lavfi','-i',`color=c=0xf4f0e8:s=${W}x${height}:d=1`);
  const filter=asset?`${detailCrop(focus)}scale=${W}:${poll?1060:height-590}:force_original_aspect_ratio=decrease,pad=${W}:${height}:(ow-iw)/2:${poll?'440':'170'}:color=0xf4f0e8,setsar=1`:'null';
  args.push('-vf',`${filter},ass=${sub}`,'-frames:v','1','-q:v','2','-threads','1',out);
  await run('ffmpeg',args);return registerOutput(store,out,{kind:'image',name});
}

// Persist each illustration before voice/render work: retries reuse it for free.
async function editorialAssets(store,ai,plan,item,dir) {
  const selected=item.selectedAssetIds.map(id=>store.get('asset',id)).filter(a=>a&&!a.disabled&&!a.productId&&['ai','editorial'].includes(a.source));
  if(selected.length)return selected;
  if(!item.imagePrompt?.trim())throw new Error('Для корисного Reel потрібні приклади образів. Натисни «Перегенерувати весь матеріал».');
  const signature=createHash('sha256').update(JSON.stringify([item.imagePrompt,item.imageGeneration||0])).digest('hex');
  const cached=getAsset(store,item.illustrationId);
  if(cached&&!cached.disabled&&item.illustrationSignature===signature)return [cached];
  const input=path.join(dir,'looks.png');await writeFile(input,await ai.image(item.imagePrompt,{comparison:true}));
  const image=await saveAsset(store,input,{source:'ai',name:`${plan.id}-${item.id}-образи.png`});
  image.layout='diptych';store.put('asset',image);
  item.illustrationId=image.id;item.illustrationSignature=signature;store.put('plan',plan);
  return [image];
}

export async function renderReel(store,ai,plan,item,dir) {
  if(item.lines.length<2)throw new Error('Спочатку підготуй сценарій: щонайменше два рядки.');
  const product=item.productId?store.get('product',item.productId):null;
  const available=product?productAssets(store,product,{originalOnly:true}):[];
  let selected=product?item.selectedAssetIds.map(id=>available.find(a=>a.id===id)).filter(Boolean):await editorialAssets(store,ai,plan,item,dir);
  if(!selected.length)selected=available.filter(a=>a.kind==='video').slice(0,4);
  if(!selected.length)selected=available.filter(a=>a.kind==='image').slice(0,6);
  if(!selected.length)throw new Error('Для Reel потрібні фото або відео');
  const sale=salesReel(item),withVoice=usesVoice(item,store.settings()),segments=[],srt=[];let offset=0;
  for(let n=0;n<item.lines.length;n++) {
    const text=item.lines[n],voice=withVoice?await ai.voice(text):null;
    const duration=voice?Number((await probe(voice)).format.duration)+.18:sale?(n===item.lines.length-1?4.2:3.6):Math.max(4,Math.min(9,text.split(/\s+/).length/2.7));
    if(!Number.isFinite(duration)||duration<=0||duration>60)throw new Error('Перевір довжину сцени озвучки');
    const sub=path.join(dir,`scene-${n}.ass`),out=path.join(dir,`scene-${n}.mp4`),asset=selected[n%selected.length];
    const title=sale&&product&&n===item.lines.length-1&&product.price!==null?`${product.price} грн${product.sku?' · Арт. '+product.sku:''}`:item.title;
    await writeFile(sub,captionAss(text,duration,{title,sale,scene:n,aiIllustration:asset.source==='ai'}));
    const args=['-y','-filter_threads','1','-filter_complex_threads','1','-threads','1'];
    if(asset.kind==='image')args.push('-loop','1');else args.push('-stream_loop','-1');
    args.push('-i',mediaPath(store,asset.file));
    // Comparison, left outfit, right outfit, comparison. Actual product frames stay whole.
    const crop=asset.layout==='diptych'&&(n===1||n===2)?`crop=iw/2:ih:${n===1?0:'iw/2'}:0,`:'';
    let visual=`${crop}scale=${W}:1350:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:310:color=0xf4f0e8,setsar=1`;
    if(asset.kind==='image')visual+=`,zoompan=z='1.01+0.025*min(on/${Math.max(1,Math.round(duration*FPS)-1)},1)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x${H}:fps=${FPS}`;
    else visual+=`,fps=${FPS}`;
    const videoFilter=`[0:v]${visual},ass=${sub}${n?',fade=t=in:st=0:d=0.12':''}[out]`;
    if(voice)args.push('-i',voice);else args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
    args.push('-filter_complex',videoFilter,'-map','[out]','-map','1:a',...codec,'-c:a','aac','-ar','48000','-ac','2','-b:a','192k','-af','apad','-t',String(duration),'-movflags','+faststart',out);
    await run('ffmpeg',args);segments.push(out);
    srt.push(`${n+1}\n${srtTime(offset)} --> ${srtTime(offset+duration)}\n${text}\n`);offset+=duration;
  }
  const list=path.join(dir,'concat.txt'),output=path.join(dir,'reel.mp4');
  await writeFile(list,segments.map(f=>`file '${f}'`).join('\n'));
  await run('ffmpeg',['-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',output]);
  const video=await registerOutput(store,output,{kind:'video',name:`${item.time.replace(':','-')}-reel.mp4`});
  const subtitlePath=path.join(dir,'subtitles.srt');await writeFile(subtitlePath,srt.join('\n'));
  const subtitle=await registerOutput(store,subtitlePath,{kind:'document',name:`${item.time.replace(':','-')}-subtitles.srt`});
  const cover=await card(store,{asset:selected[0],title:item.title,detail:product&&product.price!==null?`${product.price} грн`:'Два образи · одна зміна',name:'cover.jpg'},dir);
  item.voiceUsed=withVoice;item.duration=offset;item.coverId=cover.id;item.mediaAssetIds=selected.map(a=>a.id);
  item.notes=sale?['Без озвучки. За бажанням додай музику в Instagram або Facebook перед публікацією.']:['Приклади образів створено для поради про стиль.'];
  if(!sale&&!withVoice)item.notes.push('Озвучку порад вимкнено в налаштуваннях.');
  item.outputIds=[video.id,subtitle.id];return item;
}
const srtTime=s=>{const ms=Math.round(s*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};

export async function renderCarousel(store,plan,item,dir,provided=null) {
  const product=item.productId?store.get('product',item.productId):null;
  const available=provided||(product?productAssets(store,product,{originalOnly:true}):[getAsset(store,plan.items.find(i=>i.id==='morning')?.illustrationId)].filter(Boolean));
  let photos=item.selectedAssetIds.map(id=>available.find(a=>a.id===id)).filter(Boolean);
  if(!photos.length)photos=available.filter(a=>a.kind==='image').slice(0,6);
  if(!photos.length&&available.some(a=>a.kind==='video'))photos=available.filter(a=>a.kind==='video').slice(0,1);
  if(!photos.length)throw new Error('Додай фото для каруселі або спочатку підготуй ранкову ілюстрацію');
  const outputs=[];
  for(const [n,asset] of photos.slice(0,6).entries()) {
    const out=path.join(dir,`photo-${n}.jpg`);
    await run('ffmpeg',['-y','-filter_threads','1','-threads','1','-i',mediaPath(store,asset.file),'-frames:v','1','-vf','scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=0xf4f0e8','-q:v','2','-threads','1',out]);
    outputs.push((await registerOutput(store,out,{kind:'image',name:`${item.time.replace(':','-')}-${n+1}.jpg`})).id);
  }
  item.notes=[`Відібрано ${photos.length} кадрів із ${available.length} доступних.`];
  item.mediaAssetIds=photos.map(a=>a.id);item.outputIds=outputs;item.coverId=outputs[0];return item;
}
export async function renderItem(store,ai,plan,item) {
  const dir=path.join(store.dir,'work',randomUUID());await mkdir(dir,{recursive:true});
  try {
    if(item.purpose==='repost') {
      const parent=plan.items.find(i=>i.id===item.dependsOn);
      if(!parent?.outputIds.length)throw new Error('Спочатку підготуй матеріал, який потрібно поширити');
      item.outputIds=[...parent.outputIds];item.coverId=parent.coverId;item.parentKind=parent.kind;
    } else if(item.kind==='reel')await renderReel(store,ai,plan,item,dir);
    else if(item.kind==='carousel')await renderCarousel(store,plan,item,dir);
    else {
      const product=item.productId?store.get('product',item.productId):null;
      const assets=product?productAssets(store,product,{originalOnly:true}):[];
      const morning=plan.items.find(i=>i.id==='morning');
      const asset=product?(item.selectedAssetIds.map(id=>assets.find(a=>a.id===id)).find(Boolean)||assets[0]):getAsset(store,morning?.illustrationId)||getAsset(store,morning?.mediaAssetIds?.[0]);
      if(item.purpose==='poll'&&!asset)throw new Error('Спочатку підготуй приклади образів у ранковому Reel');
      const detail=product&&product.price!==null?`${product.price} грн${product.sku?' · Арт. '+product.sku:''}`:item.purpose==='poll'?'':item.caption;
      const output=await card(store,{asset,title:item.purpose==='poll'?item.pollQuestion:item.title,detail,poll:item.purpose==='poll',focus:item.purpose==='detail'?item.detailFocus||'upper':'full',name:`${item.time.replace(':','-')}-story.jpg`},dir);
      item.outputIds=[output.id];item.coverId=output.id;item.mediaAssetIds=asset?[asset.id]:[];
      item.notes=item.purpose==='detail'&&item.detailFocus!=='full'?['Збільшено фрагмент оригінального фото товару.']:[];
    }
    item.status='ready';item.error=null;item.renderedAt=new Date().toISOString();item.renderedRevision=item.revision;return item;
  } finally {await rm(dir,{recursive:true,force:true});}
}
