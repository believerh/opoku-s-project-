require('dotenv').config({ quiet: true });
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const express = require('express'), mongoose = require('mongoose'), multer = require('multer');
const helmet = require('helmet'), cookieParser = require('cookie-parser'), jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'), rateLimit = require('express-rate-limit');

const E = process.env, ON_RAILWAY = !!E.RAILWAY_ENVIRONMENT_NAME, PROD = E.NODE_ENV === 'production' || ON_RAILWAY, PORT = E.PORT || 3000;
for (const k of ['MONGODB_URI', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH'])
  if (!E[k]) { console.error('Missing required environment variable: ' + k + ' (see .env.example)'); process.exit(1); }
if (E.JWT_SECRET.length < 32) { console.error('JWT_SECRET must be at least 32 characters.'); process.exit(1); }

// Public address: SITE_URL, else Railway's generated domain, else localhost.
const SITE = (E.SITE_URL || (E.RAILWAY_PUBLIC_DOMAIN ? 'https://' + E.RAILWAY_PUBLIC_DOMAIN : `http://localhost:${PORT}`)).replace(/\/+$/, '');
// Browser origins allowed to make changes (SITE_URL, the Railway domain, plus any in ALLOWED_ORIGINS).
const ORIGINS = new Set([new URL(SITE).origin, ...(E.RAILWAY_PUBLIC_DOMAIN ? ['https://' + E.RAILWAY_PUBLIC_DOMAIN] : []),
  ...(E.ALLOWED_ORIGINS || '').split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean)]);
// Uploads: UPLOAD_DIR, else a folder on the attached Railway volume, else ./uploads
const UP = path.resolve(E.UPLOAD_DIR || (E.RAILWAY_VOLUME_MOUNT_PATH ? path.join(E.RAILWAY_VOLUME_MOUNT_PATH, 'uploads') : './uploads'));
fs.mkdirSync(UP, { recursive: true });
if (ON_RAILWAY && !E.UPLOAD_DIR && !E.RAILWAY_VOLUME_MOUNT_PATH)
  console.warn('WARNING: no Railway volume is attached, so uploaded pictures/videos will be lost on every deploy. Attach a volume (see DEPLOY.md).');
const EMAIL_ON = !!(E.BREVO_API_KEY && E.MAIL_FROM_EMAIL);
const CATS = ['School announcement', 'Trending news', 'Football', 'Entertainment', 'Events', 'Student achievements'];
const PRIOS = ['Normal', 'Important', 'Urgent'];
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };

/* ---------- models ---------- */
const postSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 120, trim: true },
  category: { type: String, enum: CATS, default: CATS[0] },
  priority: { type: String, enum: PRIOS, default: 'Normal' },
  author: { type: String, maxlength: 70, trim: true, default: 'Okomfo Anokye Updates' },
  body: { type: String, required: true, maxlength: 5000 },
  media: { type: [String], default: [], validate: v => v.length <= 8 },
  video: { type: String, default: null },
  published: { type: Boolean, default: true },
  notifiedAt: Date,
  emailStats: { sent: Number, failed: Number }
}, { timestamps: true });
postSchema.index({ published: 1, createdAt: -1 });
const Post = mongoose.model('Post', postSchema);
const Sub = mongoose.model('Subscriber', new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  status: { type: String, enum: ['pending', 'confirmed'], default: 'pending' },
  token: { type: String, required: true, index: true }
}, { timestamps: true }));

const dto = p => ({ id: String(p._id), title: p.title, category: p.category, priority: p.priority, author: p.author, body: p.body,
  media_urls: p.media.map(f => '/media/' + f), video_url: p.video ? '/media/' + p.video : null,
  published: p.published, notified: !!p.notifiedAt, created_at: p.createdAt });

/* ---------- helpers ---------- */
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpErr = (m, status = 400) => Object.assign(new Error(m), { status });
const unlinkAll = names => Promise.all(names.filter(Boolean).map(n => fs.promises.unlink(path.join(UP, path.basename(n))).catch(() => {})));

