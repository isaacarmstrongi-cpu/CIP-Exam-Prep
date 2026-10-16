import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../paid/store.mjs';
import {createApp} from '../paid/server.mjs';
import {POLICY_VERSION,POLICY_DIGEST,policySnapshot} from '../paid/policies.mjs';
import {createHash} from 'node:crypto';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url)));
const policy={version:POLICY_VERSION,digest:POLICY_DIGEST,document:policySnapshot};
const password='Isolated policy test password 123!';

test('checkout requires deliberate current agreement, binds its receipt and preserves it after reopening',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'procip-policies-')),path=join(directory,'db.sqlite');
 let store=new Store(path,bank);t.after(()=>{store.db.close();rmSync(directory,{recursive:true,force:true});});
 const token=await store.register('buyer@example.test',password),user=store.user(token);
 let creates=0;const stripe={checkout:{sessions:{create:async data=>{creates++;assert.equal(data.metadata.policy_version,POLICY_VERSION);assert.equal(data.metadata.policy_digest,POLICY_DIGEST);return {id:'cs_policy',url:'https://checkout.stripe.com/example',expires_at:Math.floor(Date.now()/1000)+3600};}}}};
 const origin='https://example.test',server=createApp({store,origin,stripe,price:'price',webhookSecret:'test',enrollment:true,secure:false});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const endpoint=`http://127.0.0.1:${server.address().port}/mcip/api/checkout`;
 const request=body=>fetch(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:`procip_session=${token}`},body:JSON.stringify(body)});
 for(const body of [{},{accepted:false,policyVersion:POLICY_VERSION},{accepted:'true',policyVersion:POLICY_VERSION},{accepted:true,policyVersion:'outdated'}])assert.equal((await request(body)).status,400);
 assert.equal(creates,0);assert.equal(store.db.prepare('SELECT count(*) AS n FROM policy_acceptances').get().n,0);
 assert.equal((await request({accepted:true,policyVersion:POLICY_VERSION})).status,200);
 assert.equal((await request({accepted:true,policyVersion:POLICY_VERSION})).status,200);assert.equal(creates,1);
 const receipt=store.db.prepare('SELECT * FROM policy_acceptances').get();assert.equal(receipt.user_id,user.id);assert.equal(receipt.version,POLICY_VERSION);
 assert.equal(store.db.prepare('SELECT document FROM policy_documents').get().document,policySnapshot);
 assert.equal(store.db.prepare('SELECT version FROM checkout_agreements WHERE checkout_id=?').get('cs_policy').version,POLICY_VERSION);
 store.db.close();store=new Store(path,bank);
 assert.equal(store.accountExport(user.id).policyAgreements[0].accepted,receipt.accepted);
 assert.throws(()=>store.acceptPolicies(user.id,{...policy,document:'changed without version'}),/without a new version/);
});

test('payment cannot unlock a purchase without its required checkout agreement',async t=>{
 const store=new Store(':memory:',bank);t.after(()=>store.db.close());const token=await store.register('buyer@example.test',password),user=store.user(token);
 const session={id:'cs_bound',client_reference_id:user.id,mode:'payment',payment_status:'paid',currency:'usd',amount_subtotal:4500,payment_intent:'pi_bound',livemode:false,line_items:{data:[{price:{id:'price'},quantity:1}]}};
 const event={id:'evt_bound',created:Math.floor(Date.now()/1000),livemode:false};
 store.db.prepare('INSERT INTO checkouts VALUES(?,?,?,?)').run(user.id,session.id,'https://checkout.stripe.com/example',Date.now()+3600000);
 assert.throws(()=>store.rememberPayment(event,session,'price',false,POLICY_VERSION),{status:400});assert.equal(store.access(user.id).active,false);
 store.acceptPolicies(user.id,policy);store.rememberCheckout(user.id,{...session,url:'https://checkout.stripe.com/example',expires_at:Math.floor(Date.now()/1000)+3600},POLICY_VERSION);
 store.rememberPayment(event,session,'price',false,POLICY_VERSION);assert.equal(store.access(user.id).active,true);
});

