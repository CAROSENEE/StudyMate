'use strict';

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const { WebSocket, WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const AUTH_REDIRECT_URL = String(process.env.AUTH_REDIRECT_URL || 'https://studymate-api-63in.onrender.com').replace(/\/+$/, '');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }, max: Number(process.env.DB_POOL_SIZE || 5), connectionTimeoutMillis: 15000 });
const app = express();
const sockets = new Set();
const clean = (v, n = 200) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const id = v => Number(v);
const fail = (res, code, error) => res.status(code).json({ error });
const bearer = req => (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
const json = (v, fallback = {}) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return fallback; } };
const userDto = u => ({ id: id(u.id), name: u.name, email: u.email, department: u.department || '', batch: u.batch || '', role: u.role, createdAt: u.created_at });

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(x => x.trim()).filter(Boolean) : true }));
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const registerLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });

async function authCall(endpoint, token, body, method) {
  const headers = { apikey: KEY };
  if (token) headers.Authorization = 'Bearer ' + token;
  const options = { method: method || (body ? 'POST' : 'GET'), headers };
  if (body) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  const response = await fetch(URL + '/auth/v1/' + endpoint, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const e = new Error(data.msg || data.message || data.error_description || 'Supabase Auth request failed.'); e.status = response.status; throw e; }
  return data;
}
async function profileByAuthId(authId) {
  const q = await pool.query('SELECT id,name,email,department,batch,role,created_at FROM public.profiles WHERE auth_user_id=$1', [authId]);
  return q.rows[0] || null;
}
async function userForToken(token) {
  if (!token || token.length > 4096) return null;
  const auth = await authCall('user', token);
  return auth.id ? profileByAuthId(auth.id) : null;
}
async function audit(actorId, action, targetId = null, details = {}) {
  await pool.query('INSERT INTO public.audit_logs(actor_id,action,target_user_id,details) VALUES($1,$2,$3,$4::jsonb)', [actorId || null, action, targetId || null, JSON.stringify(details)]);
}
async function requireAuth(req, res, next) {
  try { req.user = await userForToken(bearer(req)); if (!req.user) return fail(res, 401, 'Please sign in again.'); next(); }
  catch (e) { if ([401, 403].includes(e.status)) return fail(res, 401, 'Please sign in again.'); next(e); }
}
const requireAdmin = (req, res, next) => req.user.role === 'admin' ? next() : fail(res, 403, 'Admin access is required.');
const requireManager = (req, res, next) => ['manager', 'admin'].includes(req.user.role) ? next() : fail(res, 403, 'Manager access is required.');
async function areFriends(a, b) { const q = await pool.query('SELECT 1 FROM public.friendships WHERE user_a=LEAST($1::bigint,$2::bigint) AND user_b=GREATEST($1::bigint,$2::bigint)', [a, b]); return q.rowCount > 0; }
async function requireFriend(req, res, next) {
  const other = Number(req.params.userId || req.body?.toUserId);
  if (!Number.isSafeInteger(other) || other < 1 || other === id(req.user.id)) return fail(res, 400, 'Choose a valid friend.');
  try { if (!(await areFriends(req.user.id, other))) return fail(res, 403, 'You can message friends after their request is accepted.'); req.otherId = other; next(); } catch (e) { next(e); }
}
const msgDto = m => ({ id: id(m.id), fromId: id(m.sender_id), toId: id(m.recipient_id), text: m.body, createdAt: m.created_at, readAt: m.read_at || null });
app.get('/api/health', async (_req, res, next) => { try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'StudyMate API', database: 'connected' }); } catch (e) { next(e); } });

