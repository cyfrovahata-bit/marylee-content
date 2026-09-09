import { mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run, mediaPath } from './files.js';
import { captionFor } from './ai.js';
import { itemInstruction } from './planner.js';

export async function exportDay(store,date) {
  const plan=store.get('plan',date);
  if(!plan)throw new Error('Плану на цю дату немає');
  if(plan.items.some(i=>!['ready','posted','skipped'].includes(i.status)))throw new Error('Спочатку заверши підготовку матеріалів або пропусти непотрібний слот');
  const dir=path.join(store.dir,'work',randomUUID());await mkdir(dir,{recursive:true});
  const filename=path.join(store.dir,'exports',`marylee-${date}-${randomUUID()}.zip`);
  try {
    let guide=`MARYLEE SHOP · ${date}\nЧас: Europe/Kyiv. Публікуєш вручну.\n\n`;
    for(const item of plan.items) {
      guide+=`${item.time} — ${item.label}${item.status==='skipped'?' (пропущено)':''}\n${itemInstruction(item)}\n${(item.notes||[]).join('\n')}\n\n`;
      if(item.status==='skipped')continue;
      const target=path.join(dir,item.time.replace(':','-')+'-'+item.id);await mkdir(target);
      await writeFile(path.join(target,'text.txt'),captionFor(item,store));
      await writeFile(path.join(target,'instructions.txt'),itemInstruction(item)+(item.pollQuestion?`\n\n${item.pollQuestion}\n${item.pollOptions.join('\n')}`:''));
      if(item.lines.length)await writeFile(path.join(target,'voice-script.txt'),item.lines.join('\n'));
      for(const [n,id] of [...new Set([...item.outputIds,item.coverId].filter(Boolean))].entries()) {
        const asset=store.get('asset',id);if(!asset)throw new Error('Не знайдено готовий файл. Перемонтуй матеріал.');
        await copyFile(mediaPath(store,asset.file),path.join(target,(id===item.coverId?'cover':String(n+1).padStart(2,'0'))+path.extname(asset.file)));
      }
    }
    await writeFile(path.join(dir,'START-HERE.txt'),guide);
    await writeFile(path.join(dir,'plan.json'),JSON.stringify(plan,null,2));
    await run('zip',['-q','-r',filename,'.'],{cwd:dir});
    return filename;
  }finally{await rm(dir,{recursive:true,force:true});}
}
