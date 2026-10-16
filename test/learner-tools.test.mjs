import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../paid/store.mjs';
import {createApp} from '../paid/server.mjs';
import {maintainRetention} from '../paid/retention.mjs';
import {cards,confidenceSummary} from '../paid/learner-tools.mjs';
import {planPage,cardPage} from '../paid/tools-ui.mjs';
const DAY=86400000,bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url)));
async function fixture(t,path=':memory:'){
 let now=Date.parse('2026-10-17T01:00:00Z'),s=new Store(path,bank,()=>now);const token=await s.register('tools@example.test','Private learning tools fixture password!'),u=s.user(token);s.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(u.id);s.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,0)').run('cs_tools',u.id,'pi_tools',now,now+90*DAY);t.after(()=>s.db.close());
 return {get s(){return s;},u,token,get now(){return now;},advance:n=>now+=n,reopen(){s.db.close();s=new Store(path,bank,()=>now);}};
}
const config={examDate:'2026-11-20',minutes:30,days:[0,1,2,3,4,5,6],timeZone:'America/Los_Angeles'};
test('personal plan respects local dates, real study days and continuous task sequencing across days',async t=>{
 const f=await fixture(t);f.s.tools.savePlan(f.u.id,config);let p=f.s.tools.planView(f.u.id);assert.equal(p.today,'2026-10-16');assert.equal(p.weeklyMinutes,210);assert.equal(p.sessions[0].kind,'read');assert.equal(p.sessions[1].kind,'practice');
 f.s.tools.completePlan(f.u.id,{date:p.today,done:true});assert.equal(f.s.tools.planView(f.u.id).sessions[0].completed,true);assert.throws(()=>f.s.tools.completePlan(f.u.id,{date:'2026-10-17',done:true}),{status:400});
 f.advance(DAY);p=f.s.tools.planView(f.u.id);assert.equal(p.sessions[0].kind,'practice');assert.equal(p.sessions[0].date,'2026-10-17');
 f.s.tools.savePlan(f.u.id,{...config,examDate:'2027-02-01',days:[1,3,5]});p=f.s.tools.planView(f.u.id);assert.equal(p.accessEndsBeforeExam,true);assert.ok(p.sessions.every(x=>[1,3,5].includes(new Date(x.date).getUTCDay())));assert.equal(p.plan.completed.length,0);
});
test('invalid dates, impossible routines and future or foreign completion keys are rejected',async t=>{
 const f=await fixture(t);for(const change of [{examDate:'2026-02-30'},{examDate:'2026-10-16'},{minutes:999},{days:[]},{days:[1,1]},{days:[9]},{timeZone:'not-a-zone'}])assert.throws(()=>f.s.tools.savePlan(f.u.id,{...config,...change}),{status:400});
 assert.equal(f.s.tools.getPlan(f.u.id),null);assert.throws(()=>f.s.tools.completePlan(f.u.id,{date:'2026-10-16',done:true}),{status:400});
});
test('confidence is optional, preserves scoring, excludes unassessed answers and is locked after grading',async t=>{
 const f=await fixture(t),a=f.s.learning.start(f.u.id,{filter:'all',count:5}),qs=a.questionIds.map(id=>bank.find(q=>q.id===id));
 f.s.update(f.u.id,a.id,{questionId:qs[0].id,confidence:'confident',choice:(qs[0].correctIndex+1)%4});f.s.update(f.u.id,a.id,{questionId:qs[1].id,confidence:'guessing',choice:qs[1].correctIndex});
 assert.equal(f.s.tools.confidence(f.u.id).rated,0);f.s.learning.check(f.u.id,a.id);assert.throws(()=>f.s.update(f.u.id,a.id,{questionId:qs[0].id,confidence:'unsure'}),{status:409});
 f.s.update(f.u.id,a.id,{index:1});f.s.learning.check(f.u.id,a.id);const c=f.s.tools.confidence(f.u.id);assert.equal(c.confidentMistakes.length,1);assert.equal(c.correctGuesses.length,1);f.s.submit(f.u.id,a.id);assert.equal(f.s.view(f.u.id,a.id).result.score,20);
 assert.throws(()=>f.s.update(f.u.id,a.id,{questionId:qs[0].id,confidence:'confident'}),{status:409});
 const raw=confidenceSummary([{status:'submitted',answers:{[qs[0].id]:qs[0].correctIndex},confidence:{},submittedAt:1}],bank);assert.equal(raw.unrated,1);assert.equal(raw.rated,0);
});
test('flashcards require reveal, schedule reviews by recall, and replay cannot increment or extend twice',async t=>{
 const f=await fixture(t),id=cards[0].id;assert.equal(cards.length,60);assert.equal(new Set(cards.map(c=>c.id)).size,60);assert.equal(f.s.tools.cardList(f.u.id).new,60);assert.ok(!JSON.stringify(f.s.tools.cardList(f.u.id)).includes('"back"'));
 assert.throws(()=>f.s.tools.rateCard(f.u.id,id,{rating:'good',reviewToken:'missing'}),{status:409});const reveal=f.s.tools.revealCard(f.u.id,id);assert.equal(f.s.tools.cardList(f.u.id).new,60);assert.ok(reveal.card.back.length);
 const rated=f.s.tools.rateCard(f.u.id,id,{rating:'good',reviewToken:reveal.reviewToken});assert.equal(rated.due,f.now+DAY);f.advance(1000);assert.equal(f.s.tools.rateCard(f.u.id,id,{rating:'good',reviewToken:reveal.reviewToken}).due,rated.due);assert.equal(f.s.db.prepare('SELECT reviews FROM flashcard_progress').get().reviews,1);assert.equal(f.s.tools.cardList(f.u.id).cards.length,59);
 f.advance(DAY);assert.equal(f.s.tools.cardList(f.u.id).due,1);const next=f.s.tools.revealCard(f.u.id,id),again=f.s.tools.rateCard(f.u.id,id,{rating:'again',reviewToken:next.reviewToken});assert.equal(again.due,f.now+600000);
});
test('another account cannot reuse a flashcard rating token; expired reveal tokens fail',async t=>{
 const f=await fixture(t),id=cards[1].id,r=f.s.tools.revealCard(f.u.id,id),token=await f.s.register('other-tools@example.test','Another private tools test password!'),other=f.s.user(token);f.s.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,0)').run('cs_other_tools',other.id,'pi_other_tools',f.now,f.now+90*DAY);
 assert.throws(()=>f.s.tools.rateCard(other.id,id,{rating:'easy',reviewToken:r.reviewToken}),{status:409});assert.equal(f.s.tools.cardList(other.id).new,60);f.advance(31*60000);assert.throws(()=>f.s.tools.rateCard(f.u.id,id,{rating:'easy',reviewToken:r.reviewToken}),{status:409});
});
test('plans and card schedules survive restart, export without operation tokens, and retire with study data',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'procip-tools-'));const f=await fixture(t,join(dir,'db.sqlite'));t.after(()=>{assert.ok(dir.startsWith(join(tmpdir(),'procip-tools-')));rmSync(dir,{recursive:true,force:true});});f.s.tools.savePlan(f.u.id,config);const r=f.s.tools.revealCard(f.u.id,cards[0].id);f.s.tools.rateCard(f.u.id,cards[0].id,{rating:'hard',reviewToken:r.reviewToken});f.reopen();assert.equal(f.s.tools.getPlan(f.u.id).examDate,config.examDate);assert.equal(f.s.tools.cardList(f.u.id).reviewed,1);
 const exported=f.s.accountExport(f.u.id);assert.equal(exported.learningTools.flashcards.length,1);assert.ok(!JSON.stringify(exported).includes(r.reviewToken));f.advance(271*DAY);maintainRetention(f.s,{apply:true});assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM study_plans').get().n,0);assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM flashcard_progress').get().n,0);assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM purchases').get().n,1);
});
test('learning-tools HTTP gates reject anonymous, unverified, expired and active timed-exam access',async t=>{
 const f=await fixture(t),server=createApp({store:f.s,origin:'https://example.test',secure:false,requireVerification:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/mcip/api`,headers={Cookie:'procip_session='+f.token};
 for(const path of ['study-plan','flashcards'])assert.equal((await fetch(base+'/'+path)).status,401);
 assert.equal((await fetch(base+'/flashcards',{headers})).status,200);f.s.db.prepare('UPDATE users SET email_verified=0 WHERE id=?').run(f.u.id);assert.equal((await fetch(base+'/flashcards',{headers})).status,403);f.s.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(f.u.id);
 const a=f.s.start(f.u.id,4);assert.equal((await fetch(base+'/study-plan',{headers})).status,409);assert.equal((await fetch(base+'/flashcards',{headers})).status,409);f.s.submit(f.u.id,a.id);assert.equal((await fetch(base+'/study-plan',{headers})).status,200);f.s.db.prepare('UPDATE purchases SET revoked=1 WHERE user_id=?').run(f.u.id);assert.equal((await fetch(base+'/flashcards',{headers})).status,403);
});
test('learning UI escapes stored text and does not reveal flashcard reasoning before the learner asks',()=>{
 const card={...cards[0],title:'<img onerror=bad>'},html=cardPage(card,{position:0,total:60});assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.ok(!html.includes(cards[0].back[0]));assert.match(html,/Reveal reasoning/);const plan=planPage({plan:null});assert.match(plan,/not a prediction of passing/);
});
