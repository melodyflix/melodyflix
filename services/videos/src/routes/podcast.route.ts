// melodyflix videos - podcast routes
import type { FastifyInstance } from 'fastify';
import { getDb } from '@melodyflix/shared-db';
import { listPodcasts, countPodcasts, listPodcastsByChannel } from '../services/video.service.js';

export async function podcastRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/podcasts
  app.get('/podcasts', async (req, reply) => {
    const q = req.query as { limit?: string; offset?: string; channel?: string };
    const limit = Math.min(Number(q.limit ?? 50), 100);
    const offset = Number(q.offset ?? 0);

    const podcasts = q.channel
      ? listPodcastsByChannel(q.channel, limit, offset)
      : listPodcasts(limit, offset);

    return reply.send({
      success: true,
      data: {
        podcasts,
        total: q.channel ? podcasts.length : countPodcasts(),
      },
    });
  });

  // GET /api/v1/videos/podcasts/rss/:channelId — RSS feed for Apple Podcasts / Spotify
  app.get('/podcasts/rss/:channelId', async (req, reply) => {
    const { channelId } = req.params as { channelId: string };

    // Fetch channel info
    let channelName = 'melodyflix Channel';
    let channelDesc = 'Podcast channel on melodyflix';
    try {
      const { getDb: _ } = await import('@melodyflix/shared-db');
      const db = getDb();
      const row = db.prepare('SELECT name, description FROM channels WHERE id = ?').get(channelId) as
        | { name: string; description: string | null }
        | undefined;
      if (row) {
        channelName = row.name;
        channelDesc = row.description ?? channelDesc;
      }
    } catch {}

    const podcasts = listPodcastsByChannel(channelId, 200, 0);
    const baseUrl = (req.headers['x-forwarded-proto'] as string ?? 'http') + '://' + req.headers.host;

    const items = podcasts.map((p) => {
      const audioUrl = `${baseUrl}/api/v1/videos/${p.id}/stream/master.m3u8`;
      const thumbUrl = p.thumbnail_url ? `${baseUrl}/api/v1/videos/${p.id}/thumbnail.jpg` : '';
      const pubDate = new Date(p.created_at).toUTCString();
      const dur = Math.floor(p.duration_seconds);
      const durationStr = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <description>${escapeXml(p.description ?? '')}</description>
      <pubDate>${pubDate}</pubDate>
      <enclosure url="${audioUrl}" type="audio/mpeg" />
      <itunes:duration>${durationStr}</itunes:duration>
      <guid isPermaLink="false">${p.id}</guid>
      ${thumbUrl ? `<itunes:image href="${thumbUrl}" />` : ''}
    </item>`;
    }).join('\n');

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${escapeXml(channelName)}</title>
    <description>${escapeXml(channelDesc)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <itunes:author>${escapeXml(channelName)}</itunes:author>
    <itunes:explicit>no</itunes:explicit>
${items}
  </channel>
</rss>`;

    reply.type('application/rss+xml; charset=utf-8');
    return reply.send(rss);
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
