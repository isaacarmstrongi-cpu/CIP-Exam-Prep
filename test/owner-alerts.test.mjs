import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../paid/store.mjs';
import {TRIAL_VERSION} from '../paid/trials.mjs';
import {createOwnerAlertSender} from '../paid/email.mjs';
import {ownerAlertMessage} from '../paid/owner-alerts.mjs';
import {maintainRetention} from '../paid/retention.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url))),password='Owner alert isolated password 123!',DAY=86400000;
async function fixture(t,path=':memory:'){
 let now=1800000000000,store=new Store(path,bank,()=>now);
 const token=await store.register('alerts@example.test',password),user=store.user(token),invite=store.trials.issue();
 store.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(user.id);store.trials.activate(user.id,invite.token,{accepted:true,version:TRIAL_VERSION});
 t.after(()=>store.db.close());return {get store(){return store;},user,invite,advance:n=>now+=n,reopen:()=>{store.db.close();store=new Store(path,bank,()=>now);}};
}
test('owner gets one signup and one first-session alert across study, exam resumes, retakes and repeated capture',async t=>{
 const f=await fixture(t),sent=[],send=async e=>{sent.push(e);return {id:'delivery-'+sent.length};};
 await f.store.ownerAlerts.dispatch(send);await f.store.ownerAlerts.dispatch(send);assert.equal(sent.length,1);assert.equal(sent[0].kind,'signup');
 f.store.learning.start(f.user.id,{filter:'unseen',count:5});await f.store.ownerAlerts.dispatch(send);f.store.start(f.user.id,4);f.store.start(f.user.id,4);await f.store.ownerAlerts.dispatch(send);
 assert.equal(sent.length,2);assert.equal(sent[1].kind,'first_session');assert.equal(sent[1].payload.mode,'study');
 assert.ok(!JSON.stringify(sent).includes(f.user.email));assert.ok(!JSON.stringify(sent).includes(f.invite.token));assert.ok(!JSON.stringify(sent).includes(password));
 assert.equal(f.store.accountExport(f.user.id).operationalAlerts.length,2);
 const otherToken=await f.store.register('no-trial@example.test',password),other=f.store.user(otherToken);assert.deepEqual(f.store.accountExport(other.id).operationalAlerts,[]);
});
test('pending owner alerts survive restart and reuse the same request after a temporary email failure',async t=>{
 const root=mkdtempSync(join(tmpdir(),'procip-alerts-'));const f=await fixture(t,join(root,'db.sqlite')),requests=[];t.after(()=>rmSync(root,{recursive:true,force:true}));
 await f.store.ownerAlerts.dispatch(async e=>{requests.push(JSON.stringify(e));throw new Error('Temporary timeout');},{log:()=>{}});f.reopen();
 await f.store.ownerAlerts.dispatch(async()=>assert.fail('Backoff must survive restart'));
 f.advance(60000);await f.store.ownerAlerts.dispatch(async e=>{requests.push(JSON.stringify(e));return {id:'accepted'};});assert.equal(requests[0],requests[1]);
 assert.equal(f.store.db.prepare('SELECT status,attempts FROM owner_alerts').get().status,'sent');
 await f.store.ownerAlerts.dispatch(async()=>assert.fail('Already sent'));assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM purchases').get().n,0);
});
test('owner delivery pauses an uncertain request beyond the provider deduplication window, and permanent failures do not loop',async t=>{
 const f=await fixture(t);
 await f.store.ownerAlerts.dispatch(async()=>{throw new Error('Timeout');},{log:()=>{}});f.advance(24*3600000);
 await f.store.ownerAlerts.dispatch(async()=>assert.fail('Unsafe replay'),{log:()=>{}});assert.equal(f.store.db.prepare('SELECT status FROM owner_alerts').get().status,'review_required');
 const token=await f.store.register('second@example.test',password),u=f.store.user(token);f.store.trials.activate(u.id,f.invite.token,{accepted:true,version:TRIAL_VERSION});
 await f.store.ownerAlerts.dispatch(async()=>{const e=new Error('Rejected');e.retryable=false;throw e;},{log:()=>{}});assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM owner_alerts WHERE status='review_required'").get().n,2);
});
test('owner email payload uses only the approved recipient and stable idempotency key, omitting learner identifiers',async()=>{
 const calls=[],event={id:'one-event',kind:'first_session',occurred:1800000000000,payload:{tester:2,limit:5,mode:'simulation',exam:3}};
 const send=createOwnerAlertSender({key:'synthetic-sending-key',from:'Prep <accounts@mail.example.test>',to:'isaacarmstrong@live.com',fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({id:'delivered'}),{status:200});}});
 await send(event);await send(event);assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);assert.equal(calls[0].options.body,calls[1].options.body);
 const body=JSON.parse(calls[0].options.body);assert.deepEqual(body.to,['isaacarmstrong@live.com']);assert.match(body.text,/Tester 2 of 5/);assert.match(body.text,/Exam 3/);assert.ok(!body.text.includes('one-event'));
 assert.throws(()=>createOwnerAlertSender({key:'key',from:'sender',to:'unapproved@example.test'}));assert.equal(createOwnerAlertSender({}),null);
 const rejected=createOwnerAlertSender({key:'key',from:'sender',to:'isaacarmstrong@live.com',fetcher:async()=>new Response('{}',{status:429})});await assert.rejects(rejected(event),{retryable:true});
 assert.match(ownerAlertMessage({kind:'setup_test'}).text,/No tester signed up and no trial place was consumed/);
});
test('owner operational alert records retire with study data rather than financial evidence',async t=>{
 const f=await fixture(t);f.store.ownerAlerts.capture();f.advance(188*DAY);maintainRetention(f.store,{apply:true});
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM owner_alerts').get().n,0);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
});
