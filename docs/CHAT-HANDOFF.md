# MelodyFlix — Chat Handoff Context

> Session ended: 2026-10-05
> Last commit: b6a034e (main, origin/main)
> Purpose: Context for continuing work in a new chat

---

## PROJECT BASICS

- Repo: https://github.com/melodyflix/melodyflix
- Working dir: ~/melodyflix (Ubuntu 24.04 proot on Mi 11 Ultra / Termux)
- Stack: React+Vite / Fastify / Node 22 / TypeScript / SQLite / Redis / FFmpeg / Nginx
- GitHub user: melodyflix (PAT token used for git push)
- Domain: melodyflix.com (registered, DNS not yet pointed)

## HARDWARE / ENVIRONMENT

- Device: Mi 11 Ultra (M2102K1G), Android 14 (HyperOS)
- RAM: 12GB physical + 8GB virtual swap
- Storage: 225GB total, 54GB used
- Currently: Android Termux + proot-distro Ubuntu 24.04
- Termux boot from: ~/.termux/boot/ (Termux:Boot app needed from F-Droid)

## WORK CONVENTIONS (IMPORTANT)

1. Every feature in a separate file
2. One step → output → next step (never batch multiple commands)
3. Mode indicator: 🔴 Termux / 🟢 Ubuntu
4. Prompt: ~ $ = Termux, root@localhost = Ubuntu
5. Explanation in Bengali, code in English
6. git commit -F <file> for multiline commits
7. git --no-pager log --oneline -N for git log
8. Isolated tsc --noEmit for syntax verification
9. Migration: try { db.exec('ALTER ...') } catch {}
10. Auto-migrations: CREATE TABLE IF NOT EXISTS
11. Services: services/videos/src/services/*.service.ts
12. Routes: services/videos/src/routes/*.route.ts
13. Register both in: services/videos/src/index.ts
14. Static imports, NOT dynamic require()
15. FFmpeg/AI opt-in: MELODYFLIX_FFMPEG_ENABLED=1, MELODYFLIX_AI_ENABLED=1

## SESSION ACCOMPLISHMENTS (2026-10-04 to 2026-10-05)

### Commits pushed (last 15)
- b6a034e feat: ads service + admin dashboard text + logo cleanup
- b9362db feat(admin): add Auto Content Upload UI (Section 37)
- 448f5fc feat(web): add desktop sidebar navigation (YouTube-style)
- 22e6115 feat(brand): replace with official MelodyFlix logo
- c7ce306 feat(infra): add monitoring setup — logrotate + MONITORING.md (B7)
- c3fbc78 feat(infra): add shared-health package (B7 part 1)
- cbfdb9d feat(infra): add HTTPS/TLS setup automation (B2)
- 473d986 feat(web): add Legal pages (B5) — TOS, Privacy, Cookies, DMCA, Age
- d517138 fix(infra): add Nginx rate limiting + security headers (B6)
- 30a83d7 fix(infra): add systemd units + backup automation (B3, B4)
- b46fbf9 fix(config): load .env + enforce production safety (B1, B8)
- beac942 docs: add LAUNCH-READINESS.md — full pre-launch audit
- 75c25da feat(exam+cert): complete Section 13 — Exam, Proctoring, Certificates
- 36748e1 feat(content-gen): add AI Content Generation — Section 13.16-13.19
- b2227f1 feat(tutor): add AI Tutor — Section 13.6-13.15

### Key features completed this session
- Section 13 (Education): 13.1-13.27 complete
- Section 37 (Auto Content Upload) — 22/22 complete with UI
- All 8 launch blockers (B1-B8) fixed
- Desktop sidebar navigation
- Official MelodyFlix logo (crystalline SVG)
- Admin panel cleanup

### Docs in repo
- docs/CONTEXT.md, docs/COMMANDS.md, docs/FEATURES.md
- docs/FULL-AUDIT.md (145-category status)
- docs/LAUNCH-READINESS.md (8 blockers audit)
- docs/MONITORING.md, docs/ORACLE-DEPLOY.md, docs/PROJECT-STATUS.md

## CRITICAL FIXES APPLIED

### io_uring fix (proot + Node.js incompatibility)
- Error: uv__io_poll: Assertion 'errno == EINTR' failed
- Fix: UV_USE_IO_URING=0 env variable
- Applied in: scripts/start-all.sh (export line) + .env file

### ads.service.ts (was missing)
- Created services/videos/src/services/ads.service.ts
- Registered ensureAdsSchema + ensureAdNetworksSchema in index.ts

## SERVICE PORTS (dev)

- auth: 4001, channel: 4002, videos: 4003, notifications: 4004, live: 4005
- admin: 5173, web: 5174

## TERMUX TMUX WORKFLOW (proot-safe)

Run in Ubuntu proot (NOT Termux):

    tmux kill-session -t melodyflix 2>/dev/null || true
    tmux new-session -d -s melodyflix
    tmux send-keys -t melodyflix "cd /root/melodyflix" Enter
    tmux send-keys -t melodyflix "bash scripts/start-all.sh" Enter

IMPORTANT: tmux attach does NOT work in proot — use:
    tmux capture-pane -p -t melodyflix | tail -30
    tmux kill-session -t melodyflix

## HEALTH CHECK

    for port in 4001 4002 4003 4004 5173 5174; do
      status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:$port/health 2>/dev/null || echo "down")
      echo "Port $port: $status"
    done

## PENDING WORK (priority order)

### 1. Android/Termux stability setup
- Xiaomi Settings: Termux Autostart ON, Battery → No restrictions
- Termux lock in recents
- Boot script (~/.termux/boot/melodyflix.sh)
- Watchdog script (~/mf-watchdog.sh)
- Termux:Boot app from F-Droid

### 2. Auto Upload UI verification (visual test pending)

### 3. Mobile Bottom Nav (deferred)

### 4. HIGH priority items
- H1: PostgreSQL migration
- H2: Redis for sessions/cache
- H3: CDN for video delivery
- H7: MinIO/S3 storage migration
- H8: Video transcoding E2E test

### 5. Oracle Cloud signup (failed — use Contabo €5.99 alternative)

### 6. Deploy scripts ready (scripts/deploy.sh, systemd, ssl, backup, logrotate)

## FIRST MESSAGE FOR NEW CHAT

"নতুন চ্যাটে এসেছি। আগের সেশনে আমরা MelodyFlix প্রজেক্টে অনেক কাজ করেছি।
docs/CHAT-HANDOFF.md ফাইলটা পড়ে নাও — এতে সব context আছে।
আমরা এখান থেকে শুরু করব: [specific task]"

## SESSION 2026-10-05 (New Chat)

### Verified: Auto Content Upload E2E ✅
- All 6 services running in tmux `melodyflix` session (proot-safe)
- Health check: ports 4001-4004, 5173-5174 → all 200
- Content pipeline test (BBC News RSS):
  - Create source → pending_approval ✅
  - Approve → active ✅
  - Worker run → 33 jobs created from RSS ✅
  - Ingest batch(20) → 20 news_items rows ✅
  - Stats verified (worker + ingest endpoints) ✅
- Admin UI: http://localhost:5173 → Auto Upload page renders correctly
  - Stats cards, Sources table, Actions, Tabs all working

### Key learnings
- **Ingest routing by content_kind**:
  - `news` → news_items table
  - `movie`/`tv`/`drama`/`song`/etc → videos table
- **Auth**: POST /api/v1/auth/login with {email, password}
  - Admin: admin@melodyflix.com / admin12345
- **DB**: SQLite at services/videos/data/melodyflix.db
  - services/auth/data/melodyflix.db (users table)
- **`.env`**: only contains `UV_USE_IO_URING=0`
- **termux-wake-lock**: broken (Android 14 restriction on app_process)
  - Use Termux Battery: No restrictions + Recent lock instead

### tmux pattern (proot-safe, working)
    cd /root/melodyflix
    tmux kill-session -t melodyflix 2>/dev/null || true
    tmux new-session -d -s melodyflix -c /root/melodyflix
    tmux send-keys -t melodyflix "export UV_USE_IO_URING=0 && bash scripts/start-all.sh" Enter
    tmux capture-pane -p -t melodyflix | tail -40

### Commits this session
- f501d94 chore(dev): io_uring fix cleanup + admin proxy for content upload

### Test data in DB (cleanup before production)
- content_sources: BBC News Test (id=4189b157-ec82-41d9-96a0-abec1bb52b96)
- news_items: 20 rows (source_id matches above)
- content_fetch_jobs: 20 completed + 13 queued

## PENDING WORK (priority order)
1. Cleanup test data (SQL above)
2. Mobile Bottom Nav (deferred)
3. H1: PostgreSQL migration
4. H2: Redis for sessions/cache
5. H8: Video transcoding E2E test

## SESSION 2026-10-05 (Part 2 — Infra + Branding + Audit)

### Achievements
- FULL-AUDIT.md synced: actual 150 sections (not 145), 762 items total
  - DONE 426 (55%) | PARTIAL 70 (9%) | TODO 266 (34%)
  - Auto-generated summary table + counts added
- Auto Content Upload E2E verified (BBC RSS → 33 jobs → 20 news_items)
- Admin UI verified: stats, Sources/Jobs/Worker tabs, actions all working
- Branding cleanup: removed YouTube/WordPress references from comments
  - External platform refs (YouTube as publish target, migration source) kept
- Section folder scaffold created:
  - services/videos/src/sections/section-11-security-privacy/
  - services/videos/src/sections/_shared/

### CRITICAL: Termux-level tmux (SIGKILL fix)
Root cause: Android LMK kills Termux foreground → proot + tmux + services die.

SOLUTION (verified working): tmux at TERMUX level (not inside Ubuntu proot).
Scripts live in Termux home: ~/mf-scripts/ and ~/.termux/boot/

Scripts created:
- ~/mf-scripts/melodyflix-start.sh  (starts tmux session mf, launches proot+start-all)
- ~/mf-scripts/watchdog.sh          (checks session mf alive)
- ~/mf-scripts/watchdog-loop.sh     (loops watchdog every 120s)
- ~/.termux/boot/melodyflix.sh      (Termux:Boot entry — deferred install)

Usage:
- Start:    ~ $ bash ~/mf-scripts/melodyflix-start.sh
- Inspect:  ~ $ tmux capture-pane -p -t mf | tail -20
- Session:  ~ $ tmux ls   # should show "mf: 1 windows"
- Watchdog: ~ $ nohup bash ~/mf-scripts/watchdog-loop.sh > /dev/null 2>&1 &

Prompt rules (re-enforced):
- ~ $              = Termux (run mf-scripts, proot-distro, tmux)
- root@localhost   = Ubuntu proot (run git, code, services IN tmux mf)

### Deferred
- Termux:Boot app: F-Droid APK signature mismatch with installed Termux
  → Alternate: GitHub Releases APK, or MacroDroid boot trigger
- Not blocking: manual restart is 1 command (~/mf-scripts/melodyflix-start.sh)

### Admin credentials (dev only)
- URL: http://localhost:5173
- Email: admin@melodyflix.com
- Password: admin12345  (CHANGE before production!)

### Commits this session
- f501d94 chore(dev): io_uring fix cleanup + admin proxy for content upload
- 30482f0 docs: update handoff with Auto Upload E2E verification
- ee567f4 docs: sync FULL-AUDIT with 150 sections + auto-generated summary
- ae728c3 chore(brand): remove YouTube/WordPress references from comments

### Integration settings (already exists!)
- services/videos/src/services/integration-settings.service.ts
- services/videos/src/routes/integration-settings.route.ts
- DB-backed API keys, masked on read, health check, admin-only
- 19 integrations defined (tmdb, omdb, openai, anthropic, gemini, smtp,
  bkash, nagad, sslcommerz, stripe, paypal, razorpay, etc.)
- To add a new integration: add entry to DEFAULTS array → auto-seeds on boot

### NEXT SESSION START
1. Read docs/CHAT-HANDOFF.md
2. Read docs/FULL-AUDIT.md (150 sections, summary table at top)
3. Start Section 11.5 — Geo-blocking
   - Create: services/videos/src/sections/section-11-security-privacy/geo-blocking.service.ts
   - Create: .../geo-blocking.route.ts
   - Add MaxMind integration to integration-settings DEFAULTS
   - Register route in services/videos/src/index.ts
