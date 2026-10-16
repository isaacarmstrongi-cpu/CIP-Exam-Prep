// Operator-only CLI. Writes a sensitive invitation to stdout once, never an HTTP admin endpoint.
import {readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Store} from './store.mjs';
export function issueTrialFromEnvironment(env=process.env){
 if(env.STRIPE_LIVE!=='false'||env.FRIENDS_TRIAL_ENABLED!=='true'||env.ENROLLMENT_OPEN!=='false'||env.REGISTRATION_OPEN!=='false')throw new Error('Trial invitation requires the enabled isolated trial service with sales and public registration closed.');
 if(!env.DATABASE_PATH||!env.BANK_PATH||!/^https:\/\//.test(env.PUBLIC_ORIGIN)||!/^\/[a-z0-9-]+$/.test(env.PUBLIC_BASE||''))throw new Error('Explicit trial database, bank and HTTPS origin/base are required.');
 const store=new Store(env.DATABASE_PATH,JSON.parse(readFileSync(env.BANK_PATH,'utf8')));
 try{const invite=store.trials.issue({maxUses:5,validDays:7});return {...invite,url:`${env.PUBLIC_ORIGIN}${env.PUBLIC_BASE}/student/#invite=${invite.token}`};}finally{store.db.close();}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(issueTrialFromEnvironment()));
