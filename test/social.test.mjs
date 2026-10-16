import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Store} from '../paid/store.mjs';
import {createApp} from '../paid/server.mjs';
import {createIdentityProvider,providerSettings} from '../paid/social.mjs';
import {TRIAL_VERSION} from '../paid/trials.mjs';
import {maintainRetention} from '../paid/retention.mjs';
const bank=JSON.parse(readFileSync(new URL('../dist/data/questions.json',import.meta.url))),origin='https://example.test';
const identity=(subject='one',provider='google')=>({provider,issuer:provider==='google'?'https://accounts.google.com':'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',subject,email:`${subject}@gmail.com`,verified:provider==='google'});
function fixture(t){let time=Date.now();const s=new Store(':memory:',bank,()=>time);t.after(()=>s.db.close());const invite=s.trials.issue();return {s,invite,context:{purpose:'signup',inviteId:invite.id,agreement:{accepted:true,version:TRIAL_VERSION}},advance:n=>time+=n};}
function signup(f,i=identity(),email=i.email,binding='browser'){const {proof}=f.s.social.authenticated(i,f.context,binding);return f.s.social.complete(proof,binding,email);}
test('social callbacks are single-use, browser/provider-bound and expire without claiming a trial place',t=>{
 const f=fixture(t),flow=f.s.social.begin('google','browser',f.context);
 assert.throws(()=>f.s.social.takeState(flow.state,'another','google'),{status:400});
 assert.throws(()=>f.s.social.takeState(flow.state,'browser','microsoft'),{status:400});
 assert.equal(f.s.social.takeState(flow.state,'browser','google').context.inviteId,f.invite.id);
 assert.throws(()=>f.s.social.takeState(flow.state,'browser','google'),{status:400});
 const old=f.s.social.begin('google','browser',f.context);f.advance(600001);assert.throws(()=>f.s.social.takeState(old.state,'browser','google'),{status:400});
 assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM trial_access').get().n,0);
});
test('social trial signup preserves five-place cap, cannot merge by email, and returning sign-in preserves progress and expiry',async t=>{
 const f=fixture(t),result=signup(f),u=f.s.user(result.token),access=f.s.access(u.id),a=f.s.start(u.id,4);
 f.advance(10000);const again=f.s.social.authenticated(identity(),{purpose:'login'},'other');assert.equal(f.s.user(again.token).id,u.id);assert.equal(f.s.history(u.id).length,1);assert.equal(f.s.access(u.id).expires,access.expires);assert.equal(f.s.history(u.id)[0].id,a.id);
 const p=f.s.social.authenticated(identity('attacker'),f.context,'browser').proof;
 assert.throws(()=>f.s.social.complete(p,'browser',u.email),{status:409});
 for(let n=2;n<=5;n++)signup(f,identity('tester'+n));
 assert.throws(()=>signup(f,identity('sixth')),{status:400});
 assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM users').get().n,5);assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM purchases').get().n,0);
 await assert.rejects(f.s.login(u.email,'anything at all'),{status:401});
 const reset=f.s.issueEmailAction(u.id,'reset');await f.s.resetPassword(reset,'A new personal password!');assert.ok(await f.s.login(u.email,'A new personal password!'));
});
test('Microsoft and missing-contact signup require mailbox verification; proofs reject another browser and replay',t=>{
 const f=fixture(t),i={...identity('ms','microsoft'),email:''},p=f.s.social.authenticated(i,f.context,'browser').proof;
 assert.equal(f.s.social.profile(p,'browser').email,'');assert.throws(()=>f.s.social.profile(p,'wrong'),{status:400});
 const r=f.s.social.complete(p,'browser','person@outlook.com');assert.equal(f.s.user(r.token).emailVerified,false);
 assert.throws(()=>f.s.social.complete(p,'browser','person@outlook.com'),{status:400});
 const token=f.s.issueEmailAction(f.s.user(r.token).id,'verify');f.s.verifyEmail(token);assert.equal(f.s.user(r.token).emailVerified,true);
});
test('connecting social identity requires a fresh verified session, rejects collisions and rechecks session revocation',async t=>{
 const f=fixture(t),token=await f.s.register('existing@example.test','A unique test password 123!'),u=f.s.user(token);
 const context={purpose:'link',userId:u.id,sessionHash:createHash('sha256').update(token).digest('hex')};
 assert.throws(()=>f.s.social.authenticated(identity(),context,'browser'),{status:401});
 f.s.verifyEmail(f.s.issueEmailAction(u.id,'verify'));f.s.social.authenticated(identity(),context,'browser');
 assert.equal(f.s.social.methods(u.id).length,1);assert.equal(f.s.user(f.s.social.authenticated(identity(),{purpose:'login'},'x').token).id,u.id);
 assert.throws(()=>f.s.social.authenticated(identity('different'),context,'browser'),{status:409});
 f.s.logout(token);assert.throws(()=>f.s.social.authenticated(identity('ms','microsoft'),context,'browser'),{status:401});
 const newer=await f.s.login(u.email,'A unique test password 123!');context.sessionHash=createHash('sha256').update(newer).digest('hex');f.advance(600001);assert.throws(()=>f.s.social.authenticated(identity('ms','microsoft'),context,'browser'),{status:401});
});
test('social identity export excludes proof material and retention removes identities and expired requests',t=>{
 const f=fixture(t),r=signup(f),u=f.s.user(r.token);f.s.social.begin('google','browser',f.context);
 const exported=f.s.accountExport(u.id);assert.equal(exported.connectedSignins[0].provider,'google');
 assert.equal('subject' in exported.connectedSignins[0],false);f.advance(188*86400000);maintainRetention(f.s,{apply:true});
 assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM social_identities').get().n,0);assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM social_states').get().n,0);
});
function oidcFixture(provider='google'){
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
 const issuer=provider==='google'?'https://accounts.google.com':'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0';let changes={},wrongSignature=false,seenVerifier;
 const jwt=claims=>{const input=[{alg:'RS256',kid:'test-key'},claims].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return input+'.'+sign('RSA-SHA256',Buffer.from(input),wrongSignature?generateKeyPairSync('rsa',{modulusLength:2048}).privateKey:privateKey).toString('base64url');};
 const transport=async(input,options)=>{
  const url=new URL(input instanceof Request?input.url:input);let result;
  if(url.pathname.endsWith('/.well-known/openid-configuration'))result={issuer:provider==='microsoft'?'https://login.microsoftonline.com/{tenantid}/v2.0':issuer,authorization_endpoint:provider==='google'?'https://accounts.google.com/authorize':'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/keys',response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256'],subject_types_supported:['public'],token_endpoint_auth_methods_supported:['client_secret_post']};
  else if(url.pathname.endsWith('/keys'))result={keys:[jwk]};
  else if(url.pathname.endsWith('/token')){seenVerifier=new URLSearchParams(options.body).get('code_verifier');const now=Math.floor(Date.now()/1000);result={access_token:'not-stored',token_type:'Bearer',expires_in:300,id_token:jwt({iss:issuer,sub:'stable-id',aud:'client-id',iat:now,exp:now+300,nonce:'expected-nonce',email:'learner@gmail.com',email_verified:true,...(provider==='microsoft'?{tid:'9188040d-6c67-4c5b-b112-36a304b66dad'}:{}),...changes})};}
  else throw new Error('Unexpected OIDC endpoint');
  return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
 };
 return {provider:createIdentityProvider({[provider]:{clientId:'client-id',clientSecret:'test-client-secret'}},{transport}),change:c=>{changes=c;},breakSignature:()=>{wrongSignature=true;},verifier:()=>seenVerifier};
}
test('OIDC validates signatures, audience, nonce and state using real signed tokens; scopes omit mailbox and file access',async()=>{
 const f=oidcFixture(),flow={state:'expected-state',nonce:'expected-nonce',verifier:'a'.repeat(43)},url=new URL(origin+'/callback?code=one&state=expected-state');
 const auth=new URL(await f.provider.authorization('google',{...flow,redirect:origin+'/callback'}));assert.equal(auth.searchParams.get('scope'),'openid email');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
 assert.equal((await f.provider.identity('google',url,flow)).verified,true);assert.equal(f.verifier(),flow.verifier);
 await assert.rejects(f.provider.identity('google',new URL(origin+'/callback?code=one&state=wrong'),flow));
 f.change({nonce:'wrong'});await assert.rejects(f.provider.identity('google',url,flow));f.change({aud:'another-app'});await assert.rejects(f.provider.identity('google',url,flow));
 f.change({exp:1});await assert.rejects(f.provider.identity('google',url,flow));f.change({});f.breakSignature();await assert.rejects(f.provider.identity('google',url,flow));
 const thirdParty=oidcFixture();thirdParty.change({email:'person@elsewhere.test'});assert.equal((await thirdParty.provider.identity('google',url,flow)).verified,false);
});
test('Microsoft consumer issuer works with personal accounts and rejects organization tenants',async()=>{
 const f=oidcFixture('microsoft'),flow={state:'expected-state',nonce:'expected-nonce',verifier:'a'.repeat(43)},url=new URL(origin+'/callback?code=one&state=expected-state');
 assert.equal((await f.provider.identity('microsoft',url,flow)).verified,false);f.change({tid:'organization-tenant'});await assert.rejects(f.provider.identity('microsoft',url,flow));
 assert.deepEqual(providerSettings({}),{});assert.throws(()=>providerSettings({GOOGLE_SIGNIN_ENABLED:'true'}));
});
test('HTTP social flow requires agreement and same-origin start, survives cross-site callback, then verifies contact; disabled providers have no buttons',async t=>{
 const f=fixture(t);let saved;const fake={names:()=>[{id:'microsoft',label:'Microsoft'}],authorization:async(p,flow)=>{saved=flow;return 'https://login.microsoftonline.com/consumers/authorize?state='+flow.state;},identity:async()=>identity('ms','microsoft')};
 const server=createApp({store:f.s,origin,base:'/mcip-sandbox',secure:false,trialEnabled:true,requireVerification:true,mailer:async()=>{},social:fake});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}/mcip-sandbox`,post=(path,data,headers={})=>fetch(base+'/api/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 const image=await fetch(base+'/student/google-signin.png');assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/^image\/png/);assert.equal(Buffer.from(await image.arrayBuffer()).subarray(1,4).toString(),'PNG');
 assert.equal((await post('social/microsoft/start',{purpose:'signup',invite:f.invite.token})).status,400);
 assert.equal((await post('social/microsoft/start',{purpose:'login'},{Origin:'https://other.test'})).status,403);
 const start=await post('social/microsoft/start',{purpose:'signup',invite:f.invite.token,accepted:true,version:TRIAL_VERSION});assert.equal(start.status,200);const cookie=start.headers.get('set-cookie').split(';')[0];assert.match(start.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
 const callback=base+'/api/social/microsoft/callback?code=synthetic&state='+saved.state;
 const wrong=await fetch(callback,{redirect:'manual'});assert.match(wrong.headers.get('location'),/#social=failed/);
 const valid=await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'});const proof=new URL(valid.headers.get('location')).hash.split('=')[1];assert.ok(proof);assert.equal(f.s.db.prepare('SELECT COUNT(*) n FROM trial_access').get().n,0);
 const completed=await post('social/complete',{proof,email:'ms@outlook.com'},{Cookie:cookie});assert.equal(completed.status,201);assert.match(completed.headers.get('set-cookie'),/SameSite=Strict/);
 const sessionCookie=completed.headers.get('set-cookie').split(';')[0],session=await(await fetch(base+'/api/session',{headers:{Cookie:sessionCookie}})).json();assert.equal(session.user.emailVerified,false);assert.equal(session.enrollment,false);assert.equal(session.access.active,true);
 const replay=await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'});assert.match(replay.headers.get('location'),/#social=failed/);
 const disabled=createApp({store:f.s,origin});await new Promise(r=>disabled.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>disabled.close(r)));const state=await(await fetch(`http://127.0.0.1:${disabled.address().port}/mcip/api/session`)).json();assert.deepEqual(state.socialProviders,[]);
});
