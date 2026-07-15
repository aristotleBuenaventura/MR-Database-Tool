# MR Database Tool — DigitalOcean Droplet Deploy Guide

Step-by-step guide for deploying staging/production on a DigitalOcean Droplet  
(Nginx + PM2 + MySQL + Certbot), with DNS via Namecheap and/or Cloudflare.

**Example staging URL:** `https://stg.tkbaazibangladesh.com`  
**Stack:** React (Vite) + Express + Prisma + MySQL + Nginx + PM2 + Certbot  
**App path on server:** `/var/www/MR-Database-Tool`

---

## 0) Checklist before starting

- [ ] DigitalOcean account + Droplet created
- [ ] Domain on Namecheap (and/or Cloudflare DNS)
- [ ] GitHub repo access (Personal Access Token if private)
- [ ] SSH or Droplet Console access

---

## 1) Create Droplet (DigitalOcean)

| Setting | Choice |
|--------|--------|
| Region | Singapore (or nearest to users) |
| Image | **Ubuntu 24.04 LTS** |
| Plan | Basic, **2GB RAM minimum** (4GB recommended) |
| Auth | SSH key (preferred) or password |
| Hostname | e.g. `react-MrDatabaseTool-test` |

After create → copy the Droplet **IPv4** (example: `146.190.105.28`).

---

## 2) Point domain / subdomain to the Droplet

### Staging subdomain example: `stg.yourdomain.com`

**If using Cloudflare DNS** (Namecheap nameservers point to Cloudflare):

| Type | Name | Content | Proxy |
|------|------|---------|--------|
| A | `stg` | Droplet IP | **DNS only (grey cloud)** first |

**If using Namecheap DNS only:**

| Type | Host | Value |
|------|------|--------|
| A | `stg` | Droplet IP |

Wait 1–30 minutes. Test:

```bash
ping stg.yourdomain.com
```

It should resolve to the Droplet IP.

### Cloudflare Error 521

**521** means Cloudflare is up, but the **origin (Droplet) is not responding**.

Common causes:

- Nginx not running
- Firewall blocking ports 80/443
- Wrong A record IP
- Orange cloud proxy while origin is down

**Quick proof the app works:** open `http://DROPLET_IP/login` directly.  
If that works, fix DNS/Cloudflare (grey cloud + correct IP).

---

## 3) SSH into the Droplet

```bash
ssh root@YOUR_DROPLET_IP
```

Or DigitalOcean → Droplet → **Access** → **Launch Droplet Console**.

---

## 4) Base packages

```bash
apt update && apt upgrade -y
apt install -y git curl nginx mysql-server ufw
```

---

## 5) Install Node.js 22 (required)

Prisma 7 needs Node **20.19+**, **22.12+**, or **24+**.  
**Do not use Ubuntu’s default Node 18.**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v
```

Expect something like `v22.x.x`.

If `node -v` is still 18:

```bash
apt remove -y nodejs
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
hash -r
node -v
```

---

## 6) Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

If you use a DigitalOcean Cloud Firewall, also allow inbound **80** and **443**.

---

## 7) MySQL setup

```bash
systemctl enable mysql
systemctl start mysql
sudo mysql
```

> On Ubuntu, `sudo mysql` usually works for root.  
> If `mysql` command is missing: `apt install -y mysql-server`.

Inside MySQL:

```sql
CREATE DATABASE mr_database_tool CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'mr_user'@'localhost' IDENTIFIED BY 'YOUR_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON mr_database_tool.* TO 'mr_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Optional (helps some MySQL 8 + Prisma/MariaDB auth issues):

```sql
ALTER USER 'mr_user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'YOUR_STRONG_PASSWORD';
FLUSH PRIVILEGES;
```

Test:

```bash
mysql -u mr_user -p
```

```sql
SHOW DATABASES;
EXIT;
```

---

## 8) Clone repo from GitHub

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/YOUR_USERNAME/MR-Database-Tool.git
cd MR-Database-Tool
```

### Private repo — password auth will fail

GitHub **does not accept account passwords** for `git clone` / `git push` over HTTPS.

Use a **Personal Access Token (classic)**:

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate token with **`repo`** scope
3. When prompted:
   - **Username** = GitHub username
   - **Password** = paste the **token** (not your account password)

---

## 9) Install dependencies

```bash
cd /var/www/MR-Database-Tool
npm run install:all
```

If Node was upgraded after a failed install:

```bash
rm -rf backend/node_modules frontend/node_modules
npm run install:all
```

---

## 10) Backend `.env`

Path (created after clone — not visible in FileZilla until then):

`/var/www/MR-Database-Tool/backend/.env`

```bash
nano /var/www/MR-Database-Tool/backend/.env
```

```env
PORT=4000
DATABASE_URL="mysql://mr_user:YOUR_STRONG_PASSWORD@localhost:3306/mr_database_tool"
DATABASE_HOST=localhost
DATABASE_PORT=3306
DATABASE_USER=mr_user
DATABASE_PASSWORD=YOUR_STRONG_PASSWORD
DATABASE_NAME=mr_database_tool
JWT_SECRET=long-random-secret-change-me
CORS_ORIGIN=https://stg.yourdomain.com
```

Save: `Ctrl+O` → Enter → `Ctrl+X`

**Important:**

- Replace placeholders (`YOUR_STRONG_PASSWORD`, domain, JWT)
- `DATABASE_URL` and `DATABASE_PASSWORD` must use the **same** password
- Prefer a password without special characters (`@ # !`) to avoid URL-encoding issues in `DATABASE_URL`
- For HTTPS staging, `CORS_ORIGIN` must be `https://...` (not `http://localhost:5173`)

