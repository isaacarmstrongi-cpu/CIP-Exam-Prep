import { DatabaseSync,backup } from 'node:sqlite';
import { mkdirSync,openSync,closeSync,chmodSync,writeFileSync,mkdtempSync,rmSync,readFileSync,realpathSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID,createHash } from 'node:crypto';

function inspect(db){
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Database integrity check failed.');
 return Object.fromEntries(['users','purchases','attempts'].map(table=>[table,db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count]));
}
export async function snapshot(sourcePath,directory){
 mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const path=join(directory,`students-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.sqlite`);
 closeSync(openSync(path,'wx',0o600));
 const source=new DatabaseSync(sourcePath,{readOnly:true});
 try{await backup(source,path);}finally{source.close();}
 chmodSync(path,0o600);
 const copy=new DatabaseSync(path,{readOnly:true});let counts;
 try{counts=inspect(copy);}finally{copy.close();}
 const manifest={created:new Date().toISOString(),sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),counts};
 writeFileSync(`${path}.json`,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 await verifyRestore(path);
 return {path,...manifest};
}
export async function verifyRestore(path){
 const manifest=JSON.parse(readFileSync(`${path}.json`,'utf8'));
 if(createHash('sha256').update(readFileSync(path)).digest('hex')!==manifest.sha256)throw new Error('Backup checksum does not match.');
 const directory=mkdtempSync(join(resolve(path,'..'),'restore-check-'));chmodSync(directory,0o700);
 let source,restored;
 try{
   source=new DatabaseSync(path,{readOnly:true});await backup(source,join(directory,'restored.sqlite'));source.close();source=null;
   restored=new DatabaseSync(join(directory,'restored.sqlite'),{readOnly:true});
   if(JSON.stringify(inspect(restored))!==JSON.stringify(manifest.counts))throw new Error('Restored row counts do not match.');
 }finally{source?.close();restored?.close();rmSync(directory,{recursive:true,force:true});}
 return manifest;
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const source=process.env.DATABASE_PATH,directory=process.env.BACKUP_DIRECTORY;
 if(!source||!directory)throw new Error('DATABASE_PATH and BACKUP_DIRECTORY are required.');
 const result=await snapshot(source,directory);
 console.log('Database snapshot and isolated restore verification passed. Counts:',JSON.stringify(result.counts));
}
