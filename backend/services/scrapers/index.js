/**
 * Scraper Index - Exports all available scrapers
 */

export { BaseScraper } from './BaseScraper.js';

// Concrete scrapers
export { WyvernScraper, syncWyvern, refreshWyvernCard } from './WyvernScraper.js';
// export { RisuAiScraper } from './RisuAiScraper.js';
// export { CtScraper } from './CtScraper.js';
// export { ChubScraper } from './ChubScraper.js';

// Import classes for registry
import { WyvernScraper } from './WyvernScraper.js';

// Registry of all available scrapers
export const scraperRegistry = {
    wyvern: WyvernScraper,
    // risuai: RisuAiScraper,
    // ct: CtScraper,
    // chub: ChubScraper,
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
