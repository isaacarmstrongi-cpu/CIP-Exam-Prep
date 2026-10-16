import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../paid/store.mjs';
import { createApp,clientAddress } from '../paid/server.mjs';
import { createEmailSender } from '../paid/email.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url)));
const password='A unique password for tests 123!';

test('email tokens are hashed, purpose-bound, replaced, expiring and single-use',async t=>{
 let now=1000000;const store=new Store(':memory:',bank,()=>now);t.after(()=>store.db.close());
 const session=await store.register('email@example.test',password),user=store.user(session);
 assert.equal(user.emailVerified,false);
 const old=store.issueEmailAction(user.id,'verify'),token=store.issueEmailAction(user.id,'verify');
 assert.throws(()=>store.verifyEmail(old),{status:400});
 assert.notEqual(store.db.prepare('SELECT token FROM email_actions').get().token,token);
 assert.throws(()=>store.emailAction(token,'reset'),{status:400});
 now+=24*60*60000;assert.throws(()=>store.verifyEmail(token),{status:400});
 const fresh=store.issueEmailAction(user.id,'verify');store.verifyEmail(fresh);
 assert.equal(store.user(session).emailVerified,true);assert.throws(()=>store.verifyEmail(fresh),{status:400});
});

test('password reset revokes every session and never changes password after expiry or reuse',async t=>{
 let now=1000000;const store=new Store(':memory:',bank,()=>now);t.after(()=>store.db.close());
 const first=await store.register('reset@example.test',password),user=store.user(first),second=await store.login(user.email,password);
 const expired=store.issueEmailAction(user.id,'reset');now+=30*60000;
 await assert.rejects(store.resetPassword(expired,'New unique password 123!'),{status:400});
 const token=store.issueEmailAction(user.id,'reset');await store.resetPassword(token,'New unique password 123!');
 assert.equal(store.user(first),undefined);assert.equal(store.user(second),undefined);
 await assert.rejects(store.login(user.email,password),{status:401});assert.ok(await store.login(user.email,'New unique password 123!'));
 await assert.rejects(store.resetPassword(token,'Another unique password 123!'),{status:400});
});

test('request limits survive a database reopen and expire at their actual deadline',t=>{
 let now=1000;const folder=mkdtempSync(join(tmpdir(),'procip-rate-')),path=join(folder,'rate.sqlite');
 let store=new Store(path,bank,()=>now);store.limit('auth:private@example.test',1);store.db.close();
 store=new Store(path,bank,()=>now);t.after(()=>{store.db.close();rmSync(folder,{recursive:true,force:true});});
 assert.throws(()=>store.limit('auth:private@example.test',1),{status:429});
 assert.ok(!store.db.prepare('SELECT key FROM rate_limits').get().key.includes('private'));
 now+=60000;assert.doesNotThrow(()=>store.limit('auth:private@example.test',1));
});

test('forwarded addresses require a trusted loopback proxy and use the appended actual client',()=>{
 const request={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'192.0.2.1, 198.51.100.3'}};
 assert.equal(clientAddress(request,false),'127.0.0.1');assert.equal(clientAddress(request,true),'198.51.100.3');
 assert.equal(clientAddress({...request,socket:{remoteAddress:'203.0.113.2'}},true),'203.0.113.2');
 assert.equal(clientAddress({...request,headers:{'x-forwarded-for':'invalid'}},true),'127.0.0.1');
});

test('unverified students cannot buy or open exams; recovery responses do not disclose accounts',async t=>{
 const store=new Store(':memory:',bank),sent=[];t.after(()=>store.db.close());const origin='https://example.test';
 const server=createApp({store,origin,stripe:{},price:'price',webhookSecret:'test',enrollment:true,requireVerification:true,mailer:async m=>sent.push(m),secure:false});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/mcip/api/`,headers={Origin:origin,'Content-Type':'application/json'};
 const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{...headers,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const registration=await post('register',{email:'student@example.test',password});assert.equal(registration.status,200);
 const cookie=registration.headers.get('set-cookie').split(';')[0];assert.equal(sent[0].purpose,'verify');
 assert.equal((await post('checkout',{},cookie)).status,403);assert.equal((await post('attempts',{set:4},cookie)).status,403);
 assert.equal((await post('verify-email',{token:sent[0].token})).status,200);
 const state=await (await fetch(base+'session',{headers:{Cookie:cookie}})).json();assert.equal(state.user.emailVerified,true);
 const known=await post('forgot-password',{email:'student@example.test'}),unknown=await post('forgot-password',{email:'missing@example.test'});
 assert.equal(known.status,202);assert.deepEqual(await known.json(),await unknown.json());assert.equal(sent.filter(m=>m.purpose==='reset').length,1);
 const reset=sent.find(m=>m.purpose==='reset');assert.equal((await post('reset-password',{token:reset.token,password:'A different unique password 456!'})).status,200);
 assert.equal((await (await fetch(base+'session',{headers:{Cookie:cookie}})).json()).user,null);
});

test('production enrollment cannot open without configured verification delivery',async t=>{
 const store=new Store(':memory:',bank);t.after(()=>store.db.close());
 const server=createApp({store,origin:'https://example.test',stripe:{},price:'price',webhookSecret:'test',live:true,enrollment:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const result=await (await fetch(`http://127.0.0.1:${server.address().port}/mcip/api/session`)).json();assert.equal(result.enrollment,false);
});

test('email delivery uses the configured origin, hides tokens in the URL fragment and rejects provider errors',async()=>{
 let sent;const send=createEmailSender({key:'test-only',from:'Pro CIP Exam Prep <test@example.test>',origin:'https://example.test',fetcher:async(url,options)=>{sent={url,...options};return {ok:true};}});
 await send({to:'student@example.test',purpose:'reset',token:'test-token'});
 const message=JSON.parse(sent.body);assert.match(message.text,/https:\/\/example.test\/mcip\/student\/#reset=test-token/);assert.equal(message.reply_to,'isaacarmstrong@live.com');
 assert.equal(message.to[0],'student@example.test');assert.ok(!message.text.includes('test-only'));assert.ok(sent.headers['Idempotency-Key']);
 const bad=createEmailSender({key:'test',from:'test@example.test',origin:'https://example.test',fetcher:async()=>({ok:false})});await assert.rejects(bad({to:'x@example.test',purpose:'verify',token:'token'}));
});
