'use strict';

require('dotenv').config();
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { DatabaseSync } = require('node:sqlite');
const { WebSocket, WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'studymate.sqlite');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN_DAYS = Number(process.env.TOKEN_TTL_DAYS || 7);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@studymate.local').trim().toLowerCase();
const MANAGER_EMAIL = String(process.env.MANAGER_EMAIL || 'manager@studymate.local').trim().toLowerCase();
const DEMO_ADMIN_PASSWORD = 'AdminDemo123!';
const DEMO_MANAGER_PASSWORD = 'ManagerDemo123!';

if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_PASSWORD before starting StudyMate in production.');
}
if (process.env.NODE_ENV === 'production' && !process.env.MANAGER_PASSWORD) {
  throw new Error('Set MANAGER_PASSWORD before starting StudyMate in production.');
}
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT '',
    batch TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (sender_id <> receiver_id)
  );
  CREATE INDEX IF NOT EXISTS friend_requests_receiver_status ON friend_requests(receiver_id,status);
  CREATE TABLE IF NOT EXISTS friendships (
    user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_a,user_b),
    CHECK (user_a < user_b)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read_at TEXT,
    CHECK (sender_id <> recipient_id)
  );
  CREATE INDEX IF NOT EXISTS messages_pair_time ON messages(sender_id,recipient_id,id);
  CREATE INDEX IF NOT EXISTS messages_recipient ON messages(recipient_id,read_at);
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS audit_logs_time ON audit_logs(id DESC);
  CREATE TABLE IF NOT EXISTS course_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    course TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    resource_type TEXT NOT NULL DEFAULT 'Notes',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    course TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS assignment_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response TEXT NOT NULL,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(assignment_id,student_id)
  );
  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    course TEXT NOT NULL,
    questions TEXT NOT NULL DEFAULT '[]',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS study_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS study_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
`);
db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(x => x.trim()) : true }));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
const userById = db.prepare('SELECT id,name,email,department,batch,role,created_at FROM users WHERE id=?');
const publicUser = row => row && ({ id: row.id, name: row.name, email: row.email, department: row.department, batch: row.batch, role: row.email === MANAGER_EMAIL ? 'manager' : row.role, createdAt: row.created_at });
const clean = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const fail = (res, status, error) => res.status(status).json({ error });

function audit(actorId, action, targetUserId = null, details = {}) {
  db.prepare('INSERT INTO audit_logs(actor_id,action,target_user_id,details) VALUES(?,?,?,?)')
    .run(actorId || null, action, targetUserId || null, JSON.stringify(details));
}

function issueSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now',?))")
    .run(tokenHash, userId, `+${TOKEN_DAYS} days`);
  return token;
}

function findUserForToken(token) {
  if (!token || token.length > 200) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT u.id,u.name,u.email,u.department,u.batch,u.role,u.created_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now')`).get(hash);
  if (row) db.prepare("UPDATE sessions SET last_used_at=datetime('now') WHERE token_hash=?").run(hash);
  return row || null;
}

