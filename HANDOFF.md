# MelodyFlix — HANDOFF.md

**Last updated:** 2026-09-30
**Purpose:** Context handoff for new chat sessions. Share this file to continue work.

---

## 1. Project Overview

**MelodyFlix** is a full-stack video streaming platform (YouTube-like) built from scratch.

- **Repo:** https://github.com/melodyflix/melodyflix
- **Local path:** `~/melodyflix` (Termux + proot Ubuntu on Android)
- **Backup:** `mf-backup` command (Termux)
- **Development:** Started on Android phone, will migrate to Oracle Cloud VPS later.

---

## 2. Environment / Architecture

### Host environment
- **Termux** (Android) → **proot-distro Ubuntu**
- **Prompt signs:**
  - 🔴 Termux: `~ $`
  - 🟢 Ubuntu: `root@localhost:~#`
- **Access Ubuntu:** `proot-distro login ubuntu`
- **Exit Ubuntu:** `exit`

### Tech stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + React Router + hls.js |
| Backend | Node.js 22 + Fastify + TypeScript |
| Database | SQLite (dev) — file at `services/*/data/melodyflix.db` |
| Cache/Queue | Redis |
| Video | FFmpeg (HLS transcoding) |
| Storage | Local + MinIO (S3-compatible) |
| Proxy | Nginx (serves production builds + reverse proxy) |
| Monorepo | pnpm workspaces |
| Package manager | pnpm 9.x |

### Services (ports)
| Service | Port | Purpose |
|---------|------|---------|
| auth | 4001 | Signup, login, JWT, 2FA, email |
| channel | 4002 | Channels, follows, community posts, avatar/banner |
| videos | 4003 | Videos, comments, playlists, stories, series, ads, payment, support, push, analytics |
| notifications | 4004 | Bell + events (Redis pub/sub) |
| live | 4005 | Live streaming (camera + RTMP), super chat |
| web (nginx) | 5174 | Public web app (production build) |
| admin (nginx) | 5173 | Admin panel (production build) |

---

## 3. Project Structure

```
~/melodyflix/
├── apps/
│   ├── web/           # Public site (React + Vite)
│   │   ├── public/    # logos, icons, manifest, sw.js, offline.html
│   │   └── src/
│   │       ├── components/    # TopBar, HlsPlayer, MiniPlayer, etc.
│   │       ├── pages/         # Home, Watch, Channel, LiveWatch, etc.
│   │       ├── lib/api.ts     # ALL API calls live here
│   │       └── styles/global.css
│   └── admin/         # Admin panel (WordPress-style)
│       └── src/
│           ├── pages/         # Dashboard, Channels, Videos, Users, Reports, AdNetworks, AdminPayments, AdminSupport, AdminEmail
│           └── lib/api.ts
├── services/
│   ├── auth/          # Users, 2FA, email verification
│   │   ├── data/melodyflix.db
│   │   └── src/{routes,services,models}/
│   ├── channel/
│   │   ├── data/melodyflix.db
│   │   └── src/{routes,services}/
│   ├── videos/        # Largest service
│   │   ├── data/melodyflix.db
│   │   └── src/{routes,services,models}/
│   ├── notifications/
│   └── live/
├── packages/          # Shared code
│   ├── shared-types/
│   ├── shared-config/   # zod-based env config
│   ├── shared-logger/   # pino
│   ├── shared-db/       # node:sqlite wrapper
│   ├── shared-auth/     # JWT verify helpers
│   └── shared-events/   # Redis pub/sub
├── data/
│   ├── videos/{uploads,processed}/   # actual video files
│   ├── channels/{avatars,banners}/
│   ├── stories/
│   └── live/
├── scripts/
│   ├── start-all.sh          # start backend only
│   ├── start-nginx-all.sh    # start backend + nginx
│   ├── stop-all.sh
│   ├── start-infra.sh        # PostgreSQL/Redis/MinIO (if needed)
│   ├── backup.sh             # inside Ubuntu
│   └── deploy.sh             # for fresh VPS
└── configs/
    └── .env.production
```

