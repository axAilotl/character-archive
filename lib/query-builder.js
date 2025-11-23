/**
 * QueryBuilder - Clean SQL query construction with tag expansion support
 *
 * Extracted from database.js to improve maintainability and testability.
 * Handles complex tag filtering with alias expansion, boolean logic,
 * and multiple filter types.
 */

/**
 * Escape special characters in LIKE patterns
 * @param {string} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeLike(value) {
    return value.replace(/[%_]/g, '\\$&');
}

/**
 * Parse comma-separated tag list
 * @param {string} value - Comma-separated tags
 * @returns {string[]} Array of trimmed tags
 */
function parseTagList(value) {
    return value
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
}

export class QueryBuilder {
    /**
     * @param {Function} tagExpander - Function to expand tag aliases (tag => variants[])
     */
    constructor(tagExpander = null) {
        this.tagExpander = tagExpander || ((tag) => [tag]);
        this.whereClauses = [];
        this.params = [];
        this.orderBy = null;
        this.limitValue = null;
        this.offsetValue = null;
    }

    /**
     * Add full-text search across multiple fields
     * @param {string} query - Search query
     * @param {string[]} fields - Fields to search
     * @returns {QueryBuilder}
     */
    fullText(query, fields = ['name', 'description', 'tagline', 'topics', 'author']) {
        if (!query || !query.trim()) return this;

        const clauses = fields.map(() => '?').join(' OR ');
        this.whereClauses.push(`(${fields.map(f => `${f} LIKE ?`).join(' OR ')})`);

        const searchPattern = `%${query}%`;
        fields.forEach(() => this.params.push(searchPattern));

        return this;
    }

    /**
     * Add title-only search
     * @param {string} query - Search query
     * @returns {QueryBuilder}
     */
    titleSearch(query) {
        if (!query || !query.trim()) return this;

        this.whereClauses.push('(name LIKE ?)');
        this.params.push(`%${query}%`);

        return this;
    }

    /**
     * Add author-only search
     * @param {string} query - Search query
     * @returns {QueryBuilder}
     */
    authorSearch(query) {
        if (!query || !query.trim()) return this;

        this.whereClauses.push('(author LIKE ?)');
        this.params.push(`%${query}%`);

        return this;
    }

    /**
     * Add tag inclusion filter with alias expansion
     * @param {string|string[]} tags - Tags to include
     * @param {string} mode - Match mode: 'and' or 'or'
     * @returns {QueryBuilder}
     */
    includeTags(tags, mode = 'or') {
        const tagList = Array.isArray(tags) ? tags : parseTagList(tags);
        if (tagList.length === 0) return this;

        if (mode === 'or') {
            // OR mode: match ANY tag (including all variants)
            const orClauses = [];

            tagList.forEach(tag => {
                const variants = this.tagExpander(tag);

                variants.forEach(variant => {
                    const normalized = escapeLike(variant.toLowerCase());
                    const topicsLower = 'LOWER(topics)';
                    orClauses.push(
                        `(${topicsLower} = ? OR ${topicsLower} LIKE ? ESCAPE "\\" OR ${topicsLower} LIKE ? ESCAPE "\\" OR ${topicsLower} LIKE ? ESCAPE "\\")`
                    );
                    this.params.push(
                        normalized,
                        `${normalized},%`,
                        `%,${normalized}`,
                        `%,${normalized},%`
                    );
                });
            });

            if (orClauses.length > 0) {
                this.whereClauses.push(`(${orClauses.join(' OR ')})`);
            }
        } else {
            // AND mode: match ALL tags (each tag can match any of its variants)
            tagList.forEach(tag => {
                const variants = this.tagExpander(tag);
                const variantClauses = [];

                variants.forEach(variant => {
                    const normalized = escapeLike(variant.toLowerCase());
                    const topicsLower = 'LOWER(topics)';
                    variantClauses.push(
                        `(${topicsLower} = ? OR ${topicsLower} LIKE ? ESCAPE "\\" OR ${topicsLower} LIKE ? ESCAPE "\\" OR ${topicsLower} LIKE ? ESCAPE "\\")`
                    );
                    this.params.push(
                        normalized,
                        `${normalized},%`,
                        `%,${normalized}`,
                        `%,${normalized},%`
                    );
                });

                if (variantClauses.length > 0) {
                    this.whereClauses.push(`(${variantClauses.join(' OR ')})`);
                }
            });
        }

        return this;
    }

