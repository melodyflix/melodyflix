# melodyflix — Monitoring & Observability Setup

> Companion to LAUNCH-READINESS.md B7

---

## Overview

Three-tier monitoring strategy:

- **Uptime** — UptimeRobot / BetterStack (external HTTP pings, free tier OK)
- **Errors** — Sentry (exception tracking + alerts, free 5k events/month)
- **Logs** — logrotate + journald (local retention + audit, free)

Optional later: Prometheus + Grafana for deep metrics.

---

## 1. Uptime Monitoring

### UptimeRobot (recommended, free tier)

Sign up: https://uptimerobot.com — free plan covers 50 monitors, 5-min checks.

Monitors to add:

| Monitor | URL | Interval |
|---------|-----|----------|
| Web app | https://melodyflix.com/ | 5 min |
| Admin | https://admin.melodyflix.com/ | 5 min |
| Auth health | https://melodyflix.com/api/auth/health | 5 min |
| Videos health | https://melodyflix.com/api/v1/videos/health | 5 min |
| Videos readiness | https://melodyflix.com/api/v1/videos/ready | 5 min |
| Health service | https://melodyflix.com/api/health/health | 5 min |

Alert contacts to configure:
- Email: ops@melodyflix.com
- Telegram: create bot via @BotFather, add chat ID
- Slack webhook (optional)

Enable SSL expiry monitoring (checks certificate days remaining).

### BetterStack (alternative)

https://betterstack.com/uptime — free tier covers 10 monitors.
Nicer UI, includes status pages.

---

## 2. Error Tracking (Sentry)

### Setup

1. Sign up: https://sentry.io — free 5,000 events/month
2. Create org, then Node.js project
3. Copy the DSN (looks like https://abc123@o123456.ingest.sentry.io/789)
4. Add to .env:
   SENTRY_DSN=...
   SENTRY_ENVIRONMENT=production
   SENTRY_TRACES_SAMPLE_RATE=0.1

### Integration (per service)

Add to each service index.ts before Fastify():

    import * as Sentry from '@sentry/node';
    if (process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || 'development',
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
        release: process.env.APP_VERSION || 'dev',
      });
    }

Add to Fastify error handler:

    app.setErrorHandler((error, request, reply) => {
      if (process.env.SENTRY_DSN) Sentry.captureException(error);
      reply.code(500).send({ error: 'Internal server error' });
    });

Add dependency to each service package.json:
    "@sentry/node": "^8.0.0"

Then run: pnpm install

### Alerts (in Sentry UI)

- New issue — email + Slack
- Regression — email
- Spike (>10 events in 5 min) — page on-call

---

## 3. Log Rotation

Config: scripts/melodyflix-logrotate

Install on VPS:

    sudo cp scripts/melodyflix-logrotate /etc/logrotate.d/melodyflix
    sudo chmod 644 /etc/logrotate.d/melodyflix

Manual test:

    sudo logrotate -d /etc/logrotate.d/melodyflix    # dry-run
    sudo logrotate -f /etc/logrotate.d/melodyflix    # force rotate

Defaults:
- Daily rotation
- 14 days retention
- gzip compression
- copytruncate (no service restart needed)

---

## 4. Health & Readiness Endpoints

Per service, register via shared-health package:

    import { registerHealthRoutes } from '@melodyflix/shared-health';
    registerHealthRoutes(app, {
      service: 'videos',
      includeRedis: true,
      diskPath: '/root/melodyflix',
    });

Then:

- GET /health — liveness (200 if process alive)
- GET /ready — readiness (200 = ok/degraded, 503 = down)

Deep checks run on /ready:
- database: SELECT 1 + latency
- memory: heap used / total ratio
- disk: filesystem usage (degraded > 85%, down > 95%)
- redis: TCP probe with 2s timeout

Example readiness response:

    {
      "service": "videos",
      "status": "ok",
      "timestamp": "2026-10-04T16:15:00.000Z",
      "checks": [
        { "name": "database", "status": "ok", "latency_ms": 3 },
        { "name": "memory",   "status": "ok", "latency_ms": 0 },
        { "name": "disk",     "status": "ok", "latency_ms": 1 },
        { "name": "redis",    "status": "ok", "latency_ms": 2 }
      ]
    }

---

## 5. Alert Routing

Recommended channel mapping:

- Down (readiness 503)     — Email + Telegram + SMS — Immediate response
- Error spike             — Slack + Email           — Within 30 min
- Cert expiring           — Email                   — 14 days notice
- Disk usage > 85%        — Email                   — 24 hr response
- Backup failed           — Email                   — Next morning review

---

## 6. Status Page (optional, public)

Options:

- Cachet (self-hosted, free)
- Instatus (free tier)
- BetterStack status pages (bundled with uptime monitoring)

Publish:
- Incident updates
- Scheduled maintenance notifications
- Historical uptime stats

---

## 7. Metrics (later, when traffic justifies)

Stack:
- Prometheus — pull metrics from each service /metrics endpoint
- Grafana — dashboards + alerting
- Loki — log aggregation with label-based search

Integration:
- prom-client in each service
- node_exporter on VPS host

Metric categories to track:
- HTTP request rate / latency / errors per route
- DB query time
- Queue depth (jobs backlog)
- Video transcode duration
- WebSocket active connections

---

## 8. Installation Summary (on deployed VPS)

    # 1. Log rotation
    sudo cp scripts/melodyflix-logrotate /etc/logrotate.d/melodyflix

    # 2. Sentry
    # Add SENTRY_DSN to .env
    # Add @sentry/node to services that need it
    # pnpm install && systemctl restart melodyflix.target

    # 3. UptimeRobot
    # Configure monitors via web UI (no CLI)

    # 4. Alerts
    # Create Telegram bot, add chat ID to UptimeRobot + Sentry
    # Set up email forwarding to on-call

---

## 9. Verification Checklist

- [ ] UptimeRobot shows "up" for all 6 monitors
- [ ] Trigger a test error and verify it appears in Sentry
- [ ] logrotate dry-run passes with no errors
- [ ] Telegram alerts received on test trigger (kill one service)
- [ ] Readiness 503 alert reaches on-call when DB is stopped
- [ ] SSL expiry monitor is configured
- [ ] Sentry alert rules configured for new + regression + spike
- [ ] Log retention verified (14 days, gzipped)
- [ ] Status page (if used) is live and linked from web footer

---

## 10. Future Enhancements

When traffic crosses 10k DAU:

- Distributed tracing (OpenTelemetry + Jaeger)
- APM (New Relic / Datadog)
- Real user monitoring (RUM) for frontend
- Synthetic monitoring (Scripted browser tests)
- Load testing (k6 / Gatling) before major launches
- On-call rotation tooling (PagerDuty / Opsgenie)
