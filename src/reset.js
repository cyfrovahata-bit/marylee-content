import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { ContentQueue } from './queue.js';
const KINDS=['product','asset','plan','archived-plan','copy-history','image-job','drive-export','schedule','notice'];
const DIRS=['media','work','cache','exports'];
// Recoverable local trash. Credentials, integration ids, and usage accounting
// stay in the live database. Only this application's four content dirs move.
export async function resetContent(store,drive) {
  const id=randomUUID(),folder=path.join(store.dir,'trash',id),docs=KINDS.flatMap(kind=>store.list(kind).map(value=>({kind,value})));
  await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'snapshot.json'),JSON.stringify(docs));
  const queue=new ContentQueue(store,drive),roots=store.get('integration','drive');let driveTrashed=0;
  if(drive.configured()&&roots){
    if(queue.configured()){
      const ids=new Set(store.list('image-job').map(j=>j.id));
      for(const row of await queue.rows())if(ids.has(row.v[0]))await drive.sheet(`A${row.row}:L${row.row}`,[Array(12).fill('')]);
    }
    for(const key of ['input','output','briefs','results'])if(roots[key])driveTrashed+=await drive.trashChildren(roots[key]);
  }
  const moved=[];
  try{
    for(const name of DIRS){await rename(path.join(store.dir,name),path.join(folder,name));moved.push(name);await mkdir(path.join(store.dir,name));}
    store.transaction(()=>{
      for(const kind of KINDS)store.db.prepare('DELETE FROM docs WHERE kind=?').run(kind);
      store.db.exec('DELETE FROM jobs');
      store.setSettings({autoPrepare:false,driveAutoImport:false});
      store.put('reset',{id,createdAt:new Date().toISOString(),products:docs.filter(d=>d.kind==='product').length,assets:docs.filter(d=>d.kind==='asset').length,driveTrashed,status:'complete'});
    });
  }catch(e){for(const name of moved.reverse()){await rm(path.join(store.dir,name),{recursive:true,force:true});await rename(path.join(folder,name),path.join(store.dir,name));}throw e;}
  return store.get('reset',id);
}
export async function restoreContent(store,id) {
  const reset=store.get('reset',id);if(!reset||reset.status!=='complete')throw new Error('Немає очищення для відновлення');
  if(['product','plan','asset'].some(k=>store.list(k).length))throw new Error('Відновлення можливе лише до завантаження нового контенту');
  for(const name of DIRS)if((await readdir(path.join(store.dir,name))).length)throw new Error('Уже є нові файли. Відновлення зупинено, щоб їх зберегти.');
  const folder=path.join(store.dir,'trash',id),docs=JSON.parse(await readFile(path.join(folder,'snapshot.json'),'utf8'));
  for(const name of DIRS){await rm(path.join(store.dir,name),{recursive:true});await rename(path.join(folder,name),path.join(store.dir,name));}
  store.transaction(()=>{for(const {kind,value} of docs)if(KINDS.includes(kind))store.put(kind,value);store.put('reset',{...reset,status:'restored'});});
  return {restored:true,message:'Матеріали додатка відновлено. Файли Drive можна повернути з кошика Google Drive.'};
}
