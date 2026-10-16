import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';
import { Store,ACCESS_MS } from '../paid/store.mjs';
import { createApp } from '../paid/server.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url)));
const origin='https://example.test',secret='whsec_test_only';
async function fixture(t){let clock=1800000000000;const s=new Store(':memory:',bank,()=>clock);t.after(()=>s.db.close());const token=await s.register('student@example.test','A unique test password 123!');const user=s.user(token);return {s,token,user,get time(){return clock;},advance:n=>clock+=n};}
function pay(f,id='cs_test',eventId='evt_test'){
 f.s.db.prepare('INSERT OR IGNORE INTO checkouts VALUES(?,?,?,?)').run(f.user.id,id,'https://checkout.stripe.com/example',f.time+1800000);
 const event={id:eventId,created:Math.floor(f.time/1000),livemode:false};const session={id,livemode:false,client_reference_id:f.user.id,mode:'payment',payment_status:'paid',currency:'usd',amount_subtotal:4500,payment_intent:`pi_${id}`,line_items:{data:[{price:{id:'price_test'},quantity:1}]}};
 f.s.rememberPayment(event,session,'price_test',false);return {event,session};
}
test('passwords and sessions are hashed, login works, logout invalidates',async t=>{const f=await fixture(t);assert.ok(!f.s.db.prepare('SELECT password FROM users').get().password.includes('unique'));assert.notEqual(f.s.db.prepare('SELECT token FROM sessions').get().token,f.token);await assert.rejects(f.s.login('student@example.test','wrong password'),{status:401});const token=await f.s.login('student@example.test','A unique test password 123!');assert.equal(f.s.user(token).id,f.user.id);f.s.logout(token);assert.equal(f.s.user(token),undefined);});
test('unpaid users cannot start, exact 90-day expiry blocks access, unlimited retakes',async t=>{const f=await fixture(t);assert.throws(()=>f.s.start(f.user.id,4),{status:403});pay(f);for(let i=0;i<5;i++){const a=f.s.start(f.user.id,4);f.s.submit(f.user.id,a.id);}assert.equal(f.s.history(f.user.id).length,5);f.advance(ACCESS_MS-1);assert.equal(f.s.access(f.user.id).active,true);f.advance(1);assert.equal(f.s.access(f.user.id).active,false);assert.throws(()=>f.s.start(f.user.id,4),{status:403});});
test('payment replay cannot extend entitlement, wrong package rejected, full refund revokes',async t=>{const f=await fixture(t);const {event,session}=pay(f);const expires=f.s.access(f.user.id).expires;f.advance(100000);f.s.rememberPayment(event,session,'price_test',false);f.s.rememberPayment({...event,id:'evt_duplicate'},session,'price_test',false);assert.equal(f.s.access(f.user.id).expires,expires);assert.throws(()=>f.s.rememberPayment({...event,id:'evt_bad'},{...session,amount_subtotal:1},'price_test',false),{status:400});f.s.revoke(session.payment_intent);assert.equal(f.s.access(f.user.id).active,false);});
test('refund arriving before completion remains revoked',async t=>{const f=await fixture(t);f.s.revoke('pi_cs_test');pay(f);assert.equal(f.s.access(f.user.id).active,false);});
test('keys hidden before submission, scoring exact, other users cannot read or change attempt',async t=>{const f=await fixture(t);pay(f);const a=f.s.start(f.user.id,4),q=bank.filter(q=>q.set===4);const initial=JSON.stringify(f.s.view(f.user.id,a.id));assert.ok(!initial.includes('correctIndex'));assert.ok(!initial.includes('rationale'));assert.ok(!Object.hasOwn(f.s.view(f.user.id,a.id).questions[0],'source'));f.s.update(f.user.id,a.id,{questionId:q[0].id,choice:q[0].correctIndex});f.s.update(f.user.id,a.id,{questionId:q[1].id,choice:(q[1].correctIndex+1)%4});assert.throws(()=>f.s.attempt('other-user',a.id),{status:404});f.s.submit(f.user.id,a.id);const v=f.s.view(f.user.id,a.id);assert.equal(v.result.score,1);assert.equal(v.result.answered,2);assert.equal(v.result.total-v.result.answered,98);assert.ok(v.result.outcomes[0].q.rationale);assert.throws(()=>f.s.update(f.user.id,a.id,{choice:0,questionId:q[0].id}),{status:409});});
test('server deadline expires at 120 minutes and ignores client changes to deadline',async t=>{const f=await fixture(t);pay(f);const a=f.s.start(f.user.id,4);f.s.update(f.user.id,a.id,{deadline:9999999999999});assert.equal(f.s.attempt(f.user.id,a.id).deadline,a.deadline);f.advance(120*60*1000);assert.throws(()=>f.s.update(f.user.id,a.id,{questionId:bank.find(q=>q.set===4).id,choice:0}),{status:409});const v=f.s.view(f.user.id,a.id);assert.equal(v.attempt.reason,'time');assert.equal(v.result.score,0);});
test('HTTP authentication, origin protection, signed webhook, closed enrollment and no static bank',async t=>{
 const f=await fixture(t),stripe=new Stripe('sk_test_fake');const server=createApp({store:f.s,origin,stripe,price:'price_test',webhookSecret:secret,secure:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}/mcip`;
 assert.equal((await fetch(`${base}/api/attempts`)).status,401);
 assert.equal((await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'})).status,403);
 assert.equal((await fetch(`${base}/data/questions.json`)).status,404);
 assert.equal((await fetch(`${base}/api/register`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{}'})).status,503);
 const login=await fetch(`${base}/api/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:'student@example.test',password:'A unique test password 123!'})});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 const session=await fetch(`${base}/api/session`,{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}});assert.equal((await session.json()).user.id,f.user.id);
 const payload=JSON.stringify({id:'evt_ignore',type:'unhandled.event',livemode:false});const header=stripe.webhooks.generateTestHeaderString({payload,secret});
 assert.equal((await fetch(`${base}/api/stripe/webhook`,{method:'POST',headers:{'Stripe-Signature':'bad'},body:payload})).status,400);
 assert.equal((await fetch(`${base}/api/stripe/webhook`,{method:'POST',headers:{'Stripe-Signature':header},body:payload})).status,200);
});


