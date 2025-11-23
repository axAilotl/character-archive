-- Performance Indexes for Local Chub Redux
-- These indexes dramatically speed up common query patterns

-- Index for source + date filtering (common in search)
CREATE INDEX IF NOT EXISTS idx_cards_source_created
    ON cards(source, createdAt DESC);

-- Index for rating + token sorting
CREATE INDEX IF NOT EXISTS idx_cards_rating_tokens
    ON cards(rating DESC, tokenCount DESC);

-- Composite index for tag searches
CREATE INDEX IF NOT EXISTS idx_card_tags_composite
    ON card_tags(normalizedTag, cardId);

-- Index for favorite filtering with date sort
CREATE INDEX IF NOT EXISTS idx_cards_favorited_created
    ON cards(favorited, createdAt DESC);

-- Index for author + name searches
CREATE INDEX IF NOT EXISTS idx_cards_author_name_tokens
    ON cards(author, name, tokenCount);

-- Index for trending sort (nChats descending)
CREATE INDEX IF NOT EXISTS idx_cards_trending
    ON cards(nChats DESC, createdAt DESC);

-- Index for engagement sort
CREATE INDEX IF NOT EXISTS idx_cards_engagement
    ON cards(nChats DESC, nMessages DESC, rating DESC);

-- Analyze tables for query optimizer
ANALYZE;
