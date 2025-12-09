/**
 * Scraper Index - Exports all available scrapers
 */

export { BaseScraper } from './BaseScraper.js';

// Concrete scrapers will be added as they are migrated:
// export { ChubScraper } from './ChubScraper.js';
// export { RisuAiScraper } from './RisuAiScraper.js';
// export { WyvernScraper } from './WyvernScraper.js';
// export { CtScraper } from './CtScraper.js';

// Registry of all available scrapers
export const scraperRegistry = {
    // Scrapers will be registered here as they are migrated
    // chub: ChubScraper,
    // risuai: RisuAiScraper,
    // wyvern: WyvernScraper,
    // ct: CtScraper,
};

/**
 * Get a scraper instance by source name
 * @param {string} source - Source identifier
 * @returns {BaseScraper|null}
 */
export function getScraper(source) {
    const ScraperClass = scraperRegistry[source];
    if (!ScraperClass) {
        return null;
    }
    return new ScraperClass();
}

/**
 * Get all available source names
 * @returns {string[]}
 */
export function getAvailableSources() {
    return Object.keys(scraperRegistry);
}
