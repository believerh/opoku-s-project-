require('dotenv').config({ quiet: true });
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const express = require('express'), mongoose = require('mongoose'), multer = require('multer');
const helmet = require('helmet'), cookieParser = require('cookie-parser'), jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'), rateLimit = require('express-rate-limit'), webpush = require('web-push');
const connectDb = require('./db');

const E = process.env, ON_RAILWAY = !!E.RAILWAY_ENVIRONMENT_NAME, PROD = E.NODE_ENV === 'production' || ON_RAILWAY, PORT = E.PORT || 3000;
for (const k of ['MONGODB_URI', 'JWT_SECRET'])
  if (!E[k]) { console.error('Missing required environment variable: ' + k + ' (see .env.example)'); process.exit(1); }
if (E.JWT_SECRET.length < 32) { console.error('JWT_SECRET must be at least 32 characters.'); process.exit(1); }

// Image resizing uses "sharp". It is optional: on systems where it cannot load (e.g. Termux/Android) pictures are saved as uploaded.
let sharp = null;
if (!E.DISABLE_IMAGE_RESIZE) {
  try { sharp = require('sharp'); }
  catch (e) { console.warn('Image resizing is OFF (the "sharp" library could not load). Pictures will be saved as uploaded, max 5 MB each.'); }
}

const SITE = (E.SITE_URL || (E.RAILWAY_PUBLIC_DOMAIN ? 'https://' + E.RAILWAY_PUBLIC_DOMAIN : `http://localhost:${PORT}`)).replace(/\/+$/, '');
const ORIGINS = new Set([new URL(SITE).origin, ...(E.RAILWAY_PUBLIC_DOMAIN ? ['https://' + E.RAILWAY_PUBLIC_DOMAIN] : []),
  ...(E.ALLOWED_ORIGINS || '').split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean)]);
const UP = path.resolve(E.UPLOAD_DIR || (E.RAILWAY_VOLUME_MOUNT_PATH ? path.join(E.RAILWAY_VOLUME_MOUNT_PATH, 'uploads') : './uploads'));
fs.mkdirSync(UP, { recursive: true });
if (ON_RAILWAY && !E.UPLOAD_DIR && !E.RAILWAY_VOLUME_MOUNT_PATH)
  console.warn('WARNING: no Railway volume is attached, so uploaded pictures/videos will be lost on every deploy. Attach a volume (see DEPLOY.md).');
const EMAIL_ON = !!(E.BREVO_API_KEY && E.MAIL_FROM_EMAIL);
let PUSH_ON = !!(E.VAPID_PUBLIC_KEY && E.VAPID_PRIVATE_KEY);
if (PUSH_ON) {
  try { webpush.setVapidDetails(E.VAPID_SUBJECT || 'mailto:' + (E.MAIL_FROM_EMAIL || E.ADMIN_EMAIL || 'admin@example.com'), E.VAPID_PUBLIC_KEY, E.VAPID_PRIVATE_KEY); }
  catch (e) { console.warn('Push notifications disabled: invalid VAPID settings (' + e.message + ')'); PUSH_ON = false; }
}
const CATS = ['School announcement', 'Trending news', 'Football', 'Entertainment', 'Events', 'Student achievements'];
const PRIOS = ['Normal', 'Important', 'Urgent'];
const STATUSES = ['draft', 'pending', 'scheduled', 'published', 'rejected'];
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { Schema } = mongoose;

/* ---------- models ---------- */
const Post = mongoose.model('Post', new Schema({
  title: { type: String, required: true, maxlength: 120, trim: true },
  category: { type: String, enum: CATS, default: CATS[0] },
  priority: { type: String, enum: PRIOS, default: 'Normal' },
  author: { type: String, maxlength: 70, trim: true, default: 'Okomfo Anokye Updates' },
  body: { type: String, required: true, maxlength: 5000 },
  media: { type: [String], default: [], validate: v => v.length <= 8 },
  video: { type: String, default: null },
  status: { type: String, enum: STATUSES, default: 'draft' },
  publishAt: Date, publishedAt: Date,
  pinned: { type: Boolean, default: false }, pinUntil: Date,
  views: { type: Number, default: 0 },
  createdBy: { id: Schema.Types.ObjectId, name: String },
  reviewNote: { type: String, maxlength: 300, default: '' },
  notifyOnPublish: { type: Boolean, default: false },
  notifiedAt: Date,
  emailStats: { sent: Number, failed: Number }, pushStats: { sent: Number, failed: Number }
}, { timestamps: true }).index({ status: 1, createdAt: -1 }).index({ status: 1, publishAt: 1 }));
const User = mongoose.model('User', new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'teacher'], default: 'teacher' },
  active: { type: Boolean, default: true },
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt: Date
}, { timestamps: true }));
const Activity = mongoose.model('Activity', new Schema({
  at: { type: Date, default: Date.now, expires: '180d' }, // kept for 180 days
  userName: String, role: String, action: String, postId: String, postTitle: String, detail: String
}));
const Sub = mongoose.model('Subscriber', new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: ['pending', 'confirmed'], default: 'pending' },
  token: { type: String, required: true, index: true }
}, { timestamps: true }));
const PushSub = mongoose.model('PushSub', new Schema({
  endpoint: { type: String, required: true, unique: true }, keys: { p256dh: String, auth: String }
}, { timestamps: true }));

