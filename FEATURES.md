# MelodyFlix — Feature Tracker

**Last updated:** 2026-10-01
**Purpose:** Track every feature's status. Backend = done on server. Browser test = pending until Oracle VPS or browser session.

Legend:
- ✅ Done (backend + tested)
- 🟡 Backend done, browser test pending
- 🔵 In progress
- ⬜ Not started

---

## A. YouTube-like Features

### Group 1 — Watch Experience (current focus)
| # | Feature | Backend | Browser | Commit | Notes |
|---|---------|---------|---------|--------|-------|
| 1 | Video Chapters | ✅ | ✅ | done | auto from description + manual + admin editor |
| 2 | Watch Queue | ⬜ | ⬜ | — | add to queue button, sidebar queue, play next |
| 3 | Playlist auto-play next episode | ⬜ | ⬜ | — | |
| 4 | Better comments (pagination, sort, pinned, creator heart) | ⬜ | ⬜ | — | |

### Group 2 — Content Discovery
| # | Feature | Backend | Browser | Commit | Notes |
|---|---------|---------|---------|--------|-------|
| 5 | Watch Later (verify) | ✅ | ⬜ | — | |
| 6 | Continue Watching | ⬜ | ⬜ | — | |
| 7 | Favorites | ⬜ | ⬜ | — | |
| 8 | Related videos (better) | ⬜ | ⬜ | — | |

### Group 3 — Player
| # | Feature | Backend | Browser | Commit | Notes |
|---|---------|---------|---------|--------|-------|
| 9 | Loop Video | ⬜ | ⬜ | — | |
| 10 | A-B Repeat | ⬜ | ⬜ | — | |
| 11 | Sleep Timer | ⬜ | ⬜ | — | |
| 12 | Frame-by-frame navigation | ⬜ | ⬜ | — | |

---

## B. Later Phases

### Phase 2 — Audio Streaming
- Music Streaming (already has music.service.ts)
- Podcast (already has podcast.route.ts)
- Audiobook Player
- Lyrics Display

### Phase 3 — Live TV
- IPTV channels
- EPG (XMLTV)
- M3U import
- Admin panel for channels

### Phase 4 — Radio
- Live radio stations
- Now playing
- Radio admin panel

### Phase 5 — Admin Toggles
- All features toggleable from admin panel
- Feature flag system

---

## C. Completed Features (from HANDOFF.md, 39 total)
See HANDOFF.md section 5 for full list.

---

## D. Testing Plan for Oracle VPS Migration

When VPS is ready, verify in order:
1. All backend services start
2. All API endpoints respond
3. Admin panel loads all pages
4. Web app loads all pages
5. Video playback works
6. Chapters display correctly
7. Admin chapter editor works
8. All Group 1 features working

---

**End of Feature Tracker**
