import http from 'node:http';
import { readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { isIP } from 'node:net';
import { Store, Problem } from './store.mjs';
import { createEmailSender,createOwnerAlertSender } from './email.mjs';
import {startOwnerAlerts} from './owner-alerts.mjs';
import {POLICY_VERSION,POLICY_DIGEST,policySnapshot,policyPage,purchaseConfirmationPage} from './policies.mjs';
import {TRIAL_VERSION} from './trials.mjs';
import {createHash,randomBytes} from 'node:crypto';
import {createIdentityProvider,providerSettings,PROVIDERS} from './social.mjs';
import {lessons,libraryIndex,lessonForObjective,sources,STUDY_VERSION} from './study-content.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export function clientAddress(req,trustProxy=false){
  const peer=req.socket.remoteAddress;
  // Apache appends the actual client as the last X-Forwarded-For entry.
  if(trustProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)){
    const forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim();
    if(isIP(forwarded))return forwarded;
  }
  return peer;
}
export function createApp({store,origin,base='/mcip',stripe,price,webhookSecret,live=false,enrollment=false,registrationOpen=enrollment,secure=true,now=Date.now,mailer=null,requireVerification=live,trustProxy=false,policiesApproved=!live,launchApproved=!live,trialEnabled=false,social=null}) {
  if(trialEnabled&&(live||!requireVerification||!mailer||!policiesApproved))throw new Error('Friends trial requires an isolated non-live service, approved policies and verified account email.');
  const checkoutLocks=new Set();
  const ready=()=>Boolean(!trialEnabled&&enrollment&&stripe&&price&&webhookSecret&&policiesApproved&&launchApproved&&(!requireVerification||mailer));
  const sendAction=(user,purpose)=>{const token=store.issueEmailAction(user.id,purpose);Promise.resolve().then(()=>mailer({to:user.email,purpose,token})).catch(()=>console.error('Account email delivery failed; resend is available.'));};
  const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));};
  const cookie=token=>`procip_session=${token}; Path=${base||'/'}; HttpOnly; SameSite=Strict; Max-Age=${token?604800:0}${secure?'; Secure':''}`;
  const bindingCookie=token=>`procip_oauth=${token}; Path=${base||'/'}; HttpOnly; SameSite=Lax; Max-Age=${token?600:0}${secure?'; Secure':''}`;
  const readCookie=(req,name)=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
  const redirect=(res,fragment,headers={})=>{res.writeHead(303,{Location:`${origin}${base}/student/${fragment||''}`,...headers});res.end();};
  async function body(req) {
    const parts=[];let n=0;for await(const part of req){n+=part.length;if(n>65536)throw new Problem(413,'Request too large.');parts.push(part);}return Buffer.concat(parts);
  }
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,origin),path=url.pathname;
      const policyRoute=path.match(new RegExp(`^${base}/policies/(terms|privacy|refunds)$`));
      if(policyRoute&&req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(policyPage(policyRoute[1],{base,approved:policiesApproved}));}
      if(path===`${base}/api/stripe/webhook`&&req.method==='POST') {
        if(!stripe||!webhookSecret)throw new Problem(503,'Payments are not configured.');
        const raw=await body(req);let event;
        try{event=stripe.webhooks.constructEvent(raw,req.headers['stripe-signature'],webhookSecret);}catch{throw new Problem(400,'Invalid payment signature.');}
        if(event.livemode!==live)throw new Problem(400,'Payment environment does not match.');
        if(event.type==='checkout.session.completed'){
          const session=await stripe.checkout.sessions.retrieve(event.data.object.id,{expand:['line_items']});
          store.rememberPayment(event,session,price,live,policiesApproved);
        } else if(event.type==='charge.refunded'){
          // Retrieve the current charge so out-of-order events cannot undo a refund.
          const charge=await stripe.charges.retrieve(event.data.object.id);
          if(charge.refunded&&typeof charge.payment_intent==='string')store.revoke(charge.payment_intent);
        } else if(event.type==='charge.dispute.created'){
          const charge=await stripe.charges.retrieve(event.data.object.charge);
          if(typeof charge.payment_intent==='string')store.revoke(charge.payment_intent);
        }
        return json(res,200,{received:true});
      }
      if(path.startsWith(`${base}/api/`)) {
        const address=clientAddress(req,trustProxy);
        store.limit(`requests:${address}`,240);
        if(!['GET','POST','PATCH'].includes(req.method))throw new Problem(405,'Method not allowed.');
        if(req.method!=='GET'&&req.headers.origin!==origin)throw new Problem(403,'Refresh this page and try again.');
        if(req.method!=='GET'&&!req.headers['content-type']?.startsWith('application/json'))throw new Problem(415,'JSON required.');
        let data={};if(req.method!=='GET'){try{data=JSON.parse((await body(req)).toString());}catch(e){if(e instanceof Problem)throw e;throw new Problem(400,'Invalid request.');}if(!data||typeof data!=='object'||Array.isArray(data))throw new Problem(400,'Invalid request.');}
        const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('procip_session='))?.slice(15)||'';
        const user=store.user(token);
        const socialRoute=path.match(new RegExp(`^${base}/api/social/(google|microsoft)/(start|callback)$`));
        if(socialRoute){
          const [,provider,operation]=socialRoute;if(!social?.names().some(p=>p.id===provider))throw new Problem(404,'This sign-in option is not available.');
          store.limit(`social:${address}`,30);
          if(operation==='start'&&req.method==='POST'){
            const purpose=data.purpose;let context={purpose};
            if(purpose==='signup'){
              if(!trialEnabled)throw new Problem(403,'New accounts need a trial invitation.');
              if(data.accepted!==true||data.version!==TRIAL_VERSION)throw new Problem(400,'Read and agree to the free-trial terms before continuing.');
              context.inviteId=store.trials.reference(data.invite);context.agreement={accepted:true,version:TRIAL_VERSION};
            }else if(purpose==='link'){
              if(!user?.emailVerified||now()-user.authenticatedAt>10*60000)throw new Problem(401,'Sign out and sign in again before connecting a sign-in method.');
              context.userId=user.id;context.sessionHash=createHash('sha256').update(token).digest('hex');
            }else if(purpose!=='login')throw new Problem(400,'Choose a sign-in action.');
            const binding=randomBytes(32).toString('base64url'),flow=store.social.begin(provider,binding,context);
            const target=await social.authorization(provider,{...flow,redirect:`${origin}${base}/api/social/${provider}/callback`});
            const u=new URL(target);if(u.protocol!=='https:'||u.hostname!==PROVIDERS[provider].host)throw new Error('Unexpected sign-in endpoint.');
            return json(res,200,{url:target},{'Set-Cookie':bindingCookie(binding)});
          }
          if(operation==='callback'&&req.method==='GET'){
            try{
              const binding=readCookie(req,'procip_oauth'),state=url.searchParams.get('state'),flow=store.social.takeState(state,binding,provider);
              if(url.searchParams.has('error'))throw new Problem(400,'Provider sign-in was cancelled.');
              const identity=await social.identity(provider,url,{...flow,state});
              const result=store.social.authenticated(identity,flow.context,binding);
              if(result.proof)return redirect(res,`#social_profile=${result.proof}`);
              if(token)store.logout(token);
              return redirect(res,'#social=success',{'Set-Cookie':[cookie(result.token),bindingCookie('')]});
            }catch{return redirect(res,'#social=failed',{'Set-Cookie':bindingCookie('')});}
          }
          throw new Problem(405,'Method not allowed.');
        }
        if(path===`${base}/api/social/profile`&&req.method==='POST'){
          if(!social||!trialEnabled)throw new Problem(404,'Not found.');
          store.limit(`social-profile:${address}`,20);return json(res,200,store.social.profile(data.proof,readCookie(req,'procip_oauth')));
        }
        if(path===`${base}/api/social/complete`&&req.method==='POST'){
          if(!social||!trialEnabled)throw new Problem(404,'Not found.');
          store.limit(`social-complete:${address}`,10,3600000);
          const result=store.social.complete(data.proof,readCookie(req,'procip_oauth'),data.email),account=store.user(result.token);
          if(result.created&&!account.emailVerified)sendAction(account,'verify');if(token)store.logout(token);
          return json(res,201,{ok:true},{'Set-Cookie':[cookie(result.token),bindingCookie('')]});
        }
        if(path===`${base}/api/session`&&req.method==='GET')return json(res,200,{user:user||null,access:user?store.access(user.id):null,enrollment:ready(),registrationOpen:registrationOpen&&ready(),sandbox:!live,trial:trialEnabled,requireVerification,recoveryAvailable:Boolean(mailer),socialProviders:social?.names()||[],connectedSignins:user?store.social.methods(user.id):[],policies:{version:POLICY_VERSION,approved:policiesApproved},serverTime:now()});
        if(path===`${base}/api/trial/info`&&req.method==='POST'){
          if(!trialEnabled)throw new Problem(404,'Not found.');
          store.limit(`trial-info:${address}`,30);return json(res,200,store.trials.info(data.invite));
        }
        if(path===`${base}/api/trial/register`&&req.method==='POST'){
          if(!trialEnabled)throw new Problem(404,'Not found.');
          store.limit(`trial-register:${address}`,10,3600000);
          store.trials.info(data.invite);
          if(data.accepted!==true||data.version!==TRIAL_VERSION)throw new Problem(400,'Read and agree to the free-trial terms before continuing.');
          const newToken=await store.register(data.email,data.password),account=store.user(newToken);
          try{store.trials.activate(account.id,data.invite,data);}catch(e){store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);store.db.prepare('DELETE FROM users WHERE id=?').run(account.id);throw e;}
          sendAction(account,'verify');if(token)store.logout(token);
          return json(res,201,{ok:true},{'Set-Cookie':cookie(newToken)});
        }
        if(path===`${base}/api/verify-email`&&req.method==='POST'){store.verifyEmail(data.token);return json(res,200,{ok:true});}
        if(path===`${base}/api/reset-password`&&req.method==='POST'){store.limit(`reset:${address}`,10);await store.resetPassword(data.token,data.password);return json(res,200,{ok:true},{'Set-Cookie':cookie('')});}
        if(path===`${base}/api/forgot-password`&&req.method==='POST'){
          if(!mailer)throw new Problem(503,'Email recovery is not available yet. Contact support.');
          store.limit(`recovery-ip:${address}`,10);store.limit(`recovery-email:${String(data.email).trim().toLowerCase().slice(0,254)}`,3,3600000);
          const account=store.accountByEmail(data.email);if(account)sendAction(account,'reset');
          return json(res,202,{ok:true,message:'If an account matches that address, a reset link will be sent. Check your inbox and spam folder.'});
        }
        if([`${base}/api/register`,`${base}/api/login`].includes(path)&&req.method==='POST'){
          store.limit(`auth-ip:${address}`,30);store.limit(`auth-account:${String(data.email).trim().toLowerCase().slice(0,254)}`,10);
          if(path.endsWith('/register')&&(!ready()||!registrationOpen))throw new Problem(503,'Enrollment is not open yet.');
          const newToken=path.endsWith('/register')?await store.register(data.email,data.password):await store.login(data.email,data.password);
          if(path.endsWith('/register')&&requireVerification){const account=store.user(newToken);store.limit(`verify:${account.id}`,3,3600000);sendAction(account,'verify');}
          if(token)store.logout(token);
          return json(res,200,{ok:true},{'Set-Cookie':cookie(newToken)});
        }
        if(!user)throw new Problem(401,'Please sign in.');
        if(path===`${base}/api/account-data`&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="pro-cip-account-data.json"');return json(res,200,store.accountExport(user.id));}
        if(path===`${base}/api/purchase-confirmations`&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="pro-cip-purchase-confirmations.html"');res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(purchaseConfirmationPage(store.purchaseConfirmations(user.id),{sandbox:!live}));}
        if(path===`${base}/api/logout`&&req.method==='POST'){store.logout(token);return json(res,200,{ok:true},{'Set-Cookie':cookie('')});}
        if(path===`${base}/api/resend-verification`&&req.method==='POST'){
          if(!mailer)throw new Problem(503,'Email delivery is not available yet.');
          if(!user.emailVerified){store.limit(`verify:${user.id}`,3,3600000);sendAction(user,'verify');}
          return json(res,202,{ok:true});
        }
        if(requireVerification&&!user.emailVerified)throw new Problem(403,'Verify your email address before continuing.');
        if(path===`${base}/api/study-notes`&&req.method==='GET'){
          store.requireAccess(user.id);
          if(store.history(user.id).some(a=>a.status==='active'&&a.mode==='simulation'))throw new Problem(409,'Finish or submit your timed exam before opening study notes.');
          const id=url.searchParams.get('id'),objective=url.searchParams.get('objective');
          if(id||objective){const lesson=id?lessons.find(l=>l.id===id):lessonForObjective(objective);if(!lesson)throw new Problem(404,'Study lesson not found.');return json(res,200,{lesson,sources:Object.fromEntries(lesson.sources.map(key=>[key,sources[key]]))});}
          return json(res,200,{lessons:libraryIndex(),version:STUDY_VERSION});
        }
        if(path===`${base}/api/trial/activate`&&req.method==='POST'){
          if(!trialEnabled)throw new Problem(404,'Not found.');
          return json(res,200,store.trials.activate(user.id,data.invite,data));
        }
        if(path===`${base}/api/insights`&&req.method==='GET')return json(res,200,store.learning.insights(user.id));
        if(path===`${base}/api/practice`&&req.method==='POST')return json(res,201,store.view(user.id,store.learning.start(user.id,data).id));
        if(path===`${base}/api/checkout`&&req.method==='POST'){
          if(!ready())throw new Problem(503,'Enrollment is not open yet.');
          if(store.access(user.id).active)throw new Problem(409,'Your package is already active.');
          if(data.accepted!==true||data.policyVersion!==POLICY_VERSION)throw new Problem(400,'Read and agree to the current student terms before checkout.');
          if(checkoutLocks.has(user.id))throw new Problem(409,'Checkout is being prepared. Please try again.');
          checkoutLocks.add(user.id);
          try{
            store.acceptPolicies(user.id,{version:POLICY_VERSION,digest:POLICY_DIGEST,document:policySnapshot});
            const old=store.db.prepare('SELECT c.* FROM checkouts c JOIN checkout_agreements a ON c.checkout_id=a.checkout_id WHERE c.user_id=? AND a.user_id=? AND a.version=? ORDER BY c.expires DESC LIMIT 1').get(user.id,user.id,POLICY_VERSION);
            if(old&&old.expires>now())return json(res,200,{url:old.url});
            const session=await stripe.checkout.sessions.create({mode:'payment',allowed_payment_method_types:['card'],wallet_options:{link:{display:'never'}},line_items:[{price,quantity:1}],client_reference_id:user.id,customer_email:user.email,metadata:{policy_version:POLICY_VERSION,policy_digest:POLICY_DIGEST},success_url:`${origin}${base}/student/?payment=complete`,cancel_url:`${origin}${base}/student/?payment=cancelled`,expires_at:Math.floor(now()/1000)+3600},{idempotencyKey:`procip-${POLICY_VERSION}-${user.id}-${Math.floor(now()/1800000)}`});
            store.rememberCheckout(user.id,session,POLICY_VERSION);
            return json(res,200,{url:session.url});
          }finally{checkoutLocks.delete(user.id);}
        }
        if(path===`${base}/api/attempts`&&req.method==='GET')return json(res,200,{attempts:store.history(user.id)});
        if(path===`${base}/api/attempts`&&req.method==='POST')return json(res,201,store.view(user.id,store.start(user.id,data.set).id));
        const match=path.match(new RegExp(`^${base}/api/attempts/([a-zA-Z0-9-]+)(/(?:submit|check))?$`));
        if(match){
          if(match[2]==='/submit'&&req.method==='POST')store.submit(user.id,match[1]);
          else if(match[2]==='/check'&&req.method==='POST')store.learning.check(user.id,match[1]);
          else if(!match[2]&&req.method==='PATCH')store.update(user.id,match[1],data);
          else if(req.method!=='GET'||match[2])throw new Problem(405,'Method not allowed.');
          const response=store.view(user.id,match[1]);if(url.searchParams.get('state')==='1'&&response.attempt.status==='active')delete response.questions;
          return json(res,200,response);
        }
        throw new Problem(404,'Not found.');
      }
      const files=new Map([[`${base}/student/google-signin.png`,['google-signin.png','image/png']],[`${base}/student/`,['portal.html','text/html']],[`${base}/student/app.mjs`,['portal.mjs','text/javascript']],[`${base}/student/ui.mjs`,['ui.mjs','text/javascript']],[`${base}/student/study-ui.mjs`,['study-ui.mjs','text/javascript']],[`${base}/student/styles.css`,['portal.css','text/css']]]);
      if(req.method==='GET'&&files.has(path)){const[file,type]=files.get(path);res.setHeader('Content-Type',`${type}; charset=utf-8`);return res.end(readFileSync(resolve(root,file)));}
      throw new Problem(404,'Not found.');
    }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e instanceof Problem?e.message:'Something went wrong. Please try again.'});else res.end();if(!(e instanceof Problem))console.error('Request failed:',e.name);}
  });
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  const origin=process.env.PUBLIC_ORIGIN;if(!origin)throw new Error('PUBLIC_ORIGIN is required.');
  if(process.env.POLICIES_APPROVED==='true'&&(!process.env.SELLER_PUBLIC_ADDRESS?.trim()||process.env.RETENTION_ENABLED!=='true'))throw new Error('Published policies require the approved public seller address and enabled retention maintenance.');
  const local=origin.startsWith('http://127.0.0.1:');if(!local&&!origin.startsWith('https://'))throw new Error('HTTPS is required.');
  const bank=JSON.parse(readFileSync(process.env.BANK_PATH||resolve(root,'../dist/data/questions.json'),'utf8'));
  const dbPath=process.env.DATABASE_PATH||resolve(root,'../private/students.sqlite');mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
  const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY,{maxNetworkRetries:2,timeout:15000}):null;
  const base=process.env.PUBLIC_BASE||'/mcip';if(!/^\/[a-z0-9-]+$/.test(base))throw new Error('PUBLIC_BASE must be a single safe path segment.');
  const store=new Store(dbPath,bank);
  if(process.env.STRIPE_LIVE==='false'&&process.env.SANDBOX_SEED_EMAIL?.endsWith('@example.test')&&process.env.SANDBOX_SEED_PASSWORD?.length>=24){
    try{const token=await store.register(process.env.SANDBOX_SEED_EMAIL,process.env.SANDBOX_SEED_PASSWORD);store.logout(token);}catch(e){if(!(e instanceof Problem)||e.status!==409)throw e;}
  }
  const mailer=createEmailSender({key:process.env.RESEND_API_KEY,from:process.env.MAIL_FROM,origin,base});
  const trialEnabled=process.env.FRIENDS_TRIAL_ENABLED==='true';
  const social=createIdentityProvider(providerSettings());
  const server=createApp({social,store,origin,base,stripe,price:process.env.STRIPE_PRICE_ID,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,live:process.env.STRIPE_LIVE==='true',enrollment:process.env.ENROLLMENT_OPEN==='true',registrationOpen:process.env.REGISTRATION_OPEN!=='false'&&process.env.ENROLLMENT_OPEN==='true',secure:!local,mailer,requireVerification:trialEnabled||process.env.STRIPE_LIVE==='true',trustProxy:process.env.TRUST_PROXY==='loopback',policiesApproved:process.env.POLICIES_APPROVED==='true',launchApproved:process.env.LAUNCH_APPROVED==='true',trialEnabled});
  if(process.env.OWNER_ALERTS_TO){
    if(!trialEnabled)throw new Error('Owner trial alerts require the isolated friends-trial service.');
    const send=createOwnerAlertSender({key:process.env.RESEND_API_KEY,from:process.env.MAIL_FROM,to:process.env.OWNER_ALERTS_TO});
    server.once('listening',()=>{const stop=startOwnerAlerts(store.ownerAlerts,send);server.once('close',stop);});
  }
  server.listen(Number(process.env.PORT||4190),'127.0.0.1',()=>console.log('Student portal listening on the loopback interface. Enrollment is '+(process.env.ENROLLMENT_OPEN==='true'?'configured open':'closed')+'.'));
}

