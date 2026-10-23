# Deploying Okomfo Anokye Updates

Pick one: **A. Railway** (easiest, no server to manage) or **B. a VPS** (cheaper at scale, full control).
Either way you need: a strong admin password hash, a JWT secret, and (optionally) a Brevo key.

Make those first, on any computer with Node 20.19+:

```bash
npm install
npm run hash -- "your-strong-password"                                     # -> ADMIN_PASSWORD_HASH
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # -> JWT_SECRET
npm run vapid                                                              # -> VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (push notifications)
```

`ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` are only used the **first time** the app starts, to create the administrator
account. After that, passwords are managed inside the site (*My account*). If the admin password is ever lost, run
`npm run reset-admin -- you@example.com "NewPassword123"` on the server (or in Railway: `railway run npm run reset-admin -- ...`).
Push notifications need HTTPS (Railway and the Caddy setup provide it).

---

## A. Railway

The app detects Railway automatically: it uses Railway's public domain as the site address, stores uploads on
the attached volume, and Railway uses `/healthz` (from `railway.json`) to know when a deploy is healthy.

1. **Put the code on Railway.** Either push this folder to a GitHub repo and choose *New Project -> Deploy from
   GitHub repo*, or use the CLI: `npm i -g @railway/cli`, `railway login`, `railway init`, `railway up`.
2. **Add MongoDB.** In the project: *+ New -> Database -> MongoDB*. Name it `MongoDB` (the name matters below).
3. **Add a volume to the app service** (for pictures and videos): right-click the project canvas or press
   Ctrl/Cmd+K -> *Create Volume*, attach it to the app service, mount path `/data`.
   Without a volume, uploads are deleted on every deploy. The app will log a warning if it is missing.
