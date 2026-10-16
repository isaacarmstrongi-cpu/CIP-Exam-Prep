import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createAttempt, finishAttempt, grade } from '../dist/core.mjs';
const scrypt = promisify(scryptCallback);
export const ACCESS_MS = 90 * 24 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
export class Problem extends Error { constructor(status, message) { super(message); this.status = status; } }
export class Store {
  constructor(path, bank, now = Date.now) {
    this.db = new DatabaseSync(path); this.bank = bank; this.now = now;
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),payment_intent TEXT UNIQUE,created INTEGER NOT NULL,expires INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS revocations(payment_intent TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkouts(user_id TEXT NOT NULL REFERENCES users(id),checkout_id TEXT PRIMARY KEY,url TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS email_actions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,expires INTEGER NOT NULL,count INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS attempts_owner ON attempts(user_id);
      CREATE INDEX IF NOT EXISTS purchases_owner ON purchases(user_id);
    `);
    if(!this.db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='email_verified'))this.db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  }
  async register(email, password) {
    email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Problem(400, 'Enter a valid email address.');
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Problem(400, 'Use a password between 12 and 128 characters.');
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
    const id = randomUUID();
    try { this.db.prepare('INSERT INTO users(id,email,password,created) VALUES(?,?,?,?)').run(id,email,`${salt}:${key.toString('hex')}`,this.now()); }
    catch (e) { if (e.code?.includes('CONSTRAINT') || e.message.includes('UNIQUE')) throw new Problem(409, 'Unable to create this account. Try signing in.'); throw e; }
    return this.newSession(id);
  }
  async login(email, password) {
    if (typeof password !== 'string' || password.length > 128) throw new Problem(401, 'Email or password is incorrect.');
    const user = this.db.prepare('SELECT * FROM users WHERE email=?').get(String(email).trim().toLowerCase());
    const [salt, stored] = (user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
    const key = await scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
    if (!timingSafeEqual(key,Buffer.from(stored,'hex')) || !user) throw new Problem(401, 'Email or password is incorrect.');
    return this.newSession(user.id);
  }
  newSession(id) {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(this.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),id,this.now()+7*86400000);
    return token;
  }
  user(token='') { const user=this.db.prepare('SELECT u.id,u.email,u.email_verified FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(hash(token),this.now());return user?{id:user.id,email:user.email,emailVerified:Boolean(user.email_verified)}:undefined; }
  logout(token) { this.db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token)); }
  limit(key,max,window=60000){
    const digest=hash(key),time=this.now();
    this.db.prepare('DELETE FROM rate_limits WHERE expires<=?').run(time);
    const row=this.db.prepare('INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').get(digest,time+window);
    if(row.count>max)throw new Problem(429,'Please wait and try again.');
  }
  accountByEmail(email){return this.db.prepare('SELECT id,email FROM users WHERE email=?').get(typeof email==='string'?email.trim().toLowerCase():'');}
  issueEmailAction(userId,purpose){
    if(!['verify','reset'].includes(purpose))throw new Error('Invalid email action.');
    const token=randomBytes(32).toString('base64url');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM email_actions WHERE expires<=? OR (user_id=? AND purpose=?)').run(this.now(),userId,purpose);
      this.db.prepare('INSERT INTO email_actions VALUES(?,?,?,?)').run(hash(token),userId,purpose,this.now()+(purpose==='reset'?30*60000:24*60*60000));
      this.db.exec('COMMIT');return token;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  emailAction(token,purpose){
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Problem(400,'This link is invalid or has expired. Request a new one.');
    const row=this.db.prepare('SELECT user_id FROM email_actions WHERE token=? AND purpose=? AND expires>?').get(hash(token),purpose,this.now());
    if(!row)throw new Problem(400,'This link is invalid or has expired. Request a new one.');return row.user_id;
  }
  verifyEmail(token){
    this.db.exec('BEGIN IMMEDIATE');
    try{const id=this.emailAction(token,'verify');this.db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(id);this.db.prepare('DELETE FROM email_actions WHERE user_id=? AND purpose=?').run(id,'verify');this.db.exec('COMMIT');}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  async resetPassword(token,password){
    this.emailAction(token,'reset');
    if(typeof password!=='string'||password.length<12||password.length>128)throw new Problem(400,'Use a password between 12 and 128 characters.');
    const salt=randomBytes(16).toString('hex'),key=await scrypt(password,salt,64,{N:32768,maxmem:64*1024*1024});
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const id=this.emailAction(token,'reset');
      this.db.prepare('UPDATE users SET password=? WHERE id=?').run(`${salt}:${key.toString('hex')}`,id);
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM email_actions WHERE user_id=? AND purpose=?').run(id,'reset');
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  access(id) {
    const row = this.db.prepare('SELECT MAX(expires) AS expires FROM purchases WHERE user_id=? AND revoked=0').get(id);
    return {active: (row.expires ?? 0) > this.now(),expires:row.expires ?? null};
  }
  requireAccess(id) { if (!this.access(id).active) throw new Problem(403,'An active practice package is required.'); }
  rememberPayment(event, session, expectedPrice, live) {
    if (event.livemode !== live || session.livemode !== live) throw new Problem(400,'Payment environment does not match.');
    const items = session.line_items?.data;
    if (session.mode !== 'payment' || session.payment_status !== 'paid' || session.currency !== 'usd' ||
      session.amount_subtotal !== 4500 || items?.length !== 1 || items[0].price?.id !== expectedPrice || items[0].quantity !== 1 ||
      !session.payment_intent || typeof session.payment_intent !== 'string') throw new Problem(400,'Payment does not match the package.');
    const userId = session.client_reference_id;
    const checkout = this.db.prepare('SELECT * FROM checkouts WHERE checkout_id=? AND user_id=?').get(session.id,userId);
    if (!checkout) throw new Problem(400,'Payment is not associated with a student checkout.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('SELECT id FROM events WHERE id=?').get(event.id)) {
        const revoked = this.db.prepare('SELECT payment_intent FROM revocations WHERE payment_intent=?').get(session.payment_intent) ? 1 : 0;
        // Card-only Checkout completion is the purchase time. Delivery retries never extend access.
        const paidAt = event.created*1000;
        this.db.prepare('INSERT OR IGNORE INTO purchases VALUES(?,?,?,?,?,?)').run(session.id,userId,session.payment_intent,paidAt,paidAt+ACCESS_MS,revoked);
        this.db.prepare('INSERT INTO events VALUES(?,?)').run(event.id,this.now());
      }
      this.db.exec('COMMIT');
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  revoke(paymentIntent) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT OR IGNORE INTO revocations VALUES(?)').run(paymentIntent);
      this.db.prepare('UPDATE purchases SET revoked=1 WHERE payment_intent=?').run(paymentIntent);
      this.db.exec('COMMIT');
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  saveAttempt(userId,a) { this.db.prepare('INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(a.id,userId,JSON.stringify(a)); }
  attempt(userId,id) {
    const row = this.db.prepare('SELECT body FROM attempts WHERE id=? AND user_id=?').get(id,userId);
    if (!row) throw new Problem(404,'Attempt not found.');
    let a = JSON.parse(row.body);
    if (a.status === 'active' && a.deadline <= this.now()) { a=finishAttempt(a,this.now()); this.saveAttempt(userId,a); }
    return a;
  }
  start(userId,set) {
    this.requireAccess(userId);
    if (![4,5,6,7,8].includes(set)) throw new Problem(400,'Select an exam.');
    for (const row of this.db.prepare('SELECT id FROM attempts WHERE user_id=?').all(userId)) {
      const a=this.attempt(userId,row.id); if(a.status==='active') return a;
    }
    const a=createAttempt(set,this.now()); this.saveAttempt(userId,a); return a;
  }
  update(userId,id,change) {
    this.requireAccess(userId); const a=this.attempt(userId,id);
    if(a.status!=='active') throw new Problem(409,'This exam has ended. Open your results.');
    const questions=this.bank.filter(q=>q.set===a.set);
    if ('questionId' in change) {
      if (!questions.some(q=>q.id===change.questionId)) throw new Problem(400,'Unknown question.');
      if ('choice' in change) {
        if(change.choice===null) delete a.answers[change.questionId];
        else if(Number.isInteger(change.choice)&&change.choice>=0&&change.choice<4) a.answers[change.questionId]=change.choice;
        else throw new Problem(400,'Invalid answer.');
      }
      if ('flagged' in change) {
        if(typeof change.flagged!=='boolean') throw new Problem(400,'Invalid flag.');
        a.flags=a.flags.filter(x=>x!==change.questionId); if(change.flagged)a.flags.push(change.questionId);
      }
    }
    if ('index' in change) {
      if(!Number.isInteger(change.index)||change.index<0||change.index>=questions.length)throw new Problem(400,'Invalid question position.');
      a.index=change.index;
    }
    this.saveAttempt(userId,a);return a;
  }
  submit(userId,id) {
    this.requireAccess(userId); const a=finishAttempt(this.attempt(userId,id),this.now());this.saveAttempt(userId,a);return a;
  }
  view(userId,id) {
    this.requireAccess(userId);const a=this.attempt(userId,id);
    const questions=this.bank.filter(q=>q.set===a.set).map(({id,number,domain,stem,choices})=>({id,number,domain,stem,choices}));
    return {attempt:a,serverTime:this.now(),questions,...(a.status==='submitted'?{result:grade(a,this.bank)}:{})};
  }
  history(userId) {
    return this.db.prepare('SELECT id FROM attempts WHERE user_id=? ORDER BY rowid DESC').all(userId).map(row=>{
      const a=this.attempt(userId,row.id);const g=a.status==='submitted'?grade(a,this.bank):null;
      return {id:a.id,set:a.set,status:a.status,startedAt:a.startedAt,score:g?.score??null};
    });
  }
}
