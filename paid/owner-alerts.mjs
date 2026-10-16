import {randomUUID} from 'node:crypto';

// No learner emails, answers, invitation tokens or credentials enter these messages.
export function ownerAlertMessage(event){
 if(event.kind==='setup_test')return {subject:'Pro CIP Exam Prep: notification setup test',text:'This is a setup test of your friends-trial activity alerts. No tester signed up and no trial place was consumed. Future messages report a new trial account and that account’s first exam or study session.\n\nPro CIP Exam Prep'};
 const p=event.payload,label=`Tester ${p.tester} of ${p.limit}`;
 return {subject:`Pro CIP Exam Prep: ${event.kind==='signup'?'new trial account':'first learning session'}`,
  text:`${label} ${event.kind==='signup'?'created a free trial account.':p.mode==='study'?'started their first study session.':`started their first timed exam (Exam ${p.exam}).`}\n\nRecorded: ${new Date(event.occurred).toISOString()}\n${event.kind==='signup'?'Email verification is still required before using the learning tools.':'This reports a session start, not completion or a certification result.'}\n\nNo payment was taken. This operational alert omits learner email addresses, answers, passwords and invitation links.\n\nPro CIP Exam Prep`};
}

export function createOwnerAlerts(store){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS owner_alerts(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,occurred INTEGER NOT NULL,payload TEXT NOT NULL,queued INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',sent INTEGER,provider_id TEXT,attempts INTEGER NOT NULL DEFAULT 0,
 first_attempt INTEGER,next_attempt INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,kind));`);
 let busy=false;
 const queue=(userId,kind,occurred,payload)=>db.prepare('INSERT OR IGNORE INTO owner_alerts(id,user_id,kind,occurred,payload,queued) VALUES(?,?,?,?,?,?)').run(randomUUID(),userId,kind,occurred,JSON.stringify(payload),store.now());
 return {
  capture(){
   const trials=db.prepare('SELECT a.rowid AS sequence,a.*,i.max_uses FROM trial_access a JOIN trial_invites i ON i.id=a.invite_id JOIN users u ON u.id=a.user_id WHERE u.retired=0 ORDER BY a.rowid').all();
   for(const row of trials){
    const tester=db.prepare('SELECT COUNT(*) AS n FROM trial_access WHERE invite_id=? AND rowid<=?').get(row.invite_id,row.sequence).n;
    const payload={tester,limit:row.max_uses};queue(row.user_id,'signup',row.created,payload);
    const first=db.prepare("SELECT body FROM attempts WHERE user_id=? AND json_extract(body,'$.startedAt')>=? ORDER BY rowid LIMIT 1").get(row.user_id,row.created);
    if(first){const a=JSON.parse(first.body);queue(row.user_id,'first_session',a.startedAt,{...payload,mode:a.mode==='study'?'study':'simulation',exam:a.mode==='study'?null:a.set-3});}
   }
  },
  async dispatch(send,{log=console.error}={}){
   if(busy)return;busy=true;
   try{
    this.capture();
    const rows=db.prepare("SELECT * FROM owner_alerts WHERE status='pending' AND next_attempt<=? ORDER BY queued,rowid LIMIT 10").all(store.now());
    for(const row of rows){
     // Resend retains idempotency keys for 24h. Never blindly replay an uncertain send beyond that window.
     if(row.first_attempt!==null&&store.now()-row.first_attempt>=23*3600000){db.prepare("UPDATE owner_alerts SET status='review_required' WHERE id=?").run(row.id);log('Owner activity alert needs operator review after an interrupted delivery window.');continue;}
     db.prepare('UPDATE owner_alerts SET first_attempt=COALESCE(first_attempt,?),attempts=attempts+1,next_attempt=? WHERE id=?').run(store.now(),store.now()+60000,row.id);
     try{
      const result=await send({id:row.id,kind:row.kind,occurred:row.occurred,payload:JSON.parse(row.payload)});
      db.prepare("UPDATE owner_alerts SET status='sent',sent=?,provider_id=? WHERE id=?").run(store.now(),result.id,row.id);
     }catch(error){
      const failed=error.retryable===false||row.attempts+1>=8;
      db.prepare('UPDATE owner_alerts SET status=?,next_attempt=? WHERE id=?').run(failed?'review_required':'pending',store.now()+Math.min(3600000,60000*2**row.attempts),row.id);
      log(failed?'Owner activity alert delivery needs operator review.':'Owner activity alert delivery will retry.');
     }
    }
   }finally{busy=false;}
  }
 };
}

export function startOwnerAlerts(alerts,send,{intervalMs=30000,log=console.error}={}){
 const tick=()=>alerts.dispatch(send,{log}).catch(()=>log('Owner activity alert worker needs operator review.'));
 const timer=setInterval(tick,intervalMs);timer.unref();void tick();
 return ()=>clearInterval(timer);
}