const pinActive = p => !!p.pinned && (!p.pinUntil || p.pinUntil > new Date());
const me = u => ({ id: String(u._id), name: u.name, email: u.email, role: u.role });
const dto = (p, staff) => {
  const o = { id: String(p._id), title: p.title, category: p.category, priority: p.priority, author: p.author, body: p.body,
    media_urls: p.media.map(f => '/media/' + f), video_url: p.video ? '/media/' + p.video : null, pinned: pinActive(p), created_at: p.publishedAt || p.createdAt };
  if (staff) Object.assign(o, { status: p.status, publishAt: p.publishAt, pinUntil: p.pinUntil, pinSet: !!p.pinned, views: p.views, notified: !!p.notifiedAt,
    reviewNote: p.reviewNote, createdBy: p.createdBy && p.createdBy.name, createdById: p.createdBy && p.createdBy.id ? String(p.createdBy.id) : null });
  return o;
};

/* ---------- helpers ---------- */
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpErr = (m, status = 400) => Object.assign(new Error(m), { status });
const unlinkAll = names => Promise.all(names.filter(Boolean).map(n => fs.promises.unlink(path.join(UP, path.basename(n))).catch(() => {})));
const isAdmin = u => u.role === 'admin';
const owns = (u, p) => !!(p.createdBy && p.createdBy.id && String(p.createdBy.id) === String(u._id));
const log = (u, action, p, detail = '') => Activity.create({ userName: u ? u.name : 'System', role: u ? u.role : 'system', action,
  postId: p ? String(p._id) : undefined, postTitle: p ? p.title : undefined, detail }).catch(e => console.error('Activity log failed:', e.message));
const checkPw = pw => { if (typeof pw !== 'string' || pw.length < 10 || pw.length > 200) throw httpErr('Password must be at least 10 characters.'); };
const parseDate = v => { if (!v) return null; const d = new Date(v); if (isNaN(d)) throw httpErr('Invalid date.'); if (d > new Date(Date.now() + 366 * 864e5)) throw httpErr('That date is too far ahead.'); return d; };
const futureDate = v => { const d = parseDate(v); if (d && d < new Date(Date.now() - 60e3)) throw httpErr('The schedule time must be in the future.'); return d; };
const excerpt = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

async function sendMail(to, subject, html, headers) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': E.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: E.MAIL_FROM_NAME || 'Okomfo Anokye Updates', email: E.MAIL_FROM_EMAIL }, to: [{ email: to }], subject, htmlContent: html, ...(headers ? { headers } : {}) })
  });
  if (!r.ok) throw new Error('Brevo ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
const shell = inner => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17221c"><div style="background:#075C38;color:#fff;padding:16px 20px;font-weight:bold">OKOMFO ANOKYE UPDATES</div><div style="padding:20px">${inner}</div></div>`;
const btn = (href, t) => `<p><a href="${href}" style="background:#F7D51D;color:#075C38;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${t}</a></p>`;
const confirmEmail = s => shell(`<h2 style="margin-top:0">Confirm your subscription</h2><p>Tap the button to get an email when important school updates are published. If you did not ask for this, ignore this message.</p>${btn(`${SITE}/api/confirm?t=${s.token}`, 'Confirm subscription')}`);
const postEmail = (p, s) => shell(`<p style="color:#725800;font-size:12px;margin:0">${esc(p.priority !== 'Normal' ? p.priority + ' • ' : '')}${esc(p.category)}</p><h2 style="margin:8px 0">${esc(p.title)}</h2><p style="line-height:1.6;white-space:pre-line">${esc(excerpt(p.body, 400))}</p>${btn(`${SITE}/post/${p._id}`, 'Read the full update')}<p style="font-size:12px;color:#66736b">You receive this because you subscribed to Okomfo Anokye Updates. <a href="${SITE}/api/unsubscribe?t=${s.token}">Unsubscribe</a></p>`);

/* Notify subscribers by email and push. A post is only ever notified once. Returns how many people it was queued for. */
async function notify(p) {
  const [subs, pushes] = await Promise.all([EMAIL_ON ? Sub.find({ status: 'confirmed' }).lean() : [], PUSH_ON ? PushSub.find().lean() : []]);
  if (!subs.length && !pushes.length) return 0;
  p.notifiedAt = new Date(); await p.save();
  (async () => {
    const e = { sent: 0, failed: 0 }, ps = { sent: 0, failed: 0 };
    for (let i = 0; i < subs.length; i += 5)
      await Promise.all(subs.slice(i, i + 5).map(s => sendMail(s.email, (p.priority === 'Urgent' ? 'URGENT: ' : '') + p.title, postEmail(p, s),
        { 'List-Unsubscribe': `<${SITE}/api/unsubscribe?t=${s.token}>` }).then(() => e.sent++).catch(err => { e.failed++; console.error('Email failed:', err.message); })));
    const payload = JSON.stringify({ title: (p.priority === 'Urgent' ? 'URGENT: ' : '') + p.title, body: excerpt(p.body, 110), url: '/post/' + p._id, tag: String(p._id) });
    for (let i = 0; i < pushes.length; i += 20)
      await Promise.all(pushes.slice(i, i + 20).map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 86400, urgency: p.priority === 'Urgent' ? 'high' : 'normal' })
        .then(() => ps.sent++).catch(async err => { ps.failed++; if (err.statusCode === 404 || err.statusCode === 410) await PushSub.deleteOne({ endpoint: s.endpoint }); else console.error('Push failed:', err.statusCode || err.message); })));
    await Post.updateOne({ _id: p._id }, { emailStats: e, pushStats: ps });
    await log(null, 'post.notify', p, `email ${e.sent}/${subs.length}, push ${ps.sent}/${pushes.length}`);
  })().catch(console.error);
  return subs.length + pushes.length;
}

