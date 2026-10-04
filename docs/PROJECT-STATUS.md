# melodyflix — Project Status

> Last updated: 2026-10-04 (after commit 4634760)
> Repo: https://github.com/melodyflix/melodyflix
> Working dir: ~/melodyflix (Ubuntu 24.04 proot on Termux)

---

## Overview

| Metric | Count |
|---|---|
| Microservices | 18 |
| Videos service files | 56 service + 61 route |
| Auth service files | 9 service + 10 route |
| Web app pages | 45 |
| Admin app pages | 16 |
| Completed sections | 20 numbered + 15+ extra |
| Pending work | 3 sections (17 items) + 1 deploy |

---

## Completed — Numbered Features (1-20)

| # | Feature | Notes |
|---|---|---|
| 1 | Account (Signup/Login/JWT) | auth.service |
| 2 | Verification Badge | |
| 3 | Guest Mode | |
| 4 | Community Post | comment + community |
| 5 | Premium Logo (gradient SVG) | frontend |
| 6 | 2FA (TOTP + backup codes) | twofa.service |
| 7 | RTMP/OBS live streaming | live + livetv |
| 8 | Podcast Mode (RSS feed) | podcast.route |
| 9 | Series Management (seasons + episodes) | series.service |
| 10 | Shorts/Reels UI | shorts.route |
| 11 | Stories (24h) | story.service |
| 12 | Ads System (VAST + IMA + Adsterra/Monetag/AdSense) | vast + adadvanced + adcampaign |
| 13 | Payment System (bKash/Nagad/Rocket/SSLCommerz/Stripe/PayPal/Razorpay) | payment.service |
| 14 | Chat Limits (7 free + 50BDT/20 msgs) | chatlimits.service |
| 15 | Super Chat (BDT 50-1000+) | |
| 16 | Channel Membership (monthly tiers) | membership.service |
| 17 | Creator Analytics (charts + revenue) | analytics + advancedanalytics + creatorstudio |
| 18 | Customer Support (FAQ + chatbot + tickets) | support.service |
| 19 | PWA (installable + offline) | frontend |
| 20 | Push Notifications (VAPID) | push.service |

---

## Completed — Extra Features

| Feature | Commit | Notes |
|---|---|---|
| Community Management (25.1-25.4) | c300ae5 | Forum + Groups + Guidelines + Reputation |
| Autoplay Chain | eb04a8a | series/playlist/channel + prefs gating |
| Email Verification Admin Panel | 4634760 | verify/unverify + UI column |
| Cross-Platform Sync (34) | de2e3c9 | multi-device sync |
| Events & Ticketing (23) | c64ce0f | events + virtual + reminders |
| AI Content Safety (8.11-8.16) | 1564e67 | filters, spam, fake account, hallucination, prompt |
| AI Dubbing/Thumbnail/Voice (8.3, 8.5, 8.8-8.10) | c6618a2 | |
| AI Captions/Translation/Summary (8.1-8.7) | a583b31 | |
| Monetization Payouts + KYC (10.10-10.13) | 38df864 | |
| Merch Store + Affiliate (10.7, 10.8) | 4c96d0d | |
| Pay-Per-View + Rent/Buy (10.5, 10.6) | 4cb2634 | |
| Donations + Promo Codes (10.3, 10.9) | 9384dc7 | |
| Online Video Editor (9.5) | 7f593e8 | trim, crop, watermark |
| Live Premieres (7.2) | 0942d33 | |
| Auto Highlight Detection (7.6) | a2d376b | |
| Low-Latency + DVR/Rewind (7.4, 7.7) | 02828f2 | |
| Multi-Camera + Failover (7.5, 7.10) | 51f2217 | |
| Chat Slow Mode + Live Moderator (7.8, 7.9) | 7b68da3 | |
| Timestamp Comments (6.8) | 53d7857 | |
| Voice Search (5.6) | fee3221 | Web Speech API |
| Discovery (5.5, 5.7, 5.12-5.14) | bf79590 | related, up-next, homepage, recommendations |
| Typo-Tolerant Search (5.8-5.11) | d6266e9 | |
| Chromecast + HDR + Frame-Step (4.7, 4.8, 4.11) | a8fb682 | |
| Social Login OAuth (1.3) | 9964667 | |
| Multiple Profiles (1.6) | deb0ae0 | |
| YouTube/Vimeo Import (44.1-44.4) | 67e46de | |
| Video Tagging (Section 46) | 67e46de | |
| Admin Ads Dashboard (51) | 5f5f7b1 | revenue + campaigns + adblock + pods |
| Advanced Ads (51.11, 51.14, 51.17) | 751f03f | revenue, adblock, SSAI |
| Live TV DVR + Time-Shift + Catch-Up UI | 573c38c | |
| Sports + Radio Frontend | 0bd43a0 | |
| Streaming Prebuffer/ABR/CDN/DASH (42.1-42.10) | 95a46ad | |
| Playback Telemetry (42.3, 42.5, 42.7) | 9987cc9 | QoE, error diagnosis |
| Video Versions (41.1-41.4) | 591c661 | director's cut etc |
| Radio Song History (124.4) | 6927ad9 | |
| Radio Scheduling (124.2) | 838a112 | |
| Jingles Library (124.3) | f6d6d0d | |
| Internet Radio CRUD (124.1) | de94a1a | |
| Sports Instant Replay (68.3) | de0d537 | |
| Sports Live Score/Timeline (68.1, 68.2, 68.4) | 5a951df | |
| Live TV Time-Shift + Catch-Up (40.5, 40.8) | f78a460 | |
| Live TV DVR (40.4) | e483433 | FFmpeg worker |
| Live TV Chat (40.9) | 64e4224 | |
| Live TV Parental (40.12) | c59b49c | PIN + age gate |
| Channel Favorites (40.11) | 235e8f7 | |
| Live TV Watch + PiP (40.10) | 3aaa7b3 | |
| Channel Switching (40.3) | b219f93 | |
| M3U + XMLTV EPG (40.2, 40.7, 40.13, 40.14) | 795760e | |
| Live TV Channels CRUD (40.1, 40.6, 40.15, 40.16) | 95717f5 | |
| Creator Studio + A/B + Competitor (9.1-9.11) | 5ba91fc | |

