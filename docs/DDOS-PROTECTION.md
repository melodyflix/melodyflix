# MelodyFlix — DDoS Protection

Multi-layer defense-in-depth against volumetric + application-layer attacks.

## Layer Stack

| # | Layer | Mechanism | File |
|---|-------|-----------|------|
| 1 | Kernel | SYN cookies, rp_filter, backlog tuning | `scripts/nginx/sysctl-ddos.conf` |
| 2 | Edge (CDN/WAF) | Cloudflare / Nginx-edge (future) | TBD (Section 47) |
| 3 | Nginx | UA block, method whitelist, query patterns | `scripts/nginx/ddos-protection.conf` |
| 4 | Nginx | Connection limits (per-IP, per-vhost) | `ddos-protection.conf` §5 |
| 5 | Nginx | Rate limiting zones | `scripts/nginx/rate-limit.conf` |
| 6 | App | Admin-configurable rate limiting | `sections/.../rate-limiting.service.ts` |
| 7 | App | IP blocking (CIDR) | `sections/.../ip-blocking.service.ts` |
| 8 | App | VPN/Tor detection | `sections/.../vpn-detection.service.ts` |
| 9 | App | Fraud scoring | `sections/.../fraud-detection.service.ts` |
| 10 | App | Suspicious login alerts | `sections/.../suspicious-login.service.ts` |

## Deploy — Nginx

    sudo cp scripts/nginx/ddos-protection.conf /etc/nginx/snippets/melodyflix-ddos.conf
    sudo cp scripts/nginx/rate-limit.conf      /etc/nginx/snippets/melodyflix-ratelimit.conf
    sudo cp scripts/nginx/security.conf        /etc/nginx/snippets/melodyflix-security.conf

Include in http{} block (nginx.conf):

    include snippets/melodyflix-ratelimit.conf;
    include snippets/melodyflix-ddos.conf;

Add enforcement inside each server{} (see ddos-protection.conf §7):

    if ($bad_ua)     { return 403; }
    if ($bad_method) { return 405; }
    if ($blocked_ip) { return 403; }
    if ($bad_query)  { return 400; }

    limit_conn perip_ddos 50;
    limit_conn perserver_ddos 1000;
    limit_req  zone=slowreq_ddos burst=20 nodelay;
    limit_req  zone=hostflood    burst=60 nodelay;

Test + reload:

    sudo nginx -t && sudo systemctl reload nginx

## Deploy — Kernel tuning

    sudo cp scripts/nginx/sysctl-ddos.conf /etc/sysctl.d/99-melodyflix-ddos.conf
    sudo sysctl -p /etc/sysctl.d/99-melodyflix-ddos.conf

## Auto-sync IP blocklist → Nginx

The `/api/v1/ip-blocks` table holds the source of truth. Cron every 5 min:

    sqlite3 /var/lib/melodyflix/melodyflix.db \
      "SELECT '    ' || cidr || ' 1;' FROM ip_blocks \
       WHERE is_active=1 \
         AND (expires_at IS NULL OR expires_at > datetime('now'));" \
      > /etc/nginx/snippets/melodyflix-blocked-ips.conf
    nginx -t && nginx -s reload

Or via API:

    curl -s /api/v1/ip-blocks?active_only=true \
      | jq -r '.data.blocks[] | "    \(.cidr) 1;"' \
      > /etc/nginx/snippets/melodyflix-blocked-ips.conf

## Tuning knobs

| Knob | Where | Default | Effect |
|------|-------|---------|--------|
| `limit_conn perip_ddos N` | ddos §7 | 50 | Concurrent connections per IP |
| `limit_conn perserver_ddos N` | ddos §7 | 1000 | Total concurrent per vhost |
| `slowreq_ddos rate=` | ddos §5 | 10r/s | Global per-IP request rate |
| `hostflood rate=` | ddos §5 | 30r/s | Per-IP host-header rate |
| `client_max_body_size` | ddos §6 | 10m | Global body size (override per-location) |
| `client_body_timeout` | ddos §6 | 12s | Slowloris protection |
| `keepalive_timeout` | ddos §6 | 15s | Idle keepalive close |

## Layered response — what happens on attack

1. **Kernel** — SYN cookie mode; invalid packets dropped
2. **Nginx maps** — bad UA / method / query → 400/403/405
3. **Nginx limit_conn** — excessive connections → 429
4. **Nginx limit_req** — excessive rate → 429 (+ Retry-After)
5. **App rate-limit** — DB-driven rules → 429
6. **App IP-block** — matched CIDR → 403
7. **App VPN-detect** — flagged traffic → challenged (per policy)
8. **App fraud** — high score → review/block event
9. **App suspicious-login** — new device/IP/country → alert user

## Monitoring

- `GET /api/v1/rate-limit/stats/summary` — 24h hits
- `GET /api/v1/ip-blocks/stats/summary` — active blocks + top hits
- `GET /api/v1/fraud/stats/summary` — pending reviews
- Nginx access logs → fail2ban / logwatch (see MONITORING.md)

## Pre-launch checklist

- [ ] Nginx snippets deployed + enforcement blocks added to each server{}
- [ ] `nginx -t` passes on VPS
- [ ] Kernel sysctl applied (only on real VPS, not Termux)
- [ ] IP-block → Nginx sync cron scheduled
- [ ] fail2ban configured (optional)
- [ ] Cloudflare proxied (optional — TBD in Section 47)
- [ ] Monitoring alerts on `denied_24h` spike

## Status

- ✅ Nginx snippet (`ddos-protection.conf`)
- ✅ Kernel tuning (`sysctl-ddos.conf`)
- ✅ App-layer enforcement (11.12–11.16)
- ⏳ Cloudflare integration (Section 47 — deferred)
