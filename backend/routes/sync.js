
import express from 'express';
import { syncController } from '../controllers/SyncController.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// Rate limiters (could be shared in a middleware file)
const syncLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minute window
    max: 5, // 5 sync operations per 5 minutes
    message: 'Sync rate limit exceeded. Please wait before starting another sync.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
});

// Map root / to syncCards to match frontend expectation
router.get('/', syncLimiter, syncController.syncCards);
router.get('/cards', syncLimiter, syncController.syncCards);
router.get('/ct', syncLimiter, syncController.syncCharacterTavern);
router.get('/wyvern', syncLimiter, syncController.syncWyvern);
router.get('/risuai', syncLimiter, syncController.syncRisuAi);
router.post('/favorites', syncController.syncFavoritesToChub);
router.get('/chub/follows', syncController.getChubFollows);

export default router;
