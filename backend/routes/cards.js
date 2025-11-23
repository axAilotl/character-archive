
import express from 'express';
import { cardController } from '../controllers/CardController.js';
import { assetController } from '../controllers/AssetController.js';

const router = express.Router();

// Define card routes
router.get('/', cardController.listCards);
router.get('/:cardId/png-info', cardController.getPngInfo);
router.get('/:cardId/metadata', cardController.getCardMetadata);
router.post('/:cardId/refresh', cardController.refreshCard);
router.delete('/:cardId', cardController.deleteCard);
router.post('/bulk-delete', cardController.bulkDelete);
router.post('/:cardId/favorite', cardController.toggleFavorite);
router.post('/:cardId/language', cardController.setLanguage);
router.post('/:cardId/tags', cardController.editTags);
router.get('/:cardId/export', cardController.exportCard);
router.post('/:cardId/push', cardController.pushToSillyTavern);
router.post('/:cardId/push-to-architect', cardController.pushToArchitect);

// Asset routes
router.get('/:cardId/assets/scan', assetController.scanAssets);
router.post('/:cardId/assets/cache', assetController.cacheAssets);
router.get('/:cardId/assets', assetController.getAssets);
router.get('/:cardId/gallery', assetController.getGallery);
router.delete('/:cardId/assets', assetController.clearAssets);

export default router;
