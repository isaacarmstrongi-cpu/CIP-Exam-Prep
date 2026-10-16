import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../paid/store.mjs';
import {maintainRetention} from '../paid/retention.mjs';
import {createApp} from '../paid/server.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url))),password='Isolated learning test password 123!',DAY=86400000;
async function fixture(t,path=':memory:'){let now=1800000000000;let store=new Store(path,bank,()=>now);const token=await store.register('learner@example.test',password),user=store.user(token);store.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,0)').run('cs_learning',user.id,'pi_learning',now,now+90*DAY);t.after(()=>store.db.close());return {get store(){return store;},user,token,advance:n=>now+=n,reopen:()=>{store.db.close();store=new Store(path,bank,()=>now);}};}

test('study sessions use a unique filtered pool, preserve a final mock and reveal explanations only after checking',async t=>{
 const f=await fixture(t),s=f.store,a=s.learning.start(f.user.id,{filter:'unseen',domain:2,count:20});
 assert.equal(new Set(a.questionIds).size,20);assert.ok(a.questionIds.every(id=>bank.find(q=>q.id===id).domain===2&&bank.find(q=>q.id===id).set!==8));
 assert.throws(()=>s.learning.start(f.user.id,{filter:'weakest',domain:4,count:10}),{status:409});
 const initial=s.view(f.user.id,a.id);assert.equal(initial.feedback,null);assert.ok(!JSON.stringify(initial).includes('correctIndex'));assert.ok(!JSON.stringify(initial).includes('rationale'));
 const q=bank.find(q=>q.id===a.questionIds[0]);s.update(f.user.id,a.id,{questionId:q.id,choice:q.correctIndex});s.learning.check(f.user.id,a.id);s.learning.check(f.user.id,a.id);
 assert.equal(s.view(f.user.id,a.id).feedback.correctIndex,q.correctIndex);assert.throws(()=>s.update(f.user.id,a.id,{questionId:q.id,choice:0}),{status:409});assert.equal(s.db.prepare('SELECT exposures FROM question_reviews').get().exposures,1);
 f.advance(3*DAY);assert.equal(s.attempt(f.user.id,a.id).status,'active');s.submit(f.user.id,a.id);assert.equal(s.view(f.user.id,a.id).result.total,20);assert.equal(s.view(f.user.id,a.id).result.correct,1);assert.equal(s.learning.insights(f.user.id).assessed,1);
 assert.equal(s.view(f.user.id,a.id).result.answeredAccuracy,100);assert.equal(s.history(f.user.id).find(x=>x.id===a.id).score,100);
 assert.throws(()=>s.view('another-user',a.id),{status:403});
});

test('missed, flagged, new and due practice reflect graded answers rather than unanswered mock questions',async t=>{
 const f=await fixture(t),s=f.store,a=s.start(f.user.id,4),[right,wrong]=bank.filter(q=>q.set===4);
 s.update(f.user.id,a.id,{questionId:right.id,choice:right.correctIndex});s.update(f.user.id,a.id,{questionId:wrong.id,choice:(wrong.correctIndex+1)%4,flagged:true});s.submit(f.user.id,a.id);
 const state=s.learning.insights(f.user.id);assert.equal(state.assessed,2);assert.equal(state.missed,1);assert.equal(state.due,0);
 let study=s.learning.start(f.user.id,{filter:'missed',count:10});assert.deepEqual(study.questionIds,[wrong.id]);s.submit(f.user.id,study.id);
 study=s.learning.start(f.user.id,{filter:'flagged',count:10});assert.deepEqual(study.questionIds,[wrong.id]);s.submit(f.user.id,study.id);
 study=s.learning.start(f.user.id,{filter:'unseen',count:20});assert.ok(!study.questionIds.includes(right.id)&&!study.questionIds.includes(wrong.id));s.submit(f.user.id,study.id);
 assert.throws(()=>s.learning.start(f.user.id,{filter:'due',count:5}),{status:400});f.advance(2*DAY);study=s.learning.start(f.user.id,{filter:'due',count:5});assert.deepEqual(new Set(study.questionIds),new Set([right.id,wrong.id]));
});

