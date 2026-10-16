import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lessons,lessonForObjective} from '../paid/study-content.mjs';
import {lessonPage,libraryPage} from '../paid/study-ui.mjs';
import {Store} from '../paid/store.mjs';
import {createApp} from '../paid/server.mjs';
import {results} from '../paid/ui.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url)));
test('each bank objective resolves to one substantial original lesson and each lesson has eligible practice',()=>{
 assert.equal(lessons.length,30);assert.equal(new Set(lessons.map(l=>l.id)).size,30);
 const tags=lessons.flatMap(l=>l.objectives);assert.equal(tags.length,98);assert.equal(new Set(tags).size,98);
 for(const q of bank)assert.ok(lessonForObjective(q.objective),q.objective);
 for(const l of lessons){assert.ok(bank.some(q=>q.set!==8&&l.objectives.includes(q.objective)),l.id);assert.ok(l.sections.reduce((n,s)=>n+s[1].split(/\s+/).length,0)>=100,l.id);}
});
test('library search and lesson rendering escape input, hide recall reasoning in details and omit exam keys',()=>{
 const index=lessons.map(l=>({...l,summary:l.essentials[0]}));const html=libraryPage(index,{domain:'4',query:'<script>'});assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/No matching lessons/);
 const page=lessonPage(lessons[0],{});assert.match(page,/<details><summary>Reveal the reasoning/);assert.match(page,/Exam essentials/);assert.ok(!page.includes('correctIndex'));
});
async function fixture(t){let now=Date.now();const s=new Store(':memory:',bank,()=>now),token=await s.register('notes@example.test','A private fixture password 123!'),u=s.user(token);s.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(u.id);t.after(()=>s.db.close());return {s,u,token,get now(){return now;},advance:n=>now+=n,pay:()=>s.db.prepare('INSERT INTO purchases VALUES(?,?,?,?,?,0)').run('cs_notes',u.id,'pi_notes',now,now+90*86400000)};}
test('notes require sign-in, verification and active access; timed exams block notes until expiry or submission',async t=>{
 const f=await fixture(t),server=createApp({store:f.s,origin:'http://example.test',secure:false,requireVerification:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/mcip`,url=base+'/api/study-notes',headers={Cookie:'procip_session='+f.token};
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers})).status,403);f.pay();
 f.s.db.prepare('UPDATE users SET email_verified=0 WHERE id=?').run(f.u.id);assert.equal((await fetch(url,{headers})).status,403);f.s.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(f.u.id);
 const list=await (await fetch(url,{headers})).json();assert.equal(list.lessons.length,30);
 const note=await (await fetch(url+'?objective=4.v',{headers})).json();assert.equal(note.lesson.id,'holds-and-discovery');assert.ok(!JSON.stringify(note).includes('correctIndex'));assert.equal(note.lesson.advanced.checks.length,2);
 assert.equal((await fetch(url+'?id=missing',{headers})).status,404);assert.equal((await fetch(base+'/student/study-content.mjs')).status,404);assert.equal((await fetch(base+'/student/study-depth.mjs')).status,404);assert.equal((await fetch(base+'/student/lesson-audio.mjs')).status,200);
 const a=f.s.start(f.u.id,4);assert.equal((await fetch(url,{headers})).status,409);f.advance(120*60000);assert.equal((await fetch(url,{headers})).status,200);assert.equal(f.s.attempt(f.u.id,a.id).status,'submitted');
 const view=f.s.view(f.u.id,a.id);assert.match(results(view),/data-note-objective="/);f.advance(91*86400000);const login=await f.s.login('notes@example.test','A private fixture password 123!');assert.equal((await fetch(url,{headers:{Cookie:'procip_session='+login}})).status,403);
});
test('lesson practice uses only its objectives, reserves mock five, rejects invalid and conflicting focus',async t=>{
 const f=await fixture(t);f.pay();assert.throws(()=>f.s.learning.start(f.u.id,{lesson:'missing'}),{status:400});
 const a=f.s.learning.start(f.u.id,{lesson:'retention',filter:'all'}),l=lessons.find(x=>x.id==='retention');assert.ok(a.questionIds.length>0);for(const id of a.questionIds){const q=bank.find(x=>x.id===id);assert.ok(l.objectives.includes(q.objective));assert.notEqual(q.set,8);}
 assert.throws(()=>f.s.learning.start(f.u.id,{lesson:'records',filter:'all'}),{status:409});assert.equal(f.s.learning.start(f.u.id,{lesson:'retention',filter:'all'}).id,a.id);
});
