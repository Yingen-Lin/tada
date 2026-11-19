import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';

const invalid=message=>Object.assign(new Error(message),{status:400});
export function validateLibrary(value) {
  if(!value||typeof value!=='object'||!Array.isArray(value.photos)||!Array.isArray(value.collections)||!Array.isArray(value.sources))throw invalid('Invalid library backup.');
  if(value.photos.length>10000||value.collections.length>2000||value.sources.length>500)throw invalid('Library is too large.');
  const string=(x,max=500)=>typeof x==='string'&&x.length<=max;
  const ids=x=>Array.isArray(x)&&x.length<=10000&&x.every(id=>string(id,250));
  if(!value.photos.every(p=>p&&string(p.id,250)&&string(p.filename)&&Array.isArray(p.tags)&&p.tags.length<=200&&p.tags.every(t=>string(t,250))))throw invalid('Invalid photo or tag data.');
  if(!value.collections.every(c=>c&&string(c.id,250)&&string(c.name,100)&&ids(c.ids)))throw invalid('Invalid collection data.');
  if(!value.sources.every(s=>s&&string(s.id,250)&&string(s.name)&&ids(s.ids)&&(!s.children||Array.isArray(s.children)&&s.children.every(c=>string(c.id,250)&&ids(c.ids)))))throw invalid('Invalid source data.');
  if(new Set(value.photos.map(p=>p.id)).size!==value.photos.length)throw invalid('Duplicate photo records.');
  const clean=JSON.parse(JSON.stringify({photos:value.photos,collections:value.collections,sources:value.sources,collapsedSources:ids(value.collapsedSources)?value.collapsedSources:[]}));
  // Credentials have no place in a library record.
  if(/"(?:access_token|refresh_token|client_secret|tokens)"\s*:/.test(JSON.stringify(clean)))throw invalid('Credentials cannot be saved in library data.');
  return clean;
}
export function openLibraryStore(filename) {
  if(filename!==':memory:'){mkdirSync(dirname(filename),{recursive:true,mode:0o700})}
  const db=new DatabaseSync(filename);
  if(filename!==':memory:')chmodSync(filename,0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS libraries (account TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)');
  const read=db.prepare('SELECT revision,data,updated_at FROM libraries WHERE account=?');
  const write=db.prepare('INSERT INTO libraries(account,revision,data,updated_at) VALUES(?,?,?,?) ON CONFLICT(account) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at');
  return {
    read(account){const row=read.get(account);return row?{revision:row.revision,data:JSON.parse(row.data),updatedAt:row.updated_at}:{revision:0,data:null,updatedAt:null}},
    write(account,expectedRevision,value){
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw invalid('Invalid library revision.');
      const data=validateLibrary(value);db.exec('BEGIN IMMEDIATE');
      try{const current=read.get(account);if((current?.revision||0)!==expectedRevision)throw Object.assign(new Error('This library was changed in another tab. Reload from the database before saving again.'),{status:409});const revision=expectedRevision+1,updatedAt=new Date().toISOString();write.run(account,revision,JSON.stringify(data),updatedAt);db.exec('COMMIT');return{revision,updatedAt}}
      catch(e){db.exec('ROLLBACK');throw e}
    },
    close(){db.close()}
  };
}