---

## 11) Prisma migrate + seed + build API

```bash
cd /var/www/MR-Database-Tool/backend
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run build
```

Default seed accounts (change ASAP after first login):

| Role | Email | Password |
|------|--------|----------|
| Admin | `admin@mrtool.local` | `Admin123!` |
| Viewer | `viewer@mrtool.local` | `Viewer123!` |

---

## 12) Run API with PM2

```bash
npm install -g pm2
cd /var/www/MR-Database-Tool/backend
# Use ecosystem so cwd is always backend/ (loads .env correctly)
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then:

```bash
pm2 status
curl http://127.0.0.1:4000/api/health
```

`mr-api` should be **online**.

---

## 13) Build frontend

```bash
cd /var/www/MR-Database-Tool/frontend
npm run build
```

Nginx will proxy `/api` → backend, so the frontend can use relative `/api` URLs.

---

## 14) Nginx site config

```bash
nano /etc/nginx/sites-available/mr-database-tool
```

If you get `No such file or directory`, install Nginx first (`apt install -y nginx`).

```nginx
server {
    listen 80;
    server_name stg.yourdomain.com;

    root /var/www/MR-Database-Tool/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50M;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable and reload:

```bash
ln -sf /etc/nginx/sites-available/mr-database-tool /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx
```

Test:

- `http://DROPLET_IP/login`
- `http://stg.yourdomain.com/login`

---

## 15) HTTPS with Certbot

**Before Certbot:**

- Domain must resolve to the Droplet IP
- Prefer Cloudflare **DNS only (grey cloud)**
- Nginx must be running and serving the site on HTTP

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d stg.yourdomain.com
```

- Enter email
- Agree to terms
- Choose redirect HTTP → HTTPS (**option 2**)

Test: `https://stg.yourdomain.com/login`

Renewal dry-run:

```bash
certbot renew --dry-run
```

After HTTPS, ensure `.env` has:

```env
CORS_ORIGIN=https://stg.yourdomain.com
```

Then:

```bash
pm2 restart mr-api
```

### Cloudflare after HTTPS

- Proxy status can be set back to **Proxied (orange)**
- SSL/TLS mode: **Full** or **Full (strict)**

---

## 16) Deploy updates later (from GitHub)

```bash
cd /var/www/MR-Database-Tool
git pull
npm run install:all
cd backend
npx prisma generate
npx prisma migrate deploy
npm run build
pm2 restart mr-api
cd ../frontend
npm run build
systemctl reload nginx
```

---

## Troubleshooting cheat sheet

| Symptom | Fix |
|--------|-----|
| Prisma: Node version too old | Install Node 22 (section 5) |
| `git: invalid username or token` | Use PAT, not GitHub password |
| `mysql: command not found` | `apt install -y mysql-server` |
| P1000 authentication failed | Fix `.env` password (not left as `YOUR_DB_PASSWORD`) |
| Seed RSA / pool timeout | Use `mysql_native_password` for `mr_user` |
| Nginx: no such file `sites-available/...` | `apt install -y nginx` first |
| Cloudflare **521** | Origin down / wrong IP / firewall; test via IP; use grey cloud |
| Works on IP, not on domain | Fix DNS A record to Droplet IP |
| FileZilla can’t find project under `/var` | Path exists only after `mkdir -p /var/www` + `git clone` |

---

## Useful commands

```bash
pm2 status
pm2 logs mr-api
pm2 restart mr-api
systemctl status nginx
nginx -t
curl http://127.0.0.1:4000/api/health
curl -I http://127.0.0.1
curl -4 ifconfig.me
```

---

## Security reminders

- Use a strong DB password and a strong `JWT_SECRET`
- Change default seed passwords immediately after first login
- Never commit `.env` to Git
- Keep the Droplet updated: `apt update && apt upgrade -y`

---

## Staging example (reference)

What was used for the first staging deploy:

| Item | Value |
|------|--------|
| Domain | `stg.tkbaazibangladesh.com` |
| Droplet IP (example) | `146.190.105.28` |
| App path | `/var/www/MR-Database-Tool` |
| API process | `pm2` name `mr-api` |
| Nginx site | `/etc/nginx/sites-available/mr-database-tool` |
