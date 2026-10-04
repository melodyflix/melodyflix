# melodyflix — Launch Readiness Audit

> Generated: 2026-10-04 (after commit 75c25da)
> Status: NOT READY - 8 critical blockers identified
> ETA to launch-ready: 2-4 weeks of focused infra work

---

## Executive Summary

| Category | Status |
|---|---|
| Feature completeness | 95% (Sections 1-150 mostly done) |
| Production config | 20% (env, secrets, SSL missing) |
| Infrastructure | 15% (no systemd, no SSL, no monitoring) |
| Security | 40% (no edge rate limit, no WAF, no DDoS) |
| Legal & Compliance | 0% (no TOS, Privacy, Cookie) |
| Backup & Recovery | 30% (script exists, no automation) |
| Monitoring | 10% (health endpoint only) |
| Payment | 60% (sandbox only, no live merchant) |

**Bottom line:** Code almost done. But infrastructure, security, legal are launch blockers.

---

## CRITICAL BLOCKERS (must fix before launch)

### B1. dotenv not loaded anywhere

**Problem:** deploy.sh creates configs/.env.production + symlinks to .env, but no service actually loads it. loadConfig() in shared-config reads process.env directly - which stays empty unless the shell exports vars.

**Impact:** All .env.production values silently fall back to zod defaults (dev JWT secret, local paths, dev DB).

**Fix:**
1. Add dotenv to packages/shared-config/package.json
2. In loadConfig() call dotenv.config({ path: process.env.ENV_FILE || '.env' }) before parsing
3. Alternative: use Node 22 built-in --env-file=.env flag in each service start command

### B2. No HTTPS/TLS

**Problem:** Nginx listens on ports 5173 (admin) and 5174 (web), HTTP only. No listen 443 ssl.

**Impact:** All traffic (passwords, JWTs, payments) sent in plaintext. Browsers warn. Payment providers (Stripe) require HTTPS.

**Fix:**
1. Point a domain (e.g. melodyflix.com) at the VPS
2. apt install certbot python3-certbot-nginx
3. certbot --nginx -d melodyflix.com -d www.melodyflix.com -d admin.melodyflix.com
4. Update Nginx to listen 443 ssl + redirect 80 to 443

### B3. No process manager (systemd / PM2)

**Problem:** Services started via scripts/start-all.sh. If SSH session closes or VPS reboots, services stop.

**Impact:** Zero uptime guarantee. First reboot = platform down.

**Fix:**
Create systemd units for each service (auth, videos, live, channel, notifications, health) with:
- Restart=always, RestartSec=5
- User=melodyflix (non-root)
- EnvironmentFile=/root/melodyflix/.env
- After=network.target postgresql.service redis.service

Alternative: pm2 with pm2 startup + pm2 save.

### B4. No DB backup automation

**Problem:** mf-backup script exists (per COMMANDS.md) but no cron schedule.

**Impact:** DB corruption = total data loss.

**Fix:**
1. Create /etc/cron.d/melodyflix-backup:
   0 2 * * * root cd /root/melodyflix && bash scripts/backup.sh >> /var/log/melodyflix-backup.log 2>&1
2. Test the restore flow - never trust an untested backup
3. Sync backups to external storage (S3/Backblaze B2)

### B5. No legal pages

**Problem:** No TOS, Privacy Policy, Cookie Consent, DMCA, Age Policy.

**Impact:**
- Google Play / Apple App Store will reject
- Payment providers (Stripe/bKash) require it
- GDPR / BD Digital Security Act violations possible
- Advertisers (AdSense) require it

**Fix:** Create pages in web app:
- /legal/terms
- /legal/privacy
- /legal/cookies
- /legal/dmca
- /legal/age-policy

Use standard templates (Termly, iubenda) or consult a lawyer for BD + global.

### B6. No edge rate limiting / WAF

**Problem:** Rate limiting exists only in shared-auth. No Nginx-level rate limit or WAF.

**Impact:** Single attacker can DDoS or brute-force.

**Fix:**
1. Nginx limit_req_zone for /api/auth/login and /api/auth/signup
2. limit_conn_zone for global connection limits
3. Optional: Cloudflare in front (free tier handles DDoS)

### B7. No monitoring / error tracking

**Problem:** Health endpoint exists but no external monitor or error tracker.

**Impact:** Won't know about outages until users complain.

**Fix:**
1. Uptime: UptimeRobot / BetterStack (free tier)
2. Errors: Sentry (@sentry/node in each service)
3. Logs: Loki + Grafana OR Papertrail OR journalctl + logrotate
4. Metrics: Prometheus + Grafana (later)

### B8. JWT_SECRET default fallback

**Problem:** shared-config defaults JWT_SECRET to 'melodyflix-dev-secret-change-in-production'. If env not loaded (B1), this default is used.

**Impact:** Anyone with this repo can forge valid JWTs.

**Fix:**
1. Remove the default - make JWT_SECRET required with .min(32) when NODE_ENV=production
2. Fail fast on startup if unset in production

---

## HIGH PRIORITY (should fix before public launch)

