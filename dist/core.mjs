export const DURATION_MS = 120 * 60 * 1000;
export const BANK_VERSION = 'cip-2023-500-v1';
export const DOMAINS = [
  {id:1,name:'Creating, capturing & sharing information',short:'Capture & share',weight:15},
  {id:2,name:'Extracting intelligence from information',short:'Extract intelligence',weight:20},
  {id:3,name:'Digitalizing information-intensive processes',short:'Digitalize processes',weight:20},
  {id:4,name:'Automating governance & compliance',short:'Governance & compliance',weight:30},
  {id:5,name:'Implementing an information management solution',short:'Implement solutions',weight:15}
];
export function createAttempt(set, now=Date.now(), id=crypto.randomUUID()) {
  return {id,set,version:BANK_VERSION,startedAt:now,deadline:now+DURATION_MS,answers:{},flags:[],index:0,status:'active'};
}
export function remainingMs(attempt,now=Date.now()) {return Math.max(0,attempt.deadline-now);}
export function answerAttempt(attempt,qid,choice,now=Date.now()) {
  if(attempt.status!=='active'||remainingMs(attempt,now)===0)return false;
  if(choice===null)delete attempt.answers[qid];
  else if(Number.isInteger(choice)&&choice>=0&&choice<4)attempt.answers[qid]=choice;
  else return false;
  return true;
}
export function finishAttempt(attempt,now=Date.now()) {
  if(attempt.status!=='active')return attempt;
  if(attempt.mode==='study')return {...attempt,status:'submitted',submittedAt:now,reason:'manual'};
  return {...attempt,status:'submitted',submittedAt:Math.min(now,attempt.deadline),reason:now>=attempt.deadline?'time':'manual'};
}
export function grade(attempt,bank) {
  const questions=attempt.mode==='study'?attempt.questionIds.map(id=>bank.find(q=>q.id===id)).filter(Boolean):bank.filter(q=>q.set===attempt.set);
  const outcomes=questions.map(q=>({q,selected:attempt.answers[q.id]??null,correct:attempt.answers[q.id]===q.correctIndex}));
  const correct=outcomes.filter(x=>x.correct).length;
  const answered=outcomes.filter(x=>x.selected!==null).length;
  const domains=DOMAINS.map(d=>{
    const rows=outcomes.filter(x=>x.q.domain===d.id),n=rows.filter(x=>x.correct).length,assessed=rows.filter(x=>x.selected!==null).length;
    return {...d,correct:n,assessed,total:rows.length,accuracy:assessed?Math.round(100*n/assessed):null,percent:rows.length?Math.round(100*n/rows.length):0,lost:rows.length-n};
  });
  const priorities=[...domains].sort((a,b)=>b.lost-a.lost||a.percent-b.percent||a.id-b.id);
  const score=questions.length?Math.round(correct*100/questions.length):0;
  const band=score>=80&&domains.every(d=>d.percent>=75)?'Strong practice performance':score>=60?'Passing range · keep strengthening':'Build your foundation';
  return {outcomes,correct,answered,total:questions.length,score,answeredAccuracy:answered?Math.round(100*correct/answered):null,domains,priorities,band};
}
export function validAttempt(a,bank) {
  if(!a||a.version!==BANK_VERSION||typeof a.id!=='string'||![4,5,6,7,8].includes(a.set)||!['active','submitted'].includes(a.status))return false;
  if(!Number.isFinite(a.startedAt)||!Number.isFinite(a.deadline)||a.deadline-a.startedAt!==DURATION_MS||!Number.isInteger(a.index)||a.index<0||a.index>=100)return false;
  if(!a.answers||typeof a.answers!=='object'||Array.isArray(a.answers)||!Array.isArray(a.flags))return false;
  const ids=new Set(bank.filter(q=>q.set===a.set).map(q=>q.id));
  if(!Object.entries(a.answers).every(([id,v])=>ids.has(id)&&Number.isInteger(v)&&v>=0&&v<4)||!a.flags.every(id=>ids.has(id)))return false;
  if(a.status==='submitted'&&(!Number.isFinite(a.submittedAt)||a.submittedAt<a.startedAt||a.submittedAt>a.deadline))return false;
  return true;
}
export function formatTime(ms) {const s=Math.ceil(ms/1000);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
