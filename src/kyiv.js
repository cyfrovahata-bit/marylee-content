// Adapted from tiktok-chanel @ 8530cc8d. Channel folder defaults removed.
export function kyivToday(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const g=t=>p.find(x=>x.type===t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function kyivMinutes(now = new Date()) {
  const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now);
  return Number(p.find(x=>x.type==='hour').value)%24*60+Number(p.find(x=>x.type==='minute').value);
}
export function validDate(date) {
  return typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date;
}
export function shiftDate(date, days) {
  if(!validDate(date)) throw new Error('Некоректна дата');
  return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
}