| # | Item | Impact |
|---|---|---|
| H1 | PostgreSQL migration (from 5x SQLite) | SQLite locks under load; no replication |
| H2 | Redis for sessions/cache (currently unused) | Rate limits + sessions don't scale |
| H3 | CDN for video delivery (Cloudflare/BunnyCDN) | Bandwidth cost + latency |
| H4 | Content seed (50-100 real videos) | Empty platform drives users away |
| H5 | Live payment merchant accounts (bKash/Nagad/Stripe) | Paperwork 2-6 weeks |
| H6 | Email sender verified (SPF/DKIM/DMARC) | Verification emails land in spam |
| H7 | Media storage (MinIO/S3) instead of local disk | Disk fills up; no redundancy |
| H8 | Video transcoding pipeline E2E test | FFmpeg + HLS + player verified |

---

## MEDIUM PRIORITY (post-launch)

| # | Item |
|---|---|
| M1 | Elasticsearch / MeiliSearch for faster search |
| M2 | Mobile app (React Native / Flutter) |
| M3 | Multi-region DB read replicas |
| M4 | GDPR data export/delete endpoints |
| M5 | Advanced analytics (cohort, funnel, retention) |
| M6 | AI content moderation (video/audio) |
| M7 | Machine translation for user content |
| M8 | Creator payout automation (Stripe Connect) |

---

## RECOMMENDED LAUNCH ROADMAP (4 weeks)

### Week 1 — Infrastructure Foundations
- [ ] Fix B1 (dotenv + env loading)
- [ ] Fix B8 (JWT_SECRET required in production)
- [ ] Create systemd units (B3)
- [ ] Setup DB backup cron + test restore (B4)
- [ ] Setup Sentry + UptimeRobot (B7)

### Week 2 — Security & Compliance
- [ ] HTTPS via certbot (B2)
- [ ] Nginx rate limiting (B6)
- [ ] Cloudflare in front (DDoS + cache)
- [ ] Create legal pages (B5)
- [ ] Remove all default secrets

### Week 3 — Data & Content
- [ ] PostgreSQL migration (H1)
- [ ] Redis integration (H2)
- [ ] Seed 50+ real videos
- [ ] CDN setup (H3)
- [ ] Verify transcoding pipeline end-to-end (H8)

### Week 4 — Soft Launch & Monitor
- [ ] Deploy to Oracle Cloud
- [ ] Invite 20-50 alpha users
- [ ] Monitor errors + performance
- [ ] Fix critical bugs
- [ ] Prepare public launch announcement

---

## PRE-LAUNCH CHECKLIST

### Security
- [ ] JWT_SECRET >= 32 chars, unique per environment
- [ ] All default passwords changed (Postgres, MinIO, etc.)
- [ ] HTTPS enforced, HSTS header set
- [ ] Rate limits on login/signup/password-reset
- [ ] SQL injection tests pass
- [ ] XSS tests pass
- [ ] CSRF tokens on state-changing endpoints
- [ ] Secrets never logged
- [ ] .env not in git

### Reliability
- [ ] All services restart on failure (systemd Restart=always)
- [ ] DB backup runs daily + tested restore
- [ ] Uptime monitor alerts to Slack/Telegram
- [ ] Disk usage alert at 80%
- [ ] Memory usage alert at 85%
- [ ] Log rotation enabled
- [ ] Health endpoint monitored externally

### Data
- [ ] Database migration tested on fresh install
- [ ] Seed data loaded (levels, subjects, categories)
- [ ] At least 50 videos for launch
- [ ] At least 10 news articles
- [ ] Sitemap.xml generated
- [ ] robots.txt configured

### Legal & Privacy
- [ ] Terms of Service page live
- [ ] Privacy Policy page live
- [ ] Cookie consent banner
- [ ] DMCA policy
- [ ] Age policy (COPPA compliance for kids content)
- [ ] Data retention policy documented

### Payments
- [ ] Live merchant account approved (bKash/Nagad/Stripe)
- [ ] Webhook endpoints verified in production
- [ ] Refund flow tested
- [ ] Invoice / receipt emails
- [ ] Tax calculation (if required by country)

### Performance
- [ ] Lighthouse score > 80 on web app
- [ ] First contentful paint < 2s
- [ ] Time to interactive < 3s
- [ ] Video start time < 2s (with CDN)
- [ ] Database query times < 100ms (p95)

### Monitoring
- [ ] Sentry capturing errors
- [ ] UptimeRobot pinging /health every 5 min
- [ ] Postgres slow query log enabled
- [ ] Nginx access logs -> file (rotated daily)
- [ ] Alerting to email + Telegram

### Content
- [ ] Homepage populated with real content
- [ ] At least 5 featured creators
- [ ] Welcome email sent on signup
- [ ] Onboarding flow tested
- [ ] Help center populated

### Operations
- [ ] Runbook for common incidents
- [ ] Rollback procedure documented
- [ ] On-call rotation (if team)
- [ ] Status page (statuspage.io / Cachet)
- [ ] Support email configured

---

## SIGN-OFF

This audit should be reviewed before any public launch. The 8 critical
blockers MUST be resolved. The high-priority items are strongly
recommended. Medium items can be deferred.

Last review: 2026-10-04
Next review: before public launch
Owner: project founder
