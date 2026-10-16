import {randomUUID,randomInt} from 'node:crypto';
import {DOMAINS,BANK_VERSION,grade} from '../dist/core.mjs';
const DAY=86400000;
export function createLearning(store,Problem){
 const s=store,db=s.db;
 db.exec('CREATE TABLE IF NOT EXISTS question_reviews(user_id TEXT NOT NULL REFERENCES users(id),question_id TEXT NOT NULL,last_correct INTEGER NOT NULL,last_seen INTEGER NOT NULL,next_due INTEGER NOT NULL,streak INTEGER NOT NULL,exposures INTEGER NOT NULL,PRIMARY KEY(user_id,question_id));');
 const questions=a=>a.mode==='study'?a.questionIds.map(id=>s.bank.find(q=>q.id===id)).filter(Boolean):s.bank.filter(q=>q.set===a.set);
 const record=(userId,qid,correct,observedAt=s.now())=>{
  const old=db.prepare('SELECT * FROM question_reviews WHERE user_id=? AND question_id=?').get(userId,qid),streak=correct?(old?.streak||0)+1:0;
  if(old?.last_seen>observedAt)return;
  const days=correct?[1,3,7,14,30][Math.min(4,streak-1)]:1;
  db.prepare('INSERT INTO question_reviews VALUES(?,?,?,?,?,?,1) ON CONFLICT(user_id,question_id) DO UPDATE SET last_correct=excluded.last_correct,last_seen=excluded.last_seen,next_due=excluded.next_due,streak=excluded.streak,exposures=exposures+1').run(userId,qid,correct?1:0,observedAt,observedAt+days*DAY,streak);
 };
 const completed=(userId,a)=>{
  if(a.reviewRecorded)return;
  db.exec('BEGIN IMMEDIATE');
  try{for(const q of questions(a))if(a.answers[q.id]!==undefined&&!a.checked?.includes(q.id))record(userId,q.id,a.answers[q.id]===q.correctIndex,a.submittedAt||s.now());a.reviewRecorded=true;s.saveAttempt(userId,a);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 };
 function insights(userId){
  const attempts=db.prepare('SELECT id FROM attempts WHERE user_id=? ORDER BY rowid').all(userId).map(row=>s.attempt(userId,row.id));
  // Backfill completed legacy attempts once, without changing their scores.
  for(const a of attempts)if(a.status==='submitted')completed(userId,a);
  const reviews=db.prepare('SELECT * FROM question_reviews WHERE user_id=?').all(userId),byId=new Map(reviews.map(r=>[r.question_id,r]));
  const domains=DOMAINS.map(domain=>{const rows=reviews.filter(r=>s.bank.find(q=>q.id===r.question_id)?.domain===domain.id),correct=rows.filter(r=>r.last_correct).length;return {...domain,assessed:rows.length,correct,accuracy:rows.length?Math.round(correct*100/rows.length):null,missed:rows.length-correct};});
  const priorities=[...domains].sort((a,b)=>((b.missed/Math.max(1,b.assessed))*b.weight)-((a.missed/Math.max(1,a.assessed))*a.weight)||a.assessed-b.assessed);
  const mocks=attempts.filter(a=>a.mode!=='study'&&a.status==='submitted'),first=new Map();for(const a of mocks)if(!first.has(a.set))first.set(a.set,a);
  const progress=mocks.slice(-10).map(a=>({id:a.id,exam:a.set-3,date:a.submittedAt,score:grade(a,s.bank).score,firstAttempt:first.get(a.set).id===a.id}));
  const active=attempts.filter(a=>a.status==='active').map(a=>({id:a.id,set:a.set,mode:a.mode||'simulation',index:a.index,count:questions(a).length,answered:Object.keys(a.answers).length,deadline:a.deadline}));
  return {domains,priorities,progress,active,assessed:reviews.length,total:s.bank.length,missed:reviews.filter(r=>!r.last_correct).length,due:reviews.filter(r=>r.next_due<=s.now()).length,reservedExam:5,
   firstAttemptAverage:first.size?Math.round([...first.values()].reduce((n,a)=>n+grade(a,s.bank).score,0)/first.size):null,firstAttemptCount:first.size,
   topics:priorities.slice(0,2).map(d=>{const qs=s.bank.filter(q=>q.domain===d.id&&byId.get(q.id)?.last_correct===0);return {domain:d.id,objectives:[...new Set(qs.map(q=>q.objective))].slice(0,4),references:qs.slice(0,2).map(q=>q.source)};})};
 }
 function start(userId,{filter='weakest',count=10,domain=null}={}){
  s.requireAccess(userId);
  if(!['weakest','missed','flagged','unseen','due','all'].includes(filter)||![5,10,20].includes(count)||(domain!==null&&![1,2,3,4,5].includes(domain)))throw new Problem(400,'Choose a study mode, 5, 10 or 20 questions, and an available domain.');
  const state=insights(userId),active=state.active.find(a=>a.mode==='study');if(active){const existing=s.attempt(userId,active.id);if(existing.filter!==filter||(existing.domain??null)!==domain)throw new Problem(409,'A study session is in progress. Resume or finish it before choosing a different focus.');return existing;}
  const rows=db.prepare('SELECT * FROM question_reviews WHERE user_id=?').all(userId),reviews=new Map(rows.map(r=>[r.question_id,r]));
  const flagged=new Set(db.prepare('SELECT body FROM attempts WHERE user_id=?').all(userId).flatMap(r=>JSON.parse(r.body).flags));
  let pool=s.bank.filter(q=>(q.set!==8||reviews.has(q.id))&&(!domain||q.domain===domain));
  if(filter==='weakest')pool=pool.filter(q=>q.domain===(domain||state.priorities[0].id));
  if(filter==='missed')pool=pool.filter(q=>reviews.get(q.id)?.last_correct===0);
  if(filter==='flagged')pool=pool.filter(q=>flagged.has(q.id));
  if(filter==='unseen')pool=pool.filter(q=>!reviews.has(q.id));
  if(filter==='due')pool=pool.filter(q=>reviews.has(q.id)&&reviews.get(q.id).next_due<=s.now());
  if(!pool.length)throw new Problem(400,filter==='due'?'No reviews are due yet. Try new questions or a weakest-domain session.':'No questions match yet. Try new questions or another domain.');
  for(let i=pool.length-1;i>0;i--){const j=randomInt(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
  const a={id:randomUUID(),mode:'study',filter,domain,set:0,version:BANK_VERSION,startedAt:s.now(),deadline:null,questionIds:pool.slice(0,count).map(q=>q.id),answers:{},flags:[],checked:[],index:0,status:'active'};s.saveAttempt(userId,a);return a;
 }
 function check(userId,id){
  s.requireAccess(userId);const a=s.attempt(userId,id),qid=a.questionIds?.[a.index];
  if(a.mode!=='study'||a.status!=='active'||a.answers[qid]===undefined)throw new Problem(400,'Choose an answer in an active study session first.');
  if(!a.checked.includes(qid)){db.exec('BEGIN IMMEDIATE');try{record(userId,qid,a.answers[qid]===s.bank.find(q=>q.id===qid).correctIndex);a.checked.push(qid);s.saveAttempt(userId,a);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
  return a;
 }
 return {questions,record,completed,insights,start,check};
}
