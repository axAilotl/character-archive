
import express from 'express';
import { tagController } from '../controllers/TagController.js';

const router = express.Router();

router.get('/search', tagController.searchTags);
router.get('/aliases', tagController.getTagAliases);
router.get('/random', tagController.getRandomTags);

export default router;