app.post('/api/auth/register', registerLimit, async (req, res, next) => {
  const name = clean(req.body?.name, 80), email = clean(req.body?.email, 254).toLowerCase(), password = typeof req.body?.password === 'string' ? req.body.password : '';
  const department = clean(req.body?.department, 80), batch = clean(req.body?.batch, 20);
  if (name.length < 2) return fail(res, 400, 'Enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.');
  if (password.length < 8 || password.length > 100) return fail(res, 400, 'Password must be 8–100 characters.');
  try {
    const auth = await authCall('signup?redirect_to=' + encodeURIComponent(AUTH_REDIRECT_URL), null, { email, password, data: { name, department, batch } });
    const profile = auth.user?.id ? await profileByAuthId(auth.user.id) : null;
    if (profile) await audit(profile.id, 'account_registered');
    if (!auth.access_token || !profile) return res.status(202).json({ confirmationRequired: true, email, message: 'Account created. Confirm your email, then sign in.' });
    res.status(201).json({ token: auth.access_token, refreshToken: auth.refresh_token, user: userDto(profile) });
  } catch (e) {
    if ([409, 422].includes(e.status)) return fail(res, 409, 'An account with this email may already exist.');
    if (e.status === 400) return fail(res, 400, 'Supabase could not create this account. Check the password rules and Supabase Auth settings.');
    if (e.status === 429) return fail(res, 429, 'Too many attempts. Please try again later.');
    next(e);
  }
});
app.post('/api/auth/resend-confirmation', authLimit, async (req, res, next) => {
  const email = clean(req.body?.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email address.');
  try {
    await authCall('resend?redirect_to=' + encodeURIComponent(AUTH_REDIRECT_URL), null, { email, type: 'signup' });
    res.json({ ok: true, message: 'If this account needs confirmation, a new email has been sent.' });
  } catch (e) {
    if (e.status === 429) return fail(res, 429, 'Please wait before requesting another confirmation email.');
    if ([400, 404, 422].includes(e.status)) return fail(res, 400, 'Could not resend the email. Check that this account was registered and is still unconfirmed.');
    next(e);
  }
});
app.post('/api/auth/login', authLimit, async (req, res, next) => {
  const email = clean(req.body?.email, 254).toLowerCase(), password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return fail(res, 400, 'Enter your email and password.');
  try {
    const auth = await authCall('token?grant_type=password', null, { email, password });
    const profile = auth.user?.id ? await profileByAuthId(auth.user.id) : null;
    if (!auth.access_token || !profile) return fail(res, 403, 'Your profile is not ready. Please contact an administrator.');
    await audit(profile.id, 'login'); res.json({ token: auth.access_token, refreshToken: auth.refresh_token, user: userDto(profile) });
  } catch (e) { if (e.status === 400 && /confirm/i.test(e.message)) return fail(res, 403, 'Confirm your email address before signing in.'); if ([400, 401].includes(e.status)) return fail(res, 401, 'Email or password is incorrect.'); if (e.status === 429) return fail(res, 429, 'Too many attempts. Please try again later.'); next(e); }
});
app.post('/api/auth/refresh', authLimit, async (req, res, next) => {
  const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
  if (!refreshToken || refreshToken.length > 4096) return fail(res, 401, 'Please sign in again.');
  try {
    const auth = await authCall('token?grant_type=refresh_token', null, { refresh_token: refreshToken });
    const profile = auth.user?.id ? await profileByAuthId(auth.user.id) : null;
    if (!auth.access_token || !profile) return fail(res, 401, 'Please sign in again.');
    res.json({ token: auth.access_token, refreshToken: auth.refresh_token, user: userDto(profile) });
  } catch (e) { if ([400, 401].includes(e.status)) return fail(res, 401, 'Please sign in again.'); next(e); }
});
app.post('/api/auth/logout', requireAuth, async (req, res, next) => {
  try { await audit(req.user.id, 'logout'); await authCall('logout', bearer(req), null, 'POST'); res.json({ ok: true }); }
  catch (e) { if (e.status === 401) return res.json({ ok: true }); next(e); }
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: userDto(req.user) }));