---

## 4. Design Rules (IMPORTANT)

The user has ONE key rule:

> **"প্রতিটি ফিচার আলাদা ফাইলে থাকবে। কোনো সমস্যা হলে শুধু সেই ফাইল rewrite করলেই কাজ হবে।"**

Meaning:
- Each feature = its own file(s) in a dedicated folder
- Small, focused files
- No giant "all-in-one" files
- If a bug appears → fix only that file, not whole codebase

### A-FORMAT for commands (user preference)
Every command block should have:
```
🟢 Ubuntu (or 🔴 Termux)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 এখন আপনি আছেন: [expected prompt]
📝 যা করব: [what the command does]
💻 কমান্ড: [the command]
✅ এরপর দেখবেন: [expected output]
```

Also:
- User says **"ok"** to confirm each step works
- User sends **screenshots** if a step fails
- When rewriting files, use **Node.js script method** (writing to /tmp/*.js then running node) — NOT heredoc, because heredoc has stuck multiple times

---

## 5. Current Status — COMPLETED FEATURES (20)

All pushed to GitHub main branch:

| # | Feature | Key files |
|---|---------|-----------|
| 1 | Account (signup, login, JWT) | services/auth/ |
| 2 | Channel (create, edit, follow) | services/channel/ |
| 3 | Video upload, edit, delete | services/videos/ |
| 4 | HLS player (quality, speed, PiP, mini player) | apps/web/src/components/HlsPlayer.tsx, MiniPlayer.tsx |
| 5 | Search backend + filters | services/videos/src/routes/search.route.ts |
| 5b | Trending + Categories | services/videos/src/routes/trending.route.ts |
| 6 | Comments + replies + likes | services/videos/src/services/comment.service.ts |
| 6b | Share + Save (Watch Later) | apps/web/src/components/ShareMenu.tsx |
| 11 | Report + Admin moderation | services/videos/src/routes/admin.route.ts |
| 14 | Notifications (bell + events) | services/notifications/ |
| 15 | Watch Later + Subscriptions + History | apps/web/src/pages/WatchLater.tsx, Subscriptions.tsx, History.tsx |
| 16 | Playlists | services/videos/src/routes/playlist.route.ts |
| 17 | Video Edit/Delete (web UI) | apps/web/src/pages/MyVideos.tsx |
| 18 | Channel Avatar/Banner upload | services/channel/src/routes/channel.route.ts |
| 19 | Verification Badge | apps/web/src/components/VerifiedBadge.tsx |
| 20 | Guest Mode + Return-to-page | apps/web/src/components/GuestBanner.tsx |
| 21 | Community Post | services/channel/src/routes/community.route.ts |
| 22 | Premium Logo (gradient SVG) | apps/web/src/components/Logo.tsx |
| 23 | 2FA (TOTP + backup codes) | services/auth/src/services/twofa.service.ts |
| 24 | Live Streaming (camera + WS→FFmpeg→HLS) | services/live/ |
| 25 | RTMP/OBS ingest | services/live/src/services/rtmp.service.ts |
| 26 | Podcast Mode | services/videos/src/routes/podcast.route.ts |
| 27 | Series Management | services/videos/src/services/series.service.ts |
| 28 | Shorts/Reels UI | apps/web/src/pages/ShortsFeed.tsx |
| 29 | Stories (24h) | services/videos/src/services/story.service.ts |
| 30 | Ads System (VAST/IMA/internal) | services/videos/src/services/ads.service.ts, vast.service.ts |
| 31 | Payment Gateways (bKash/Nagad/Stripe/PayPal) | services/videos/src/services/payment.service.ts |
| 32 | Chat Limits (7 free + paid packs) | services/videos/src/services/chatlimits.service.ts |
| 33 | Super Chat | services/live/src/services/superchat.service.ts |
| 34 | Channel Membership | services/videos/src/services/membership.service.ts |
| 35 | Analytics Dashboard | services/videos/src/services/analytics.service.ts |
| 36 | Customer Support (FAQ + chatbot + tickets) | services/videos/src/services/support.service.ts |
| 37 | PWA (installable + offline) | apps/web/public/{sw.js,manifest.webmanifest,offline.html} |
| 38 | Push Notifications (VAPID) | services/videos/src/services/push.service.ts |
| 39 | Email Verification + SMTP | services/auth/src/services/email.service.ts |

---

## 6. How to Run Locally

### Termux prompt (`~ $`)
```bash
proot-distro login ubuntu
```

### Ubuntu prompt (`root@localhost:~#`)
```bash
~/melodyflix/scripts/start-nginx-all.sh
```

Wait ~20 seconds. Then check:
```bash
for p in 4001 4002 4003 4004 4005; do
  echo -n "$p: "; curl -s --max-time 2 http://127.0.0.1:$p/health; echo ""
done
curl -s -o /dev/null -w "web: %{http_code}\n" http://127.0.0.1:5174
curl -s -o /dev/null -w "admin: %{http_code}\n" http://127.0.0.1:5173
```

Expected: all `ok` and `200`.

Open browser: `http://localhost:5174`

**Admin login:** admin@melodyflix.com / admin12345
**Test user:** test@melodyflix.com / password123
**Viewer:** viewer@melodyflix.com / password123

---

## 7. Known Issues & Constraints

### RAM constraint (main issue)
- Android phone kills services (OOM) frequently
- 5 Node services + Nginx + SQLite together need ~1.5GB RAM
- **Solution in progress:** migrate to Oracle Cloud Always Free VPS (4 ARM cores + 24 GB RAM)
- Until then: start services only when testing, then stop.

### Heredoc stuck issue
- `cat > file << 'EOF'` sometimes gets stuck in Termux
- **Always use the Node.js method instead:**
  ```bash
  cat > /tmp/make-file.js << 'ENDSCRIPT'
  const fs = require('fs');
  fs.writeFileSync('/path/to/file', `...content...`);
  console.log('done');
  ENDSCRIPT
  node /tmp/make-file.js
  ```

### Git push needs PAT
- Username: `melodyflix`
- Password: use a Personal Access Token (classic, repo scope)

### Database
- SQLite (not PostgreSQL) is being used for now
- DB files: `services/*/data/melodyflix.db`
- `.gitignore` excludes `.db` files
- Do NOT commit DB files

---

## 8. Next Steps (Pending)

### Immediate
- Oracle Cloud VPS signup + deploy (deploy.sh ready)
- Test all features on VPS

### Group 1 (small)
- Video Chapters (auto + manual)
- Watch Queue (add to queue button)
- Playlist auto-play next episode
- Better comments (pagination, sort, pinned, creator heart)

### Group 2 (medium)
- Music Streaming (separate audio section with lyrics)
- Audiobook Player
- Live TV (IPTV channels + EPG)
- DRM (Widevine)

### Group 3 (advanced)
- Mobile App (Flutter)
- Multi-Tenant SaaS
- AI Features (auto captions via Whisper, auto tags, video summary)

---

## 9. Session Recovery Checklist

When starting a new chat, do this:

1. Share this HANDOFF.md file
2. Say: `"চলুন কাজ শুরু করি"`
3. AI should:
   - Login to Ubuntu: `proot-distro login ubuntu`
   - Check current state: `cd ~/melodyflix && git log --oneline | head -3`
   - Verify services: `curl -s http://127.0.0.1:4001/health` etc.
   - Continue from last completed feature

---

## 10. Git Push Reminder

After every feature:
```bash
cd ~/melodyflix
git add -A
git commit -m "Add <feature name>"
git push
```

If push asks for credentials:
- Username: `melodyflix`
- Password: (paste PAT)

---

**End of HANDOFF.md**
