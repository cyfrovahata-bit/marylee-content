import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS } from './config.js';
import { kyivToday } from './kyiv.js';

export class Store {
  constructor(dir) {
    this.dir = dir;
    for (const sub of ['', 'media', 'work', 'cache', 'exports']) mkdirSync(path.join(dir, sub), { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'marylee.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(type,target) WHERE status IN ('queued','running');
      CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, day TEXT, kind TEXT, units INTEGER, reserve REAL, created TEXT);`);
  }
  get(kind, id) { const row = this.db.prepare('SELECT body FROM docs WHERE kind=? AND id=?').get(kind,id); return row ? JSON.parse(row.body) : null; }
  list(kind) { return this.db.prepare('SELECT body FROM docs WHERE kind=?').all(kind).map(r=>JSON.parse(r.body)); }
  put(kind, value) {
    this.db.prepare('INSERT INTO docs VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,value.id,JSON.stringify(value));
    return value;
  }
  remove(kind,id) { this.db.prepare('DELETE FROM docs WHERE kind=? AND id=?').run(kind,id); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r=fn(); this.db.exec('COMMIT'); return r; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  settings() { return { ...DEFAULT_SETTINGS, ...this.get('settings','main') }; }
  setSettings(value) { return this.put('settings',{...this.settings(),...value,id:'main'}); }
  jobs() { return this.db.prepare('SELECT body FROM jobs ORDER BY rowid DESC LIMIT 50').all().map(r=>JSON.parse(r.body)); }
  activeJobs() { return this.db.prepare("SELECT body FROM jobs WHERE status IN ('running','queued') ORDER BY rowid").all().map(r=>JSON.parse(r.body)); }
  job(id) { const r=this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id); return r ? JSON.parse(r.body) : null; }
  updateJob(job, patch) {
    Object.assign(job,patch,{updatedAt:new Date().toISOString()});
    this.db.prepare('UPDATE jobs SET status=?,body=? WHERE id=?').run(job.status,JSON.stringify(job),job.id);
    return job;
  }
  enqueue(type,target,payload={}) {
    const existing=this.db.prepare("SELECT body FROM jobs WHERE type=? AND target=? AND status IN ('queued','running')").get(type,target);
    if(existing) return JSON.parse(existing.body);
    const job={id:randomUUID(),type,target,payload,status:'queued',progress:0,message:'У черзі',createdAt:new Date().toISOString()};
    this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?)').run(job.id,type,target,job.status,JSON.stringify(job));
    return job;
  }
  claim() {
    return this.transaction(()=>{
      const row=this.db.prepare("SELECT body FROM jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get();
      if(!row) return null;
      return this.updateJob(JSON.parse(row.body),{status:'running',message:'Починаю підготовку'});
    });
  }
  recover() {
    for(const row of this.db.prepare("SELECT body FROM jobs WHERE status='running'").all()) this.updateJob(JSON.parse(row.body),{status:'interrupted',message:'Сервіс перезапустився. Готові файли збережено; можна продовжити вручну.'});
  }
  usage(day=kyivToday()) {
    const rows=this.db.prepare('SELECT kind,SUM(units) AS units,SUM(reserve) AS reserve FROM usage WHERE day=? GROUP BY kind').all(day);
    return {day,reserve:rows.reduce((a,r)=>a+r.reserve,0),counts:Object.fromEntries(rows.map(r=>[r.kind,r.units]))};
  }
  reserve(kind, units, amount) {
    return this.transaction(()=>{
      const current=this.usage();
      const limits={text:24,image:2,voice:10000};
      if(!(kind in limits) || !Number.isFinite(amount) || amount<0 || !Number.isInteger(units) || units<1) throw new Error('Некоректний резерв генерації');
      if((current.counts[kind]||0)+units>limits[kind]) throw new Error(`Вичерпано добовий ліміт ${kind}. Спробуй завтра за київським часом.`);
      if(current.reserve+amount>this.settings().dailyBudget) throw new Error('Вичерпано розрахунковий бюджет дня. Збережені матеріали залишаються доступними.');
      this.db.prepare('INSERT INTO usage VALUES(?,?,?,?,?,?)').run(randomUUID(),current.day,kind,units,amount,new Date().toISOString());
    });
  }
  close() { this.db.close(); }
}
