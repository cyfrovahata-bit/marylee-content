// Deliberately small ZIP protocol: flat filenames, 1 manifest, at most 4 images.
// Validate the central directory before inflating and never extract filesystem paths.
import { inflateRawSync } from 'node:zlib';
const fail=()=>{throw new Error('Некоректний ZIP. Потрібні manifest.json і тільки зображення з цього завдання.');};
function crc32(buf){let c=0xffffffff;for(const v of buf){c^=v;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export function readBundle(zip,job) {
  if(zip.length>50*1024*1024||zip.length<22)fail();
  let e=-1;for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50&&i+22+zip.readUInt16LE(i+20)===zip.length){e=i;break;}
  if(e<0||zip.readUInt16LE(e+4)||zip.readUInt16LE(e+6))fail();
  const count=zip.readUInt16LE(e+10),size=zip.readUInt32LE(e+12),offset=zip.readUInt32LE(e+16);
  if(count<2||count>5||zip.readUInt16LE(e+8)!==count||offset+size!==e)fail();
  let at=offset,total=0;const files=new Map();
  for(let n=0;n<count;n++) {
    if(at+46>e||zip.readUInt32LE(at)!==0x02014b50)fail();
    const flags=zip.readUInt16LE(at+8),method=zip.readUInt16LE(at+10),crc=zip.readUInt32LE(at+16),compressed=zip.readUInt32LE(at+20),length=zip.readUInt32LE(at+24),nl=zip.readUInt16LE(at+28),el=zip.readUInt16LE(at+30),cl=zip.readUInt16LE(at+32),local=zip.readUInt32LE(at+42),mode=(zip.readUInt32LE(at+38)>>>16)&0xf000;
    if(at+46+nl+el+cl>e||flags&1||![0,8].includes(method)||![0,0x8000].includes(mode)||length>12*1024*1024||(total+=length)>45*1024*1024)fail();
    const name=zip.subarray(at+46,at+46+nl).toString('utf8');
    if(!/^(manifest\.json|[a-z0-9_-]+\.(png|jpg|jpeg|webp))$/.test(name)||files.has(name)||(name==='manifest.json'&&length>32000))fail();
    if(local+30>offset||zip.readUInt32LE(local)!==0x04034b50||zip.readUInt16LE(local+8)!==method||zip.readUInt16LE(local+6)!==flags)fail();
    const lnl=zip.readUInt16LE(local+26),lel=zip.readUInt16LE(local+28),start=local+30+lnl+lel;
    if(start+compressed>offset||zip.subarray(local+30,local+30+lnl).toString('utf8')!==name)fail();
    const data=zip.subarray(start,start+compressed),out=method===8?inflateRawSync(data,{maxOutputLength:Math.max(1,length)}):data;
    if(out.length!==length||crc32(out)!==crc)fail();files.set(name,out);at+=46+nl+el+cl;
  }
  if(at!==e||!files.has('manifest.json'))fail();
  let m;try{m=JSON.parse(files.get('manifest.json').toString('utf8'));}catch{fail();}
  if(!m||typeof m!=='object')fail();
  if(m.version!==1||m.job_id!==job.id||m.generation!==job.generation||m.date!==job.date||m.kind!==job.kind)throw new Error('ZIP належить іншому або застарілому завданню');
  const required=job.kind==='reel-tip'?4:1;
  if(!Array.isArray(m.images)||m.images.length!==required||new Set(m.images).size!==required||m.images.some(n=>n==='manifest.json'||!files.has(n))||files.size!==required+1)fail();
  if(!m.fact_check||m.fact_check.status!=='checked'||!['editorial','factual'].includes(m.fact_check.type)||typeof m.fact_check.note!=='string'||m.fact_check.note.length>2000)throw new Error('У manifest.json потрібен результат перевірки сюжету');
  const sources=m.fact_check.sources;
  if(!Array.isArray(sources)||sources.length>5||sources.some(s=>typeof s.url!=='string'||!/^https:\/\//.test(s.url)||typeof s.claim!=='string'||s.claim.length>600))fail();
  if(m.fact_check.type==='factual'&&(sources.length<2||!sources.some(s=>s.primary===true)))throw new Error('Фактичні твердження потребують двох джерел, зокрема першоджерела');
  if(job.kind==='reel-tip'){
    if(typeof m.title!=='string'||!m.title.trim()||m.title.length>58||!Array.isArray(m.lines)||m.lines.length!==4||m.lines.some(t=>typeof t!=='string'||t.trim().length<8||t.length>180))throw new Error('Для Reel потрібні заголовок і 4 короткі перевірені сцени українською');
  }else if(typeof m.poll_question!=='string'||!m.poll_question.trim()||m.poll_question.length>42||!Array.isArray(m.poll_options)||m.poll_options.length!==2||m.poll_options.some(t=>typeof t!=='string'||!t.trim()||t.length>24))throw new Error('Для опитування потрібні запитання й два короткі варіанти');
  return {manifest:m,images:m.images.map(name=>({name,bytes:files.get(name)}))};
}