### Core (merged into main)

- Video Upload (Web + Admin)
- HLS Player (Quality/Speed/PiP/Mini/Loop/A-B/Sleep)
- Search backend + Filters
- Like/Comment/Reply/Share/Save
- Report + Admin Moderation
- Watch Later/Subscriptions/History/Resume
- Playlists
- Trending + Categories
- Notifications (Bell + full stack)
- Admin Panel (16 pages)
- Backup (mf-backup)

---

## Launch-Scope Extensions (Sections 146-150)

Added after initial audit based on launch vision (YouTube + Facebook calling + auto content):

| # | Section | Items | Status |
|---|---|---|---|
| 146 | Voice & Video Calling | 8 | NOT STARTED |
| 147 | Real-time Messaging (WebSocket) | 8 | PARTIAL (live chat only) |
| 148 | Emoji Reactions & Rich Media | 6 | NOT STARTED |
| 149 | TMDB/IMDb Metadata Automation | 10 | PARTIAL |
| 150 | Live Collaboration | 6 | PARTIAL (multicam) |

**Additional infra needed:** STUN/TURN (coturn), WebSocket signaling, SFU (mediasoup/Janus).

---

## Pending Work

### Section 21 — Download & Offline (5 items)

Status: NOT STARTED (zero code)

- 21.1 Video download for offline viewing
- 21.2 Quality selection for downloads
- 21.3 Download queue + progress
- 21.4 DRM/token protection
- 21.5 Expiry + storage management

### Section 47 — Social Media Integration (5 items)

Status: NOT STARTED (zero code)

- 47.1 Share to Facebook/Twitter/WhatsApp
- 47.2 Login via social (partial via OAuth 1.3)
- 47.3 Auto-post uploads to social
- 47.4 Social embeds
- 47.5 Cross-post analytics

### Section 65 — Family/Parental Profiles (7 items)

Status: PARTIAL (only ParentalSettings.tsx for Live TV, not family profiles)

- 65.1 Family account (multiple sub-profiles)
- 65.2 Kid-safe mode
- 65.3 Content rating filters
- 65.4 Time limits per profile
- 65.5 Activity reports
- 65.6 Profile PIN
- 65.7 Recommendations per profile

### Deploy

Status: NOT STARTED

- Oracle Cloud Always Free deploy
- Env config + secrets
- PM2 / systemd unit files
- Nginx config for prod
- Health check + monitoring

---

## Priority Order

1. Section 21 (Download & Offline) — smallest, no external API, quick win
2. Section 47 (Social Media) — needs OAuth setup, moderate
3. Section 65 (Family/Parental) — largest, design-heavy
4. Oracle Cloud Deploy — final step after sections done

---

## Directory Map

    melodyflix/
      apps/
        web/       (45 user-facing pages)
        admin/     (16 admin pages)
      services/    (18 microservices)
        auth/            (port 4001)
        channel/         (port 4002)
        videos/          (port 4003) - largest
        notifications/   (port 4004)
        live/            (port 4005)
        ... (13 more)
      packages/
        shared-auth/  shared-db/  shared-events/
        shared-logger/  shared-config/  shared-types/
      docs/
        CONTEXT.md  COMMANDS.md  FEATURES.md  PROJECT-STATUS.md
      scripts/
        start-nginx-all.sh

---

## Work Conventions

- Every feature in a separate file
- One step -> output -> next step
- Mode: Termux / Ubuntu
- Explanation in Bengali, code in English
- git commit -F <file> for multiline commit messages
- Isolated tsc --noEmit for syntax verification
- Migration: try { db.exec('ALTER ...') } catch {}
- Auto-migrations: CREATE TABLE IF NOT EXISTS
- Services: services/videos/src/services/*.service.ts
- Routes: services/videos/src/routes/*.route.ts
- Register both in: services/videos/src/index.ts
- FFmpeg/AI opt-in via env: MELODYFLIX_FFMPEG_ENABLED=1, MELODYFLIX_AI_ENABLED=1