app.get('/api/users', requireAuth, async (req, res, next) => {
  try {
    const q = clean(req.query.q, 80).toLowerCase(), pattern = '%' + q + '%';
    const rows = await pool.query('SELECT u.id,u.name,u.email,u.department,u.batch,u.role,u.created_at,EXISTS(SELECT 1 FROM public.friendships f WHERE f.user_a=LEAST(u.id,$1::bigint) AND f.user_b=GREATEST(u.id,$1::bigint)) is_friend,(SELECT fr.status FROM public.friend_requests fr WHERE fr.status=$2 AND ((fr.sender_id=$1 AND fr.receiver_id=u.id) OR (fr.sender_id=u.id AND fr.receiver_id=$1)) ORDER BY fr.id DESC LIMIT 1) pending_status,(SELECT fr.sender_id FROM public.friend_requests fr WHERE fr.status=$2 AND ((fr.sender_id=$1 AND fr.receiver_id=u.id) OR (fr.sender_id=u.id AND fr.receiver_id=$1)) ORDER BY fr.id DESC LIMIT 1) pending_sender FROM public.profiles u WHERE u.id<>$1 AND u.role=$3 AND ($4=$5 OR lower(u.name) LIKE $6 OR lower(u.email) LIKE $6) ORDER BY u.name LIMIT 200', [req.user.id, 'pending', 'student', q, '', pattern]);
    res.json({ users: rows.rows.map(u => ({ ...userDto(u), relationship: u.is_friend ? 'friend' : u.pending_status ? (id(u.pending_sender) === id(req.user.id) ? 'outgoing' : 'incoming') : 'none' })) });
  } catch (e) { next(e); }
});
app.get('/api/friends', requireAuth, async (req, res, next) => {
  try { const q = await pool.query('SELECT u.id,u.name,u.email,u.department,u.batch,u.role,u.created_at,f.created_at friends_since FROM public.friendships f JOIN public.profiles u ON u.id=CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END WHERE f.user_a=$1 OR f.user_b=$1 ORDER BY u.name', [req.user.id]); res.json({ friends: q.rows.map(u => ({ ...userDto(u), friendsSince: u.friends_since })) }); } catch (e) { next(e); }
});
app.get('/api/friends/requests', requireAuth, async (req, res, next) => {
  try {
    const [incoming, outgoing] = await Promise.all([
      pool.query('SELECT fr.id,fr.created_at,u.id user_id,u.name,u.email,u.department,u.batch,u.role,u.created_at user_created_at FROM public.friend_requests fr JOIN public.profiles u ON u.id=fr.sender_id WHERE fr.receiver_id=$1 AND fr.status=$2 ORDER BY fr.id DESC', [req.user.id, 'pending']),
      pool.query('SELECT fr.id,fr.created_at,u.id user_id,u.name,u.email,u.department,u.batch,u.role,u.created_at user_created_at FROM public.friend_requests fr JOIN public.profiles u ON u.id=fr.receiver_id WHERE fr.sender_id=$1 AND fr.status=$2 ORDER BY fr.id DESC', [req.user.id, 'pending'])
    ]);
    const shape = x => ({ id: id(x.id), createdAt: x.created_at, user: { id: id(x.user_id), name: x.name, email: x.email, department: x.department, batch: x.batch, role: x.role, createdAt: x.user_created_at } });
    res.json({ incoming: incoming.rows.map(shape), outgoing: outgoing.rows.map(shape) });
  } catch (e) { next(e); }
});
app.post('/api/friends/requests', requireAuth, async (req, res, next) => {
  const other = Number(req.body?.userId);
  if (!Number.isSafeInteger(other) || other < 1) return fail(res, 400, 'Choose a valid student.');
  if (other === id(req.user.id)) return fail(res, 400, 'You cannot add yourself.');
  try {
    const target = await pool.query('SELECT id,role FROM public.profiles WHERE id=$1', [other]);
    if (!target.rowCount || target.rows[0].role !== 'student') return fail(res, 404, 'Student not found.');
    if (await areFriends(req.user.id, other)) return fail(res, 409, 'You are already friends.');
    const pending = await pool.query('SELECT 1 FROM public.friend_requests WHERE status=$1 AND ((sender_id=$2 AND receiver_id=$3) OR (sender_id=$3 AND receiver_id=$2)) LIMIT 1', ['pending', req.user.id, other]);
    if (pending.rowCount) return fail(res, 409, 'A friend request is already pending.');
    const saved = await pool.query('INSERT INTO public.friend_requests(sender_id,receiver_id) VALUES($1,$2) RETURNING id', [req.user.id, other]);
    const requestId = id(saved.rows[0].id); await audit(req.user.id, 'friend_request_sent', other, { requestId }); res.status(201).json({ ok: true, requestId });
  } catch (e) { next(e); }
});
app.post('/api/friends/requests/:id/:decision', requireAuth, async (req, res, next) => {
  const requestId = Number(req.params.id), decision = req.params.decision;
  if (!Number.isSafeInteger(requestId) || !['accept', 'reject'].includes(decision)) return fail(res, 400, 'Invalid request action.');
  const c = await pool.connect().catch(next); if (!c) return;
  try {
    await c.query('BEGIN'); const found = await c.query('SELECT * FROM public.friend_requests WHERE id=$1 AND receiver_id=$2 AND status=$3 FOR UPDATE', [requestId, req.user.id, 'pending']);
    if (!found.rowCount) { await c.query('ROLLBACK'); return fail(res, 404, 'Pending friend request not found.'); }
    const row = found.rows[0], status = decision === 'accept' ? 'accepted' : 'rejected';
    await c.query('UPDATE public.friend_requests SET status=$1,updated_at=now() WHERE id=$2', [status, requestId]);
    if (decision === 'accept') await c.query('INSERT INTO public.friendships(user_a,user_b) VALUES(LEAST($1::bigint,$2::bigint),GREATEST($1::bigint,$2::bigint)) ON CONFLICT DO NOTHING', [row.sender_id, row.receiver_id]);
    await c.query('COMMIT'); await audit(req.user.id, 'friend_request_' + (decision === 'accept' ? 'accepted' : 'rejected'), row.sender_id, { requestId }); res.json({ ok: true, status });
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); next(e); } finally { c.release(); }
});

