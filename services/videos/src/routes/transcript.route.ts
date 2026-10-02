// melodyflix videos - transcript routes
import type { FastifyInstance } from 'fastify';
import {
  getTranscript, searchTranscript, exportTranscript, listTranscriptLanguages,
} from '../services/transcript.service.js';

export async function transcriptRoutes(app: FastifyInstance) {
  // GET /:videoId/transcript?lang=en
  app.get('/:videoId/transcript', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { lang?: string };
    const t = getTranscript(videoId, q.lang);
    if (!t) return reply.code(404).send({ success: false, error: 'Video not found' });
    return reply.send({ success: true, data: { transcript: t } });
  });

  // GET /:videoId/transcript/languages
  app.get('/:videoId/transcript/languages', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const languages = listTranscriptLanguages(videoId);
    return reply.send({ success: true, data: { languages } });
  });

  // GET /:videoId/transcript/search?q=needle&lang=en
  app.get('/:videoId/transcript/search', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { q?: string; lang?: string };
    const result = searchTranscript(videoId, q.q ?? '', q.lang);
    if (!result.transcript) {
      return reply.code(404).send({ success: false, error: 'Video not found' });
    }
    return reply.send({
      success: true,
      data: {
        hits: result.hits,
        total: result.total,
        language: result.transcript.language,
        label: result.transcript.label,
      },
    });
  });

  // GET /:videoId/transcript/download?format=txt|srt|vtt&lang=en
  app.get('/:videoId/transcript/download', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const q = req.query as { format?: string; lang?: string };
    const format = (q.format === 'srt' || q.format === 'vtt') ? q.format : 'txt';
    const result = exportTranscript(videoId, format, q.lang);
    if (!result) return reply.code(404).send('Transcript not available');
    reply
      .header('Content-Type', result.mime)
      .header('Content-Disposition', `attachment; filename="${result.filename}"`);
    return reply.send(result.content);
  });
}
