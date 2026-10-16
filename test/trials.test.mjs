import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store} from '../paid/store.mjs';
import {createApp} from '../paid/server.mjs';
import {TRIAL_VERSION} from '../paid/trials.mjs';
import {maintainRetention} from '../paid/retention.mjs';
import {issueTrialFromEnvironment} from '../paid/invite-trial.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url))),DAY=86400000,password='Private friends trial password 123!';
const agreement={accepted:true,version:TRIAL_VERSION};
function setup(t){let time=1800000000000;const store=new Store(':memory:',bank,()=>time);t.after(()=>store.db.close());return {store,advance:n=>time+=n};}

test('trial invitation admits five separate accounts once without a purchase, and expires after seven days',async t=>{
 const f=setup(t),s=f.store,invite=s.trials.issue({maxUses:5}),people=[];
 assert.ok(!JSON.stringify(s.db.prepare('SELECT * FROM trial_invites').get()).includes(invite.token));
 for(let i=0;i<6;i++){const token=await s.register(`friend${i}@example.test`,password);people.push(s.user(token));}
 for(const p of people.slice(0,5)){const access=s.trials.activate(p.id,invite.token,agreement);assert.equal(access.kind,'trial');assert.equal(access.active,true);assert.equal(access.expires-s.now(),7*DAY);}
 assert.throws(()=>s.trials.activate(people[5].id,invite.token,agreement),{status:400});
 const expiry=s.access(people[0].id).expires;f.advance(DAY);s.trials.activate(people[0].id,invite.token,agreement);assert.equal(s.access(people[0].id).expires,expiry);
 assert.equal(s.db.prepare('SELECT count(*) AS n FROM purchases').get().n,0);assert.equal(s.accountExport(people[0].id).freeTrial.version,TRIAL_VERSION);
 const a=s.start(people[0].id,8);assert.equal(s.view(people[0].id,a.id).questions.length,100);assert.throws(()=>s.view(people[1].id,a.id),{status:404});
 s.submit(people[0].id,a.id);assert.equal(s.learning.start(people[0].id,{count:5,filter:'unseen'}).questionIds.length,5);
 f.advance(6*DAY);assert.equal(s.access(people[0].id).active,false);assert.throws(()=>s.start(people[0].id,4),{status:403});assert.throws(()=>s.trials.info(invite.token),{status:400});
});
test('trial invitation rejects wrong tokens, missing agreement, replay from another invitation and revocation',async t=>{
 const f=setup(t),s=f.store,a=s.trials.issue(),b=s.trials.issue(),token=await s.register('private@example.test',password),user=s.user(token);
 assert.throws(()=>s.trials.info('bad'),{status:400});assert.throws(()=>s.trials.activate(user.id,a.token,{}),{status:400});
 s.trials.activate(user.id,a.token,agreement);assert.throws(()=>s.trials.activate(user.id,b.token,agreement),{status:409});s.trials.revoke(a.id);assert.equal(s.access(user.id).active,false);
});
test('trial HTTP flow requires email verification, keeps payment closed and is absent on the live service',async t=>{
 const f=setup(t),s=f.store,invite=s.trials.issue(),mail=[],origin='https://example.test';
 const server=createApp({store:s,origin,base:'/mcip-sandbox',live:false,secure:false,trialEnabled:true,requireVerification:true,policiesApproved:true,mailer:async m=>mail.push(m),enrollment:true,registrationOpen:true,launchApproved:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/mcip-sandbox/api/`,headers={Origin:origin,'Content-Type':'application/json'};
 const post=(path,data,cookie)=>fetch(base+path,{method:'POST',headers:{...headers,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
 const result=await post('trial/register',{invite:invite.token,email:'httpfriend@example.test',password,...agreement});assert.equal(result.status,201);const cookie=result.headers.get('set-cookie').split(';')[0];
 const session=await(await fetch(base+'session',{headers:{Cookie:cookie}})).json();assert.equal(session.trial,true);assert.equal(session.access.active,true);assert.equal(session.enrollment,false);assert.equal(session.registrationOpen,false);
 assert.equal((await post('practice',{count:5},cookie)).status,403);assert.equal(mail.length,1);assert.equal(mail[0].purpose,'verify');
 assert.equal((await post('verify-email',{token:mail[0].token},cookie)).status,200);assert.equal((await post('practice',{count:5},cookie)).status,201);
 assert.equal((await post('checkout',{accepted:true},cookie)).status,503);assert.equal((await post('register',{email:'public@example.test',password})).status,503);
 const exportData=await(await fetch(base+'account-data',{headers:{Cookie:cookie}})).json();assert.equal(exportData.freeTrial.version,TRIAL_VERSION);assert.ok(!JSON.stringify(exportData).includes(invite.token));
 const login=await post('login',{email:'httpfriend@example.test',password});assert.equal(login.status,200);
 assert.equal((await post('forgot-password',{email:'httpfriend@example.test'})).status,202);assert.equal(mail.at(-1).purpose,'reset');
 assert.equal((await post('reset-password',{token:mail.at(-1).token,password:'New trial password for recovery 123!'})).status,200);
 assert.equal((await fetch(base+'insights',{headers:{Cookie:cookie}})).status,401);
 assert.throws(()=>createApp({store:s,origin,live:true,trialEnabled:true,requireVerification:true,mailer:async()=>{},policiesApproved:true}));
 const liveServer=createApp({store:s,origin,live:true,secure:false});await new Promise(r=>liveServer.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>liveServer.close(r)));
 assert.equal((await fetch(`http://127.0.0.1:${liveServer.address().port}/mcip/api/trial/register`,{method:'POST',headers,body:'{}'})).status,404);
});
test('trial study retention follows expiry and creates no seven-year financial record',async t=>{
 const f=setup(t),s=f.store,invite=s.trials.issue(),token=await s.register('retentionfriend@example.test',password),user=s.user(token);
 s.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(user.id);s.trials.activate(user.id,invite.token,agreement);s.start(user.id,4);
 f.advance(180*DAY);maintainRetention(s,{apply:true});assert.equal(s.db.prepare('SELECT count(*) AS n FROM users').get().n,1);
 f.advance(7*DAY);maintainRetention(s,{apply:true});assert.equal(s.db.prepare('SELECT count(*) AS n FROM users').get().n,0);assert.equal(s.db.prepare('SELECT count(*) AS n FROM trial_access').get().n,0);assert.equal(s.db.prepare('SELECT count(*) AS n FROM financial_contacts').get().n,0);
});
test('operator invitation cannot be issued for live payments or open public enrollment',()=>{
 assert.throws(()=>issueTrialFromEnvironment({STRIPE_LIVE:'true',FRIENDS_TRIAL_ENABLED:'true'}));assert.throws(()=>issueTrialFromEnvironment({STRIPE_LIVE:'false',FRIENDS_TRIAL_ENABLED:'true',ENROLLMENT_OPEN:'true',REGISTRATION_OPEN:'false'}));
});
