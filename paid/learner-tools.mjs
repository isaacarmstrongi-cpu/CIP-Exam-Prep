import {randomUUID} from 'node:crypto';
import {lessons} from './study-content.mjs';
const DAY=86400000,MINUTE=60000;
export const cards=lessons.flatMap(l=>[
 {id:l.id+'-concept',lesson:l.id,domain:l.domain,title:l.title,front:l.question,back:[l.answer]},
 {id:l.id+'-decisions',lesson:l.id,domain:l.domain,title:l.title,front:`You face a scenario about ${l.title.toLowerCase()}. What decision sequence should you follow, and which common mistakes should you avoid?`,back:[...l.steps,'Avoid these mistakes:',...l.traps]}
]);
const localDay=(time,zone)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
const calendar=time=>new Date(time).toISOString().slice(0,10);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&calendar(Date.parse(s))===s;
export function confidenceSummary(attempts,bank){
 const byId=new Map(bank.map(q=>[q.id,q])),latest=new Map();
 for(const a of attempts)for(const [id,choice] of Object.entries(a.answers)){
  if(a.status!=='submitted'&&!(a.mode==='study'&&a.checked?.includes(id)))continue;
  const q=byId.get(id);if(!q)continue;const at=a.checkedAt?.[id]||a.submittedAt||a.startedAt;
  if(!latest.has(id)||latest.get(id).at<=at)latest.set(id,{at,id,domain:q.domain,objective:q.objective,confidence:a.confidence?.[id]||null,correct:choice===q.correctIndex});
 }
 const rows=[...latest.values()],rated=rows.filter(r=>r.confidence),groups=['confident','unsure','guessing'].map(label=>{const list=rated.filter(r=>r.confidence===label);return {label,total:list.length,correct:list.filter(r=>r.correct).length};});
 return {rated:rated.length,unrated:rows.length-rated.length,groups,confidentMistakes:rated.filter(r=>r.confidence==='confident'&&!r.correct).map(({domain,objective})=>({domain,objective})),correctGuesses:rated.filter(r=>r.confidence==='guessing'&&r.correct).map(({domain,objective})=>({domain,objective}))};
}
export function createLearnerTools(store,Problem){
 const s=store,db=s.db;
 db.exec(`CREATE TABLE IF NOT EXISTS study_plans(user_id TEXT PRIMARY KEY REFERENCES users(id),body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS flashcard_progress(user_id TEXT NOT NULL REFERENCES users(id),card_id TEXT NOT NULL,rating TEXT,streak INTEGER NOT NULL DEFAULT 0,reviews INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL DEFAULT 0,last_review INTEGER,reveal_token TEXT,reveal_expires INTEGER,last_token TEXT,PRIMARY KEY(user_id,card_id));`);
 function requireLearning(userId){s.requireAccess(userId);if(s.history(userId).some(a=>a.status==='active'&&a.mode==='simulation'))throw new Problem(409,'Finish or submit your timed exam before opening learning tools.');}
 function confidence(userId){return confidenceSummary(db.prepare('SELECT body FROM attempts WHERE user_id=? ORDER BY rowid').all(userId).map(r=>JSON.parse(r.body)),s.bank);}
 function getPlan(userId){return JSON.parse(db.prepare('SELECT body FROM study_plans WHERE user_id=?').get(userId)?.body||'null');}
 function savePlan(userId,data){
  requireLearning(userId);const {examDate,minutes,days,timeZone}=data;
  if(!validDate(examDate)||![15,30,45,60,90,120].includes(minutes)||!Array.isArray(days)||!days.length||days.length>7||new Set(days).size!==days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6)||typeof timeZone!=='string'||timeZone.length>80)throw new Problem(400,'Choose a valid exam date, daily study time and at least one study day.');
  try{localDay(s.now(),timeZone);}catch{throw new Problem(400,'Choose a supported time zone.');}
  const today=localDay(s.now(),timeZone),span=(Date.parse(examDate)-Date.parse(today))/DAY;if(span<1||span>365)throw new Problem(400,'Choose an exam date from tomorrow through the next 365 days.');
  const old=getPlan(userId),same=old&&old.examDate===examDate&&old.minutes===minutes&&old.timeZone===timeZone&&JSON.stringify([...old.days].sort())===JSON.stringify([...days].sort());
  const plan={examDate,minutes,days:[...days].sort(),timeZone,created:old?.created||s.now(),updated:s.now(),completed:same?old.completed:[]};
  db.prepare('INSERT INTO study_plans VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body').run(userId,JSON.stringify(plan));return plan;
 }
 function planView(userId){
  requireLearning(userId);const plan=getPlan(userId),insights=s.learning.insights(userId);if(!plan)return {plan:null,sessions:[],priorities:insights.priorities.map(d=>({id:d.id,short:d.short}))};
  const today=localDay(s.now(),plan.timeZone),start=Date.parse(today),anchor=Date.parse(localDay(plan.created,plan.timeZone)),end=Date.parse(plan.examDate),expiry=s.access(userId).expires,expiryDate=localDay(expiry,plan.timeZone),completed=new Set(plan.completed),sessions=[];
  const ordered=[...insights.priorities].sort((a,b)=>a.assessed===0&&b.assessed>0?1:a.assessed>0&&b.assessed===0?-1:0),sequence=ordered.map(d=>d.id);
  // Recompute suggestions from current assessed needs. Completion is an explicit learner check, not inferred mastery.
  let index=0;
  for(let day=anchor;day<end&&day<=Date.parse(expiryDate)&&sessions.length<14;day+=DAY){
   const date=calendar(day);if(!plan.days.includes(new Date(day).getUTCDay()))continue;
   const domain=sequence[Math.floor(index/3)%sequence.length],kind=['read','practice','cards'][index%3],lesson=lessons.filter(l=>l.domain===domain)[Math.floor(index/15)%lessons.filter(l=>l.domain===domain).length];
   if(day>=start)sessions.push({date,domain,kind,lesson:lesson.id,title:lesson.title,minutes:plan.minutes,completed:completed.has(date)});index++;
  }
  return {plan,sessions,today,priorities:ordered.map(d=>({id:d.id,short:d.short})),daysRemaining:Math.max(0,Math.round((end-start)/DAY)),weeklyMinutes:plan.days.length*plan.minutes,accessEndsBeforeExam:plan.examDate>expiryDate,accessEnd:expiryDate};
 }
 function completePlan(userId,{date,done}){
  requireLearning(userId);const plan=getPlan(userId);if(!plan||typeof done!=='boolean'||!validDate(date)||!planView(userId).sessions.some(s=>s.date===date))throw new Problem(400,'Choose a displayed study task.');
  if(done&&date>localDay(s.now(),plan.timeZone))throw new Problem(400,'Future tasks cannot be marked complete yet.');
  plan.completed=plan.completed.filter(d=>d!==date);if(done)plan.completed.push(date);db.prepare('UPDATE study_plans SET body=? WHERE user_id=?').run(JSON.stringify(plan),userId);return planView(userId);
 }
 function cardList(userId,{domain=null,filter='due'}={}){
  requireLearning(userId);if((domain!==null&&![1,2,3,4,5].includes(domain))||!['due','all'].includes(filter))throw new Problem(400,'Choose an available flashcard view.');
  const progress=new Map(db.prepare('SELECT card_id,rating,streak,reviews,due FROM flashcard_progress WHERE user_id=?').all(userId).map(r=>[r.card_id,r]));
  const eligible=cards.filter(c=>!domain||c.domain===domain),due=eligible.filter(c=>progress.get(c.id)?.reviews>0&&progress.get(c.id).due<=s.now()),fresh=eligible.filter(c=>!progress.get(c.id)?.reviews);
  const list=filter==='all'?eligible:[...due.sort((a,b)=>progress.get(a.id).due-progress.get(b.id).due),...fresh];
  return {cards:list.map(({id,lesson,domain,title,front})=>({id,lesson,domain,title,front,progress:progress.get(id)||null})),total:eligible.length,due:due.length,new:fresh.length,reviewed:eligible.filter(c=>progress.get(c.id)?.reviews>0).length,serverTime:s.now()};
 }
 function revealCard(userId,id){
  requireLearning(userId);const card=cards.find(c=>c.id===id);if(!card)throw new Problem(404,'Flashcard not found.');
  const row=db.prepare('SELECT * FROM flashcard_progress WHERE user_id=? AND card_id=?').get(userId,id);if(row?.reveal_expires>s.now())return {card,reviewToken:row.reveal_token};
  const token=randomUUID();db.prepare('INSERT INTO flashcard_progress(user_id,card_id,reveal_token,reveal_expires) VALUES(?,?,?,?) ON CONFLICT(user_id,card_id) DO UPDATE SET reveal_token=excluded.reveal_token,reveal_expires=excluded.reveal_expires').run(userId,id,token,s.now()+30*MINUTE);return {card,reviewToken:token};
 }
 function rateCard(userId,id,{rating,reviewToken}){
  requireLearning(userId);if(!cards.some(c=>c.id===id)||!['again','hard','good','easy'].includes(rating)||typeof reviewToken!=='string')throw new Problem(400,'Reveal a card and choose a review rating.');
  const row=db.prepare('SELECT * FROM flashcard_progress WHERE user_id=? AND card_id=?').get(userId,id);
  if(row?.last_token===reviewToken)return {due:row.due,rating:row.rating};
  if(!row||row.reveal_token!==reviewToken||row.reveal_expires<=s.now())throw new Problem(409,'Reveal this card again before rating it.');
  const streak=rating==='again'?0:row.streak+1,days=rating==='hard'?1:rating==='good'?[1,3,7,14,30][Math.min(4,streak-1)]:[3,7,14,30,60][Math.min(4,streak-1)],due=s.now()+(rating==='again'?10*MINUTE:days*DAY);
  db.prepare('UPDATE flashcard_progress SET rating=?,streak=?,reviews=reviews+1,due=?,last_review=?,last_token=?,reveal_token=NULL,reveal_expires=NULL WHERE user_id=? AND card_id=?').run(rating,streak,due,s.now(),reviewToken,userId,id);return {due,rating};
 }
 function exportData(userId){return {studyPlan:getPlan(userId),flashcards:db.prepare('SELECT card_id,rating,streak,reviews,due,last_review FROM flashcard_progress WHERE user_id=?').all(userId)};}
 return {requireLearning,confidence,getPlan,savePlan,planView,completePlan,cardList,revealCard,rateCard,exportData};
}
