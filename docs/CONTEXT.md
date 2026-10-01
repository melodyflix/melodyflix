# melodyflix — Project Context

GitHub: https://github.com/melodyflix/melodyflix
Env: Termux → proot Ubuntu 24.04
Path: ~/melodyflix/

## Stack
- Frontend: React + Vite + TypeScript + hls.js
- Backend: Node.js 22 + Fastify + TypeScript
- DB: SQLite (dev) → PostgreSQL (prod)
- Cache: Redis
- Video: FFmpeg (HLS)
- Storage: Local + MinIO
- Proxy: Nginx (5173 admin, 5174 web)
- Monorepo: pnpm workspaces

## Ports
- auth: 4001
- channel: 4002
- videos: 4003
- notifications: 4004
- live: 4005
- admin: 5173
- web: 5174
