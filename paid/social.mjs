import {randomBytes,randomUUID,createHash} from 'node:crypto';
import * as oidc from 'openid-client';
const hash=s=>createHash('sha256').update(s).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const TENANT='9188040d-6c67-4c5b-b112-36a304b66dad';
export const PROVIDERS={google:{label:'Google',issuer:'https://accounts.google.com',host:'accounts.google.com'},microsoft:{label:'Microsoft',issuer:'https://login.microsoftonline.com/consumers/v2.0',host:'login.microsoftonline.com'}};
export function providerSettings(env=process.env){
 return Object.fromEntries(Object.keys(PROVIDERS).filter(p=>env[`${p.toUpperCase()}_SIGNIN_ENABLED`]==='true').map(p=>{
  const clientId=env[`${p.toUpperCase()}_CLIENT_ID`],clientSecret=env[`${p.toUpperCase()}_CLIENT_SECRET`];
  if(!clientId||!clientSecret)throw new Error('Enabled social sign-in requires complete provider credentials.');
  return [p,{clientId,clientSecret}];
 }));
}
export function createIdentityProvider(settings,{transport}={}){
 const cache=new Map();
 async function configuration(provider){
  if(!PROVIDERS[provider]||!settings[provider])throw new Error('Provider unavailable.');
  if(!cache.has(provider))cache.set(provider,(async()=>{
   const s=settings[provider],config=await oidc.discovery(new URL(PROVIDERS[provider].issuer),s.clientId,s.clientSecret,undefined,transport?{[oidc.customFetch]:transport}:undefined);
   config.timeout=15;oidc.enableNonRepudiationChecks(config);if(transport)config[oidc.customFetch]=transport;return config;
  })().catch(e=>{cache.delete(provider);throw e;}));
  return cache.get(provider);
 }
 return {
  names:()=>Object.keys(settings).filter(p=>PROVIDERS[p]).map(id=>({id,label:PROVIDERS[id].label})),
  async authorization(provider,{state,nonce,verifier,redirect}){
   const config=await configuration(provider),challenge=await oidc.calculatePKCECodeChallenge(verifier);
   const url=oidc.buildAuthorizationUrl(config,{redirect_uri:redirect,scope:'openid email',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',state,nonce});
   if(url.protocol!=='https:'||url.hostname!==PROVIDERS[provider].host)throw new Error('Unexpected provider endpoint.');return url.href;
  },
  async identity(provider,url,{state,nonce,verifier}){
   const tokens=await oidc.authorizationCodeGrant(await configuration(provider),url,{pkceCodeVerifier:verifier,expectedState:state,expectedNonce:nonce,idTokenExpected:true});
   const c=tokens.claims();
   if(!c||typeof c.sub!=='string'||!c.sub||c.sub.length>512||typeof c.iss!=='string')throw new Error('Invalid provider identity.');
   if(provider==='microsoft'&&c.tid!==TENANT)throw new Error('Use a personal Microsoft account.');
   const email=typeof c.email==='string'?c.email.trim().toLowerCase():'';
   // A third-party address in a Google account is not proof of current mailbox ownership.
   const verified=provider==='google'&&c.email_verified===true&&(/@gmail\.com$/.test(email)||typeof c.hd==='string'&&Boolean(c.hd));
   return {provider,issuer:c.iss,subject:c.sub,email,verified};
  }
 };
}
export function createSocialStore(store,Problem){
 const db=store.db,invalid=()=>new Problem(400,'This sign-in request expired or does not match this browser. Please start again.');
 db.exec(`CREATE TABLE IF NOT EXISTS social_identities(provider TEXT NOT NULL,issuer TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),created INTEGER NOT NULL,PRIMARY KEY(provider,issuer,subject),UNIQUE(user_id,provider));
 CREATE TABLE IF NOT EXISTS social_states(token TEXT PRIMARY KEY,binding TEXT NOT NULL,provider TEXT NOT NULL,body TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS social_profiles(token TEXT PRIMARY KEY,binding TEXT NOT NULL,body TEXT NOT NULL,expires INTEGER NOT NULL);`);
 const purge=()=>{for(const t of ['social_states','social_profiles'])db.prepare(`DELETE FROM ${t} WHERE expires<=?`).run(store.now());};
 const validIdentity=i=>{if(!PROVIDERS[i?.provider]||typeof i.issuer!=='string'||typeof i.subject!=='string'||!i.subject)throw invalid();};
 const find=i=>db.prepare('SELECT s.user_id FROM social_identities s JOIN users u ON u.id=s.user_id WHERE provider=? AND issuer=? AND subject=? AND u.retired=0').get(i.provider,i.issuer,i.subject)?.user_id;
 const attach=(id,i)=>{try{db.prepare('INSERT INTO social_identities VALUES(?,?,?,?,?)').run(i.provider,i.issuer,i.subject,id,store.now());}catch(e){if(e.code?.includes('CONSTRAINT')||e.message.includes('UNIQUE'))throw new Problem(409,'This sign-in method is already connected. Use the original account or contact support.');throw e;}};
 function take(table,token,binding,provider){
  purge();if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||typeof binding!=='string')throw invalid();
  const row=db.prepare(`DELETE FROM ${table} WHERE token=? AND binding=? ${provider?'AND provider=?':''} RETURNING body`).get(...[hash(token),hash(binding),...(provider?[provider]:[])]);
  if(!row)throw invalid();return JSON.parse(row.body);
 }
 return {
  methods:id=>db.prepare('SELECT provider,created FROM social_identities WHERE user_id=?').all(id),
  begin(provider,binding,context){
   if(!PROVIDERS[provider])throw invalid();purge();const state=random(),nonce=random(),verifier=oidc.randomPKCECodeVerifier();
   db.prepare('INSERT INTO social_states VALUES(?,?,?,?,?)').run(hash(state),hash(binding),provider,JSON.stringify({nonce,verifier,context}),store.now()+10*60000);
   return {state,nonce,verifier};
  },
  takeState:(state,binding,provider)=>take('social_states',state,binding,provider),
  authenticated(i,context,binding){
   validIdentity(i);const id=find(i);
   if(context.purpose==='link'){
    // Recheck the original session, including revocation while the provider was open.
    const u=db.prepare('SELECT u.id,u.email_verified,s.authenticated FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.retired=0').get(context.sessionHash,store.now());if(!u||u.id!==context.userId||!u.email_verified||store.now()-u.authenticated>10*60000)throw new Problem(401,'Sign in again before connecting a sign-in method.');
    if(id&&id!==u.id)throw new Problem(409,'This sign-in method belongs to another account.');
    if(!id)attach(u.id,i);return {token:store.newSession(u.id)};
   }
   if(id)return {token:store.newSession(id)};
   if(context.purpose!=='signup'||!context.inviteId)throw new Problem(403,'New accounts need a valid invitation. If you already have an account, sign in with your original method and connect this one from your dashboard.');
   const proof=random();purge();db.prepare('INSERT INTO social_profiles VALUES(?,?,?,?)').run(hash(proof),hash(binding),JSON.stringify({identity:i,context}),store.now()+10*60000);
   return {proof};
  },
  complete(proof,binding,email){
   const {identity:i,context}=take('social_profiles',proof,binding);validIdentity(i);
   email=typeof email==='string'?email.trim().toLowerCase():'';
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new Problem(400,'Enter a valid contact email and start sign-in again.');
   const existing=find(i);if(existing)return {token:store.newSession(existing),created:false};
   db.exec('BEGIN IMMEDIATE');
   try{
    if(store.accountByEmail(email))throw new Problem(409,'An account uses this email. Sign in with your original method, then connect Google or Microsoft from your dashboard.');
    const id=randomUUID(),verified=i.verified&&email===i.email;
    db.prepare('INSERT INTO users(id,email,password,created,email_verified,password_enabled) VALUES(?,?,?,?,?,0)').run(id,email,`${'0'.repeat(32)}:${'0'.repeat(128)}`,store.now(),verified?1:0);
    store.trials.activateReference(id,context.inviteId,context.agreement);attach(id,i);
    const token=store.newSession(id);db.exec('COMMIT');return {token,created:true};
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  profile(proof,binding){purge();if(typeof proof!=='string'||typeof binding!=='string')throw invalid();const row=db.prepare('SELECT body FROM social_profiles WHERE token=? AND binding=?').get(hash(proof),hash(binding));if(!row)throw invalid();const {identity}=JSON.parse(row.body);return {provider:identity.provider,email:identity.email||'',verified:identity.verified};}
 };
}