test('checkout uses the current card-only API contract and reuses open checkout',async t=>{
 const f=await fixture(t);let captured,calls=0;
 const stripe={checkout:{sessions:{create:async params=>{captured=params;calls++;return {id:'cs_contract',url:'https://checkout.stripe.com/example',expires_at:Math.floor(Date.now()/1000)+3600};}}}};
 const server=createApp({store:f.s,origin,stripe,price:'price_contract',webhookSecret:secret,enrollment:true,secure:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/mcip/api/checkout`;
 const options={method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:`procip_session=${f.token}`},body:'{}'};
 assert.equal((await fetch(url,options)).status,200);
 assert.deepEqual(captured.allowed_payment_method_types,['card']);assert.equal(Object.hasOwn(captured,'payment_method_types'),false);
 assert.equal(captured.mode,'payment');assert.deepEqual(captured.line_items,[{price:'price_contract',quantity:1}]);
 assert.ok(captured.expires_at>Math.floor(Date.now()/1000)+1800);assert.equal(captured.client_reference_id,f.user.id);
 assert.equal((await fetch(url,options)).status,200);assert.equal(calls,1);
});

test('sandbox checkout uses its own base path while public registration stays closed',async t=>{
 const f=await fixture(t);let captured;
 const stripe={checkout:{sessions:{create:async params=>{captured=params;return {id:'cs_sandbox',url:'https://checkout.stripe.com/example',expires_at:Math.floor(Date.now()/1000)+3600};}}}};
 const server=createApp({store:f.s,origin,base:'/mcip-sandbox',stripe,price:'price_sandbox',webhookSecret:secret,enrollment:true,registrationOpen:false,secure:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const host=`http://127.0.0.1:${server.address().port}`,base=`${host}/mcip-sandbox`;
 const headers={Origin:origin,'Content-Type':'application/json',Cookie:`procip_session=${f.token}`};
 const state=await (await fetch(`${base}/api/session`,{headers})).json();
 assert.equal(state.enrollment,true);assert.equal(state.registrationOpen,false);assert.equal(state.sandbox,true);
 assert.equal((await fetch(`${base}/api/register`,{method:'POST',headers,body:'{}'})).status,503);
 assert.equal((await fetch(`${base}/api/checkout`,{method:'POST',headers,body:'{}'})).status,200);
 assert.equal(captured.success_url,`${origin}/mcip-sandbox/student/?payment=complete`);
 const login=await fetch(`${base}/api/login`,{method:'POST',headers,body:JSON.stringify({email:'student@example.test',password:'A unique test password 123!'})});
 assert.match(login.headers.get('set-cookie'),/Path=\/mcip-sandbox; HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
 assert.equal((await fetch(`${host}/mcip/api/session`)).status,404);
 assert.equal((await fetch(`${base}/student/`)).status,200);
});