/* Publishes scheduled posts when their time comes. Each post is claimed atomically, so it can never go out twice. */
async function runScheduler() {
  if (mongoose.connection.readyState !== 1) return;
  for (;;) {
    const p = await Post.findOneAndUpdate({ status: 'scheduled', publishAt: { $lte: new Date() } }, { status: 'published', publishedAt: new Date() }, { returnDocument: 'after' });
    if (!p) break;
    await log(null, 'post.publish', p, 'scheduled time reached');
    if (p.notifyOnPublish && !p.notifiedAt) await notify(p).catch(console.error);
  }
}

/* ---------- app ---------- */
const app = express();
const tp = String(E.TRUST_PROXY || '1');
app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp === 'false' ? false : tp);
app.disable('x-powered-by');
app.use(helmet({ hsts: PROD, frameguard: { action: 'deny' }, contentSecurityPolicy: { useDefaults: false, directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
  mediaSrc: ["'self'"], connectSrc: ["'self'"], workerSrc: ["'self'"], manifestSrc: ["'self'"], objectSrc: ["'none'"],
  baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], ...(PROD ? { upgradeInsecureRequests: [] } : {}) } } }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { const o = req.get('origin'); if (o && !ORIGINS.has(o)) return res.status(403).json({ error: 'Blocked cross-site request.' }); }
  next();
});
app.get('/healthz', (req, res) => { const up = mongoose.connection.readyState === 1; res.status(up ? 200 : 503).json({ ok: up }); });
app.use('/media', express.static(UP, { maxAge: '7d', immutable: true, index: false }));

/* ---------- accounts ---------- */
const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: PROD, path: '/', maxAge: 8 * 3600e3 };
const issue = (res, u) => res.cookie('oa_session', jwt.sign({ sub: String(u._id), tv: u.tokenVersion }, E.JWT_SECRET, { expiresIn: '8h' }), cookieOpts);
const auth = h(async (req, res, next) => {
  let t; try { t = jwt.verify(req.cookies.oa_session || '', E.JWT_SECRET); } catch (e) { return res.status(401).json({ error: 'Please sign in.' }); }
  const u = mongoose.isValidObjectId(t.sub) ? await User.findById(t.sub) : null;
  if (!u || !u.active || u.tokenVersion !== t.tv) return res.status(401).json({ error: 'Please sign in.' });
  req.user = u; next();
});
const adminOnly = (req, res, next) => isAdmin(req.user) ? next() : res.status(403).json({ error: 'Only the administrator can do this.' });
const lim = (windowMs, limit, error) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error } });
const DUMMY = bcrypt.hashSync('not-a-real-password', 10);

