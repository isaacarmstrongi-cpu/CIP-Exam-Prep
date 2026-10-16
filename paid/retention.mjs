import {grade,finishAttempt} from '../dist/core.mjs';
const DAY=86400000;
export const RETENTION={unverifiedDays:30,unpaidDays:180,studyDays:180,financialYears:7,backupDays:30};
function yearsAfter(time,years){const date=new Date(time);date.setUTCFullYear(date.getUTCFullYear()+years);return date.getTime();}

// Operator maintenance only. No public route exposes this function or the hold table.
export function maintainRetention(store,{apply=false}={}){
 const db=store.db,now=store.now();
 db.exec(`CREATE TABLE IF NOT EXISTS retention_holds(user_id TEXT PRIMARY KEY REFERENCES users(id),until INTEGER NOT NULL,reason TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS financial_contacts(user_id TEXT PRIMARY KEY REFERENCES users(id),email TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS study_totals(year INTEGER NOT NULL,exam INTEGER NOT NULL,domain INTEGER NOT NULL,learners INTEGER NOT NULL,attempts INTEGER NOT NULL,correct INTEGER NOT NULL,total INTEGER NOT NULL,PRIMARY KEY(year,exam,domain));`);
 if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='retired'))db.exec('ALTER TABLE users ADD COLUMN retired INTEGER NOT NULL DEFAULT 0');
 const result={apply,retiredAccounts:0,deletedAccounts:0,deletedAttempts:0,expiredPurchases:0,heldAccounts:0};
 const users=db.prepare('SELECT * FROM users').all();
 if(apply)db.exec('BEGIN IMMEDIATE');
 try{
  for(const user of users){
   const hold=db.prepare('SELECT until FROM retention_holds WHERE user_id=?').get(user.id);
   if(hold?.until>now){result.heldAccounts++;continue;}
   const purchases=db.prepare('SELECT * FROM purchases WHERE user_id=?').all(user.id);
   const trial=db.prepare('SELECT expires FROM trial_access WHERE user_id=?').get(user.id);
   const latestExpiry=purchases.length||trial?Math.max(...purchases.map(p=>p.expires),trial?.expires||0):null;
   const due=!user.email_verified&&!purchases.length?user.created+RETENTION.unverifiedDays*DAY<=now:latestExpiry!==null?latestExpiry+RETENTION.studyDays*DAY<=now:user.created+RETENTION.unpaidDays*DAY<=now;
   if(due){
    const rows=db.prepare('SELECT body FROM attempts WHERE user_id=?').all(user.id);
    result.deletedAttempts+=rows.length;
    const totals=new Map();
    for(const row of rows){
     const attempt=finishAttempt(JSON.parse(row.body),now),score=grade(attempt,store.bank),year=new Date(attempt.startedAt).getUTCFullYear();
     for(const domain of score.domains.filter(d=>d.total)){const key=`${year}:${attempt.set}:${domain.id}`,total=totals.get(key)||{year,exam:attempt.set,domain:domain.id,attempts:0,correct:0,total:0};total.attempts++;total.correct+=domain.correct;total.total+=domain.total;totals.set(key,total);}
    }
    if(apply){
     for(const total of totals.values())db.prepare('INSERT INTO study_totals VALUES(?,?,?,1,?,?,?) ON CONFLICT(year,exam,domain) DO UPDATE SET learners=learners+1,attempts=attempts+excluded.attempts,correct=correct+excluded.correct,total=total+excluded.total').run(total.year,total.exam,total.domain,total.attempts,total.correct,total.total);
     db.prepare('DELETE FROM attempts WHERE user_id=?').run(user.id);
     db.prepare('DELETE FROM question_reviews WHERE user_id=?').run(user.id);
     db.prepare('DELETE FROM owner_alerts WHERE user_id=?').run(user.id);
     db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
     db.prepare('DELETE FROM email_actions WHERE user_id=?').run(user.id);
     // Keep only minimal contact/purchase evidence while financial retention remains.
     if(!user.retired)db.prepare('INSERT OR IGNORE INTO financial_contacts VALUES(?,?)').run(user.id,user.email);
     db.prepare('UPDATE users SET email=?,password=?,email_verified=0,retired=1 WHERE id=?').run(`retired-${user.id}@retired.invalid`,`${'0'.repeat(32)}:${'0'.repeat(128)}`,user.id);
     db.prepare('UPDATE checkouts SET url=? WHERE user_id=?').run('',user.id);
    }
    if(!user.retired)result.retiredAccounts++;
   }
   const expired=purchases.filter(p=>yearsAfter(p.created,RETENTION.financialYears)<=now);
   result.expiredPurchases+=expired.length;
   if(apply)for(const purchase of expired){
    db.prepare('DELETE FROM checkout_agreements WHERE checkout_id=?').run(purchase.id);
    db.prepare('DELETE FROM checkouts WHERE checkout_id=?').run(purchase.id);
    db.prepare('DELETE FROM revocations WHERE payment_intent=?').run(purchase.payment_intent);
    db.prepare('DELETE FROM purchases WHERE id=?').run(purchase.id);
   }
   if(due&&expired.length===purchases.length){
    result.deletedAccounts++;
    if(apply){
     for(const table of ['trial_access','sessions','email_actions','attempts','checkout_agreements','checkouts','policy_acceptances','retention_holds','financial_contacts'])db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user.id);
     db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    }
   }
  }
  if(apply){
   for(const table of ['sessions','email_actions','rate_limits'])db.prepare(`DELETE FROM ${table} WHERE expires<=?`).run(now);
   db.exec('COMMIT');
  }
  return result;
 }catch(error){if(apply)db.exec('ROLLBACK');throw error;}
}

// Suppress small cohorts; stored totals have no account IDs, emails or individual answers.
export function studyAnalytics(store){return store.db.prepare('SELECT * FROM study_totals WHERE learners>=10 ORDER BY year,exam,domain').all();}
