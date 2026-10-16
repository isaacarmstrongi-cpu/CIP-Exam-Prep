import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {exam,reviewNavigation} from '../paid/ui.mjs';
import {Store} from '../paid/store.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url)));
const makeView=()=>({attempt:{id:'review',set:4,index:1,flags:['q1','q3'],answers:{q1:2},status:'active'},questions:Array.from({length:5},(_,i)=>({id:'q'+i,domain:1,stem:'Question '+i,choices:['A','B','C','D']}))});
test('marked review keeps original numbers and includes only marked questions in navigation',()=>{
 const v=makeView(),n=reviewNavigation(v,true);assert.deepEqual(n.indices,[1,3]);assert.equal(n.previous,null);assert.equal(n.next,3);
 const html=exam(v,{markedOnly:true});assert.match(html,/1 unanswered/);assert.match(html,/Next marked/);assert.match(html,/Question 4, unanswered, marked for review/);assert.ok(!html.includes('data-index="2"'));assert.ok(!html.includes('data-index="4"'));assert.match(html,/The exam clock continues/);assert.match(html,/Not sure of an answer/);assert.match(html,/Marking keeps your selected answer/);assert.match(html,/Use <strong>Review marked/);
 v.attempt.index=3;const last=reviewNavigation(v,true);assert.equal(last.previous,1);assert.equal(last.next,null);
 assert.deepEqual(reviewNavigation(v,false).indices,[0,1,2,3,4]);
});
test('empty marked review has no answer controls and a clear way back; a stale position shows only the map',()=>{
 const v=makeView();v.attempt.flags=[];const empty=exam(v,{markedOnly:true});assert.match(empty,/No marked questions/);assert.match(empty,/Show all questions/);assert.ok(!empty.includes('name="answer"'));
 v.attempt.flags=['q3'];const stale=exam(v,{markedOnly:true});assert.match(stale,/Choose a marked question/);assert.ok(!stale.includes('name="answer"'));assert.match(stale,/data-index="3"/);
});
test('saved marks and answers survive reloading while marking and navigation never extend the exam deadline',async t=>{
 let now=Date.now();const s=new Store(':memory:',bank,()=>now);t.after(()=>s.db.close());const token=await s.register('marked@example.test','A private marked review test password!'),u=s.user(token);s.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,0)').run('cs_mark',u.id,'pi_mark',now,now+90*86400000);
 const a=s.start(u.id,4),qs=bank.filter(q=>q.set===4),deadline=a.deadline;s.update(u.id,a.id,{questionId:qs[0].id,choice:2,flagged:true});s.update(u.id,a.id,{questionId:qs[3].id,flagged:true,index:3});now+=60000;
 const reloaded=s.view(u.id,a.id);assert.deepEqual(reloaded.attempt.flags,[qs[0].id,qs[3].id]);assert.equal(reloaded.attempt.answers[qs[0].id],2);assert.equal(reloaded.attempt.deadline,deadline);
 s.update(u.id,a.id,{questionId:qs[3].id,flagged:false,index:0});assert.deepEqual(s.attempt(u.id,a.id).flags,[qs[0].id]);assert.equal(s.attempt(u.id,a.id).answers[qs[0].id],2);now=deadline;assert.throws(()=>s.update(u.id,a.id,{questionId:qs[0].id,flagged:false}),{status:409});assert.equal(s.view(u.id,a.id).attempt.status,'submitted');
});