function tokenFromRequest(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function requireAuth(req, res, next) {
  const user = findUserForToken(tokenFromRequest(req));
  if (!user) return fail(res, 401, 'Please sign in again.');
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return fail(res, 403, 'Admin access is required.');
  next();
}
function requireManager(req,res,next){if(!['manager','admin'].includes(req.user.role))return fail(res,403,'Manager access is required.');next()}

function friendshipExists(firstId, secondId) {
  const a = Math.min(firstId, secondId), b = Math.max(firstId, secondId);
  return !!db.prepare('SELECT 1 FROM friendships WHERE user_a=? AND user_b=?').get(a, b);
}

function messageDto(row) {
  return { id: row.id, fromId: row.sender_id, toId: row.recipient_id, text: row.body, createdAt: row.created_at, readAt: row.read_at || null };
}

const messageById = db.prepare('SELECT id,sender_id,recipient_id,body,created_at,read_at FROM messages WHERE id=?');
const sockets = new Set();
function broadcastMessage(message) {
  const payload = JSON.stringify({ type: 'message', message });
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN && (socket.userId === message.fromId || socket.userId === message.toId)) socket.send(payload);
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'StudyMate API' }));

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  const name = clean(req.body?.name, 80);
  const email = clean(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const department = clean(req.body?.department, 80);
  const batch = clean(req.body?.batch, 20);
  if (name.length < 2) return fail(res, 400, 'Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.');
  if (password.length < 8 || password.length > 100) return fail(res, 400, 'Password must be 8–100 characters.');
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users(name,email,password_hash,department,batch,role) VALUES(?,?,?,?,?,\'student\')')
      .run(name, email, hash, department, batch);
    const user = userById.get(Number(result.lastInsertRowid));
    audit(user.id, 'account_registered');
    return res.status(201).json({ token: issueSession(user.id), user: publicUser(user) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: users.email')) return fail(res, 409, 'An account with this email already exists.');
    console.error('Register failed:', err.message);
    return fail(res, 500, 'Could not create the account.');
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = clean(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const row = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return fail(res, 401, 'Email or password is incorrect.');
  audit(row.id, 'login');
  return res.json({ token: issueSession(row.id), user: publicUser(row) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = tokenFromRequest(req);
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
  audit(req.user.id, 'logout');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/users', requireAuth, (req, res) => {
  const q = clean(req.query.q, 80).toLowerCase();
  const pattern = `%${q}%`;
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.department,u.batch,u.role,u.created_at,
    EXISTS(SELECT 1 FROM friendships f WHERE f.user_a=min(u.id,?) AND f.user_b=max(u.id,?)) AS is_friend,
    (SELECT fr.status FROM friend_requests fr WHERE fr.status='pending' AND ((fr.sender_id=? AND fr.receiver_id=u.id) OR (fr.sender_id=u.id AND fr.receiver_id=?)) ORDER BY fr.id DESC LIMIT 1) AS pending_status,
    (SELECT fr.sender_id FROM friend_requests fr WHERE fr.status='pending' AND ((fr.sender_id=? AND fr.receiver_id=u.id) OR (fr.sender_id=u.id AND fr.receiver_id=?)) ORDER BY fr.id DESC LIMIT 1) AS pending_sender
    FROM users u WHERE u.id<>? AND u.role='student' AND (?='' OR lower(u.name) LIKE ? OR lower(u.email) LIKE ?)
    ORDER BY u.name LIMIT 200`).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, q, pattern, pattern);
  res.json({ users: rows.map(row => ({ ...publicUser(row), relationship: row.is_friend ? 'friend' : row.pending_status ? (row.pending_sender === req.user.id ? 'outgoing' : 'incoming') : 'none' })) });
});

app.get('/api/friends', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.department,u.batch,u.role,u.created_at,f.created_at AS friends_since
    FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END
    WHERE f.user_a=? OR f.user_b=? ORDER BY u.name`).all(req.user.id, req.user.id, req.user.id);
  res.json({ friends: rows.map(row => ({ ...publicUser(row), friendsSince: row.friends_since })) });
});

app.get('/api/friends/requests', requireAuth, (req, res) => {
  const incoming = db.prepare(`SELECT fr.id,fr.created_at,u.id AS user_id,u.name,u.email,u.department,u.batch,u.role,u.created_at AS user_created_at
    FROM friend_requests fr JOIN users u ON u.id=fr.sender_id WHERE fr.receiver_id=? AND fr.status='pending' ORDER BY fr.id DESC`).all(req.user.id);
  const outgoing = db.prepare(`SELECT fr.id,fr.created_at,u.id AS user_id,u.name,u.email,u.department,u.batch,u.role,u.created_at AS user_created_at
    FROM friend_requests fr JOIN users u ON u.id=fr.receiver_id WHERE fr.sender_id=? AND fr.status='pending' ORDER BY fr.id DESC`).all(req.user.id);
  const shape = r => ({ id: r.id, createdAt: r.created_at, user: { id: r.user_id, name: r.name, email: r.email, department: r.department, batch: r.batch, role: r.role, createdAt: r.user_created_at } });
  res.json({ incoming: incoming.map(shape), outgoing: outgoing.map(shape) });
});

app.post('/api/friends/requests', requireAuth, (req, res) => {
  const targetId = Number(req.body?.userId);
  if (!Number.isSafeInteger(targetId) || targetId < 1) return fail(res, 400, 'Choose a valid student.');
  if (targetId === req.user.id) return fail(res, 400, 'You cannot add yourself.');
  const target = userById.get(targetId);
  if (!target || target.role !== 'student') return fail(res, 404, 'Student not found.');
  if (friendshipExists(req.user.id, targetId)) return fail(res, 409, 'You are already friends.');
  const exists = db.prepare(`SELECT id FROM friend_requests WHERE status='pending' AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?))`).get(req.user.id, targetId, targetId, req.user.id);
  if (exists) return fail(res, 409, 'A friend request is already pending.');
  const result = db.prepare('INSERT INTO friend_requests(sender_id,receiver_id) VALUES(?,?)').run(req.user.id, targetId);
  audit(req.user.id, 'friend_request_sent', targetId, { requestId: Number(result.lastInsertRowid) });
  res.status(201).json({ ok: true, requestId: Number(result.lastInsertRowid) });
});

app.post('/api/friends/requests/:id/:decision', requireAuth, (req, res) => {
  const requestId = Number(req.params.id);
  const decision = req.params.decision;
  if (!Number.isSafeInteger(requestId) || !['accept','reject'].includes(decision)) return fail(res, 400, 'Invalid request action.');
  const request = db.prepare("SELECT * FROM friend_requests WHERE id=? AND receiver_id=? AND status='pending'").get(requestId, req.user.id);
  if (!request) return fail(res, 404, 'Pending friend request not found.');
  const status = decision === 'accept' ? 'accepted' : 'rejected';
  db.prepare("UPDATE friend_requests SET status=?,updated_at=datetime('now') WHERE id=?").run(status, requestId);
  if (decision === 'accept') {
    const a = Math.min(request.sender_id, request.receiver_id), b = Math.max(request.sender_id, request.receiver_id);
    db.prepare('INSERT OR IGNORE INTO friendships(user_a,user_b) VALUES(?,?)').run(a, b);
    audit(req.user.id, 'friend_request_accepted', request.sender_id, { requestId });
  } else audit(req.user.id, 'friend_request_rejected', request.sender_id, { requestId });
  res.json({ ok: true, status });
});

function requireFriend(req, res, next) {
  const otherId = Number(req.params.userId || req.body?.toUserId);
  if (!Number.isSafeInteger(otherId) || otherId < 1 || otherId === req.user.id) return fail(res, 400, 'Choose a valid friend.');
  if (!friendshipExists(req.user.id, otherId)) return fail(res, 403, 'You can message friends after their request is accepted.');
  req.otherUserId = otherId;
  next();
}

app.get('/api/messages/threads', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT u.id AS user_id,u.name,u.email,u.department,u.batch,u.role,u.created_at AS user_created_at,
    (SELECT m.body FROM messages m WHERE (m.sender_id=? AND m.recipient_id=u.id) OR (m.sender_id=u.id AND m.recipient_id=?) ORDER BY m.id DESC LIMIT 1) AS last_message,
    (SELECT m.created_at FROM messages m WHERE (m.sender_id=? AND m.recipient_id=u.id) OR (m.sender_id=u.id AND m.recipient_id=?) ORDER BY m.id DESC LIMIT 1) AS last_message_at,
    (SELECT count(*) FROM messages m WHERE m.sender_id=u.id AND m.recipient_id=? AND m.read_at IS NULL) AS unread_count
    FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END
    WHERE f.user_a=? OR f.user_b=? ORDER BY coalesce(last_message_at,f.created_at) DESC`).all(req.user.id,req.user.id,req.user.id,req.user.id,req.user.id,req.user.id,req.user.id,req.user.id);
  res.json({ threads: rows.map(r => ({ user: { id: r.user_id,name: r.name,email: r.email,department: r.department,batch: r.batch,role: r.role,createdAt: r.user_created_at }, lastMessage: r.last_message || '', lastMessageAt: r.last_message_at || null, unreadCount: r.unread_count })) });
});

app.get('/api/messages/:userId', requireAuth, requireFriend, (req, res) => {
  const before = Number(req.query.before || Number.MAX_SAFE_INTEGER);
  const rows = db.prepare(`SELECT id,sender_id,recipient_id,body,created_at,read_at FROM messages
    WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND id<?
    ORDER BY id DESC LIMIT 100`).all(req.user.id,req.otherUserId,req.otherUserId,req.user.id,before);
  db.prepare("UPDATE messages SET read_at=datetime('now') WHERE sender_id=? AND recipient_id=? AND read_at IS NULL").run(req.otherUserId,req.user.id);
  res.json({ messages: rows.reverse().map(messageDto) });
});

app.post('/api/messages', requireAuth, requireFriend, (req, res) => {
  const text = clean(req.body?.text, 2000);
  if (!text) return fail(res, 400, 'Write a message first.');
  const result = db.prepare('INSERT INTO messages(sender_id,recipient_id,body) VALUES(?,?,?)').run(req.user.id,req.otherUserId,text);
  const message = messageDto(messageById.get(Number(result.lastInsertRowid)));
  // Keep an activity trail without copying private message contents into the admin log.
  audit(req.user.id, 'message_sent', req.otherUserId, { messageId: message.id });
  broadcastMessage(message);
  res.status(201).json({ message });
});

// Manager tools from the supplied use-case diagram: course materials, assignments,
// quizzes, notifications and student progress. Student endpoints expose no answer keys.
const safeJson=(value,fallback)=>{try{return JSON.parse(value)}catch{return fallback}};
app.get('/api/manager/overview',requireAuth,requireManager,(_req,res)=>res.json({counts:{students:db.prepare("SELECT count(*) n FROM users WHERE role='student'").get().n,materials:db.prepare('SELECT count(*) n FROM course_materials').get().n,assignments:db.prepare('SELECT count(*) n FROM assignments').get().n,submissions:db.prepare('SELECT count(*) n FROM assignment_submissions').get().n,quizzes:db.prepare('SELECT count(*) n FROM quizzes').get().n,quizAttempts:db.prepare('SELECT count(*) n FROM quiz_attempts').get().n}}));
app.get('/api/manager/materials',requireAuth,requireManager,(_req,res)=>res.json({materials:db.prepare('SELECT m.*,u.name AS manager_name FROM course_materials m JOIN users u ON u.id=m.created_by ORDER BY m.id DESC').all()}));
app.get('/api/materials',requireAuth,(_req,res)=>res.json({materials:db.prepare('SELECT id,title,course,description,resource_type AS resourceType,created_at AS createdAt FROM course_materials ORDER BY id DESC').all()}));
app.post('/api/manager/materials',requireAuth,requireManager,(req,res)=>{const title=clean(req.body?.title,120),course=clean(req.body?.course,100),description=clean(req.body?.description,1000),resourceType=clean(req.body?.resourceType,40)||'Notes';if(title.length<2||course.length<2)return fail(res,400,'Enter a title and course.');const r=db.prepare('INSERT INTO course_materials(title,course,description,resource_type,created_by) VALUES(?,?,?,?,?)').run(title,course,description,resourceType,req.user.id);audit(req.user.id,'material_published',null,{materialId:Number(r.lastInsertRowid)});res.status(201).json({ok:true,id:Number(r.lastInsertRowid)});});
app.get('/api/manager/assignments',requireAuth,requireManager,(_req,res)=>res.json({assignments:db.prepare(`SELECT a.*,u.name AS manager_name,(SELECT count(*) FROM assignment_submissions s WHERE s.assignment_id=a.id) AS submissions FROM assignments a JOIN users u ON u.id=a.created_by ORDER BY a.id DESC`).all()}));
app.get('/api/assignments',requireAuth,(req,res)=>res.json({assignments:db.prepare(`SELECT a.id,a.title,a.course,a.instructions,a.due_date AS dueDate,a.created_at AS createdAt,s.id AS submissionId,s.response AS submission FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id AND s.student_id=? ORDER BY a.id DESC`).all(req.user.id)}));
app.post('/api/manager/assignments',requireAuth,requireManager,(req,res)=>{const title=clean(req.body?.title,120),course=clean(req.body?.course,100),instructions=clean(req.body?.instructions,2000),dueDate=clean(req.body?.dueDate,30);if(title.length<2||course.length<2)return fail(res,400,'Enter an assignment title and course.');const r=db.prepare('INSERT INTO assignments(title,course,instructions,due_date,created_by) VALUES(?,?,?,?,?)').run(title,course,instructions,dueDate,req.user.id);audit(req.user.id,'assignment_published',null,{assignmentId:Number(r.lastInsertRowid)});res.status(201).json({ok:true,id:Number(r.lastInsertRowid)});});
app.post('/api/assignments/:id/submit',requireAuth,(req,res)=>{if(req.user.role!=='student')return fail(res,403,'Only students can submit assignments.');const id=Number(req.params.id),response=clean(req.body?.response,5000);if(!Number.isSafeInteger(id)||!response)return fail(res,400,'Enter your assignment response.');if(!db.prepare('SELECT 1 FROM assignments WHERE id=?').get(id))return fail(res,404,'Assignment not found.');db.prepare(`INSERT INTO assignment_submissions(assignment_id,student_id,response) VALUES(?,?,?) ON CONFLICT(assignment_id,student_id) DO UPDATE SET response=excluded.response,submitted_at=datetime('now')`).run(id,req.user.id,response);audit(req.user.id,'assignment_submitted',null,{assignmentId:id});res.json({ok:true});});
app.get('/api/manager/quizzes',requireAuth,requireManager,(_req,res)=>res.json({quizzes:db.prepare('SELECT q.*,u.name AS manager_name FROM quizzes q JOIN users u ON u.id=q.created_by ORDER BY q.id DESC').all().map(q=>({...q,questions:safeJson(q.questions,[])}))}));
app.get('/api/quizzes',requireAuth,(_req,res)=>res.json({quizzes:db.prepare('SELECT id,title,course,questions,created_at AS createdAt FROM quizzes ORDER BY id DESC').all().map(q=>({...q,questions:safeJson(q.questions,[]).map(({prompt,options})=>({prompt,options}))}))}));
app.post('/api/manager/quizzes',requireAuth,requireManager,(req,res)=>{const title=clean(req.body?.title,120),course=clean(req.body?.course,100),questions=Array.isArray(req.body?.questions)?req.body.questions.slice(0,20):[];if(title.length<2||course.length<2||!questions.length)return fail(res,400,'Add a quiz title, course and at least one question.');for(const q of questions){if(!clean(q.prompt,300)||!Array.isArray(q.options)||q.options.length<2||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length)return fail(res,400,'Each quiz question needs options and one correct answer.')}const r=db.prepare('INSERT INTO quizzes(title,course,questions,created_by) VALUES(?,?,?,?)').run(title,course,JSON.stringify(questions.map(q=>({prompt:clean(q.prompt,300),options:q.options.slice(0,6).map(x=>clean(x,150)),answer:q.answer}))),req.user.id);audit(req.user.id,'quiz_published',null,{quizId:Number(r.lastInsertRowid)});res.status(201).json({ok:true,id:Number(r.lastInsertRowid)});});
app.post('/api/quizzes/:id/attempt',requireAuth,(req,res)=>{if(req.user.role!=='student')return fail(res,403,'Only students can take quizzes.');const id=Number(req.params.id),quiz=db.prepare('SELECT id,questions FROM quizzes WHERE id=?').get(id);if(!quiz)return fail(res,404,'Quiz not found.');const questions=safeJson(quiz.questions,[]),answers=Array.isArray(req.body?.answers)?req.body.answers:[];if(answers.length!==questions.length)return fail(res,400,'Answer every question before submitting.');const score=questions.reduce((n,q,i)=>n+(Number(answers[i])===q.answer?1:0),0);db.prepare('INSERT INTO quiz_attempts(quiz_id,student_id,score,total) VALUES(?,?,?,?)').run(id,req.user.id,score,questions.length);audit(req.user.id,'quiz_completed',null,{quizId:id,score,total:questions.length});res.json({score,total:questions.length});});
app.get('/api/manager/progress',requireAuth,requireManager,(_req,res)=>{const students=db.prepare(`SELECT u.id,u.name,u.email,u.department,u.batch,(SELECT count(*) FROM assignment_submissions s WHERE s.student_id=u.id) AS submissions,(SELECT count(*) FROM quiz_attempts q WHERE q.student_id=u.id) AS quizAttempts,(SELECT coalesce(sum(score),0) FROM quiz_attempts q WHERE q.student_id=u.id) AS quizScore,(SELECT coalesce(sum(total),0) FROM quiz_attempts q WHERE q.student_id=u.id) AS quizTotal FROM users u WHERE u.role='student' ORDER BY u.name`).all();res.json({students})});
app.get('/api/study/notifications',requireAuth,(_req,res)=>res.json({notifications:db.prepare('SELECT n.id,n.title,n.body,n.created_at AS createdAt,u.name AS manager FROM study_notifications n JOIN users u ON u.id=n.created_by ORDER BY n.id DESC LIMIT 50').all()}));
app.post('/api/manager/notifications',requireAuth,requireManager,(req,res)=>{const title=clean(req.body?.title,120),body=clean(req.body?.body,500);if(!title)return fail(res,400,'Enter a notification title.');const r=db.prepare('INSERT INTO study_notifications(title,body,created_by) VALUES(?,?,?)').run(title,body,req.user.id);audit(req.user.id,'notification_sent',null,{notificationId:Number(r.lastInsertRowid)});res.status(201).json({ok:true,id:Number(r.lastInsertRowid)});});

app.get('/api/admin/overview', requireAuth, requireAdmin, (_req, res) => {
  const counts = db.prepare(`SELECT
    (SELECT count(*) FROM users WHERE role='student') AS students,
    (SELECT count(*) FROM messages) AS messages,
    (SELECT count(*) FROM friendships) AS friendships,
    (SELECT count(*) FROM friend_requests WHERE status='pending') AS pendingRequests,
    (SELECT count(*) FROM users WHERE role='student' AND date(created_at)=date('now')) AS registrationsToday`).get();
  const recent = db.prepare(`SELECT id,name,email,department,batch,role,created_at FROM users WHERE role='student' ORDER BY id DESC LIMIT 8`).all().map(publicUser);
  res.json({ counts, recentRegistrations: recent });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const q = clean(req.query.q,80).toLowerCase();
  const pattern = `%${q}%`;
  const users = db.prepare(`SELECT u.id,u.name,u.email,u.department,u.batch,u.role,u.created_at,
    (SELECT max(created_at) FROM audit_logs l WHERE l.actor_id=u.id AND l.action='login') AS last_login,
    (SELECT count(*) FROM messages m WHERE m.sender_id=u.id) AS sent_messages
    FROM users u WHERE u.role='student' AND (?='' OR lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR lower(u.department) LIKE ? OR u.batch LIKE ?)
    ORDER BY u.id DESC LIMIT 500`).all(q,pattern,pattern,pattern,pattern);
  res.json({ users: users.map(u => ({ ...publicUser(u), lastLogin: u.last_login || null, sentMessages: u.sent_messages })) });
});

app.get('/api/admin/activity', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT l.id,l.action,l.details,l.created_at,l.actor_id,
    a.name AS actor_name,t.id AS target_id,t.name AS target_name
    FROM audit_logs l LEFT JOIN users a ON a.id=l.actor_id LEFT JOIN users t ON t.id=l.target_user_id
    ORDER BY l.id DESC LIMIT 150`).all();
  res.json({ events: rows.map(r => ({ id:r.id,action:r.action,createdAt:r.created_at,actorId:r.actor_id,actorName:r.actor_name || 'System',targetId:r.target_id,targetName:r.target_name || null,details:JSON.parse(r.details || '{}') })) });
});
app.get('/api/admin/settings',requireAuth,requireAdmin,(_req,res)=>{const values=Object.fromEntries(db.prepare('SELECT key,value FROM study_settings').all().map(x=>[x.key,x.value]));res.json({settings:{attendanceThreshold:Number(values.attendanceThreshold||75),weeklySummary:values.weeklySummary!=='false'}})});
app.put('/api/admin/settings',requireAuth,requireAdmin,(req,res)=>{const threshold=Number(req.body?.attendanceThreshold),weeklySummary=!!req.body?.weeklySummary;if(!Number.isFinite(threshold)||threshold<0||threshold>100)return fail(res,400,'Attendance threshold must be between 0 and 100.');const save=db.prepare('INSERT INTO study_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');save.run('attendanceThreshold',String(threshold));save.run('weeklySummary',String(weeklySummary));audit(req.user.id,'settings_updated',null,{attendanceThreshold:threshold,weeklySummary});res.json({ok:true,settings:{attendanceThreshold:threshold,weeklySummary}})});

const webDir = path.join(ROOT, 'www');
app.use(express.static(webDir, { extensions: ['html'] }));
app.get(/.*/, (req,res,next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(webDir,'index.html')));
app.use((req,res) => fail(res,404,'Not found.'));
app.use((err,_req,res,_next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url,'http://localhost').pathname; } catch { socket.destroy(); return; }
  if (pathname !== '/api/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req));
});
wss.on('connection', ws => {
  sockets.add(ws);
  const authTimer = setTimeout(() => ws.close(4401,'Authentication required'),5000);
  ws.on('message', raw => {
    if (ws.userId) return;
    try {
      const packet = JSON.parse(raw.toString());
      if (packet.type !== 'auth') return ws.close(4401,'Authenticate first');
      const user = findUserForToken(packet.token);
      if (!user) return ws.close(4401,'Invalid session');
      ws.userId = user.id;
      clearTimeout(authTimer);
      ws.send(JSON.stringify({ type:'ready' }));
    } catch { ws.close(4400,'Invalid message'); }
  });
  ws.on('close', () => { clearTimeout(authTimer); sockets.delete(ws); });
});

