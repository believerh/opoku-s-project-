OKOMFO ANOKYE UPDATES — v3 (Express + MongoDB + Brevo)
=======================================================

WHAT CHANGED FROM THE SUPABASE VERSION
- Posts, subscribers and the admin session now live in YOUR server + MongoDB. No Supabase.
- Pictures/videos are saved on the server's disk (UPLOAD_DIR) and served from /media/.
- Brevo sends the emails: subscriber confirmation + "new post" alerts.
- The admin page, hidden #admin route, draft/publish, media removal and all other v2 features are kept.
- The Netlify static deploy is replaced by a Node server (Netlify cannot run this).
- Ready to deploy on Railway or a VPS (Docker Compose, systemd/PM2, Caddy/nginx): see DEPLOY.md.
- New: /healthz health check, graceful restarts, automatic Railway detection (domain + volume).

WHAT YOU NEED
1. Node.js 20.19 or newer on your host.
2. A MongoDB database (MongoDB Atlas free tier works; or your own server). Copy its connection string.
3. A Node host with a PERSISTENT DISK for uploads: Railway (with a volume) or a VPS. DEPLOY.md has
   step-by-step guides for both. Hosts with temporary storage delete uploads on every restart.
4. (For email) a free Brevo account.

LOCAL TEST / QUICK START (for Railway and VPS steps, read DEPLOY.md)
1. Unzip, then in the folder run:        npm install
2. Copy .env.example to .env and fill it in:
   - MONGODB_URI        your MongoDB connection string
   - SITE_URL           your public address, e.g. https://school.example.com (no trailing slash)
   - ADMIN_EMAIL        the one admin email
   - ADMIN_PASSWORD_HASH  run:  npm run hash -- "a-strong-password"   and paste the output in single quotes
   - JWT_SECRET         run:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   - UPLOAD_DIR         a folder on persistent storage
   - TRUST_PROXY        1 when behind nginx/Caddy/Railway (default 1)
   - ALLOWED_ORIGINS    optional extra website addresses allowed to publish
3. Start:                                npm start
4. Open the site. Admin login: yoursite.com/#admin  (or tap the "OA" badge 5 times).
   To change the admin password later: make a new hash and update ADMIN_PASSWORD_HASH, then restart.

BREVO EMAIL SETUP (optional; leave the Brevo variables blank to turn email alerts off)
1. Create a Brevo account at https://www.brevo.com/ .
2. Senders, Domains & Dedicated IPs: add and VERIFY the sender address you will send from.
   For reliable delivery, authenticate your own domain (SPF/DKIM). Free mailbox addresses like
   @gmail.com often land in spam when used as the sender.
3. SMTP & API > API Keys: create a key (starts with xkeysib-) and put it in BREVO_API_KEY.
4. Set MAIL_FROM_EMAIL to the verified sender and MAIL_FROM_NAME to the display name.
5. Restart. A "Get news by email" box then appears on the public page.

HOW EMAIL ALERTS WORK
- Visitors enter their email and must click a confirmation link (double opt-in), so nobody can be
  subscribed by someone else. Every alert has an Unsubscribe link.
- When you publish a post, tick "Email confirmed subscribers" and each subscriber gets one email.
  Each post is emailed only once, even if you unpublish and republish it.
- Brevo's free plan allows 300 emails per day (and adds a Brevo logo). With more than 300
  subscribers, some alerts will not be delivered that day. The dashboard shows your subscriber
  count; upgrade the Brevo plan or keep the list under the limit. Plans and limits change, so
  check Brevo's pricing page.

SECURITY NOTES
- Only the one admin can create, edit, hide or delete posts, enforced on the server. The login is
  rate-limited (10 tries per 15 minutes) and the session is an httpOnly, same-site cookie.
- Never commit .env. Never share your Brevo key or JWT_SECRET.
- Serve the site over HTTPS (most hosts do this for you) and keep NODE_ENV=production.
- Strict security headers and a Content-Security-Policy are set in server.js.
- If you open the site by a different address than SITE_URL, admin saves will be blocked as
  "cross-site". Keep SITE_URL equal to the address in the browser.

MEDIA
- Up to 8 pictures per post (5 MB each), one video (50 MB). JPG, PNG, WebP, GIF, AVIF; MP4, WebM, MOV.
- Back up the UPLOAD_DIR folder along with your database.

PRIVACY
Get permission before posting identifiable student photos/videos, and avoid private health details
or humiliating content. Only email people who subscribed themselves.

WHAT'S NOT INCLUDED
- Browser push notifications (email alerts replace them).
- Password reset by email (change the hash in your settings instead).
- Cloud storage for media (files are on your server's disk).
