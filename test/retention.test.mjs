import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../paid/store.mjs';
import {maintainRetention,studyAnalytics} from '../paid/retention.mjs';
import {snapshot} from '../paid/backup.mjs';
import {pruneSnapshots} from '../paid/maintenance.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url)));
const DAY=86400000,password='Isolated retention test password 123!';
function recordPurchase(store,id,created){store.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,0)').run('cs_'+id,id,'pi_'+id,created,created+90*DAY);}

test('retention removes study data, preserves seven-year finance evidence, respects holds and supports safe re-registration',async t=>{
 let now=Date.UTC(2026,0,1);const store=new Store(':memory:',bank,()=>now);t.after(()=>store.db.close());
 const token=await store.register('learner@example.test',password),user=store.user(token);recordPurchase(store,user.id,now);
 const a=store.start(user.id,4);store.update(user.id,a.id,{questionId:bank.find(q=>q.set===4).id,choice:0});store.submit(user.id,a.id);
 maintainRetention(store);store.db.prepare('INSERT INTO retention_holds VALUES(?,?,?)').run(user.id,now+400*DAY,'Example dispute hold');
 now+=271*DAY;assert.equal(maintainRetention(store,{apply:true}).heldAccounts,1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM attempts').get().n,1);
 store.db.prepare('DELETE FROM retention_holds').run();const dry=maintainRetention(store);assert.equal(dry.deletedAttempts,1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM attempts').get().n,1);
 const applied=maintainRetention(store,{apply:true});assert.equal(applied.deletedAttempts,1);assert.equal(applied.retiredAccounts,1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM attempts').get().n,0);
 assert.equal(store.db.prepare('SELECT email FROM financial_contacts WHERE user_id=?').get(user.id).email,'learner@example.test');assert.equal(store.db.prepare('SELECT count(*) AS n FROM purchases').get().n,1);
 assert.equal(store.user(token),undefined);assert.equal(store.accountByEmail('learner@example.test'),undefined);assert.throws(()=>store.newSession(user.id),{status:401});
 assert.equal(studyAnalytics(store).length,0);const totals=JSON.stringify(store.db.prepare('SELECT * FROM study_totals').all());assert.ok(!totals.includes(user.id));assert.ok(!totals.includes(user.email));
 const newToken=await store.register(user.email,password);assert.notEqual(store.user(newToken).id,user.id);assert.equal(store.access(store.user(newToken).id).active,false);
 maintainRetention(store,{apply:true});assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM study_totals').all()),totals);
 now=Date.UTC(2033,0,1);maintainRetention(store,{apply:true});assert.equal(store.db.prepare('SELECT count(*) AS n FROM purchases').get().n,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM financial_contacts').get().n,0);
});

test('unverified accounts expire at 30 days and verified unpaid accounts at 180 days',async t=>{
 let now=Date.UTC(2026,0,1);const store=new Store(':memory:',bank,()=>now);t.after(()=>store.db.close());
 await store.register('unverified@example.test',password);const verified=store.user(await store.register('verified@example.test',password));store.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(verified.id);
 now+=30*DAY;assert.equal(maintainRetention(store,{apply:true}).deletedAccounts,1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM users').get().n,1);
 now+=150*DAY;assert.equal(maintainRetention(store,{apply:true}).deletedAccounts,1);assert.equal(store.db.prepare('SELECT count(*) AS n FROM users').get().n,0);
});

test('backup rotation removes only old checked snapshots and preserves newest two and unrelated files',async t=>{
 const root=mkdtempSync(join(tmpdir(),'procip-rotation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const source=join(root,'db.sqlite'),backups=join(root,'backups'),store=new Store(source,bank);store.db.close();
 const copies=[];for(let i=0;i<3;i++)copies.push(await snapshot(source,backups));
 const sentinel=join(backups,'unrelated.txt');writeFileSync(sentinel,'keep');
 const future=Date.now()+31*DAY;assert.equal(await pruneSnapshots(backups,future),1);assert.equal(readdirSync(backups).filter(n=>n.endsWith('.sqlite')).length,2);assert.ok(readdirSync(backups).includes('unrelated.txt'));
 assert.equal(await pruneSnapshots(backups,future),0);
});
