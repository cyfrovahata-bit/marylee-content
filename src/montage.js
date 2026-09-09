// Video normalization and ASS timing adapted from tiktok-chanel's montage/captions pipeline.
// Full product frame is preserved with padding. No publisher or Telegram imports.
import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run, probe, mediaPath, registerOutput } from './files.js';
import { productAssets } from './catalog.js';
import { factBlock } from './ai.js';

const W=1080,H=1920,FPS=25;
const FONT='DejaVu Sans';
const codec=['-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-r',String(FPS),'-g','50','-keyint_min','50','-sc_threshold','0','-threads','2'];
const clean=s=>String(s).replace(/[{}\\]/g,'').replace(/[\r\n]+/g,' ').trim();
function stamp(seconds) {const cs=Math.round(seconds*100),s=Math.floor(cs/100);return `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;}
function wrap(text,width=30) {
  const lines=[''];for(const word of clean(text).split(/\s+/)) {if(lines.at(-1).length+word.length>width&&lines.at(-1))lines.push('');lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}
  return lines.join('\\N');
}
function assHeader(height=H) { return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${height}\nWrapStyle: 2\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,${FONT},54,&H00FFFFFF,&H00FFFFFF,&H601C3025,&H601C3025,0,0,0,0,100,100,0,0,3,10,0,2,90,90,320,1\nStyle: Title,${FONT},68,&H0024382B,&H0024382B,&H00F4F0E8,&H00F4F0E8,-1,0,0,0,100,100,0,0,1,0,0,8,85,85,200,1\nStyle: Brand,${FONT},28,&H0024382B,&H0024382B,&H00F4F0E8,&H00F4F0E8,0,0,0,0,100,100,4,0,1,0,0,8,50,50,90,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`; }
function lineEvent(start,end,style,text) { return `Dialogue: 0,${stamp(start)},${stamp(end)},${style},,0,0,0,,${text}\n`; }
function captionAss(text,duration,{title='',height=H}={}) {
  let ass=assHeader(height)+lineEvent(0,duration,'Brand','MARYLEE  /  СТИЛЬ У ДЕТАЛЯХ');
  if(title) ass+=lineEvent(0,duration,'Title',wrap(title,25));
  const words=clean(text).split(/\s+/).filter(Boolean),chunks=[];
  for(let i=0;i<words.length;i+=6) chunks.push(words.slice(i,i+6).join(' '));
  const total=Math.max(1,chunks.join('').length);let cursor=0;
  for(const chunk of chunks) {const end=cursor+duration*chunk.length/total;ass+=lineEvent(cursor,Math.min(duration,end),'Caption',wrap(chunk,30));cursor=end;}
  return ass;
}
export async function card(store,{asset=null,title='',detail='',height=1920,name='story.jpg'},dir) {
  const id=randomUUID(),out=path.join(dir,id+'.jpg'),sub=path.join(dir,id+'.ass');
  let ass=assHeader(height).replace(`${FONT},68,`,`${FONT},${title.length>65?44:60},`).replace(',90,90,320,1',',90,90,170,1')+lineEvent(0,1,'Brand','MARYLEE SHOP');
  if(title)ass+=lineEvent(0,1,'Title',wrap(title,25));
  if(detail)ass+=lineEvent(0,1,'Caption',wrap(detail,30));
  await writeFile(sub,ass);
  const args=['-y','-filter_threads','1','-threads','1'];
  if(asset) args.push('-i',mediaPath(store,asset.file));else args.push('-f','lavfi','-i',`color=c=0xf4f0e8:s=${W}x${height}:d=1`);
  const filter=asset?`scale=940:${height-950}:force_original_aspect_ratio=decrease,pad=${W}:${height}:(ow-iw)/2:430:color=0xf4f0e8`:
    `drawbox=x=130:y=${Math.round(height*.37)}:w=580:h=${Math.round(height*.12)}:color=0xd5c3ad:t=fill,drawbox=x=370:y=${Math.round(height*.51)}:w=580:h=${Math.round(height*.12)}:color=0x657e91:t=fill,drawbox=x=630:y=${Math.round(height*.65)}:w=210:h=${Math.round(height*.085)}:color=0x7e3b47:t=fill`;
  args.push('-vf',`${filter},ass=${sub}`,'-frames:v','1','-q:v','2','-threads','1',out);
  await run('ffmpeg',args);
  return registerOutput(store,out,{kind:'image',name});
}
function diagramInput(topic,index,duration) {
  const palettes=[['d5c3ad','657e91','7e3b47'],['ece5d9','475b50','bc7658'],['bfcbd2','745b4d','f4f0e8']];
  const p=palettes[index%palettes.length];
  const args=['-f','lavfi','-i',`color=c=0xf4f0e8:s=${W}x${H}:r=${FPS}:d=${duration}`];
  const colors=topic.mode==='proportion'?[p[0],p[1],p[1]]:p;
  const sizes=topic.mode==='proportion'?[[380,300+index%3*55],[175,470-index%3*55],[175,470-index%3*55]]:[[610,250],[440,230],[220,170]];
  for(let i=0;i<3;i++)args.push('-f','lavfi','-i',`color=c=0x${colors[i]}:s=${sizes[i][0]}x${sizes[i][1]}:r=${FPS}:d=${duration}`);
  const y=topic.mode==='proportion'?[670,975+index%3*55,975+index%3*55]:[680,960,1220];
  const x=topic.mode==='proportion'?[350,350,555]:[235,320,430];
  const filters=[];let prev='0:v';
  for(let i=0;i<3;i++){filters.push(`[${prev}][${i+1}:v]overlay=x='${x[i]}+120*max(0,1-t/0.7)':y=${y[i]}:shortest=1[d${i}]`);prev=`d${i}`;}
  return {args,filter:filters.join(';'),label:prev};
}
export async function renderReel(store,ai,plan,item,dir) {
  if(item.lines.length<2)throw new Error('Спочатку підготуй або введи сценарій озвучки: щонайменше два рядки.');
  const product=item.productId?store.get('product',item.productId):null;
  const available=product?productAssets(store,product,{originalOnly:true}):[];
  let selected=item.selectedAssetIds.map(id=>store.get('asset',id)).filter(a=>a && (product?a.productId===product.id&&a.source==='original':!a.productId));
  if(!selected.length) selected=available.filter(a=>a.kind==='video').slice(0,4);
  if(!selected.length) selected=available.filter(a=>a.kind==='image').slice(0,6);
  if(product&&!selected.length)throw new Error('Для товарного Reel потрібне фото або відео товару');
  if(!product&&selected.length&&selected.every(a=>a.kind==='image')) {
    item.kind='carousel';item.notes=['Є лише статичні ілюстрації: підготовано карусель.'];
    return renderCarousel(store,plan,item,dir,selected);
  }
  const withVoice=store.settings().voiceEnabled,segments=[],srt=[];let offset=0;
  for(let n=0;n<item.lines.length;n++) {
    const text=item.lines[n];
    const voice=withVoice?await ai.voice(text):null;
    const duration=voice?Number((await probe(voice)).format.duration)+.35:Math.max(3,Math.min(10,text.split(/\s+/).length/2.6));
    if(!Number.isFinite(duration)||duration<=0)throw new Error('Не вдалося визначити тривалість озвучки');
    if(duration>60)throw new Error('Одна сцена довша за хвилину. Скороти рядок озвучки.');
    const sub=path.join(dir,`scene-${n}.ass`),out=path.join(dir,`scene-${n}.mp4`);
    await writeFile(sub,captionAss(text,duration,{title:!selected.length?(n===0?item.title:plan.topic.title):''}));
    const args=['-y','-filter_threads','1','-filter_complex_threads','1','-threads','1'];
    let videoFilter,audioIndex;
    if(selected.length) {
      const asset=selected[n%selected.length];
      if(asset.kind==='image')args.push('-loop','1');else args.push('-stream_loop','-1');
      args.push('-i',mediaPath(store,asset.file));
      videoFilter=`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0xf4f0e8,setsar=1,fps=${FPS},ass=${sub}[out]`;
      audioIndex=1;
    } else {
      const graphic=diagramInput(plan.topic,n,duration);args.push(...graphic.args);audioIndex=4;
      videoFilter=graphic.filter+`;[${graphic.label}]ass=${sub}[out]`;
    }
    if(voice)args.push('-i',voice);else args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
    args.push('-filter_complex',videoFilter,'-map','[out]','-map',`${audioIndex}:a`,...codec,'-c:a','aac','-ar','48000','-ac','2','-b:a','192k','-af','apad','-t',String(duration),'-movflags','+faststart',out);
    await run('ffmpeg',args);segments.push(out);
    srt.push(`${n+1}\n${srtTime(offset)} --> ${srtTime(offset+duration)}\n${text}\n`);offset+=duration;
  }
  const list=path.join(dir,'concat.txt'),output=path.join(dir,'reel.mp4');
  await writeFile(list,segments.map(f=>`file '${f}'`).join('\n'));
  await run('ffmpeg',['-y','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',output]);
  const video=await registerOutput(store,output,{kind:'video',name:`${item.time.replace(':','-')}-reel.mp4`});
  const subtitlePath=path.join(dir,'subtitles.srt');await writeFile(subtitlePath,srt.join('\n'));
  const subtitle=await registerOutput(store,subtitlePath,{kind:'document',name:`${item.time.replace(':','-')}-subtitles.srt`});
  const cover=await card(store,{asset:selected[0]||null,title:item.title,detail:product&&product.price!==null?`${product.price} грн`:'',name:'cover.jpg'},dir);
  item.voiceUsed=withVoice;item.duration=offset;item.coverId=cover.id;
  item.notes=selected.length&&selected.every(a=>a.kind==='image')?['Відеослайд із фото для продажу. Не розраховуй на монетизацію цього формату.']:!selected.length?['Авторська анімована схема. Монетизацію визначає Meta.']:[];
  if(!withVoice)item.notes.push('Зібрано без озвучки: звук вимкнено в налаштуваннях.');
  item.outputIds=[video.id,subtitle.id];return item;
}
const srtTime=s=>{const ms=Math.round(s*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
export async function renderCarousel(store,plan,item,dir,provided=null) {
  const product=item.productId?store.get('product',item.productId):null;
  const available=provided|| (product?productAssets(store,product,{originalOnly:true}):[]);
  let photos=item.selectedAssetIds.map(id=>available.find(a=>a.id===id)).filter(Boolean);
  if(!photos.length)photos=available.filter(a=>a.kind==='image').slice(0,6);
  if(!photos.length&&available.some(a=>a.kind==='video'))photos=available.filter(a=>a.kind==='video').slice(0,1);
  const outputs=[];
  if(photos.length) {
    for(const [n,asset] of photos.slice(0,6).entries()) {
      const out=path.join(dir,`photo-${n}.jpg`);
      await run('ffmpeg',['-y','-filter_threads','1','-threads','1','-i',mediaPath(store,asset.file),'-frames:v','1','-vf','scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=0xf4f0e8','-q:v','2','-threads','1',out]);
      outputs.push((await registerOutput(store,out,{kind:'image',name:`${item.time.replace(':','-')}-${n+1}.jpg`})).id);
    }
    item.notes=photos.length<4?[`Доступно ${photos.length} фото. Можна опублікувати цей набір або додати ще ракурси.`]:[];
  } else {
    const texts=item.lines.length?item.lines:[plan.topic.title,plan.topic.brief,item.caption];
    for(const text of texts.slice(0,6)) outputs.push((await card(store,{title:item.title,detail:text,height:1350,name:`guide-${outputs.length+1}.jpg`},dir)).id);
  }
  item.outputIds=outputs;item.coverId=outputs[0];return item;
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
      const asset=assets.find(a=>item.selectedAssetIds.includes(a.id))||assets[item.purpose==='detail'?Math.min(1,assets.length-1):0]||null;
      const detail=item.purpose==='poll'?'Додай опитування у сторіз':product?factBlock(product).split('\n').slice(1,4).join(' · '):item.caption;
      const output=await card(store,{asset,title:item.title,detail:item.purpose==='poll'?'':detail,name:`${item.time.replace(':','-')}-story.jpg`},dir);
      item.outputIds=[output.id];item.coverId=output.id;
    }
    item.status='ready';item.renderedAt=new Date().toISOString();item.renderedRevision=item.revision;return item;
  } finally {await rm(dir,{recursive:true,force:true});}
}
