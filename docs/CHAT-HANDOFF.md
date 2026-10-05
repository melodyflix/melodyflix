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

## LAST KNOWN STATE

- All services STOPPED (pkill was run)
- Ubuntu proot: no tmux session
- Uncommitted changes: NONE (working tree clean)