app.post('/api/login', lim(15 * 60e3, 10, 'Too many attempts. Try again in 15 minutes.'), h(async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase(), pw = String((req.body && req.body.password) || '').slice(0, 200);
  const u = email ? await User.findOne({ email }) : null;
  const ok = await bcrypt.compare(pw, u && u.active ? u.passwordHash : DUMMY);
  if (!(u && u.active && ok)) { await log(null, 'login.failed', null, email.slice(0, 80)); return res.status(401).json({ error: 'Sign-in failed. Check your email and password.' }); }
  u.lastLoginAt = new Date(); await u.save(); issue(res, u); await log(u, 'login');
  res.json({ user: me(u) });
}));
app.post('/api/logout', (req, res) => { res.clearCookie('oa_session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: me(req.user) }));
app.post('/api/me/password', lim(15 * 60e3, 10, 'Too many attempts. Try again later.'), auth, h(async (req, res) => {
  const { current = '', password = '' } = req.body || {};
  if (!(await bcrypt.compare(String(current).slice(0, 200), req.user.passwordHash))) throw httpErr('Your current password is incorrect.');
  checkPw(password);
  req.user.passwordHash = await bcrypt.hash(password, 12); req.user.tokenVersion++; await req.user.save();
  issue(res, req.user); await log(req.user, 'password.change'); res.json({ ok: true });
}));
app.get('/api/admin/users', auth, adminOnly, h(async (req, res) =>
  res.json((await User.find().sort({ createdAt: 1 })).map(u => ({ ...me(u), active: u.active, lastLoginAt: u.lastLoginAt })))));
app.post('/api/admin/users', auth, adminOnly, h(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 80), email = String(req.body.email || '').trim().toLowerCase();
  if (!name) throw httpErr('Name is required.');
  if (!EMAIL_RE.test(email) || email.length > 254) throw httpErr('Enter a valid email address.');
  checkPw(req.body.password);
  if (await User.exists({ email })) throw httpErr('That email already has an account.');
  const u = await User.create({ name, email, passwordHash: await bcrypt.hash(req.body.password, 12), role: 'teacher' });
  await log(req.user, 'user.create', null, name); res.status(201).json({ user: me(u) });
}));
app.patch('/api/admin/users/:id', auth, adminOnly, h(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw httpErr('Invalid account.');
  const u = await User.findById(req.params.id);
  if (!u) throw httpErr('Account not found.', 404);
  if (u.role !== 'teacher') throw httpErr('The administrator account is managed from "My account".');
  if (req.body.password !== undefined) { checkPw(req.body.password); u.passwordHash = await bcrypt.hash(req.body.password, 12); u.tokenVersion++; await log(req.user, 'user.reset', null, u.name); }
  if (typeof req.body.active === 'boolean' && req.body.active !== u.active) { u.active = req.body.active; if (!u.active) u.tokenVersion++; await log(req.user, u.active ? 'user.activate' : 'user.deactivate', null, u.name); }
  await u.save(); res.json({ user: { ...me(u), active: u.active } });
}));
app.get('/api/admin/activity', auth, adminOnly, h(async (req, res) =>
  res.json((await Activity.find().sort({ at: -1 }).limit(150).lean()).map(a => ({ at: a.at, userName: a.userName, role: a.role, action: a.action, postId: a.postId, postTitle: a.postTitle, detail: a.detail })))));

/* ---------- public posts ---------- */
app.get('/api/status', (req, res) => res.json({ email: EMAIL_ON, push: PUSH_ON }));
app.get('/api/posts', h(async (req, res) => {
  const ps = await Post.find({ status: 'published' }).sort({ publishedAt: -1, createdAt: -1 }).limit(200);
  res.json(ps.map(p => dto(p)).sort((a, b) => b.pinned - a.pinned)); // pinned first, newest first inside each group
}));
const BOT = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|curl|wget|python|http-client/i;
app.post('/api/posts/:id/view', lim(3600e3, 1000, 'Too many requests.'), h(async (req, res) => {
  if (!BOT.test(req.get('user-agent') || '') && mongoose.isValidObjectId(req.params.id))
    await Post.updateOne({ _id: req.params.id, status: 'published' }, { $inc: { views: 1 } });
  res.status(204).end();
}));