test('draft policies keep live enrollment closed and account downloads exclude other students and secrets',async t=>{
 const store=new Store(':memory:',bank);t.after(()=>store.db.close());const own=await store.register('own@example.test',password),other=await store.register('other@example.test',password);
 const ownUser=store.user(own);store.acceptPolicies(ownUser.id,policy);
 const origin='https://example.test',server=createApp({store,origin,live:true,enrollment:true,policiesApproved:false,launchApproved:true,mailer:async()=>{},stripe:{},price:'price',webhookSecret:'test',secure:false});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/mcip`;
 assert.equal((await(await fetch(base+'/api/session')).json()).enrollment,false);
 for(const slug of ['terms','refunds','privacy']){const r=await fetch(base+'/policies/'+slug);assert.equal(r.status,200);assert.match(await r.text(),/Owner review draft/);}
 assert.equal((await fetch(base+'/api/account-data')).status,401);
 const exported=await fetch(base+'/api/account-data',{headers:{Cookie:`procip_session=${own}`}});assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);
 const data=await exported.json(),text=JSON.stringify(data);assert.equal(data.account.email,'own@example.test');assert.ok(!text.includes('other@example.test'));assert.ok(!text.includes(password));assert.ok(!text.includes(own));assert.ok(!text.includes(other));assert.ok(!Object.hasOwn(data.account,'password'));
});

test('live sales remain closed after policy approval until the separate launch review is approved',async t=>{
 const store=new Store(':memory:',bank);t.after(()=>store.db.close());
 const server=createApp({store,origin:'https://example.test',live:true,enrollment:true,policiesApproved:true,launchApproved:false,mailer:async()=>{},stripe:{},price:'price',webhookSecret:'test'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const state=await(await fetch(`http://127.0.0.1:${server.address().port}/mcip/api/session`)).json();assert.equal(state.policies.approved,true);assert.equal(state.enrollment,false);assert.equal(state.registrationOpen,false);
});

test('purchase confirmations preserve purchased wording, stay private and remain downloadable after access expires',async t=>{
 let clock=1800000000000;const store=new Store(':memory:',bank,()=>clock);t.after(()=>store.db.close());
 const own=await store.register('own@example.test',password),other=await store.register('other@example.test',password),user=store.user(own);
 const archived={version:'earlier-version',documents:{terms:{title:'Purchased terms',sections:[['Original promise','Original wording <script>alert(1)</script>']]}}};
 const document=JSON.stringify(archived),digest=createHash('sha256').update(document).digest('hex');
 store.acceptPolicies(user.id,{version:archived.version,digest,document});
 const session={id:'cs_original',client_reference_id:user.id,mode:'payment',payment_status:'paid',currency:'usd',amount_subtotal:4500,payment_intent:'pi_original',livemode:false,line_items:{data:[{price:{id:'price'},quantity:1}]},metadata:{policy_version:archived.version,policy_digest:digest},url:'https://checkout.stripe.com/example',expires_at:clock/1000+3600};
 store.rememberCheckout(user.id,session,archived.version);
 store.rememberPayment({id:'evt_original',created:clock/1000,livemode:false},session,'price',false,true);
 assert.throws(()=>store.rememberPayment({id:'evt_forged',created:clock/1000,livemode:false},{...session,metadata:{policy_version:POLICY_VERSION,policy_digest:POLICY_DIGEST}},'price',false,true),{status:400});
 clock+=91*86400000;assert.equal(store.access(user.id).active,false);
 const fresh=await store.login('own@example.test',password),otherFresh=await store.login('other@example.test',password);
 const server=createApp({store,origin:'https://example.test',secure:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const endpoint=`http://127.0.0.1:${server.address().port}/mcip/api/purchase-confirmations`;
 assert.equal((await fetch(endpoint)).status,401);
 const response=await fetch(endpoint,{headers:{Cookie:`procip_session=${fresh}`}});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
 const html=await response.text();assert.match(html,/Original wording &lt;script&gt;/);assert.match(html,/earlier-version/);assert.doesNotMatch(html,/<script>|other@example|password hash/);
 assert.match(await(await fetch(endpoint,{headers:{Cookie:`procip_session=${otherFresh}`}})).text(),/No confirmed purchases/);
});
