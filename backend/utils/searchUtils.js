
/**
 * Build a unified Meilisearch filter expression from all filter parameters.
 * Uses ONLY 'tags' field (not 'topics') for consistency across cards and chunks indexes.
 */
export function buildMeilisearchFilter({
    advancedFilter = '',
    include = '',
    exclude = '',
    tagMatchMode = 'and',
    minTokens = null,
    language = null,
    favoriteFilter = null,
    source = null,
    hasAlternateGreetings = false,
    hasLorebook = false,
    hasEmbeddedLorebook = false,
    hasLinkedLorebook = false,
    hasExampleDialogues = false,
    hasSystemPrompt = false,
    hasGallery = false,
    hasEmbeddedImages = false,
    hasExpressions = false
} = {}) {
    const parts = [];

    // Manual filter (user-entered advanced syntax) - wrap in parens for safety
    if (advancedFilter && advancedFilter.trim()) {
        parts.push(`(${advancedFilter.trim()})`);
    }

    // Boolean flags - only add if true
    if (hasLorebook) parts.push('hasLorebook = true');
    if (hasAlternateGreetings) parts.push('hasAlternateGreetings = true');
    if (hasEmbeddedLorebook) parts.push('hasEmbeddedLorebook = true');
    if (hasLinkedLorebook) parts.push('hasLinkedLorebook = true');
    if (hasExampleDialogues) parts.push('hasExampleDialogues = true');
    if (hasSystemPrompt) parts.push('hasSystemPrompt = true');
    if (hasGallery) parts.push('hasGallery = true');
    if (hasEmbeddedImages) parts.push('hasEmbeddedImages = true');
    if (hasExpressions) parts.push('hasExpressions = true');

    // Token minimum
    if (minTokens !== null && Number.isFinite(Number(minTokens))) {
        parts.push(`tokenCount >= ${minTokens}`);
    }

    // Language filter
    if (language && language !== 'all') {
        parts.push(`language = "${language}"`);
    }

    // Favorite filter (accept both 'fav'/'favorited' and 'not_fav'/'unfavorited')
    if (favoriteFilter === 'favorited' || favoriteFilter === 'fav') {
        parts.push('favorited = 1');
    } else if (favoriteFilter === 'unfavorited' || favoriteFilter === 'not_fav') {
        parts.push('favorited = 0');
    }

    // Source filter
    if (source && source !== 'all') {
        parts.push(`source = "${source}"`);
    }

    // Include tags - use ONLY 'tags' field (not 'topics')
    // Normalize to lowercase for case-insensitive matching
    if (include && include.trim()) {
        const includeTags = include.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        if (includeTags.length > 0) {
            const tagClauses = includeTags.map(tag => `tags = "${tag}"`);
            if (tagMatchMode === 'and') {
                // AND mode: all tags must be present
                tagClauses.forEach(clause => parts.push(clause));
            } else {
                // OR mode: any tag can be present
                parts.push(`(${tagClauses.join(' OR ')})`);
            }
        }
    }

    // Exclude tags - always use NOT
    // Normalize to lowercase for case-insensitive matching
    if (exclude && exclude.trim()) {
        const excludeTags = exclude.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        excludeTags.forEach(tag => {
            parts.push(`NOT tags = "${tag}"`);
        });
    }

    return parts.length > 0 ? parts.join(' AND ') : '';
}