async function start() {
  if (ADMIN_EMAIL === MANAGER_EMAIL) throw new Error('ADMIN_EMAIL and MANAGER_EMAIL must be different.');
  const currentAdmin = db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL);
  if (!currentAdmin) {
    const password = process.env.ADMIN_PASSWORD || DEMO_ADMIN_PASSWORD;
    const hash = await bcrypt.hash(password,12);
    const result = db.prepare("INSERT INTO users(name,email,password_hash,department,batch,role) VALUES('StudyMate Admin',? ,?,'Administration','','admin')").run(ADMIN_EMAIL,hash);
    audit(Number(result.lastInsertRowid),'admin_seeded');
  }
  let manager=db.prepare('SELECT id FROM users WHERE email=?').get(MANAGER_EMAIL);
  if(!manager){const password=process.env.MANAGER_PASSWORD||DEMO_MANAGER_PASSWORD,hash=await bcrypt.hash(password,12);const result=db.prepare("INSERT INTO users(name,email,password_hash,department,batch,role) VALUES('StudyMate Manager',? ,?,'Academic Office','','admin')").run(MANAGER_EMAIL,hash);manager={id:Number(result.lastInsertRowid)};audit(manager.id,'manager_seeded');}
  if(!db.prepare('SELECT 1 FROM course_materials LIMIT 1').get())db.prepare('INSERT INTO course_materials(title,course,description,resource_type,created_by) VALUES(?,?,?,?,?)').run('Introduction to Data Structures','Data Structures','Arrays, linked lists, stacks and queues - class notes.','Notes',manager.id);
  if(!db.prepare('SELECT 1 FROM assignments LIMIT 1').get())db.prepare('INSERT INTO assignments(title,course,instructions,due_date,created_by) VALUES(?,?,?,?,?)').run('Linked List Practice','Data Structures','Solve the linked-list exercises and submit a short explanation.','2026-11-14',manager.id);
  if(!db.prepare('SELECT 1 FROM quizzes LIMIT 1').get())db.prepare('INSERT INTO quizzes(title,course,questions,created_by) VALUES(?,?,?,?)').run('Data Structures Quick Quiz','Data Structures',JSON.stringify([{prompt:'Which structure follows LIFO order?',options:['Queue','Stack','Tree'],answer:1},{prompt:'Which operation adds an item to a queue?',options:['Enqueue','Pop','Peek'],answer:0}]),manager.id);
  server.listen(PORT,HOST,() => {
    console.log(`StudyMate is running at http://localhost:${PORT}`);
    console.log(`SQLite database: ${DB_FILE}`);
    if (process.env.NODE_ENV !== 'production' && !process.env.ADMIN_PASSWORD) console.log(`Demo admin: ${ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
    if (process.env.NODE_ENV !== 'production' && !process.env.MANAGER_PASSWORD) console.log(`Demo manager: ${MANAGER_EMAIL} / ${DEMO_MANAGER_PASSWORD}`);
  });
}

start().catch(err => { console.error(err); process.exit(1); });

for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => {
  server.close(() => { db.close(); process.exit(0); });
});