async function sendMail(to, subject, html, headers) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': E.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: E.MAIL_FROM_NAME || 'Okomfo Anokye Updates', email: E.MAIL_FROM_EMAIL }, to: [{ email: to }], subject, htmlContent: html, ...(headers ? { headers } : {}) })
  });
  if (!r.ok) throw new Error('Brevo ' + r.status + ' ' + (await r.text()).slice(0, 200));
}
const shell = inner => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17221c"><div style="background:#075C38;color:#fff;padding:16px 20px;font-weight:bold">OKOMFO ANOKYE UPDATES</div><div style="padding:20px">${inner}</div></div>`;
const btn = (href, t) => `<p><a href="${href}" style="background:#F7D51D;color:#075C38;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${t}</a></p>`;
const confirmEmail = s => shell(`<h2 style="margin-top:0">Confirm your subscription</h2><p>Tap the button to get an email when important school updates are published. If you did not ask for this, ignore this message.</p>${btn(`${SITE}/api/confirm?t=${s.token}`, 'Confirm subscription')}`);
const postEmail = (p, s) => shell(`<p style="color:#725800;font-size:12px;margin:0">${esc(p.priority !== 'Normal' ? p.priority + ' • ' : '')}${esc(p.category)}</p><h2 style="margin:8px 0">${esc(p.title)}</h2><p style="line-height:1.6;white-space:pre-line">${esc(p.body.length > 400 ? p.body.slice(0, 400) + '…' : p.body)}</p>${btn(SITE + '/', 'Read on the website')}<p style="font-size:12px;color:#66736b">You receive this because you subscribed to Okomfo Anokye Updates. <a href="${SITE}/api/unsubscribe?t=${s.token}">Unsubscribe</a></p>`);

async function notify(p) {
  const subs = await Sub.find({ status: 'confirmed' }).lean();
  if (!subs.length) return 0;
  p.notifiedAt = new Date(); await p.save(); // mark first so it can never be sent twice
  (async () => {
    let sent = 0, failed = 0;
    for (let i = 0; i < subs.length; i += 5)
      await Promise.all(subs.slice(i, i + 5).map(s =>
        sendMail(s.email, (p.priority === 'Urgent' ? 'URGENT: ' : '') + p.title, postEmail(p, s), { 'List-Unsubscribe': `<${SITE}/api/unsubscribe?t=${s.token}>` })
          .then(() => sent++).catch(e => { failed++; console.error('Email failed:', e.message); })));
    await Post.updateOne({ _id: p._id }, { emailStats: { sent, failed } });
  })().catch(console.error);
  return subs.length;
}

/* ---------- app ---------- */
const app = express();
const tp = String(E.TRUST_PROXY || '1'); // number of reverse proxies in front of the app
app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp === 'false' ? false : tp);
app.disable('x-powered-by');
app.use(helmet({ hsts: PROD, frameguard: { action: 'deny' }, contentSecurityPolicy: { useDefaults: false, directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
  mediaSrc: ["'self'"], connectSrc: ["'self'"], workerSrc: ["'self'"], manifestSrc: ["'self'"], objectSrc: ["'none'"],
  baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], ...(PROD ? { upgradeInsecureRequests: [] } : {}) } } }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use('/api', (req, res, next) => { // block cross-site writes
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { const o = req.get('origin'); if (o && !ORIGINS.has(o)) return res.status(403).json({ error: 'Blocked cross-site request.' }); }
  next();
});
app.get('/healthz', (req, res) => { const up = mongoose.connection.readyState === 1; res.status(up ? 200 : 503).json({ ok: up }); });
app.use('/media', express.static(UP, { maxAge: '7d', immutable: true, index: false }));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, f) => { if (/(sw\.js|\.html)$/.test(f)) res.setHeader('Cache-Control', 'no-cache'); } }));

const auth = (req, res, next) => {
  try { if (jwt.verify(req.cookies.oa_admin || '', E.JWT_SECRET).role === 'admin') return next(); } catch (e) {}
  res.status(401).json({ error: 'Please sign in.' });
};
const lim = (windowMs, limit, error) => rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error } });
const DUMMY = bcrypt.hashSync('not-the-password', 10);

