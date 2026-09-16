import { kyivToday, shiftDate, validDate } from './kyiv.js';

// Keep the image-job date immutable: GPT may already be using its brief/ZIP.
// planDate routes that same job to the new publication day without redrawing.
export function reschedulePlans(store,{dates,startDate=shiftDate(kyivToday(),1),requestId}={}) {
  if(!Array.isArray(dates)||!dates.length||dates.length>366||dates.some(d=>!validDate(d))||new Set(dates).size!==dates.length)throw new Error('Вибери різні дати наявних планів');
  if(!validDate(startDate))throw new Error('Некоректна нова дата');
  if(typeof requestId!=='string'||!/^[-a-zA-Z0-9]{8,80}$/.test(requestId))throw new Error('Потрібен ідентифікатор перенесення');
  const sources=[...dates].sort(),auditId='reschedule-'+requestId;
  const previous=store.get('archived-plan',auditId);
  if(previous) {
    if(previous.startDate!==startDate||JSON.stringify(previous.dates)!==JSON.stringify(sources))throw new Error('Цей ідентифікатор уже використаний для іншого перенесення');
    return previous.result;
  }
  if(startDate<shiftDate(kyivToday(),1))throw new Error('Перенесення починається не раніше завтра за Києвом');
  const offset=(Date.parse(startDate)-Date.parse(sources[0]))/86400000;
  if(offset<=0)throw new Error('Нова дата має бути пізнішою за початок вибраного розкладу');
  const moves=sources.map(from=>({from,to:shiftDate(from,offset)})),mapping=new Map(moves.map(m=>[m.from,m.to]));
  return store.transaction(()=>{
    if(store.activeJobs().length)throw new Error('Дочекайся завершення поточних завдань перед перенесенням');
    const plans=sources.map(date=>{
      const plan=store.get('plan',date);
      if(!plan)throw new Error('Не знайдено план на '+date);
      if(plan.items.some(i=>i.status==='posted'||i.postedAt))throw new Error('У дні '+date+' вже є опубліковані матеріали');
      return plan;
    });
    for(const {to} of moves)if(!mapping.has(to)&&(store.get('plan',to)||store.get('drive-export',to)))throw new Error('Дата '+to+' уже зайнята. Наявні матеріали збережено');
    const imageJobs=store.list('image-job').filter(j=>mapping.has(j.planDate||j.date));
    const history=store.list('copy-history').filter(h=>mapping.has(h.planId));
    const exports=store.list('drive-export').filter(e=>mapping.has(e.id));
    const jobs=store.db.prepare("SELECT body FROM jobs WHERE type IN ('prepare','export-drive')").all().map(r=>JSON.parse(r.body)).filter(j=>mapping.has(j.target));
    const at=new Date().toISOString();
    const result={requestId,moves,products:new Set(plans.flatMap(p=>p.productIds)).size};
    store.put('archived-plan',{id:auditId,type:'reschedule',dates:sources,startDate,createdAt:at,plans,imageJobs,history,exports,jobs,result});
    for(const date of sources){store.remove('plan',date);store.remove('drive-export',date);}
    for(const plan of plans)store.put('plan',{...plan,id:mapping.get(plan.id),originalDate:plan.originalDate||plan.id,rescheduledFrom:plan.id,rescheduledAt:at});
    for(const job of imageJobs)store.put('image-job',{...job,planDate:mapping.get(job.planDate||job.date)});
    for(const entry of history)store.put('copy-history',{...entry,planId:mapping.get(entry.planId)});
    for(const entry of exports)store.put('drive-export',{...entry,id:mapping.get(entry.id),sourceDate:entry.sourceDate||entry.id});
    for(const job of jobs) {
      const target=mapping.get(job.target),moved={...job,target,updatedAt:at};
      if(job.result?.date===job.target)moved.result={...job.result,date:target};
      store.db.prepare('UPDATE jobs SET target=?,body=? WHERE id=?').run(target,JSON.stringify(moved),job.id);
    }
    return result;
  });
}
