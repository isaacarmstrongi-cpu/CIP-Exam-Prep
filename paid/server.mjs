import http from 'node:http';
import { readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { Store, Problem } from './store.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export function createApp({store,origin,base='/mcip',stripe,price,webhookSecret,live=false,enrollment=false,registrationOpen=enrollment,secure=true,now=Date.now}) {
  const limits=new Map(),checkoutLocks=new Set();
  function limit(key,max) {
    const time=now(),old=limits.get(key),bucket=old&&old.until>time?old:{until:time+60000,count:0};
    limits.set(key,bucket);if(++bucket.count>max)throw new Problem(429,'Please wait a minute and try again.');
    if(limits.size>10000)for(const [k,v]of limits)if(v.until<=time)limits.delete(k);
  }
  const ready=()=>Boolean(enrollment&&stripe&&price&&webhookSecret);
  const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));};
  const cookie=token=>`procip_session=${token}; Path=${base||'/'}; HttpOnly; SameSite=Strict; Max-Age=${token?604800:0}${secure?'; Secure':''}`;
  async function body(req) {
    const parts=[];let n=0;for await(const part of req){n+=part.length;if(n>65536)throw new Problem(413,'Request too large.');parts.push(part);}return Buffer.concat(parts);
  }
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,origin),path=url.pathname;
      if(path===`${base}/api/stripe/webhook`&&req.method==='POST') {
        if(!stripe||!webhookSecret)throw new Problem(503,'Payments are not configured.');
        const raw=await body(req);let event;
        try{event=stripe.webhooks.constructEvent(raw,req.headers['stripe-signature'],webhookSecret);}catch{throw new Problem(400,'Invalid payment signature.');}
        if(event.livemode!==live)throw new Problem(400,'Payment environment does not match.');
        if(event.type==='checkout.session.completed'){
          const session=await stripe.checkout.sessions.retrieve(event.data.object.id,{expand:['line_items']});
          store.rememberPayment(event,session,price,live);
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
        limit(req.socket.remoteAddress,240);
        if(!['GET','POST','PATCH'].includes(req.method))throw new Problem(405,'Method not allowed.');
        if(req.method!=='GET'&&req.headers.origin!==origin)throw new Problem(403,'Refresh this page and try again.');
        if(req.method!=='GET'&&!req.headers['content-type']?.startsWith('application/json'))throw new Problem(415,'JSON required.');
        let data={};if(req.method!=='GET'){try{data=JSON.parse((await body(req)).toString());}catch(e){if(e instanceof Problem)throw e;throw new Problem(400,'Invalid request.');}if(!data||typeof data!=='object'||Array.isArray(data))throw new Problem(400,'Invalid request.');}
        const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('procip_session='))?.slice(15)||'';
        const user=store.user(token);
        if(path===`${base}/api/session`&&req.method==='GET')return json(res,200,{user:user||null,access:user?store.access(user.id):null,enrollment:ready(),registrationOpen:registrationOpen&&ready(),sandbox:!live,serverTime:now()});
        if([`${base}/api/register`,`${base}/api/login`].includes(path)&&req.method==='POST'){
          limit(`auth:${req.socket.remoteAddress}`,10);
          if(path.endsWith('/register')&&(!ready()||!registrationOpen))throw new Problem(503,'Enrollment is not open yet.');
          const newToken=path.endsWith('/register')?await store.register(data.email,data.password):await store.login(data.email,data.password);
          if(token)store.logout(token);
          return json(res,200,{ok:true},{'Set-Cookie':cookie(newToken)});
        }
        if(!user)throw new Problem(401,'Please sign in.');
        if(path===`${base}/api/logout`&&req.method==='POST'){store.logout(token);return json(res,200,{ok:true},{'Set-Cookie':cookie('')});}
        if(path===`${base}/api/checkout`&&req.method==='POST'){
          if(!ready())throw new Problem(503,'Enrollment is not open yet.');
          if(store.access(user.id).active)throw new Problem(409,'Your package is already active.');
          if(checkoutLocks.has(user.id))throw new Problem(409,'Checkout is being prepared. Please try again.');
          checkoutLocks.add(user.id);
          try{
            const old=store.db.prepare('SELECT * FROM checkouts WHERE user_id=? ORDER BY expires DESC LIMIT 1').get(user.id);
            if(old&&old.expires>now())return json(res,200,{url:old.url});
            const session=await stripe.checkout.sessions.create({mode:'payment',allowed_payment_method_types:['card'],line_items:[{price,quantity:1}],client_reference_id:user.id,customer_email:user.email,success_url:`${origin}${base}/student/?payment=complete`,cancel_url:`${origin}${base}/student/?payment=cancelled`,expires_at:Math.floor(now()/1000)+3600},{idempotencyKey:`procip-${user.id}-${Math.floor(now()/1800000)}`});
            store.db.prepare('INSERT OR IGNORE INTO checkouts VALUES(?,?,?,?)').run(user.id,session.id,session.url,session.expires_at*1000);
            return json(res,200,{url:session.url});
          }finally{checkoutLocks.delete(user.id);}
        }
        if(path===`${base}/api/attempts`&&req.method==='GET')return json(res,200,{attempts:store.history(user.id)});
        if(path===`${base}/api/attempts`&&req.method==='POST')return json(res,201,store.view(user.id,store.start(user.id,data.set).id));
        const match=path.match(new RegExp(`^${base}/api/attempts/([a-zA-Z0-9-]+)(/submit)?$`));
        if(match){
          if(match[2]&&req.method==='POST')store.submit(user.id,match[1]);
          else if(!match[2]&&req.method==='PATCH')store.update(user.id,match[1],data);
          else if(req.method!=='GET'||match[2])throw new Problem(405,'Method not allowed.');
          return json(res,200,store.view(user.id,match[1]));
        }
        throw new Problem(404,'Not found.');
      }
      const files=new Map([[`${base}/student/`,['portal.html','text/html']],[`${base}/student/app.mjs`,['portal.mjs','text/javascript']],[`${base}/student/styles.css`,['portal.css','text/css']]]);
      if(req.method==='GET'&&files.has(path)){const[file,type]=files.get(path);res.setHeader('Content-Type',`${type}; charset=utf-8`);return res.end(readFileSync(resolve(root,file)));}
      throw new Problem(404,'Not found.');
    }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e instanceof Problem?e.message:'Something went wrong. Please try again.'});else res.end();if(!(e instanceof Problem))console.error('Request failed:',e.name);}
  });
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  const origin=process.env.PUBLIC_ORIGIN;if(!origin)throw new Error('PUBLIC_ORIGIN is required.');
  const local=origin.startsWith('http://127.0.0.1:');if(!local&&!origin.startsWith('https://'))throw new Error('HTTPS is required.');
  const bank=JSON.parse(readFileSync(process.env.BANK_PATH||resolve(root,'../dist/data/questions.json'),'utf8'));
  const dbPath=process.env.DATABASE_PATH||resolve(root,'../private/students.sqlite');mkdirSync(dirname(dbPath),{recursive:true,mode:0o700});
  const stripe=process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY,{maxNetworkRetries:2,timeout:15000}):null;
  const base=process.env.PUBLIC_BASE||'/mcip';if(!/^\/[a-z0-9-]+$/.test(base))throw new Error('PUBLIC_BASE must be a single safe path segment.');
  const store=new Store(dbPath,bank);
  if(process.env.STRIPE_LIVE==='false'&&process.env.SANDBOX_SEED_EMAIL?.endsWith('@example.test')&&process.env.SANDBOX_SEED_PASSWORD?.length>=24){
    try{const token=await store.register(process.env.SANDBOX_SEED_EMAIL,process.env.SANDBOX_SEED_PASSWORD);store.logout(token);}catch(e){if(!(e instanceof Problem)||e.status!==409)throw e;}
  }
  const server=createApp({store,origin,base,stripe,price:process.env.STRIPE_PRICE_ID,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,live:process.env.STRIPE_LIVE==='true',enrollment:process.env.ENROLLMENT_OPEN==='true',registrationOpen:process.env.REGISTRATION_OPEN!=='false'&&process.env.ENROLLMENT_OPEN==='true',secure:!local});
  server.listen(Number(process.env.PORT||4190),'127.0.0.1',()=>console.log('Student portal listening on the loopback interface. Enrollment is '+(process.env.ENROLLMENT_OPEN==='true'?'configured open':'closed')+'.'));
}