app.get('/api/messages/threads', requireAuth, async (req, res, next) => {
  try {
    const q = await pool.query('SELECT u.id user_id,u.name,u.email,u.department,u.batch,u.role,u.created_at user_created_at,(SELECT m.body FROM public.messages m WHERE (m.sender_id=$1 AND m.recipient_id=u.id) OR (m.sender_id=u.id AND m.recipient_id=$1) ORDER BY m.id DESC LIMIT 1) last_message,(SELECT m.created_at FROM public.messages m WHERE (m.sender_id=$1 AND m.recipient_id=u.id) OR (m.sender_id=u.id AND m.recipient_id=$1) ORDER BY m.id DESC LIMIT 1) last_message_at,(SELECT count(*) FROM public.messages m WHERE m.sender_id=u.id AND m.recipient_id=$1 AND m.read_at IS NULL) unread_count FROM public.friendships f JOIN public.profiles u ON u.id=CASE WHEN f.user_a=$1 THEN f.user_b ELSE f.user_a END WHERE f.user_a=$1 OR f.user_b=$1 ORDER BY COALESCE((SELECT max(m.created_at) FROM public.messages m WHERE (m.sender_id=$1 AND m.recipient_id=u.id) OR (m.sender_id=u.id AND m.recipient_id=$1)),f.created_at) DESC', [req.user.id]);
    res.json({ threads: q.rows.map(r => ({ user: { id: id(r.user_id), name: r.name, email: r.email, department: r.department, batch: r.batch, role: r.role, createdAt: r.user_created_at }, lastMessage: r.last_message || '', lastMessageAt: r.last_message_at || null, unreadCount: id(r.unread_count) })) });
  } catch (e) { next(e); }
});
app.get('/api/messages/:userId', requireAuth, requireFriend, async (req, res, next) => {
  const before = req.query.before ? Number(req.query.before) : Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(before) || before < 1) return fail(res, 400, 'Invalid message cursor.');
  try { const q = await pool.query('SELECT id,sender_id,recipient_id,body,created_at,read_at FROM public.messages WHERE ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)) AND id<$3 ORDER BY id DESC LIMIT 100', [req.user.id, req.otherId, before]); await pool.query('UPDATE public.messages SET read_at=now() WHERE sender_id=$1 AND recipient_id=$2 AND read_at IS NULL', [req.otherId, req.user.id]); res.json({ messages: q.rows.reverse().map(msgDto) }); } catch (e) { next(e); }
});
app.post('/api/messages', requireAuth, requireFriend, async (req, res, next) => {
  const text = clean(req.body?.text, 2000); if (!text) return fail(res, 400, 'Write a message first.');
  try { const q = await pool.query('INSERT INTO public.messages(sender_id,recipient_id,body) VALUES($1,$2,$3) RETURNING id,sender_id,recipient_id,body,created_at,read_at', [req.user.id, req.otherId, text]); const message = msgDto(q.rows[0]); await audit(req.user.id, 'message_sent', req.otherId, { messageId: message.id }); for (const ws of sockets) if (ws.readyState === WebSocket.OPEN && (ws.userId === message.fromId || ws.userId === message.toId)) ws.send(JSON.stringify({ type: 'message', message })); res.status(201).json({ message }); } catch (e) { next(e); }
});

