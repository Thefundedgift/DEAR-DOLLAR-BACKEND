# DEAR DOLLAR.com — Backend PRD

## Original Problem Statement
Build a production-ready, fully self-hostable BACKEND for "DEAR DOLLAR.com" (Powered by INTERNET ZONE) using Node.js/NestJS/TypeScript + PostgreSQL (Prisma) + Redis, deployable to Hostinger KVM VPS via Docker Compose. No dependency on proprietary cloud platforms. Features: mobile+password customer auth (JWT access + rotating refresh, brute-force lockout, secure password reset), separate RBAC admin auth, INR money wallet + $DOLLAR point wallet with full transaction ledgers, admin-managed Buy/Demand listings with server-side calculations and rate snapshots, PENDING→approve/reject order flows in atomic PostgreSQL transactions, UPI/QR deposit flow with UTR submission and admin verification (config versioning snapshots), payment settings with QR upload, bank details (masked), audit logs, reports, social links (Telegram/Discord) config API, health check, backups documentation, tests.

## User Choices
- No seeded admin: created via CLI script (`node dist/scripts/create-admin.js`)
- Password reset: token generated server-side, NEVER returned via forgot-password API; admin endpoint generates single-use 30-min tokens; SMS-provider-agnostic (MSG91 later)
- Money wallet = INR, points wallet = $DOLLAR
- QR image: admin uploads file (multer → UPLOAD_DIR, served at /api/uploads)
- Deposits: min ₹200, max ₹100,000; no KYC

## Architecture
- /app/backend = complete portable NestJS project (Dockerfile, docker-compose.yml with backend+postgres16+redis7, .env.example, prisma migrations, README with full Hostinger VPS guide)
- Preview environment only: supervisor runs FastAPI shim (server.py :8001) proxying to Nest API on :4000; start_services.sh auto-starts local Postgres 15/Redis/Node. Production ignores these files (.dockerignore excludes them).
- Prisma models: users, admins, refresh_tokens, password_reset_tokens, money_wallets(+transactions), dollar_wallets(+transactions), buy_listings, demand_listings, buy_orders, sell_orders, payment_settings (versioned), deposits, bank_details, audit_logs, social_links
- Financial safety: conditional raw SQL updates inside prisma.$transaction (balance >= amount, remaining >= points, status=PENDING claims) → no negative balances/double-spend/oversell/duplicate approval. Idempotency-Key supported on order/deposit creation.
- Security: Argon2id, HMAC-hashed rotating refresh tokens w/ reuse detection, Redis brute-force lockout (5 fails/15 min), @nestjs/throttler rate limits, helmet, strict CORS, class-validator, RBAC permissions guard (SUPER_ADMIN bypass), audit logging on all sensitive actions.

## Implemented (June 2026) — all tested
- Full API surface per spec (see /app/backend/README.md API OVERVIEW)
- Social Links config API (admin SUPER_ADMIN manage, public returns enabled only, audit logged)
- Withdrawals: POST/GET /api/wallet/withdrawals (₹200–₹100000, bank-detail snapshot, immediate atomic debit, idempotency); admin GET /api/admin/withdrawals + approve (payoutReference) / reject (auto-refund) under VERIFY_PAYMENTS; audit WITHDRAWAL_APPROVED/REJECTED; reports include withdrawals. Verified via curl e2e (approve, duplicate-409, reject-refund, insufficient balance, min amount, foreign bank id).
- Jest tests: 19 passing (calc + DB transaction/concurrency/idempotency/snapshot tests)
- Testing agent iteration_1: 33/33 backend tests passing; login endpoints fixed to return 200
- Credentials in /app/memory/test_credentials.md

## Backlog / Next
- P1: SMS provider integration (MSG91) for delivering password-reset OTP/tokens
- P2: Pagination/filtering polish on admin lists; CSV export for reports
- P2: Frontend apps (customer + admin) — not in scope of this backend task