4. **Set variables** on the app service (*Variables* tab):

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | `${{MongoDB.MONGO_URL}}`  (use your Mongo service's actual name) |
   | `ADMIN_EMAIL` | your admin email |
   | `ADMIN_PASSWORD_HASH` | the hash from above (paste as-is) |
   | `JWT_SECRET` | the secret from above |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional, for push notifications (`VAPID_SUBJECT` like `mailto:you@example.com`) |
   | `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | optional, for email alerts |

   You do **not** need to set `SITE_URL`, `UPLOAD_DIR` or `NODE_ENV` on Railway.
5. **Get a public address:** app service -> *Settings -> Networking -> Generate Domain* (or add your own domain).
6. Open the site. Admin: `https://YOUR-DOMAIN/#admin`.

**Custom domain:** add it under *Networking*, then set `SITE_URL=https://your-domain` (used in email links) and
keep the Railway domain working too (it is allowed automatically). Any other domains go in `ALLOWED_ORIGINS`.

**Notes**
- A service with a volume runs as a single instance, so expect a brief gap while a new version starts.
- Backups: enable them for the volume and the MongoDB service in the Railway dashboard.
- Logs: `railway logs --follow`.

---

## B. VPS

Use a fresh Ubuntu 22.04/24.04 server and point a DNS **A record** for your domain at its IP address.
Open the firewall: `sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable`.

### B1. Docker Compose (recommended: app + MongoDB + automatic HTTPS in one command)

```bash
curl -fsSL https://get.docker.com | sh            # install Docker
# copy this project to the server (git clone, or scp), then inside the folder:
cp .env.example .env && nano .env
```

In `.env` set: `DOMAIN`, `MONGO_USER`, `MONGO_PASSWORD` (letters and numbers only), `ADMIN_EMAIL`,
`ADMIN_PASSWORD_HASH` (keep the single quotes), `JWT_SECRET`, and the `VAPID_*` / Brevo values if you want push / email.
(`MONGODB_URI`, `SITE_URL` and `UPLOAD_DIR` are filled in by Compose; ignore them.)

```bash
docker compose up -d --build
docker compose logs -f app                        # watch it start (Ctrl+C to leave)
```

Caddy fetches the HTTPS certificate on first visit (DNS must already point at the server).
MongoDB is never exposed to the internet.

**Update:** copy the new files over, then `docker compose up -d --build`.
**Backup** (run regularly and copy the files off the server):

```bash
docker compose exec -T mongo mongodump -u YOUR_MONGO_USER -p YOUR_MONGO_PASSWORD \
  --authenticationDatabase admin --db okomfo_anokye --archive --gzip > db-$(date +%F).gz
docker volume ls                                   # find the volume ending in _uploads
docker run --rm -v THAT_VOLUME:/data -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

### B2. Without Docker (Node + your own MongoDB or Atlas)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo useradd -r -m -d /opt/okomfo-anokye oa
# copy the project into /opt/okomfo-anokye, then:
cd /opt/okomfo-anokye && sudo -u oa npm install --omit=dev
sudo -u oa cp .env.example .env && sudo -u oa nano .env
sudo mkdir -p /var/lib/okomfo-uploads && sudo chown oa /var/lib/okomfo-uploads
```

In `.env`: `NODE_ENV=production`, `PORT=3000`, `SITE_URL=https://your-domain`, `UPLOAD_DIR=/var/lib/okomfo-uploads`,
`MONGODB_URI` (an Atlas string is simplest; installing MongoDB yourself is also fine), and the admin/JWT/Brevo values.

Keep the app running (choose one):

```bash
# systemd
sudo cp deploy/okomfo-anokye.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now okomfo-anokye
journalctl -u okomfo-anokye -f

# or PM2
sudo npm i -g pm2 && pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
```

Add HTTPS in front (choose one):

- **Caddy** (simplest): install Caddy, put `deploy/Caddyfile` at `/etc/caddy/Caddyfile`, replace `{$DOMAIN}` with your
  domain and `app:3000` with `127.0.0.1:3000`, then `sudo systemctl reload caddy`.
- **Nginx**: use `deploy/nginx.conf` (replace `YOUR_DOMAIN`), then `sudo certbot --nginx -d YOUR_DOMAIN`.

**Update:** copy new files, `npm install --omit=dev`, then `sudo systemctl restart okomfo-anokye` (or `pm2 restart okomfo-anokye`).
**Back up** your MongoDB and the `UPLOAD_DIR` folder.

---

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| Uploads fail with "413" | A proxy is limiting body size. Nginx needs `client_max_body_size 60m;` (already in `deploy/nginx.conf`). |
| Pictures vanish after a deploy/restart | Uploads are not on persistent storage. Attach a Railway volume, or use a Docker volume / a real folder on the VPS. |
| "Blocked cross-site request" when publishing | The address in your browser is not `SITE_URL`. Fix `SITE_URL` or add the address to `ALLOWED_ORIGINS`. |
| Login succeeds but you are signed out instantly | The site is being served over plain `http://` in production mode. Use HTTPS (the login cookie is HTTPS-only). |
| Railway deploy never turns healthy | `MONGODB_URI` is wrong. Check the Mongo service name in `${{MongoDB.MONGO_URL}}` and the deploy logs. |
| Everyone shares one rate limit / wrong visitor IP | `TRUST_PROXY` should equal the number of proxies in front of the app (1 for Caddy, nginx and Railway). |
| Notifications never arrive on a phone | Push needs HTTPS and `VAPID_*` set. On iPhone/iPad the visitor must first add the site to the Home Screen and open it from there. Android and desktop browsers work directly. |
| Pictures fail with "could not be read" | The file is damaged or not a real image. Re-save it as JPG and try again. |
| `queryTxt ETIMEOUT` / `querySrv ECONNREFUSED` on start | DNS cannot look up your Atlas address (common on Termux/Android and some networks). Set `DNS_SERVERS=8.8.8.8,1.1.1.1` in `.env`, or use Atlas's standard (non "+srv") connection string. |
| `Server selection timed out` | Atlas is blocking you. In Atlas open *Network Access* and allow your IP (or `0.0.0.0/0` while testing). Also check the database user's password (special characters must be URL-encoded). |
| "Image resizing is OFF" in the log | The `sharp` image library cannot load on this system (e.g. Termux). The site still works; pictures are saved as uploaded (max 5 MB each). Normal on Linux servers, Railway and Docker. |
| No confirmation emails | Check `BREVO_API_KEY`, that `MAIL_FROM_EMAIL` is a verified Brevo sender, and Brevo's daily limit. |