app.post('/api/login', lim(15 * 60e3, 10, 'Too many attempts. Try again in 15 minutes.'), h(async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const okE = String(email).trim().toLowerCase() === E.ADMIN_EMAIL.trim().toLowerCase();
  const okP = await bcrypt.compare(String(password).slice(0, 200), okE ? E.ADMIN_PASSWORD_HASH : DUMMY);
  if (!(okE && okP)) return res.status(401).json({ error: 'Sign-in failed. Check your email and password.' });
  res.cookie('oa_admin', jwt.sign({ role: 'admin' }, E.JWT_SECRET, { expiresIn: '8h' }), { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 8 * 3600e3, path: '/' });
  res.json({ ok: true });
}));
app.post('/api/logout', (req, res) => { res.clearCookie('oa_admin', { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ admin: true }));
app.get('/api/status', (req, res) => res.json({ email: EMAIL_ON }));

/* public posts */
app.get('/api/posts', h(async (req, res) => res.json((await Post.find({ published: true }).sort({ createdAt: -1 }).limit(200)).map(dto))));

/* admin posts */
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (q, f, cb) => cb(null, crypto.randomUUID() + EXT[f.mimetype]) }),
  limits: { fileSize: 50 * 1024 * 1024, files: 9, fields: 20, fieldSize: 30 * 1024 },
  fileFilter: (q, f, cb) => {
    const ok = EXT[f.mimetype] && ((f.fieldname === 'images' && f.mimetype.startsWith('image/')) || (f.fieldname === 'video' && f.mimetype.startsWith('video/')));
    cb(ok ? null : httpErr('Unsupported file type. Use JPG, PNG, WebP, GIF or AVIF pictures, or an MP4, WebM or MOV video.'), !!ok);
  }
}).fields([{ name: 'images', maxCount: 8 }, { name: 'video', maxCount: 1 }]);

function parseFields(b) {
  const title = String(b.title || '').trim(), body = String(b.body || '').trim();
  if (!title || title.length > 120) throw httpErr('Title is required (max 120 characters).');
  if (!body || body.length > 5000) throw httpErr('Story text is required (max 5000 characters).');
  return { title, body, category: CATS.includes(b.category) ? b.category : CATS[0], priority: PRIOS.includes(b.priority) ? b.priority : 'Normal',
    author: String(b.author || '').trim().slice(0, 70) || 'Okomfo Anokye Updates' };
}
function parseFiles(req) {
  const f = req.files || {}, imgs = f.images || [], vid = (f.video || [])[0];
  const out = { imgs: imgs.map(x => x.filename), vid: vid ? vid.filename : null };
  out.all = [...out.imgs, ...(out.vid ? [out.vid] : [])];
  out.big = imgs.some(x => x.size > 5 * 1024 * 1024);
  return out;
}
async function findPost(id) {
  if (!mongoose.isValidObjectId(id)) throw httpErr('Invalid post.');
  const p = await Post.findById(id); if (!p) throw httpErr('Post not found.', 404); return p;
}