    /**
     * Add tag exclusion filter with alias expansion
     * @param {string|string[]} tags - Tags to exclude
     * @returns {QueryBuilder}
     */
    excludeTags(tags) {
        const tagList = Array.isArray(tags) ? tags : parseTagList(tags);
        if (tagList.length === 0) return this;

        tagList.forEach(tag => {
            const variants = this.tagExpander(tag);
            const variantClauses = [];

            variants.forEach(variant => {
                const normalized = escapeLike(variant.toLowerCase());
                const topicsLower = 'LOWER(topics)';
                variantClauses.push(
                    `(${topicsLower} = ? OR ${topicsLower} LIKE ? ESCAPE "\\" OR ${topicsLower} LIKE ? ESCAPE "\\" OR ${topicsLower} LIKE ? ESCAPE "\\")`
                );
                this.params.push(
                    normalized,
                    `${normalized},%`,
                    `%,${normalized}`,
                    `%,${normalized},%`
                );
            });

            // Exclude if ANY variant matches
            if (variantClauses.length > 0) {
                this.whereClauses.push(`NOT (${variantClauses.join(' OR ')})`);
            }
        });

        return this;
    }

    /**
     * Add simple WHERE clause
     * @param {string} field - Field name
     * @param {*} value - Field value
     * @param {string} operator - Comparison operator (=, !=, >, <, >=, <=)
     * @returns {QueryBuilder}
     */
    where(field, value, operator = '=') {
        if (value === null || value === undefined || value === '') return this;

        this.whereClauses.push(`${field} ${operator} ?`);
        this.params.push(value);

        return this;
    }

    /**
     * Add IN clause
     * @param {string} field - Field name
     * @param {Array} values - Array of values
     * @returns {QueryBuilder}
     */
    whereIn(field, values) {
        if (!Array.isArray(values) || values.length === 0) return this;

        const placeholders = values.map(() => '?').join(', ');
        this.whereClauses.push(`${field} IN (${placeholders})`);
        this.params.push(...values);

        return this;
    }

    /**
     * Add followed creators filter
     * @param {string[]} creators - Array of creator names
     * @returns {QueryBuilder}
     */
    followedCreators(creators) {
        if (!Array.isArray(creators) || creators.length === 0) return this;

        const authorList = creators
            .map(name => (name || '').trim())
            .filter(Boolean);

        if (authorList.length === 0) return this;

        const placeholders = authorList.map(() => '?').join(', ');
        this.whereClauses.push(`LOWER(author) IN (${placeholders})`);
        authorList.forEach(author => this.params.push(author.toLowerCase()));

        return this;
    }

    /**
     * Set ORDER BY clause
     * @param {string} orderByClause - SQL ORDER BY clause
     * @returns {QueryBuilder}
     */
    sort(orderByClause) {
        this.orderBy = orderByClause;
        return this;
    }

    /**
     * Set LIMIT
     * @param {number} limit - Maximum number of rows
     * @returns {QueryBuilder}
     */
    limit(limit) {
        this.limitValue = limit;
        return this;
    }

    /**
     * Set OFFSET
     * @param {number} offset - Number of rows to skip
     * @returns {QueryBuilder}
     */
    offset(offset) {
        this.offsetValue = offset;
        return this;
    }

    /**
     * Build the final SQL query and parameters
     * @param {string} baseQuery - Base SELECT query (default: SELECT * FROM cards)
     * @returns {{sql: string, params: Array, countSql: string, countParams: Array}}
     */
    build(baseQuery = 'SELECT * FROM cards') {
        let sql = baseQuery;
        let countSql = 'SELECT COUNT(*) as count FROM cards';

        // Add WHERE clauses
        if (this.whereClauses.length > 0) {
            const whereClause = ` WHERE ${this.whereClauses.join(' AND ')}`;
            sql += whereClause;
            countSql += whereClause;
        }

        // Count query params (same as main query WHERE params)
        const countParams = [...this.params];

        // Add ORDER BY
        if (this.orderBy) {
            sql += ` ORDER BY ${this.orderBy}`;
        }

        // Add LIMIT and OFFSET
        if (this.limitValue !== null) {
            sql += ' LIMIT ?';
            this.params.push(this.limitValue);
        }

        if (this.offsetValue !== null) {
            sql += ' OFFSET ?';
            this.params.push(this.offsetValue);
        }

        return {
            sql,
            params: this.params,
            countSql,
            countParams
        };
    }

    /**
     * Reset the builder to initial state
     * @returns {QueryBuilder}
     */
    reset() {
        this.whereClauses = [];
        this.params = [];
        this.orderBy = null;
        this.limitValue = null;
        this.offsetValue = null;
        return this;
    }
}

/**
 * Factory function for creating QueryBuilder instances
 * @param {Function} tagExpander - Tag expansion function
 * @returns {QueryBuilder}
 */
export function createQueryBuilder(tagExpander) {
    return new QueryBuilder(tagExpander);
}

export default QueryBuilder;
