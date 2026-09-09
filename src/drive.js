// Isolated Google Drive adapter. OAuth variables match the source application's format.
// Every read/write is confined to the explicitly allowed YouTube Storis subtree.
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { YOUTUBE_STORIS_FOLDER } from './config.js';
import { boundedDownload, saveAsset } from './files.js';
import { cleanProduct } from './catalog.js';

const BASE='https://www.googleapis.com/drive/v3';
const FOLDER='application/vnd.google-apps.folder';
const fields='id,name,mimeType,parents,size,modifiedTime,appProperties,trashed';
const safeId=id=>{if(!/^[a-zA-Z0-9_-]{5,150}$/.test(id))throw new Error('Некоректний ідентифікатор Drive');return id;};
const qstr=s=>String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

export class Drive {
  constructor(config,store,fetcher=fetch) {this.c=config;this.store=store;this.fetch=fetcher;this.token=null;}
  configured() {return Boolean(this.c.driveParent&&this.c.googleClient&&this.c.googleSecret&&this.c.googleRefresh);}
  async accessToken() {
    if(this.token&&this.token.expires>Date.now()+60000)return this.token.value;
    if(!this.configured())throw new Error('Заповни Google OAuth і MARYLEE_DRIVE_PARENT_ID у Variables другого сервісу.');
    const res=await this.fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.c.googleClient,client_secret:this.c.googleSecret,refresh_token:this.c.googleRefresh,grant_type:'refresh_token'}),signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw new Error(`Google OAuth: ${res.status}. Перевір змінні доступу.`);
    const data=await res.json();if(!data.access_token)throw new Error('Google не повернув токен');
    this.token={value:data.access_token,expires:Date.now()+(data.expires_in||3600)*1000};return this.token.value;
  }
  async request(url,options={}) {
    const u=new URL(url);
    if(u.origin!=='https://www.googleapis.com')throw new Error('Непідтримувана адреса Drive');
    const res=await this.fetch(url,{...options,headers:{Authorization:`Bearer ${await this.accessToken()}`,...options.headers},signal:AbortSignal.timeout(240000)});
    if(!res.ok)throw new Error(`Google Drive: ${res.status}. Перевір доступ і вільне місце.`);
    return res;
  }
  async meta(id) {return (await this.request(`${BASE}/files/${safeId(id)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`)).json();}
  async scoped(id) {
    if(this.c.driveParent!==YOUTUBE_STORIS_FOLDER)throw new Error('Drive Marylee не налаштований або вибрано іншу папку');
    let current=safeId(id),first;
    for(let n=0;n<12;n++) {
      const meta=await this.meta(current);first??=meta;
      if(meta.trashed)throw new Error('Файл Drive у кошику');
      if(current===YOUTUBE_STORIS_FOLDER) return first;
      if(!meta.parents?.length)break;current=meta.parents[0];
    }
    throw new Error('Операцію заблоковано: файл поза YouTube Storis');
  }
  async children(parent) {
    await this.scoped(parent);let page='',files=[];
    do {
      const q=`'${safeId(parent)}' in parents and trashed = false`;
      const res=await this.request(`${BASE}/files?${new URLSearchParams({q,fields:`nextPageToken,files(${fields})`,pageSize:'100',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(page?{pageToken:page}:{})})}`);
      const data=await res.json();files.push(...data.files);page=data.nextPageToken||'';
      if(files.length>3000)throw new Error('Забагато файлів в одній папці. Розділи товари на окремі підпапки.');
    } while(page);
    return files;
  }
  async folder(parent,name,key) {
    const children=await this.children(parent);
    const found=children.find(f=>f.mimeType===FOLDER&&f.appProperties?.maryleeKey===key);
    if(found)return found.id;
    // These requests are sequential in the single persistent job worker.
    const res=await this.request(`${BASE}/files?fields=id&supportsAllDrives=true`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:FOLDER,parents:[parent],appProperties:{marylee:'1',maryleeKey:key}})});
    return (await res.json()).id;
  }
  async setup() {
    const root=await this.folder(this.c.driveParent,'Marylee Content','root');
    const input=await this.folder(root,'Товари','input'),output=await this.folder(root,'Готове','output');
    const result={id:'drive',root,input,output};this.store.put('integration',result);return result;
  }
  async upload(parent,name,filename,mime,key) {
    await this.scoped(parent);
    const children=await this.children(parent),existing=children.find(f=>f.appProperties?.maryleeKey===key);
    if(existing && existing.appProperties?.marylee!=='1')throw new Error('Файл не належить Marylee');
    const size=(await stat(filename)).size;
    const url=`https://www.googleapis.com/upload/drive/v3/files${existing?'/'+safeId(existing.id):''}?uploadType=resumable&supportsAllDrives=true&fields=id,name`;
    const initial=await this.request(url,{method:existing?'PATCH':'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':mime,'X-Upload-Content-Length':String(size)},body:JSON.stringify({name,mimeType:mime,...(!existing?{parents:[parent]}:{}),appProperties:{marylee:'1',maryleeKey:key}})});
    const session=initial.headers.get('location');if(!session)throw new Error('Drive не повернув адресу завантаження');
    const res=await this.request(session,{method:'PUT',headers:{'Content-Type':mime,'Content-Length':String(size)},body:createReadStream(filename),duplex:'half'});
    return res.json();
  }
  async download(meta,target,limit) {
    await this.scoped(meta.id);
    if(Number(meta.size)>limit)throw new Error(`Файл ${meta.name} завеликий`);
    const res=await this.request(`${BASE}/files/${safeId(meta.id)}?alt=media&supportsAllDrives=true`);
    await boundedDownload(Readable.fromWeb(res.body),target,limit);
  }
  async importProducts(progress=()=>{}) {
    const roots=await this.setup();
    const folders=(await this.children(roots.input)).filter(f=>f.mimeType===FOLDER);
    if(folders.length>300)throw new Error('За один імпорт підтримується до 300 товарів');
    let imported=0,waiting=0;
    for(const folder of folders) {
      const files=await this.children(folder.id);
      const latest=Math.max(...files.map(f=>Date.parse(f.modifiedTime)),0);
      if(!files.length||Date.now()-latest<600000) {waiting++;continue;}
      progress(`Імпорт: ${folder.name}`);
      const old=this.store.list('product').find(p=>p.driveFolderId===folder.id);
      const descriptor=files.find(f=>f.name==='product.json')||files.find(f=>/^(опис|description)\.txt$/i.test(f.name));
      let input=old?{}:{name:folder.name};
      if(descriptor&&old?.driveDescriptorVersion!==descriptor.modifiedTime) {
        const temp=path.join(this.store.dir,'work',randomUUID()+'.txt');
        try {
          await this.download(descriptor,temp,64000);const text=await readFile(temp,'utf8');
          input=descriptor.name==='product.json'?JSON.parse(text):{name:folder.name,description:text};
          if(typeof input!=='object'||Array.isArray(input)||!input)throw new Error('product.json має містити об’єкт товару');
          if(!input.name)input.name=old?.name||folder.name;
        }finally {await rm(temp,{force:true});}
      }
      let product=cleanProduct({...input,ready:false},old||{});
      product.driveFolderId=folder.id;product.driveDescriptorVersion=descriptor?.modifiedTime||'';
      this.store.put('product',product);
      const media=files.filter(f=>/\.(jpe?g|png|webp|mp4|mov|webm)$/i.test(f.name));
      if(media.length>40)throw new Error(`Товар ${folder.name}: залиш до 40 медіафайлів`);
      for(const file of media) {
        const previous=this.store.list('asset').find(a=>a.productId===product.id&&a.driveId===file.id&&!a.disabled);
        if(previous?.driveVersion===file.modifiedTime)continue;
        const temp=path.join(this.store.dir,'work',randomUUID()+path.extname(file.name).toLowerCase());
        try {
          await this.download(file,temp,this.c.maxUploadBytes);
          const asset=await saveAsset(this.store,temp,{name:file.name,productId:product.id,driveId:file.id});
          asset.driveVersion=file.modifiedTime;this.store.put('asset',asset);
          if(previous&&previous.id!==asset.id)this.store.put('asset',{...previous,disabled:true});
        }finally{await rm(temp,{force:true});}
      }
      const present=new Set(media.map(f=>f.id));
      for(const a of this.store.list('asset').filter(a=>a.productId===product.id&&a.driveId&&!present.has(a.driveId)))this.store.put('asset',{...a,disabled:true});
      product.ready=media.length>0;this.store.put('product',product);imported++;
    }
    return {imported,waiting,folderUrl:`https://drive.google.com/drive/folders/${roots.input}`};
  }
}