app.get('/api/admin/posts', auth, h(async (req, res) => {
  const [ps, subscribers] = await Promise.all([Post.find().sort({ createdAt: -1 }), Sub.countDocuments({ status: 'confirmed' })]);
  res.json({ posts: ps.map(dto), subscribers, email: EMAIL_ON });
}));
app.post('/api/admin/posts', auth, upload, h(async (req, res) => {
  const F = parseFiles(req);
  try {
    if (F.big) throw httpErr('Each picture must be 5 MB or less.');
    const publish = req.body.action !== 'draft';
    const p = await Post.create({ ...parseFields(req.body), media: F.imgs, video: F.vid, published: publish });
    const queued = publish && req.body.notify === '1' && EMAIL_ON ? await notify(p) : 0;
    res.status(201).json({ post: dto(p), queued });
  } catch (e) { await unlinkAll(F.all); throw e; }
}));
app.put('/api/admin/posts/:id', auth, upload, h(async (req, res) => {
  const F = parseFiles(req);
  try {
    if (F.big) throw httpErr('Each picture must be 5 MB or less.');
    const p = await findPost(req.params.id);
    let rm = []; try { rm = JSON.parse(req.body.removeMedia || '[]'); } catch (e) {}
    rm = (Array.isArray(rm) ? rm : []).map(u => path.basename(String(u))).filter(n => p.media.includes(n));
    const media = [...p.media.filter(n => !rm.includes(n)), ...F.imgs];
    if (media.length > 8) throw httpErr('A post can have at most 8 pictures.');
    let video = p.video; const drop = [...rm];
    if (F.vid) { if (video) drop.push(video); video = F.vid; }
    else if (req.body.removeVideo === '1' && video) { drop.push(video); video = null; }
    Object.assign(p, parseFields(req.body), { media, video }); await p.save();
    await unlinkAll(drop);
    res.json({ post: dto(p) });
  } catch (e) { await unlinkAll(F.all); throw e; }
}));
app.patch('/api/admin/posts/:id/published', auth, h(async (req, res) => {
  const p = await findPost(req.params.id);
  p.published = !!(req.body && req.body.published); await p.save();
  const queued = p.published && req.body.notify && EMAIL_ON && !p.notifiedAt ? await notify(p) : 0;
  res.json({ post: dto(p), queued });
}));
app.delete('/api/admin/posts/:id', auth, h(async (req, res) => {
  const p = await findPost(req.params.id); await p.deleteOne(); await unlinkAll([...p.media, p.video]); res.json({ ok: true });
}));

/* email subscriptions (double opt-in) */
const page = (t, m) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><body style="font-family:system-ui,Arial;background:#f5f7f4;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#fff;border:1px solid #e1e8e2;border-radius:16px;padding:28px;max-width:420px;text-align:center"><h2 style="color:#075C38;margin-top:0">${esc(t)}</h2><p>${esc(m)}</p><a href="/" style="color:#075C38;font-weight:bold">Go to the website</a></div></body>`;
app.post('/api/subscribe', lim(60 * 60e3, 8, 'Too many requests. Please try again later.'), h(async (req, res) => {
  const msg = 'Check your inbox to confirm your subscription. If you are already subscribed, no action is needed.';
  if (!EMAIL_ON) return res.status(503).json({ error: 'Email alerts are not available yet.' });
  if (req.body && req.body.website) return res.json({ ok: true, message: msg }); // honeypot
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
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
  if (err instanceof multer.MulterError) { status = 400; m = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (pictures 5 MB, video 50 MB).' : 'Upload problem: ' + err.message; }
  else if (err.name === 'ValidationError' || err.name === 'CastError') status = 400;
  else if (status === 500) { console.error(err); m = 'Something went wrong. Please try again.'; }
  res.status(status).json({ error: m });
});

// If the connection string names no database (e.g. Railway's MONGO_URL), use MONGODB_DB or "okomfo_anokye".
const hasDb = /^mongodb(?:\+srv)?:\/\/[^/]+\/[^?\s]+/.test(E.MONGODB_URI);
let server;
mongoose.connect(E.MONGODB_URI, { serverSelectionTimeoutMS: 10000, ...(E.MONGODB_DB || !hasDb ? { dbName: E.MONGODB_DB || 'okomfo_anokye' } : {}) })
  .then(() => { server = app.listen(PORT, () => console.log(`Okomfo Anokye Updates running on ${SITE} (port ${PORT}). Uploads: ${UP}. Email alerts: ${EMAIL_ON ? 'on' : 'off'}`)); })
  .catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });

// Finish in-flight requests and close cleanly when the host restarts or redeploys the app.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(sig + ' received, shutting down.');
  setTimeout(() => process.exit(0), 10000).unref();
  if (!server) return process.exit(0);
  server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
  if (server.closeIdleConnections) server.closeIdleConnections();
});
