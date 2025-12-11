import express from 'express';
import { metricsController } from '../controllers/MetricsController.js';

const router = express.Router();

// GET /api/metrics/stats - Get comprehensive metrics stats
router.get('/stats', metricsController.getStats);

// GET /api/metrics/top-tags - Get most popular tags
router.get('/top-tags', metricsController.getTopTags);

// GET /api/metrics/largest-cards - Get cards with highest token counts
router.get('/largest-cards', metricsController.getLargestCards);

// GET /api/metrics/distribution - Get token count distribution histogram
router.get('/distribution', metricsController.getDistribution);

// GET /api/metrics/timeline - Get cards added over time
router.get('/timeline', metricsController.getTimeline);

// GET /api/metrics/history - Get historical metrics for trends
router.get('/history', metricsController.getHistory);

// GET /api/metrics/trending-tags - Get trending tags (rising from yesterday)
router.get('/trending-tags', metricsController.getTrendingTags);

// GET /api/metrics/top-cards-by-platform - Get top cards per platform
router.get('/top-cards-by-platform', metricsController.getTopCardsByPlatform);

// POST /api/metrics/snapshot - Force compute new daily snapshot
router.post('/snapshot', metricsController.computeSnapshot);

export default router;
