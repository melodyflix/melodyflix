// melodyflix videos - entry point
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { loadConfig } from '@melodyflix/shared-config';
import { createLogger } from '@melodyflix/shared-logger';
import { searchRoutes } from './routes/search.route.js';
import { podcastRoutes } from './routes/podcast.route.js';
import { shortRoutes } from './routes/shorts.route.js';
import { seriesRoutes } from './routes/series.route.js';
import { trendingRoutes } from './routes/trending.route.js';
import { watchLaterRoutes } from './routes/watchlater.route.js';
import { historyRoutes } from './routes/history.route.js';
import { playlistRoutes } from './routes/playlist.route.js';
import { videoRoutes } from './routes/video.route.js';
import { musicRoutes } from './routes/music.route.js';
import { commentRoutes } from './routes/comment.route.js';
import { adminReportRoutes } from './routes/admin.route.js';
import { chapterRoutes } from './routes/chapter.route.js';
import { queueRoutes } from './routes/queue.route.js';
import { pollRoutes } from './routes/poll.route.js';
import { quizRoutes } from './routes/quiz.route.js';
import { clipRoutes } from './routes/clip.route.js';
import { tagRoutes } from './routes/tag.route.js';
import { genreRoutes } from './routes/genre.route.js';
import { castCrewRoutes } from './routes/castcrew.route.js';
import { subtitleRoutes } from './routes/subtitle.route.js';
import { transcriptRoutes } from './routes/transcript.route.js';
import { audioTrackRoutes } from './routes/audiotrack.route.js';
import { vrRoutes } from './routes/vr.route.js';
import { bannerRoutes } from './routes/banner.route.js';
import { customizationRoutes } from './routes/customization.route.js';
import { introOutroRoutes } from './routes/introoutro.route.js';
import { overlaysRoutes } from './routes/overlays.route.js';
import { distributionRoutes } from './routes/distribution.route.js';
import { adCampaignRoutes } from './routes/adcampaign.route.js';
import { advancedAnalyticsRoutes } from './routes/advancedanalytics.route.js';
import { creatorStudioRoutes } from './routes/creatorstudio.route.js';
import { preferencesRoutes } from './routes/preferences.route.js';
import { liveTvRoutes } from './routes/livetv.route.js';
import { ensureSchema } from './services/video.service.js';
import { ensureCommentSchema, ensureHistorySchema, ensurePlaylistSchema } from './services/comment.service.js';
import { ensureSeriesSchema } from './services/series.service.js';
import { ensureStorySchema } from './services/story.service.js';
import { ensureMusicSchema } from './services/music.service.js';
import { ensureStorage } from './services/storage.service.js';
import { ensureChapterSchema } from './services/chapter.service.js';
import { ensureQueueSchema } from './services/queue.service.js';
import { ensurePollSchema } from './services/poll.service.js';
import { ensureQuizSchema } from './services/quiz.service.js';
import { ensureClipSchema } from './services/clip.service.js';
import { ensureTagSchema } from './services/tag.service.js';
import { ensureGenreSchema } from './services/genre.service.js';
import { ensureCastCrewSchema } from './services/castcrew.service.js';
import { ensureSubtitleSchema } from './services/subtitle.service.js';
import { ensureAudioTrackSchema } from './services/audiotrack.service.js';
import { ensureVrSchema } from './services/vr.service.js';
import { ensureBannerSchema } from './services/banner.service.js';
import { ensureCustomizationSchema } from './services/customization.service.js';
import { ensureIntroOutroSchema } from './services/introoutro.service.js';
import { ensureOverlaysSchema, ensureTransitionSchema } from './services/overlays.service.js';
import { ensureDistributionSchema } from './services/distribution.service.js';
import { ensureAdCampaignSchema } from './services/adcampaign.service.js';
import { ensureLiveTvSchema, ensureLiveTvStateSchema, ensureXmltvSchema, ensureLiveTvFavoritesSchema, ensureLiveTvParentalSchema } from './services/livetv.service.js';
import { ensureAdvancedAnalyticsSchema } from './services/advancedanalytics.service.js';
import { ensureCreatorStudioSchema } from './services/creatorstudio.service.js';
import { ensurePreferencesSchema } from './services/preferences.service.js';
import { ensureAdNetworksSchema } from './services/vast.service.js';
import { ensurePaymentSchema } from './services/payment.service.js';
import { ensureChatLimitsSchema } from './services/chatlimits.service.js';
import { ensureMembershipSchema } from './services/membership.service.js';
import { ensureSupportSchema } from './services/support.service.js';
import { ensurePushSchema } from './services/push.service.js';

