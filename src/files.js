import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const exec=promisify(execFile);
export const MIME={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mp3':'audio/mpeg','.srt':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8','.json':'application/json','.zip':'application/zip'};
export async function run(command,args,{cwd,timeout=600000}={}) {
  try { return await exec(command,args,{cwd,timeout,maxBuffer:4*1024*1024}); }
  catch(error) { const e=new Error(command==='ffmpeg'?'Не вдалося змонтувати медіа. Перевір формат і справність файлу.':`Помилка ${command}`); e.cause=error; throw e; }
}
export function mediaPath(store,file) {
  if(!/^[a-f0-9-]+\.[a-z0-9]+$/.test(file)) throw new Error('Некоректний файл');
  return path.join(store.dir,'media',file);
}
export async function probe(file) {
  const {stdout}=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{timeout:30000});
  return JSON.parse(stdout);
}
export async function hashFile(file) {
  const h=createHash('sha256'); for await(const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex');
}
export async function boundedDownload(readable,filename,limit) {
  let n=0;
  try { await pipeline(readable,new Transform({transform(chunk,_,cb){n+=chunk.length;cb(n>limit?new Error('Файл завеликий'):null,chunk);}}),createWriteStream(filename,{flags:'wx'})); }
  catch(e) { await rm(filename,{force:true});throw e; }
  return n;
}
export async function saveAsset(store, file, {name, productId=null, source='original', driveId=null}) {
  const ext=path.extname(name).toLowerCase();
  if(!['.jpg','.jpeg','.png','.webp','.mp4','.mov','.webm'].includes(ext)) throw new Error('Підтримуються JPG, PNG, WebP, MP4, MOV і WebM');
  const size=(await stat(file)).size;
  if(size>200*1024*1024 || !size) throw new Error('Файл має бути від 1 байта до 200 МБ');
  const info=await probe(file), video=info.streams.find(s=>s.codec_type==='video');
  if(!video || video.width<64 || video.height<64 || video.width*video.height>50000000) throw new Error('Непідтримуваний розмір зображення або відео');
  const kind=ext.match(/\.(mp4|mov|webm)$/)?'video':'image';
  if(kind==='image'&&!['mjpeg','png','webp'].includes(video.codec_name))throw new Error('Вміст файлу не відповідає формату фото');
  const duration=kind==='video'?Number(info.format.duration):0;
  if(kind==='video' && (!Number.isFinite(duration)||duration<.2||duration>600)) throw new Error('Відео має тривати від 0,2 секунди до 10 хвилин');
  const hash=await hashFile(file);
  const duplicate=store.list('asset').find(a=>a.productId===productId && a.hash===hash);
  if(duplicate) { await rm(file,{force:true});return store.put('asset',{...duplicate,disabled:false,...(driveId?{driveId}:{})}); }
  const id=randomUUID(), stored=id+ext;
  // JPEG originals use a separate thumbnail id.
  const thumbnail=randomUUID()+'.jpg';
  await rename(file,mediaPath(store,stored));
  try {
    await run('ffmpeg',['-y','-threads','1','-i',mediaPath(store,stored),'-frames:v','1','-vf','scale=420:560:force_original_aspect_ratio=decrease,pad=420:560:(ow-iw)/2:(oh-ih)/2:color=0xf4f0e8','-threads','1',mediaPath(store,thumbnail)],{timeout:60000});
  } catch(e) { await rm(mediaPath(store,stored),{force:true});throw e; }
  const asset={id,file:stored,thumbnail,name:path.basename(name).slice(0,160),kind,mime:MIME[ext],size,width:video.width,height:video.height,duration,hash,source,productId,driveId,createdAt:new Date().toISOString()};
  store.put('asset',asset);
  return asset;
}
export async function registerOutput(store,file,{kind,name,source='rendered'}) {
  const id=randomUUID(),ext=path.extname(file),stored=id+ext;
  await rename(file,mediaPath(store,stored));
  return store.put('asset',{id,file:stored,name,kind,mime:MIME[ext]||'application/octet-stream',size:(await stat(mediaPath(store,stored))).size,source,productId:null,createdAt:new Date().toISOString()});
}
export async function atomicJson(filename,value) { const temp=filename+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,filename); }
export async function exists(filename) { try { return (await stat(filename)).isFile(); } catch { return false; } }
