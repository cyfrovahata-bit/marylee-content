import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const dir of ['src','web','test','scripts']) for(const file of await readdir(dir))if(file.endsWith('.js')) {
  const result=spawnSync(process.execPath,['--check',`${dir}/${file}`],{encoding:'utf8'});
  if(result.status){process.stderr.write(result.stderr);process.exitCode=1;}
}
if(!process.exitCode)console.log('JavaScript syntax: OK');
