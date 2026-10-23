OKOMFO ANOKYE UPDATES — v4 (Express + MongoDB + Brevo + Push)
=============================================================

NEW IN v4
- Every post has its own link (/post/ID) with a Share button and a preview card, so links pasted into
  WhatsApp/Facebook show the title and picture.
- Pictures are resized automatically (max 1600px, saved as WebP) and camera location data is removed.
  Originals up to 15 MB are accepted. Videos are stored as uploaded (max 50 MB).
- Scheduled publishing: pick a date/time and the post goes live by itself (checked every minute).
- Pinned notices: pin an important post to the top, optionally unpinning itself after a date.
- Post view counts (one per browser per day; bots are ignored; counts are approximate).
- Teacher accounts with approval: the administrator adds teachers. Teachers write posts and submit them;
  only the administrator can publish. Rejected posts come back with a reason. Teachers see only their own posts.
- Activity log (administrator only): who published, edited, approved, rejected, deleted, scheduled, signed in, etc.
  Kept for 180 days.
- Real push notifications to phones and computers (needs HTTPS), alongside email alerts.
- Admin sign-in is now an account in the database. Admins and teachers change their own password under "My account".
  The old ADMIN_PASSWORD_HASH is only used to create the first administrator.

(The notes below still apply; the features above are in addition.)

PREVIOUS VERSION NOTES (v3: Express + MongoDB + Brevo)
------------------------------------------------------

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

PUSH NOTIFICATIONS
- Run  npm run vapid  once and put the two keys in VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (plus VAPID_SUBJECT).
  Do not change the keys later, or everyone has to turn notifications on again.
- Visitors tap "Get notifications on this device". Android and desktop browsers work directly. On iPhone/iPad
  the visitor must first add the site to the Home Screen and open it from there.
- Tick "Notify subscribers" when publishing (or confirm the prompt when approving) to send email + push once.
- Only real browser push services are accepted as destinations, and dead devices are removed automatically.

TEACHERS AND APPROVAL
- Administrator: Team tab > Add teacher (name, email, temporary password). Share the password privately.
- Teachers sign in at yoursite.com/#admin, write a post and press "Submit for approval".
- Administrator: Review tab > Approve (publishes now) or Reject (with a reason the teacher sees).
- Deactivating a teacher signs them out immediately.

WHAT'S NOT INCLUDED
- Events with dates/"add to calendar" and a weekly email digest (suggested earlier, not built yet).
- Video compression (videos are stored as uploaded).
- Password reset by email (use  npm run reset-admin  on the server).
- Cloud storage for media (files are on your server's disk).