const config = loadConfig();
const logger = createLogger('videos');
const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 * 1024 });

await app.register(multipart, {
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
});

app.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') reply.code(204).send();
});

app.get('/health', async () => ({ service: 'videos', status: 'ok' }));

ensureStorage();
ensureChapterSchema();
ensureQueueSchema();
ensurePollSchema();
ensureQuizSchema();
ensureClipSchema();
ensureTagSchema();
ensureGenreSchema();
ensureCastCrewSchema();
ensureSubtitleSchema();
ensureAudioTrackSchema();
ensureVrSchema();
ensureBannerSchema();
ensureCustomizationSchema();
ensureIntroOutroSchema();
ensureOverlaysSchema();
ensureTransitionSchema();
ensureDistributionSchema();
ensureAdCampaignSchema();
ensureAdvancedAnalyticsSchema();
ensureCreatorStudioSchema();
ensurePreferencesSchema();
ensureSchema();
ensureCommentSchema();
ensureHistorySchema();
ensurePlaylistSchema();
ensureSeriesSchema();
ensureStorySchema();
ensureMusicSchema();
ensureAdNetworksSchema();
ensurePaymentSchema();
ensureChatLimitsSchema();
ensureMembershipSchema();
ensureSupportSchema();
ensurePushSchema();
ensureLiveTvSchema();
ensureLiveTvStateSchema();
ensureXmltvSchema();
ensureLiveTvFavoritesSchema();
ensureLiveTvParentalSchema();
logger.info('videos storage and schema ensured');

// Specific routes first (before wildcards)
await app.register(searchRoutes, { prefix: '/api/v1/videos' });
await app.register(trendingRoutes, { prefix: '/api/v1/videos' });
await app.register(watchLaterRoutes, { prefix: '/api/v1/videos' });
await app.register(historyRoutes, { prefix: '/api/v1/videos' });
await app.register(playlistRoutes, { prefix: '/api/v1/videos' });
await app.register(videoRoutes, { prefix: '/api/v1/videos' });
await app.register(commentRoutes, { prefix: '/api/v1/videos' });
await app.register(chapterRoutes, { prefix: '/api/v1/videos' });
await app.register(queueRoutes, { prefix: '/api/v1/videos' });
await app.register(pollRoutes, { prefix: '/api/v1/videos' });
await app.register(quizRoutes, { prefix: '/api/v1/videos' });
await app.register(clipRoutes, { prefix: '/api/v1/videos' });
await app.register(tagRoutes, { prefix: '/api/v1/videos' });
await app.register(genreRoutes, { prefix: '/api/v1/videos' });
await app.register(castCrewRoutes, { prefix: '/api/v1/videos' });
await app.register(subtitleRoutes, { prefix: '/api/v1/videos' });
await app.register(transcriptRoutes, { prefix: '/api/v1/videos' });
await app.register(audioTrackRoutes, { prefix: '/api/v1/videos' });
await app.register(vrRoutes, { prefix: '/api/v1/videos' });
await app.register(bannerRoutes, { prefix: '/api/v1/videos' });
await app.register(customizationRoutes, { prefix: '/api/v1/videos' });
await app.register(introOutroRoutes, { prefix: '/api/v1/videos' });
await app.register(overlaysRoutes, { prefix: '/api/v1/videos' });
await app.register(distributionRoutes, { prefix: '/api/v1/videos' });
await app.register(adCampaignRoutes, { prefix: '/api/v1/videos' });
await app.register(advancedAnalyticsRoutes, { prefix: '/api/v1/videos' });
await app.register(creatorStudioRoutes, { prefix: '/api/v1/videos' });
await app.register(preferencesRoutes, { prefix: '/api/v1/videos' });
await app.register(liveTvRoutes, { prefix: '/api/v1/videos' });
await app.register(musicRoutes, { prefix: '/api/v1/videos/music' });
await app.register(adminReportRoutes, { prefix: '/api/v1/videos/admin' });

const PORT = 4003;
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info(`videos service listening on port ${PORT}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

start();