app.get('/api/manager/overview', requireAuth, requireManager, async (_req, res, next) => { try { const q = await pool.query('SELECT (SELECT count(*) FROM public.profiles WHERE role=$1) students,(SELECT count(*) FROM public.course_materials) materials,(SELECT count(*) FROM public.assignments) assignments,(SELECT count(*) FROM public.assignment_submissions) submissions,(SELECT count(*) FROM public.quizzes) quizzes,(SELECT count(*) FROM public.quiz_attempts) "quizAttempts"', ['student']); const x = q.rows[0]; res.json({ counts: Object.fromEntries(Object.entries(x).map(([k,v]) => [k,id(v)])) }); } catch(e) { next(e); } });
app.get('/api/manager/materials', requireAuth, requireManager, async (_req, res, next) => { try { const q = await pool.query('SELECT m.*,u.name manager_name FROM public.course_materials m JOIN public.profiles u ON u.id=m.created_by ORDER BY m.id DESC'); res.json({ materials:q.rows }); } catch(e) { next(e); } });
app.get('/api/materials', requireAuth, async (_req, res, next) => { try { const q = await pool.query('SELECT id,title,course,description,resource_type resourceType,created_at createdAt FROM public.course_materials ORDER BY id DESC'); res.json({ materials:q.rows.map(x=>({...x,id:id(x.id)})) }); } catch(e) { next(e); } });
app.post('/api/manager/materials', requireAuth, requireManager, async (req, res, next) => { const title=clean(req.body?.title,120),course=clean(req.body?.course,100),description=clean(req.body?.description,1000),type=clean(req.body?.resourceType,40)||'Notes'; if(title.length<2||course.length<2)return fail(res,400,'Enter a title and course.'); try{const q=await pool.query('INSERT INTO public.course_materials(title,course,description,resource_type,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[title,course,description,type,req.user.id]);const newId=id(q.rows[0].id);await audit(req.user.id,'material_published',null,{materialId:newId});res.status(201).json({ok:true,id:newId});}catch(e){next(e);} });
app.get('/api/manager/assignments', requireAuth, requireManager, async (_req,res,next)=>{try{const q=await pool.query('SELECT a.*,u.name manager_name,(SELECT count(*) FROM public.assignment_submissions s WHERE s.assignment_id=a.id) submissions FROM public.assignments a JOIN public.profiles u ON u.id=a.created_by ORDER BY a.id DESC');res.json({assignments:q.rows});}catch(e){next(e);} });
app.get('/api/assignments', requireAuth, async (req,res,next)=>{try{const q=await pool.query('SELECT a.id,a.title,a.course,a.instructions,a.due_date dueDate,a.created_at createdAt,s.id submissionId,s.response submission FROM public.assignments a LEFT JOIN public.assignment_submissions s ON s.assignment_id=a.id AND s.student_id=$1 ORDER BY a.id DESC',[req.user.id]);res.json({assignments:q.rows});}catch(e){next(e);} });
app.post('/api/manager/assignments', requireAuth, requireManager, async (req,res,next)=>{const title=clean(req.body?.title,120),course=clean(req.body?.course,100),instructions=clean(req.body?.instructions,2000),due=clean(req.body?.dueDate,30)||null;if(title.length<2||course.length<2)return fail(res,400,'Enter an assignment title and course.');try{const q=await pool.query('INSERT INTO public.assignments(title,course,instructions,due_date,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[title,course,instructions,due,req.user.id]);const newId=id(q.rows[0].id);await audit(req.user.id,'assignment_published',null,{assignmentId:newId});res.status(201).json({ok:true,id:newId});}catch(e){next(e);} });
app.post('/api/assignments/:id/submit', requireAuth, async (req,res,next)=>{if(req.user.role!=='student')return fail(res,403,'Only students can submit assignments.');const aid=Number(req.params.id),response=clean(req.body?.response,5000);if(!Number.isSafeInteger(aid)||!response)return fail(res,400,'Enter your assignment response.');try{const exists=await pool.query('SELECT 1 FROM public.assignments WHERE id=$1',[aid]);if(!exists.rowCount)return fail(res,404,'Assignment not found.');await pool.query('INSERT INTO public.assignment_submissions(assignment_id,student_id,response) VALUES($1,$2,$3) ON CONFLICT(assignment_id,student_id) DO UPDATE SET response=excluded.response,submitted_at=now()',[aid,req.user.id,response]);await audit(req.user.id,'assignment_submitted',null,{assignmentId:aid});res.json({ok:true});}catch(e){next(e);} });
app.get('/api/manager/quizzes', requireAuth, requireManager, async (_req,res,next)=>{try{const q=await pool.query('SELECT q.*,u.name manager_name FROM public.quizzes q JOIN public.profiles u ON u.id=q.created_by ORDER BY q.id DESC');res.json({quizzes:q.rows.map(x=>({...x,id:id(x.id),questions:json(x.questions,[])}))});}catch(e){next(e);} });
app.get('/api/quizzes', requireAuth, async (_req,res,next)=>{try{const q=await pool.query('SELECT id,title,course,questions,created_at createdAt FROM public.quizzes ORDER BY id DESC');res.json({quizzes:q.rows.map(x=>({...x,id:id(x.id),questions:json(x.questions,[]).map(({prompt,options})=>({prompt,options}))}))});}catch(e){next(e);} });
app.post('/api/manager/quizzes', requireAuth, requireManager, async (req,res,next)=>{const title=clean(req.body?.title,120),course=clean(req.body?.course,100),input=Array.isArray(req.body?.questions)?req.body.questions.slice(0,20):[];if(title.length<2||course.length<2||!input.length)return fail(res,400,'Add a quiz title, course and at least one question.');for(const x of input)if(!clean(x.prompt,300)||!Array.isArray(x.options)||x.options.length<2||!Number.isInteger(x.answer)||x.answer<0||x.answer>=x.options.length)return fail(res,400,'Each quiz question needs options and one correct answer.');const questions=input.map(x=>({prompt:clean(x.prompt,300),options:x.options.slice(0,6).map(y=>clean(y,150)),answer:x.answer}));try{const q=await pool.query('INSERT INTO public.quizzes(title,course,questions,created_by) VALUES($1,$2,$3::jsonb,$4) RETURNING id',[title,course,JSON.stringify(questions),req.user.id]);const newId=id(q.rows[0].id);await audit(req.user.id,'quiz_published',null,{quizId:newId});res.status(201).json({ok:true,id:newId});}catch(e){next(e);} });
app.post('/api/quizzes/:id/attempt', requireAuth, async (req,res,next)=>{if(req.user.role!=='student')return fail(res,403,'Only students can take quizzes.');const qid=Number(req.params.id);if(!Number.isSafeInteger(qid))return fail(res,400,'Invalid quiz.');try{const q=await pool.query('SELECT questions FROM public.quizzes WHERE id=$1',[qid]);if(!q.rowCount)return fail(res,404,'Quiz not found.');const questions=json(q.rows[0].questions,[]),answers=Array.isArray(req.body?.answers)?req.body.answers:[];if(answers.length!==questions.length)return fail(res,400,'Answer every question before submitting.');const score=questions.reduce((n,x,i)=>n+(Number(answers[i])===x.answer?1:0),0);await pool.query('INSERT INTO public.quiz_attempts(quiz_id,student_id,score,total) VALUES($1,$2,$3,$4)',[qid,req.user.id,score,questions.length]);await audit(req.user.id,'quiz_completed',null,{quizId:qid,score,total:questions.length});res.json({score,total:questions.length});}catch(e){next(e);} });
app.get('/api/manager/progress', requireAuth, requireManager, async (_req,res,next)=>{try{const q=await pool.query('SELECT u.id,u.name,u.email,u.department,u.batch,(SELECT count(*) FROM public.assignment_submissions s WHERE s.student_id=u.id) submissions,(SELECT count(*) FROM public.quiz_attempts x WHERE x.student_id=u.id) "quizAttempts",(SELECT coalesce(sum(score),0) FROM public.quiz_attempts x WHERE x.student_id=u.id) "quizScore",(SELECT coalesce(sum(total),0) FROM public.quiz_attempts x WHERE x.student_id=u.id) "quizTotal" FROM public.profiles u WHERE u.role=$1 ORDER BY u.name',['student']);res.json({students:q.rows.map(x=>({...x,id:id(x.id),submissions:id(x.submissions),quizAttempts:id(x.quizAttempts),quizScore:id(x.quizScore),quizTotal:id(x.quizTotal)}))});}catch(e){next(e);} });
app.get('/api/study/notifications', requireAuth, async (_req,res,next)=>{try{const q=await pool.query('SELECT n.id,n.title,n.body,n.created_at createdAt,u.name manager FROM public.study_notifications n JOIN public.profiles u ON u.id=n.created_by ORDER BY n.id DESC LIMIT 50');res.json({notifications:q.rows.map(x=>({...x,id:id(x.id)}))});}catch(e){next(e);} });
app.post('/api/manager/notifications', requireAuth, requireManager, async (req,res,next)=>{const title=clean(req.body?.title,120),body=clean(req.body?.body,500);if(!title)return fail(res,400,'Enter a notification title.');try{const q=await pool.query('INSERT INTO public.study_notifications(title,body,created_by) VALUES($1,$2,$3) RETURNING id',[title,body,req.user.id]);const newId=id(q.rows[0].id);await audit(req.user.id,'notification_sent',null,{notificationId:newId});res.status(201).json({ok:true,id:newId});}catch(e){next(e);} });

app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req,res,next)=>{try{const [c,r]=await Promise.all([pool.query('SELECT (SELECT count(*) FROM public.profiles WHERE role=$1) students,(SELECT count(*) FROM public.messages) messages,(SELECT count(*) FROM public.friendships) friendships,(SELECT count(*) FROM public.friend_requests WHERE status=$2) "pendingRequests",(SELECT count(*) FROM public.profiles WHERE role=$1 AND created_at::date=CURRENT_DATE) "registrationsToday"',['student','pending']),pool.query('SELECT id,name,email,department,batch,role,created_at FROM public.profiles WHERE role=$1 ORDER BY id DESC LIMIT 8',['student'])]);res.json({counts:Object.fromEntries(Object.entries(c.rows[0]).map(([k,v])=>[k,id(v)])),recentRegistrations:r.rows.map(userDto)});}catch(e){next(e);} });
app.get('/api/admin/users', requireAuth, requireAdmin, async (req,res,next)=>{try{const q=clean(req.query.q,80).toLowerCase(),pattern='%'+q+'%';const rows=await pool.query('SELECT u.id,u.name,u.email,u.department,u.batch,u.role,u.created_at,(SELECT max(l.created_at) FROM public.audit_logs l WHERE l.actor_id=u.id AND l.action=$1) last_login,(SELECT count(*) FROM public.messages m WHERE m.sender_id=u.id) sent_messages FROM public.profiles u WHERE u.role=$2 AND ($3=$4 OR lower(u.name) LIKE $5 OR lower(u.email) LIKE $5 OR lower(u.department) LIKE $5 OR lower(u.batch) LIKE $5) ORDER BY u.id DESC LIMIT 500',['login','student',q,'',pattern]);res.json({users:rows.rows.map(u=>({...userDto(u),lastLogin:u.last_login||null,sentMessages:id(u.sent_messages)}))});}catch(e){next(e);} });
app.get('/api/admin/activity', requireAuth, requireAdmin, async (_req,res,next)=>{try{const q=await pool.query('SELECT l.id,l.action,l.details,l.created_at,l.actor_id,a.name actor_name,t.id target_id,t.name target_name FROM public.audit_logs l LEFT JOIN public.profiles a ON a.id=l.actor_id LEFT JOIN public.profiles t ON t.id=l.target_user_id ORDER BY l.id DESC LIMIT 150');res.json({events:q.rows.map(x=>({id:id(x.id),action:x.action,createdAt:x.created_at,actorId:x.actor_id?id(x.actor_id):null,actorName:x.actor_name||'System',targetId:x.target_id?id(x.target_id):null,targetName:x.target_name||null,details:json(x.details)}))});}catch(e){next(e);} });
app.get('/api/admin/settings', requireAuth, requireAdmin, async (_req,res,next)=>{try{const q=await pool.query('SELECT key,value FROM public.study_settings');const v=Object.fromEntries(q.rows.map(x=>[x.key,x.value]));res.json({settings:{attendanceThreshold:Number(v.attendanceThreshold||75),weeklySummary:v.weeklySummary!=='false'}});}catch(e){next(e);} });
app.put('/api/admin/settings', requireAuth, requireAdmin, async (req,res,next)=>{const threshold=Number(req.body?.attendanceThreshold),weeklySummary=!!req.body?.weeklySummary;if(!Number.isFinite(threshold)||threshold<0||threshold>100)return fail(res,400,'Attendance threshold must be between 0 and 100.');try{await pool.query('INSERT INTO public.study_settings(key,value) VALUES($1,$2),($3,$4) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['attendanceThreshold',String(threshold),'weeklySummary',String(weeklySummary)]);await audit(req.user.id,'settings_updated',null,{attendanceThreshold:threshold,weeklySummary});res.json({ok:true,settings:{attendanceThreshold:threshold,weeklySummary}});}catch(e){next(e);} });

app.use(express.static(path.join(ROOT, 'www'), { extensions: ['html'] }));
app.get(/.*/, (req,res,next)=>req.path.startsWith('/api/')?next():res.sendFile(path.join(ROOT,'www','index.html')));
app.use((_req,res)=>fail(res,404,'Not found.'));
app.use((err,_req,res,_next)=>{console.error('StudyMate API error:',err.message);if(!res.headersSent)res.status(500).json({error:'Unexpected server error.'});});

const server=http.createServer(app),wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{socket.destroy();return;}if(pathname!=='/api/ws'){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
wss.on('connection',ws=>{sockets.add(ws);const timer=setTimeout(()=>ws.close(4401,'Authentication required'),8000);ws.on('message',async raw=>{if(ws.userId)return;try{const packet=JSON.parse(raw.toString());if(packet.type!=='auth')return ws.close(4401,'Authenticate first');const user=await userForToken(packet.token);if(!user)return ws.close(4401,'Invalid session');ws.userId=id(user.id);clearTimeout(timer);ws.send(JSON.stringify({type:'ready'}));}catch{ws.close(4401,'Invalid session');}});ws.on('close',()=>{clearTimeout(timer);sockets.delete(ws);});});

async function start(){
  const missing=[];if(!URL)missing.push('SUPABASE_URL');if(!KEY)missing.push('SUPABASE_PUBLISHABLE_KEY');if(!process.env.DATABASE_URL)missing.push('DATABASE_URL');if(missing.length)throw new Error('Supabase mode requires '+missing.join(', '));
  await pool.query('SELECT 1');server.listen(PORT,'0.0.0.0',()=>console.log('StudyMate Supabase API listening on port '+PORT));
  const stop=async()=>{server.close();await pool.end();process.exit(0);};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
module.exports={start};
