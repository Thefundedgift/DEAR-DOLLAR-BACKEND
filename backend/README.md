# DEAR DOLLAR.com — Backend

Powered by **INTERNET ZONE**

Production-ready, fully self-hostable REST API for the DEAR DOLLAR platform: customer money wallets (INR), $DOLLAR point wallets, admin-managed buy/demand listings, UPI/QR deposits with manual verification, RBAC admin system, audit logs and social links.

**No proprietary cloud required.** Runs on any Linux VPS (tested target: Hostinger KVM VPS, Ubuntu LTS) with Docker Compose.

## Tech Stack

- Node.js 20 (LTS) + NestJS + TypeScript
- PostgreSQL 16 + Prisma ORM (migrations included)
- Redis 7 (rate limiting / brute-force protection)
- JWT auth (access + rotating refresh tokens), Argon2id password hashing
- Docker + Docker Compose, Nginx-compatible

## Project Structure

```
backend/
├── src/                  # NestJS source (auth, wallet, points, orders, admin, ...)
│   └── scripts/          # CLI: create-admin
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── test/                 # Jest tests (calculations + DB transaction flows)
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start (any machine with Docker)

```bash
git clone <repository>
cd <project>/backend
cp .env.example .env
nano .env                 # fill in every value (see below)

docker compose build
docker compose up -d
docker compose exec backend npx prisma migrate deploy

# create the first SUPER_ADMIN (no admin is seeded by default)
docker compose exec backend node dist/scripts/create-admin.js \
  --email admin@yourdomain.com --password 'YourStrongPassword' --role SUPER_ADMIN

curl http://localhost:4000/api/health
# {"status":"ok","database":"connected","redis":"connected"}
```

## Environment Variables (.env)

| Variable | Description | Docker Compose value |
|---|---|---|
| `NODE_ENV` | `production` | `production` |
| `PORT` | API port | `4000` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://deardollar:<POSTGRES_PASSWORD>@db:5432/deardollar?schema=public` |
| `REDIS_URL` | Redis connection | `redis://redis:6379` |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 64` | — |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 64` (must differ from access secret) | — |
| `CORS_ORIGINS` | Comma-separated allowed origins | `https://deardollar.com,https://admin.deardollar.com` |
| `APP_URL` / `CUSTOMER_APP_URL` / `ADMIN_APP_URL` | Public URLs | — |
| `UPLOAD_DIR` | QR image storage (Docker volume) | `/app/uploads` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Used by the `db` container | — |

Never commit `.env`. Never hardcode secrets.

---

# HOSTINGER VPS DEPLOYMENT

Target: Hostinger KVM VPS, Ubuntu 22.04/24.04 LTS. No cPanel, no managed platform.

### 1. SSH into the VPS
```bash
ssh root@YOUR_VPS_IP
```

### 2. Install Docker (with Compose plugin)
```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

### 3. Install Git
```bash
apt install -y git
```

### 4. Clone the repository
```bash
cd /opt
git clone https://github.com/YOUR_USER/YOUR_REPO.git deardollar
cd deardollar/backend
```

### 5. Create the production .env
```bash
cp .env.example .env
openssl rand -hex 64   # run twice, use for the two JWT secrets
nano .env
```
Set `DATABASE_URL=postgresql://deardollar:<POSTGRES_PASSWORD>@db:5432/deardollar?schema=public`, `REDIS_URL=redis://redis:6379`, a strong `POSTGRES_PASSWORD`, both JWT secrets, and your real domain in `CORS_ORIGINS`/`APP_URL`.

### 6. Build Docker images
```bash
docker compose build
```

### 7. Start Docker Compose
```bash
docker compose up -d
```

### 8. Run Prisma migrations
```bash
docker compose exec backend npx prisma migrate deploy
```

### 8b. Create the first SUPER_ADMIN
```bash
docker compose exec backend node dist/scripts/create-admin.js \
  --email admin@yourdomain.com --password 'YourStrongPassword' --name 'Owner' --role SUPER_ADMIN
```

### 9. Check container status
```bash
docker compose ps
```

### 10. Check API health
```bash
curl http://localhost:4000/api/health
```

