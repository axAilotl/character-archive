
import express from 'express';
import { adminController } from '../controllers/AdminController.js';

const router = express.Router();

router.post('/backfill-token-counts', adminController.backfillTokenCounts);
router.post('/backfill-feature-flags', adminController.backfillFeatureFlags);

export default router;
