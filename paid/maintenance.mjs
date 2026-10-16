import {readFileSync,readdirSync,lstatSync,unlinkSync,realpathSync,existsSync,chownSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {snapshot,verifyRestore} from './backup.mjs';
import {Store} from './store.mjs';
import {maintainRetention,RETENTION} from './retention.mjs';

export async function pruneSnapshots(directory,now=Date.now()){
 const root=realpathSync(directory),candidates=[];
 for(const name of readdirSync(root)){
  if(!/^students-[0-9TZ-]+-[a-f0-9-]{36}\.sqlite$/.test(name))continue;
  const path=join(root,name),manifestPath=`${path}.json`;
  if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(manifestPath).isSymbolicLink()||!lstatSync(manifestPath).isFile())throw Error('Unexpected snapshot file type.');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),created=Date.parse(manifest.created);
  if(!Number.isFinite(created))throw Error('Invalid snapshot date.');
  candidates.push({path,manifestPath,created});
 }
 candidates.sort((a,b)=>b.created-a.created);
 let removed=0;
 // Always retain the newest two checked snapshots, even if both are old.
 for(const item of candidates.slice(2))if(item.created<now-RETENTION.backupDays*86400000){await verifyRestore(item.path);unlinkSync(item.path);unlinkSync(item.manifestPath);removed++;}
 return removed;
}

export async function maintainDatabase(source,directory,{apply=false,now=Date.now}={}){
 if(!source||!directory)throw Error('Database and backup directory are required.');
 if(!lstatSync(source).isFile()||lstatSync(source).isSymbolicLink())throw Error('Database must be an existing regular file.');
 const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url)));
 if(apply)await snapshot(source,directory);
 const owner=lstatSync(source),store=new Store(source,bank,now);let result;
 try{store.db.exec('PRAGMA secure_delete=ON');result=maintainRetention(store,{apply});if(apply)store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{
  store.db.close();
  // Root maintenance must not leave newly-created SQLite sidecars unreadable to the app.
  if(process.getuid?.()===0)for(const path of [source,`${source}-wal`,`${source}-shm`])if(existsSync(path)){
   if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile())throw Error('Unexpected database file type.');
   chownSync(path,owner.uid,owner.gid);chmodSync(path,0o600);
  }
 }
 if(apply){const check=new DatabaseSync(source,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Post-maintenance database check failed.');}finally{check.close();}}
 const removedSnapshots=apply?await pruneSnapshots(directory,now()):0;
 return {...result,removedSnapshots};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const apply=process.env.RETENTION_ENABLED==='true';
 console.log('Retention maintenance:',JSON.stringify(await maintainDatabase(process.env.DATABASE_PATH,process.env.BACKUP_DIRECTORY,{apply})));
}