### 11. Configure Nginx reverse proxy
```bash
apt install -y nginx
nano /etc/nginx/sites-available/deardollar-api
```
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/deardollar-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 12. Configure SSL (Let's Encrypt)
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.yourdomain.com
```

### 13. Restart the application
```bash
docker compose restart backend
# or full restart:
docker compose down && docker compose up -d
```

### 14. View logs
```bash
docker compose logs -f backend
docker compose logs -f db
docker compose logs -f redis
```

### 15. Update the application from GitHub
```bash
cd /opt/deardollar/backend
git pull
docker compose build backend
docker compose up -d backend
docker compose exec backend npx prisma migrate deploy
```

---

# BACKUP & RESTORE

### PostgreSQL backup (pg_dump)
```bash
docker compose exec db pg_dump -U deardollar -Fc deardollar > backup_$(date +%F).dump
```

### PostgreSQL restore (pg_restore)
```bash
cat backup_2025-01-01.dump | docker compose exec -T db pg_restore -U deardollar -d deardollar --clean --if-exists
```

### Docker volume backup (database + uploads)
```bash
docker run --rm -v backend_postgres_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/postgres_volume_$(date +%F).tar.gz -C /data .

docker run --rm -v backend_uploads_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/uploads_volume_$(date +%F).tar.gz -C /data .
```
Restore a volume:
```bash
docker run --rm -v backend_postgres_data:/data -v $(pwd):/backup alpine \
  sh -c "cd /data && tar xzf /backup/postgres_volume_2025-01-01.tar.gz"
```
Automate daily backups with `crontab -e`:
```
0 3 * * * cd /opt/deardollar/backend && docker compose exec -T db pg_dump -U deardollar -Fc deardollar > /opt/backups/deardollar_$(date +\%F).dump
```

---

# API OVERVIEW

All routes are prefixed with `/api`. Authenticated routes require `Authorization: Bearer <accessToken>`.

### Health
- `GET /api/health` → `{"status":"ok","database":"connected","redis":"connected"}`

### Customer auth (`/api/auth`)
- `POST /api/auth/register` `{mobile, password, name?}`
- `POST /api/auth/login` `{mobile, password}` (5 failed attempts → 15 min lockout)
- `POST /api/auth/refresh` `{refreshToken}` (rotating; reuse detection revokes all sessions)
- `POST /api/auth/logout` `{refreshToken}`
- `POST /api/auth/forgot-password` `{mobile}` — generates a secure single-use 30-min token server-side (never returned in the response; SMS provider such as MSG91 can be plugged in later). Until then, an admin can generate a reset token via `POST /api/admin/users/:id/password-reset`.
- `POST /api/auth/reset-password` `{token, newPassword}` — token becomes invalid immediately after use
- `GET /api/auth/me`

### Customer (all require customer JWT)
- `GET /api/users/me`
- `GET /api/wallet` · `GET /api/wallet/transactions`
- `POST /api/wallet/deposits` `{amount}` (₹200–₹100000, supports `Idempotency-Key` header) → returns UPI ID / QR snapshot
- `POST /api/wallet/deposits/:id/utr` `{utr}`
- `GET /api/wallet/deposits` · `GET /api/payments`
- `POST /api/wallet/withdrawals` `{amount, bankDetailId}` (₹200–₹100000; wallet debited immediately, bank details snapshotted; supports `Idempotency-Key`)
- `GET /api/wallet/withdrawals`
- `GET /api/payment-settings` (active UPI/QR config)
- `GET /api/points` · `GET /api/points/transactions`
- `GET /api/points/buy-listings` · `GET /api/points/demand-listings`
- `POST /api/buy-orders` `{listingId, points}` (server calculates amount; wallet debited atomically)
- `POST /api/sell-orders` `{listingId, points}`
- `GET /api/buy-orders` · `GET /api/sell-orders`
- `GET/POST/PUT/DELETE /api/bank-details` (account numbers always masked in responses)
- `GET /api/social-links` (enabled links only, public)

### Admin (`/api/admin`, separate auth — customers can never access)
- `POST /api/admin/auth/login` `{email, password}` · `refresh` · `logout` · `GET me`
- `GET /api/admin/users` · `GET /api/admin/users/:id` · `POST :id/block|unblock`
- `POST /api/admin/users/:id/password-reset` → returns single-use reset token (audit logged)
- `POST /api/admin/users/wallet-adjustment` (SUPER_ADMIN)
- `GET/POST /api/admin/buy-listings` · `PATCH :id/status` (same for `demand-listings`)
- `GET /api/admin/buy-orders` · `POST :id/approve|reject` (same for `sell-orders`)
- `GET /api/admin/payments` · `POST :id/verify|reject`
- `GET /api/admin/withdrawals` · `POST :id/approve` `{payoutReference?}` · `POST :id/reject` `{reason?}` (rejection auto-refunds the wallet)
- `GET/POST /api/admin/payment-settings` (multipart: `upiId`, `merchantName`, `instructions`, `qrImage` file; versioned — historical deposits keep their snapshot)
- `GET /api/admin/reports/summary`
- `GET /api/admin/audit-logs`
- `GET/POST/PATCH /api/admin/admins` (MANAGE_ADMINS)
- `GET/PUT /api/admin/social-links/:platform` (SUPER_ADMIN; platforms: TELEGRAM, DISCORD)

### Roles & permissions
Roles: `SUPER_ADMIN` (all permissions), `ADMIN` (granted subset).
Permissions: `VIEW_CUSTOMERS, VIEW_WALLETS, VERIFY_PAYMENTS, MANAGE_BUY_LISTINGS, MANAGE_DEMAND_LISTINGS, APPROVE_BUY, APPROVE_SELL, VIEW_REPORTS, MANAGE_PAYMENT_SETTINGS, MANAGE_ADMINS, VIEW_AUDIT_LOGS`

---

# SECURITY NOTES

- Argon2id password hashing; hashes/secrets never leave the server
- Rotating refresh tokens stored only as HMAC hashes; reuse detection revokes all sessions
- Login brute-force protection via Redis (5 fails → 15 min lock) + global rate limiting
- All money/point mutations run inside PostgreSQL transactions with conditional updates — negative balances, double-spending, duplicate approvals and overselling are impossible at the SQL level
- Every order/deposit permanently snapshots the rate & UPI configuration used
- Helmet secure headers, strict CORS, class-validator input validation, idempotency keys
- Logs never contain passwords, tokens or full bank account numbers

# TESTING

```bash
# unit + DB integration tests (needs DATABASE_URL pointing at a running PostgreSQL)
yarn test
```
Covers: wallet credit/debit, point credit/debit, buy/sell calculations, approval/rejection, duplicate approval, insufficient balance/points, rate-change snapshot immutability, idempotency and concurrent debits.

# LOCAL DEVELOPMENT (without Docker)

```bash
yarn install
npx prisma migrate dev
yarn start:dev          # http://localhost:4000/api/health
```