/* Shareable page for one post, with link-preview tags (WhatsApp, Facebook, etc.) */
const pageCss = '*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Arial,sans-serif;background:#f5f7f4;color:#17221c;line-height:1.6}header{background:#075C38;color:#fff;padding:14px 18px;font-weight:800}header a{color:#fff;text-decoration:none}main{max-width:720px;margin:0 auto;padding:18px}.card{background:#fff;border:1px solid #e1e8e2;border-radius:16px;padding:20px}.tag{display:inline-block;background:#e8f3eb;color:#075C38;font-size:12px;font-weight:800;border-radius:6px;padding:4px 8px}.tag.u{background:#fff4cc;color:#725800}h1{font-size:28px;line-height:1.2;margin:12px 0 4px}.meta{color:#66736b;font-size:13px}.body{white-space:pre-line;margin:16px 0}.media{display:grid;gap:10px;margin:14px 0}.media img,.media video{width:100%;border-radius:12px;background:#111}.share{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.share a,.share button{border:0;border-radius:10px;padding:10px 14px;font:inherit;font-weight:800;text-decoration:none;cursor:pointer;background:#eaf2ec;color:#075C38}.share a.wa{background:#25D366;color:#fff}.back{display:inline-block;margin:0 0 12px;color:#075C38;font-weight:800;text-decoration:none}footer{text-align:center;color:#66736b;font-size:12px;padding:20px}';
const postPage = p => {
  const url = `${SITE}/post/${p._id}`, desc = excerpt(p.body, 180), img = p.media.find(f => !f.endsWith('.gif')) || p.media[0];
  const ogImg = img ? `${SITE}/media/${img}` : `${SITE}/icon-512.png`, title = `${p.title} • Okomfo Anokye Updates`;
  const text = encodeURIComponent(`${p.title} ${url}`);
  const media = p.media.map(f => `<img loading="lazy" src="/media/${esc(f)}" alt="">`).join('') + (p.video ? `<video controls preload="metadata" src="/media/${esc(p.video)}"></video>` : '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(url)}"><meta name="theme-color" content="#075C38"><link rel="icon" href="/icon-192.png"><link rel="manifest" href="/manifest.webmanifest">
<meta property="og:type" content="article"><meta property="og:site_name" content="Okomfo Anokye Updates"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(ogImg)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(p.title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(ogImg)}">
<style>${pageCss}</style></head><body><header><a href="/">OKOMFO ANOKYE UPDATES</a></header>
<main data-id="${p._id}" data-url="${esc(url)}" data-title="${esc(p.title)}"><a class="back" href="/">← All updates</a><article class="card"><span class="tag${p.priority !== 'Normal' ? ' u' : ''}">${esc(p.priority !== 'Normal' ? p.priority + ' • ' + p.category : p.category)}</span>
<h1>${esc(p.title)}</h1><div class="meta">${esc(p.author)} · ${new Date(p.publishedAt || p.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
<div class="body">${esc(p.body)}</div>${media ? `<div class="media">${media}</div>` : ''}
<div class="share"><a class="wa" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${text}">Share on WhatsApp</a><a target="_blank" rel="noopener noreferrer" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}">Facebook</a><button id="shareBtn" type="button">Share / copy link</button></div></article></main>
<footer>School news • Community • Trends</footer><script src="/post.js"></script></body></html>`;
};
const notFoundPage = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Update not found</title><body style="font-family:system-ui,Arial;background:#f5f7f4;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><div><h2 style="color:#075C38">This update is not available</h2><p>It may have been removed or is not published yet.</p><a href="/" style="color:#075C38;font-weight:bold">See all updates</a></div>';
app.get('/post/:id', h(async (req, res) => {
  const p = mongoose.isValidObjectId(req.params.id) ? await Post.findOne({ _id: req.params.id, status: 'published' }) : null;
  res.status(p ? 200 : 404).type('html').send(p ? postPage(p) : notFoundPage);
}));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, f) => { if (/(sw\.js|\.html)$/.test(f)) res.setHeader('Cache-Control', 'no-cache'); } }));

/* ---------- staff posts (admin + teachers) ---------- */
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (q, f, cb) => cb(null, crypto.randomUUID() + EXT[f.mimetype]) }),
  limits: { fileSize: 50 * 1024 * 1024, files: 9, fields: 25, fieldSize: 30 * 1024 },
  fileFilter: (q, f, cb) => {
    const ok = EXT[f.mimetype] && ((f.fieldname === 'images' && f.mimetype.startsWith('image/')) || (f.fieldname === 'video' && f.mimetype.startsWith('video/')));
    cb(ok ? null : httpErr('Unsupported file type. Use JPG, PNG, WebP, GIF or AVIF pictures, or an MP4, WebM or MOV video.'), !!ok);
  }
}).fields([{ name: 'images', maxCount: 8 }, { name: 'video', maxCount: 1 }]);

/* Pictures are resized to max 1600px and saved as WebP (this also strips camera location data). GIFs are kept as they are. */
async function processFiles(req) {
  const f = req.files || {}, inImgs = f.images || [], vid = (f.video || [])[0];
  const out = { imgs: [], vid: vid ? vid.filename : null, all: [] };
  try {
    const maxMb = sharp ? 15 : 5;
    if (inImgs.some(x => x.size > maxMb * 1024 * 1024)) throw httpErr(`Each picture must be ${maxMb} MB or less.`);
    for (const x of inImgs) {
      if (!sharp || x.mimetype === 'image/gif') { out.imgs.push(x.filename); continue; }
      const name = crypto.randomUUID() + '.webp';
      try { await sharp(path.join(UP, x.filename), { limitInputPixels: 80e6 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(UP, name)); }
      catch (e) { throw httpErr('One of the pictures could not be read. Please try a different file.'); }
      out.imgs.push(name); await unlinkAll([x.filename]);
    }
  } catch (e) { await unlinkAll([...out.imgs, ...inImgs.map(x => x.filename), out.vid]); throw e; }
  out.all = [...out.imgs, ...(out.vid ? [out.vid] : [])];
  return out;
}
function parseFields(b) {
  const title = String(b.title || '').trim(), body = String(b.body || '').trim();
  if (!title || title.length > 120) throw httpErr('Title is required (max 120 characters).');
  if (!body || body.length > 5000) throw httpErr('Story text is required (max 5000 characters).');
  return { title, body, category: CATS.includes(b.category) ? b.category : CATS[0], priority: PRIOS.includes(b.priority) ? b.priority : 'Normal',
    author: String(b.author || '').trim().slice(0, 70) || 'Okomfo Anokye Updates' };
}
async function findPost(id) {
  if (!mongoose.isValidObjectId(id)) throw httpErr('Invalid post.');
  const p = await Post.findById(id); if (!p) throw httpErr('Post not found.', 404); return p;
}
const canEdit = (u, p) => isAdmin(u) || (owns(u, p) && ['draft', 'pending', 'rejected'].includes(p.status));

app.get('/api/staff/posts', auth, h(async (req, res) => {
  const u = req.user, ad = isAdmin(u);
  const [ps, subscribers, pushSubscribers, pending] = await Promise.all([
    Post.find(ad ? {} : { 'createdBy.id': u._id }).sort({ createdAt: -1 }).limit(500),
    ad && EMAIL_ON ? Sub.countDocuments({ status: 'confirmed' }) : 0, ad && PUSH_ON ? PushSub.countDocuments() : 0, ad ? Post.countDocuments({ status: 'pending' }) : 0]);
  res.json({ posts: ps.map(p => dto(p, true)), me: me(u), email: EMAIL_ON, push: PUSH_ON, subscribers, pushSubscribers, pending });
}));

app.post('/api/staff/posts', auth, upload, h(async (req, res) => {
  const F = await processFiles(req);
  try {
    const u = req.user, ad = isAdmin(u), action = String(req.body.action || 'draft');
    let status = 'draft'; const extra = {};
    if (action === 'submit') status = 'pending';
    else if (action === 'publish' || action === 'schedule') {
      if (!ad) throw httpErr('Only the administrator can publish. Submit the post for approval instead.', 403);
      if (action === 'publish') { status = 'published'; extra.publishedAt = new Date(); }
      else { const d = futureDate(req.body.publishAt); if (!d) throw httpErr('Choose a date and time to schedule the post.'); status = 'scheduled'; extra.publishAt = d; }
    } else if (action !== 'draft') throw httpErr('Unknown action.');
    if (ad) { extra.pinned = req.body.pinned === '1'; extra.pinUntil = extra.pinned ? parseDate(req.body.pinUntil) : null; extra.notifyOnPublish = req.body.notify === '1'; }
    const p = await Post.create({ ...parseFields(req.body), media: F.imgs, video: F.vid, status, createdBy: { id: u._id, name: u.name }, ...extra });
    await log(u, { pending: 'post.submit', published: 'post.publish', scheduled: 'post.schedule', draft: 'post.create' }[status], p, status === 'scheduled' ? 'for ' + p.publishAt.toISOString() : '');
    const queued = status === 'published' && extra.notifyOnPublish ? await notify(p) : 0;
    res.status(201).json({ post: dto(p, true), queued });
  } catch (e) { await unlinkAll(F.all); throw e; }
}));

app.put('/api/staff/posts/:id', auth, upload, h(async (req, res) => {
  const F = await processFiles(req);
  try {
    const u = req.user, ad = isAdmin(u), p = await findPost(req.params.id);
    if (!canEdit(u, p)) throw httpErr('You cannot edit this post.', 403);
    let rm = []; try { rm = JSON.parse(req.body.removeMedia || '[]'); } catch (e) {}
    rm = (Array.isArray(rm) ? rm : []).map(x => path.basename(String(x))).filter(n => p.media.includes(n));
    const media = [...p.media.filter(n => !rm.includes(n)), ...F.imgs];
    if (media.length > 8) throw httpErr('A post can have at most 8 pictures.');
    let video = p.video; const drop = [...rm];
    if (F.vid) { if (video) drop.push(video); video = F.vid; }
    else if (req.body.removeVideo === '1' && video) { drop.push(video); video = null; }
    Object.assign(p, parseFields(req.body), { media, video });
    if (ad) {
      p.pinned = req.body.pinned === '1'; p.pinUntil = p.pinned ? parseDate(req.body.pinUntil) : null;
      if (p.status === 'scheduled' && req.body.publishAt) p.publishAt = futureDate(req.body.publishAt);
    } else if (p.status === 'rejected') p.status = 'draft';
    const submit = !ad && req.body.action === 'submit' && p.status !== 'pending';
    if (submit) { p.status = 'pending'; p.reviewNote = ''; }
    await p.save(); await unlinkAll(drop);
    await log(u, submit ? 'post.submit' : 'post.update', p);
    res.json({ post: dto(p, true) });
  } catch (e) { await unlinkAll(F.all); throw e; }
}));

app.patch('/api/staff/posts/:id/status', auth, h(async (req, res) => {
  const u = req.user, a = String((req.body && req.body.action) || ''), p = await findPost(req.params.id);
  let queued = 0;
  if (!isAdmin(u)) { // teachers: submit or withdraw their own posts only
    if (!owns(u, p)) throw httpErr('You cannot change this post.', 403);
    if (a === 'submit' && ['draft', 'rejected'].includes(p.status)) { p.status = 'pending'; p.reviewNote = ''; await log(u, 'post.submit', p); }
    else if (a === 'withdraw' && p.status === 'pending') { p.status = 'draft'; await log(u, 'post.withdraw', p); }
    else throw httpErr('That action is not allowed.', 403);
    await p.save(); return res.json({ post: dto(p, true), queued: 0 });
  }
  if (a === 'publish' || a === 'approve') {
    if (p.status === 'published') throw httpErr('This post is already published.');
    p.status = 'published'; p.publishedAt = new Date(); p.publishAt = undefined; p.reviewNote = '';
    await p.save(); await log(u, a === 'approve' ? 'post.approve' : 'post.publish', p);
    if (req.body.notify && !p.notifiedAt) queued = await notify(p);
  } else if (a === 'unpublish') {
    if (!['published', 'scheduled'].includes(p.status)) throw httpErr('This post is not published or scheduled.');
    p.status = 'draft'; p.publishAt = undefined; await p.save(); await log(u, 'post.unpublish', p);
  } else if (a === 'reject') {
    if (p.status !== 'pending') throw httpErr('Only posts waiting for approval can be rejected.');
    p.status = 'rejected'; p.reviewNote = String(req.body.note || '').trim().slice(0, 300); await p.save(); await log(u, 'post.reject', p, p.reviewNote);
  } else if (a === 'schedule') {
    const d = futureDate(req.body.publishAt); if (!d) throw httpErr('Choose a date and time.');
    p.status = 'scheduled'; p.publishAt = d; p.notifyOnPublish = !!req.body.notify; await p.save(); await log(u, 'post.schedule', p, 'for ' + d.toISOString());
  } else throw httpErr('Unknown action.');
  res.json({ post: dto(p, true), queued });
}));

app.delete('/api/staff/posts/:id', auth, h(async (req, res) => {
  const u = req.user, p = await findPost(req.params.id);
  if (!(isAdmin(u) || (owns(u, p) && ['draft', 'rejected'].includes(p.status)))) throw httpErr('You cannot delete this post.', 403);
  await p.deleteOne(); await unlinkAll([...p.media, p.video]); await log(u, 'post.delete', p); res.json({ ok: true });
}));

/* ---------- push notifications ---------- */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const pushHostOk = ep => { try { const u = new URL(ep); return u.protocol === 'https:' && PUSH_HOSTS.some(d => u.hostname === d || u.hostname.endsWith('.' + d)); } catch (e) { return false; } };
app.get('/api/push/key', (req, res) => PUSH_ON ? res.json({ key: E.VAPID_PUBLIC_KEY }) : res.status(503).json({ error: 'Notifications are not enabled.' }));
app.post('/api/push/subscribe', lim(3600e3, 100, 'Too many requests. Please try again later.'), h(async (req, res) => {
  if (!PUSH_ON) return res.status(503).json({ error: 'Notifications are not enabled.' });
  const s = req.body && req.body.subscription, ep = s && s.endpoint, k = s && s.keys;
  if (typeof ep !== 'string' || ep.length > 700 || !pushHostOk(ep) || !k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100)
    throw httpErr('Invalid subscription.');
  await PushSub.updateOne({ endpoint: ep }, { endpoint: ep, keys: { p256dh: k.p256dh, auth: k.auth } }, { upsert: true });
  res.json({ ok: true });
}));
app.post('/api/push/unsubscribe', lim(3600e3, 100, 'Too many requests.'), h(async (req, res) => {
  if (typeof (req.body && req.body.endpoint) === 'string') await PushSub.deleteOne({ endpoint: req.body.endpoint });
  res.json({ ok: true });
}));

/* ---------- email subscriptions (double opt-in) ---------- */
const page = (t, m) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><body style="font-family:system-ui,Arial;background:#f5f7f4;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #e1e8e2;border-radius:16px;padding:28px;max-width:420px;text-align:center"><h2 style="color:#075C38;margin-top:0">${esc(t)}</h2><p>${esc(m)}</p><a href="/" style="color:#075C38;font-weight:bold">Go to the website</a></div></body>`;
app.post('/api/subscribe', lim(3600e3, 30, 'Too many requests. Please try again later.'), h(async (req, res) => {
  const msg = 'Check your inbox to confirm your subscription. If you are already subscribed, no action is needed.';
  if (!EMAIL_ON) return res.status(503).json({ error: 'Email alerts are not available yet.' });
  if (req.body && req.body.website) return res.json({ ok: true, message: msg });
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  let s = await Sub.findOne({ email });
  if (!s) s = await Sub.create({ email, token: crypto.randomBytes(24).toString('hex') });
  if (s.status === 'pending') await sendMail(email, 'Confirm your subscription to Okomfo Anokye Updates', confirmEmail(s)).catch(e => console.error('Confirm email failed:', e.message));
  res.json({ ok: true, message: msg });
}));
const tokenOk = t => typeof t === 'string' && /^[a-f0-9]{48}$/.test(t);
app.get('/api/confirm', h(async (req, res) => {
  const s = tokenOk(req.query.t) ? await Sub.findOneAndUpdate({ token: req.query.t }, { status: 'confirmed' }) : null;
  res.status(s ? 200 : 404).send(s ? page('Subscription confirmed', 'You will now get an email when important updates are published.') : page('Link not valid', 'This link is invalid or has expired.'));
}));
app.get('/api/unsubscribe', h(async (req, res) => {
  const s = tokenOk(req.query.t) ? await Sub.findOneAndDelete({ token: req.query.t }) : null;
  res.status(s ? 200 : 404).send(s ? page('Unsubscribed', 'You will no longer receive emails from Okomfo Anokye Updates.') : page('Link not valid', 'This link is invalid or you are already unsubscribed.'));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err.status || 500, m = err.message;
  if (err instanceof multer.MulterError) { status = 400; m = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (video up to 50 MB).' : 'Upload problem: ' + err.message; }
  else if (err.name === 'ValidationError' || err.name === 'CastError') status = 400;
  else if (status === 500) { console.error(err); m = 'Something went wrong. Please try again.'; }
  res.status(status).json({ error: m });
});

/* ---------- start ---------- */
async function bootstrap() {
  // Upgrade posts saved by the earlier version (they had a true/false "published" field).
  await Post.collection.updateMany({ status: { $exists: false }, published: { $exists: true } }, [{ $set: { status: { $cond: [{ $eq: ['$published', true] }, 'published', 'draft'] }, publishedAt: '$createdAt' } }]);
  await Post.collection.createIndex({ status: 1, createdAt: -1 }).catch(() => {});
  // First start: create the administrator account from ADMIN_EMAIL + ADMIN_PASSWORD_HASH.
  if (!(await User.exists({ role: 'admin' }))) {
    if (!E.ADMIN_EMAIL || !E.ADMIN_PASSWORD_HASH) { console.error('No administrator account exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH (see .env.example), then restart.'); process.exit(1); }
    await User.create({ name: 'Administrator', email: E.ADMIN_EMAIL, passwordHash: E.ADMIN_PASSWORD_HASH, role: 'admin' });
    console.log('Administrator account created for ' + E.ADMIN_EMAIL.toLowerCase());
  }
}
let server;
connectDb(E).then(bootstrap)
  .then(() => {
    server = app.listen(PORT, () => console.log(`Okomfo Anokye Updates running on ${SITE} (port ${PORT}). Uploads: ${UP}. Email: ${EMAIL_ON ? 'on' : 'off'}. Push: ${PUSH_ON ? 'on' : 'off'}. Image resizing: ${sharp ? 'on' : 'off'}`));
    runScheduler().catch(console.error); setInterval(() => runScheduler().catch(console.error), 60e3).unref();
  })
  .catch(e => {
    console.error('Startup failed:', e.message);
    if (/querySrv|queryTxt|ENOTFOUND|EAI_AGAIN/.test(e.message)) console.error('Hint: this is a network/DNS problem reaching MongoDB. Add DNS_SERVERS=8.8.8.8,1.1.1.1 to your .env, or use the standard (non "+srv") connection string from Atlas.');
    else if (/Server selection timed out|ECONNREFUSED/.test(e.message)) console.error('Hint: MongoDB did not answer. For Atlas, open Network Access and allow your IP address (or 0.0.0.0/0 while testing); also check the username and password.');
    process.exit(1);
  });
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(sig + ' received, shutting down.');
  setTimeout(() => process.exit(0), 10000).unref();
  if (!server) return process.exit(0);
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  if (server.closeIdleConnections) server.closeIdleConnections();
});
