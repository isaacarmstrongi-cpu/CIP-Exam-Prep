import {randomBytes,createHash,randomUUID} from 'node:crypto';
export const TRIAL_VERSION='friends-2026-10-16-v1';
export const TRIAL_DAYS=7;
export const TRIAL_TERMS='Friends-and-family trial: seven consecutive days from account activation, free access to all five exams and study tools, unlimited retakes, no card, no charge, no subscription and no automatic conversion to paid access. Use your own account. This is a pre-launch evaluation; practice results do not guarantee certification outcomes. Account and study data are retained for up to 180 days after trial expiry under the privacy notice; no financial purchase record is created. Email feedback or support requests to isaacarmstrong@live.com. The account, permitted-use and privacy provisions of the linked student policies also apply; their paid-package price and 90-day duration do not apply to this free trial.';
const hash=s=>createHash('sha256').update(s).digest('hex'),DAY=86400000;
export function createTrials(store,Problem){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS trial_invites(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,created INTEGER NOT NULL,expires INTEGER NOT NULL,max_uses INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS trial_access(user_id TEXT PRIMARY KEY REFERENCES users(id),invite_id TEXT NOT NULL REFERENCES trial_invites(id),created INTEGER NOT NULL,expires INTEGER NOT NULL,version TEXT NOT NULL,terms TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);`);
 const invite=token=>{
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Problem(400,'This invitation is invalid, full, or expired. Contact support.');
  const row=db.prepare('SELECT * FROM trial_invites WHERE token_hash=? AND expires>? AND revoked=0').get(hash(token),store.now());
  if(!row)throw new Problem(400,'This invitation is invalid, full, or expired. Contact support.');return row;
 };
 const used=id=>db.prepare('SELECT COUNT(*) AS n FROM trial_access WHERE invite_id=?').get(id).n;
 return {
  issue({maxUses=5,validDays=7}={}){
   if(!Number.isInteger(maxUses)||maxUses<1||maxUses>25||!Number.isInteger(validDays)||validDays<1||validDays>30)throw new Error('Invalid trial invitation limits.');
   const token=randomBytes(32).toString('base64url'),id=randomUUID(),created=store.now(),expires=created+validDays*DAY;
   db.prepare('INSERT INTO trial_invites(id,token_hash,created,expires,max_uses) VALUES(?,?,?,?,?)').run(id,hash(token),created,expires,maxUses);
   return {token,id,expires,maxUses};
  },
  info(token){const row=invite(token);if(used(row.id)>=row.max_uses)throw new Problem(400,'This invitation is invalid, full, or expired. Contact support.');return {days:TRIAL_DAYS,version:TRIAL_VERSION,terms:TRIAL_TERMS,expires:row.expires};},
  activate(userId,token,{accepted=false,version}={}){
   if(accepted!==true||version!==TRIAL_VERSION)throw new Problem(400,'Read and agree to the free-trial terms before continuing.');
   db.exec('BEGIN IMMEDIATE');
   try{
    const row=invite(token),old=db.prepare('SELECT * FROM trial_access WHERE user_id=?').get(userId);
    if(old){if(old.invite_id!==row.id)throw new Problem(409,'This account has already used a free trial.');db.exec('COMMIT');return this.access(userId);}
    if(used(row.id)>=row.max_uses)throw new Problem(400,'This invitation is invalid, full, or expired. Contact support.');
    const created=store.now();db.prepare('INSERT INTO trial_access(user_id,invite_id,created,expires,version,terms) VALUES(?,?,?,?,?,?)').run(userId,row.id,created,created+TRIAL_DAYS*DAY,TRIAL_VERSION,TRIAL_TERMS);
    db.exec('COMMIT');return this.access(userId);
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  access(userId){const row=db.prepare('SELECT a.*,i.revoked AS invite_revoked FROM trial_access a JOIN trial_invites i ON i.id=a.invite_id WHERE a.user_id=?').get(userId);return {active:Boolean(row&&!row.revoked&&!row.invite_revoked&&row.expires>store.now()),expires:row?.expires??null,kind:'trial'};},
  revoke(id){db.prepare('UPDATE trial_invites SET revoked=1 WHERE id=?').run(id);}
 };
}
