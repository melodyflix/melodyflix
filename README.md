# 🎬 melodyflix

A full-stack video streaming platform with live broadcasting — built from scratch.

## ✨ Features

### Core
- 🔐 **Account** — Signup, login, JWT auth
- 📺 **Channel** — Create/edit, follow/subscribe, avatar & banner
- 🎥 **Video** — Upload, edit, delete, thumbnails, categories
- ▶️ **HLS Player** — Adaptive bitrate, quality selector, playback speed, PiP
- 🔍 **Search** — Backend search + filters

### Interaction
- 👍 Like / Dislike
- 💬 Comments + nested replies, likes, report
- 📤 Share (6 platforms)
- 🔖 Save to Watch Later
- 📁 Playlists
- 🕐 Watch history with resume
- 🔔 Notifications

### Live Streaming
- 📡 **Camera broadcasting** — Browser camera → WebSocket → FFmpeg → HLS
- 🎥 **RTMP ingest** — OBS/Larix support (planned)
- 💬 **Live chat** — WebSocket-based
- 🔄 **Camera switch** — Front/back toggle

### Discovery
- 🔥 Trending (7-day weighted by views+likes)
- 🗂️ Categories — Music, Gaming, Education, Tech, etc.

### Admin Panel
- WordPress-style dashboard
- Users, Channels, Videos, Reports
- Moderation queue

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, Vite, React Router, hls.js |
| Backend | Node.js 22, Fastify, TypeScript |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Cache | Redis |
| Video | FFmpeg (HLS transcoding) |
| Storage | Local / MinIO (S3-compatible) |
| Proxy | Nginx |
| Monorepo | pnpm workspaces |

## 📁 Project Structure

```
melodyflix/
├── apps/
│   ├── web/              # Public web app (React)
│   └── admin/            # Admin panel (React)
├── services/
│   ├── auth/             # Users, JWT (port 4001)
│   ├── channel/          # Channels, follow (port 4002)
│   ├── videos/           # Videos, comments, playlists (4003)
│   ├── notifications/    # Bell + events (4004)
│   └── live/             # Live streaming (4005)
├── packages/             # Shared code
├── scripts/              # Automation
└── data/                 # Media (gitignored)
```

## 🚀 Quick Start

```bash
# Prerequisites: Node.js 22+, pnpm, FFmpeg, PostgreSQL, Redis, Nginx

# Install
pnpm install

# Start infrastructure
redis-server --daemonize yes

# Start all services
./scripts/start-all.sh

# Open
# http://localhost:5174
```

## 🌐 Deployment

Designed for **Oracle Cloud Always Free** (4 ARM cores + 24 GB RAM).

## 📊 Status

**Phase 1 complete:**
- ✅ Account, Channel, Video, Player
- ✅ Search, Trending, Categories
- ✅ Comments, Likes, Playlists, History
- ✅ Notifications, Watch Later, Subscriptions
- ✅ Live streaming (camera + chat)
- ✅ Admin panel + moderation
- ✅ Avatar/banner upload

**Phase 2 (planned):**
- ⏳ AI features (captions, tags, summary)
- ⏳ Video chapters
- ⏳ Shorts / Reels UI
- ⏳ Better comments
- ⏳ Watch queue
- ⏳ Playlist auto-play
- ⏳ Channel verification
- ⏳ RTMP ingest (OBS)

## 📝 License

Private project. All rights reserved.
