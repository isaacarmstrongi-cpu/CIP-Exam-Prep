import { createHash } from 'node:crypto';
import {ownerAlertMessage} from './owner-alerts.mjs';

export function createOwnerAlertSender({key,from,to,fetcher=fetch}){
 if(!to)return null;
 if(!key||!from||/[\r\n]/.test(from)||to!=='isaacarmstrong@live.com')throw new Error('Owner alerts require the approved recipient and configured sending service.');
 return async event=>{
  const message=ownerAlertMessage(event);
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`procip-owner-${event.id}`},body:JSON.stringify({from,to:[to],...message})});
  if(!response.ok){const error=new Error('Owner alert delivery was not accepted.');error.retryable=response.status===429||response.status>=500;throw error;}
  const result=await response.json();if(typeof result.id!=='string'||!result.id)throw new Error('Owner alert delivery confirmation is missing.');return {id:result.id};
 };
}

export function createEmailSender({key,from,origin,base='/mcip',fetcher=fetch}){
  if(!key||!from)return null;
  if(/[\r\n]/.test(from)||!/^https:\/\//.test(origin))throw new Error('Invalid email sender configuration.');
  return async ({to,purpose,token})=>{
    const reset=purpose==='reset';
    if(!reset&&purpose!=='verify')throw new Error('Invalid email purpose.');
    const link=`${origin}${base}/student/#${purpose}=${encodeURIComponent(token)}`;
    const response=await fetcher('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':createHash('sha256').update(`${purpose}:${token}`).digest('hex')},
      body:JSON.stringify({from,to:[to],reply_to:'isaacarmstrong@live.com',subject:reset?'Reset your Pro CIP Exam Prep password':'Verify your Pro CIP Exam Prep email',text:`${reset?'Reset your password':'Verify your email address'}:\n\n${link}\n\nThis link expires in ${reset?'30 minutes':'24 hours'} and works once. ${reset?'If you did not request a password reset, ignore this message. Your current password will remain unchanged.':'If you did not create an account, ignore this message.'}\n\nPro CIP Exam Prep\nSupport: isaacarmstrong@live.com`})
    });
    if(!response.ok)throw new Error('Email delivery was not accepted.');
  };
}
