import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { appConfig as config } from './backend/services/ConfigState.js';
import { schedulerService } from './backend/services/SchedulerService.js';
import configRouter from './backend/routes/config.js';
import { initDatabase } from './backend/database.js';
import { configureSearchIndex, configureVectorSearch } from './backend/services/search-index.js';

import cardRouter from './backend/routes/cards.js';
import syncRouter from './backend/routes/sync.js';
import adminRouter from './backend/routes/admin.js';
import tagRouter from './backend/routes/tags.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



// Initialize
const app = express();


// Security and performance middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for inline scripts
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting middleware
// General API rate limiter - protects against abuse and accidental loops
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 100, // 100 requests per minute per IP
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    // Skip rate limiting for localhost in development
    skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
});


// Stricter rate limiter for refresh operations - prevents abuse
const refreshLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 20, // 20 refresh operations per minute
    message: 'Refresh rate limit exceeded. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
});

// Apply general rate limiter to all API routes
app.use('/api/', apiLimiter);

// Static files
app.use('/static', express.static(path.join(__dirname, 'static')));

// Initialize database
initDatabase();
configureSearchIndex(config.meilisearch);
configureVectorSearch(config.vectorSearch || {});
























app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Local Chub Redux API is running',
        documentation: 'Use the /api endpoints to interact with the service.'
    });
});

app.use('/api/cards', cardRouter);
app.use('/api/sync', syncRouter);

app.get('/get_png_info/:cardId', (req, res) => res.redirect(301, `/api/cards/${req.params.cardId}/png-info`));
app.get('/get_card_metadata/:cardId', (req, res) => res.redirect(301, `/api/cards/${req.params.cardId}/metadata`));



app.post('/toggle_favorite/:cardId', (req, res) => res.redirect(307, `/api/cards/${req.params.cardId}/favorite`));



// Legacy/Root redirects for sync
app.get('/sync', (req, res) => res.redirect(307, '/api/sync/cards'));
app.get('/sync/ct', (req, res) => res.redirect(307, '/api/sync/ct'));
app.post('/api/favorites/sync-chub', (req, res) => res.redirect(307, '/api/sync/favorites'));

app.use('/api/admin', adminRouter);

app.post('/bulk_delete_cards', (req, res) => res.redirect(307, '/api/cards/bulk-delete'));
app.delete('/delete_card/:cardId', (req, res) => res.redirect(307, `/api/cards/${req.params.cardId}`));

app.use('/api/config', configRouter);
app.get('/get_config', (req, res) => res.redirect(307, '/api/config'));
app.post('/set_config', (req, res) => res.redirect(307, '/api/config'));

app.get('/api/chub/follows', (req, res) => res.redirect(307, '/api/sync/chub/follows'));

app.use('/api/tags', tagRouter);

app.get('/reroll-tags', (req, res) => res.redirect(307, '/api/tags/random'));
app.get('/api/tag-aliases', (req, res) => res.redirect(307, '/api/tags/aliases'));

app.post('/cards/:cardId/set-language', (req, res) => res.redirect(307, `/api/cards/${req.params.cardId}/language`));

app.post('/edit_tags/:cardId', (req, res) => res.redirect(307, `/api/cards/${req.params.cardId}/tags`));





// Start server
const PORT = config.port || 6969;
const HOST = config.ip || '0.0.0.0'; // Listen on all interfaces for LAN access

app.listen(PORT, HOST, () => {
    console.log(`[INFO] Server running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (HOST === '0.0.0.0') {
        console.log(`[INFO] Server is accessible from your LAN`);
        console.log(`[INFO] Use your machine's IP address to access from other devices`);
    }
    console.log(`[INFO] Database initialized`);
    console.log(`[INFO] Press Ctrl+C to stop`);
    
    // Start auto-update if enabled
    schedulerService.startAutoUpdate();
    schedulerService.startCtAutoUpdate();
    schedulerService.startSearchIndexScheduler();
});

export default app;
export const startAutoUpdate = () => schedulerService.startAutoUpdate();