test('full-exam progress separates first attempts from retakes and never silently switches exams',async t=>{
 const f=await fixture(t),s=f.store,a=s.start(f.user.id,4),[q]=bank.filter(q=>q.set===4);
 assert.throws(()=>s.start(f.user.id,5),{status:409});assert.equal(s.start(f.user.id,4).id,a.id);
 s.update(f.user.id,a.id,{questionId:q.id,choice:q.correctIndex});s.submit(f.user.id,a.id);s.submit(f.user.id,a.id);
 assert.equal(s.db.prepare('SELECT exposures FROM question_reviews').get().exposures,1);
 const b=s.start(f.user.id,4);s.submit(f.user.id,b.id);const state=s.learning.insights(f.user.id);
 assert.equal(state.firstAttemptCount,1);assert.equal(state.firstAttemptAverage,1);assert.deepEqual(state.progress.map(p=>p.firstAttempt),[true,false]);
 assert.ok(!JSON.stringify(state).includes('correctIndex'));assert.ok(!JSON.stringify(state).includes('password'));
});

test('study schedules survive restart and expire with practice data while financial evidence remains',async t=>{
 const root=mkdtempSync(join(tmpdir(),'procip-learning-'));const f=await fixture(t,join(root,'db.sqlite'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const a=f.store.learning.start(f.user.id,{filter:'unseen',count:5}),q=bank.find(q=>q.id===a.questionIds[0]);f.store.update(f.user.id,a.id,{questionId:q.id,choice:q.correctIndex});f.store.learning.check(f.user.id,a.id);f.store.submit(f.user.id,a.id);f.reopen();
 assert.equal(f.store.learning.insights(f.user.id).assessed,1);assert.equal(f.store.accountExport(f.user.id).reviewSchedule.length,1);
 f.advance(271*DAY);maintainRetention(f.store,{apply:true});assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM question_reviews').get().n,0);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM purchases').get().n,1);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM attempts').get().n,0);
});

test('unpaid or expired students cannot use study answer checks or create practice sessions',async t=>{
 const f=await fixture(t);const a=f.store.learning.start(f.user.id,{filter:'unseen',count:5});f.advance(90*DAY);
 assert.throws(()=>f.store.learning.check(f.user.id,a.id),{status:403});assert.throws(()=>f.store.learning.start(f.user.id,{filter:'unseen',count:5}),{status:403});assert.throws(()=>f.store.update(f.user.id,a.id,{index:1}),{status:403});
});

test('study API keeps updates small, protects other paid accounts and separates study from exam scores',async t=>{
 const f=await fixture(t),s=f.store,otherToken=await s.register('other@example.test',password),other=s.user(otherToken),now=1800000000000;
 s.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,0)').run('cs_other',other.id,'pi_other',now,now+90*DAY);
 const origin='https://example.test',server=createApp({store:s,origin,secure:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/mcip/api/`,headers=token=>({Origin:origin,'Content-Type':'application/json',Cookie:`procip_session=${token}`});
 assert.equal((await fetch(base+'insights')).status,401);
 const start=await(await fetch(base+'practice',{method:'POST',headers:headers(f.token),body:JSON.stringify({filter:'unseen',count:5})})).json();assert.equal(start.questions.length,5);assert.ok(!JSON.stringify(start).includes('correctIndex'));
 const q=bank.find(q=>q.id===start.questions[0].id),path='attempts/'+start.attempt.id;
 const changed=await(await fetch(base+path+'?state=1',{method:'PATCH',headers:headers(f.token),body:JSON.stringify({questionId:q.id,choice:q.correctIndex})})).json();assert.ok(!Object.hasOwn(changed,'questions'));assert.equal(changed.feedback,null);
 assert.equal((await fetch(base+path+'/check',{method:'POST',headers:headers(otherToken),body:'{}'})).status,404);
 const checked=await(await fetch(base+path+'/check?state=1',{method:'POST',headers:headers(f.token),body:'{}'})).json();assert.equal(checked.feedback.correctIndex,q.correctIndex);assert.ok(!Object.hasOwn(checked,'questions'));
 const own=await(await fetch(base+'insights',{headers:headers(f.token)})).json(),unrelated=await(await fetch(base+'insights',{headers:headers(otherToken)})).json();assert.equal(own.assessed,1);assert.equal(unrelated.assessed,0);assert.equal(own.firstAttemptAverage,null);
});
