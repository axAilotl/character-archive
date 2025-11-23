
import express from 'express';
import { assetController } from '../controllers/AssetController.js';

const router = express.Router({ mergeParams: true }); // mergeParams to access :cardId if mounted nested, but we probably won't

// Note: server.js routes were /api/cards/:cardId/assets/...
// If we mount this at /api/cards/:cardId/assets, mergeParams is needed.
// But routing might be easier if we handle cardId in the handler or mount at /api/assets?
// Original routes:
// app.get('/api/cards/:cardId/assets/scan', ...)
// app.post('/api/cards/:cardId/assets/cache', ...)
// app.get('/api/cards/:cardId/assets', ...)
// app.get('/api/cards/:cardId/gallery', ...)
// app.delete('/api/cards/:cardId/assets', ...)

// Let's mount this router at /api/cards so we can capture :cardId
// But we already have cardRouter. 
// Maybe we should add these to cardRouter or make assetRouter a sub-router.
// Let's add them to cardRouter for now to keep it simple, or just define them here and mount them specially.

// Actually, cleaner is:
// router.get('/:cardId/assets/scan', assetController.scanAssets);
// router.post('/:cardId/assets/cache', assetController.cacheAssets);
// router.get('/:cardId/assets', assetController.getAssets);
// router.get('/:cardId/gallery', assetController.getGallery);
// router.delete('/:cardId/assets', assetController.clearAssets);

// This router can be merged with card router or mounted separately. 
// If we mount at /api/cards, it works.

router.get('/:cardId/assets/scan', assetController.scanAssets);
router.post('/:cardId/assets/cache', assetController.cacheAssets);
router.get('/:cardId/assets', assetController.getAssets);
router.get('/:cardId/gallery', assetController.getGallery);
router.delete('/:cardId/assets', assetController.clearAssets);

export default router;
