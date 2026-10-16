import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../paid/store.mjs';
import { snapshot,verifyRestore } from '../paid/backup.mjs';
test('online snapshot restores accounts and attempts without changing the live database; corruption is detected',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'procip-backup-')),path=join(folder,'source.sqlite');
 const store=new Store(path,[]);t.after(()=>{store.db.close();rmSync(folder,{recursive:true,force:true});});
 const token=await store.register('backup@example.test','A unique test password 123!'),user=store.user(token);
 store.db.prepare('INSERT INTO attempts VALUES(?,?,?)').run('test-attempt',user.id,JSON.stringify({id:'test-attempt',answers:{one:2}}));
 const result=await snapshot(path,join(folder,'backups'));
 assert.deepEqual(result.counts,{users:1,purchases:0,attempts:1});
 const restored=new DatabaseSync(result.path,{readOnly:true});
 try{assert.equal(restored.prepare('SELECT email FROM users').get().email,user.email);assert.equal(JSON.parse(restored.prepare('SELECT body FROM attempts').get().body).answers.one,2);}finally{restored.close();}
 assert.equal(store.user(token).id,user.id);
 const manifest=JSON.parse(readFileSync(`${result.path}.json`));manifest.sha256='incorrect';writeFileSync(`${result.path}.json`,JSON.stringify(manifest));
 await assert.rejects(verifyRestore(result.path),/checksum/);
});
