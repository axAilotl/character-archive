export const TOKEN_COUNT_FIELD_MAP = {
    description: 'tokenDescriptionCount',
    personality: 'tokenPersonalityCount',
    scenario: 'tokenScenarioCount',
    mes_example: 'tokenMesExampleCount',
    first_mes: 'tokenFirstMessageCount',
    system_prompt: 'tokenSystemPromptCount',
    post_history_instructions: 'tokenPostHistoryCount'
};

export const TOKEN_COUNT_COLUMNS = Object.values(TOKEN_COUNT_FIELD_MAP);

export function extractTokenCountLabel(labels) {
    if (!Array.isArray(labels)) {
        return null;
    }
    const tokenLabel = labels.find(label => label && label.title === 'TOKEN_COUNTS' && typeof label.description === 'string');
    if (!tokenLabel) {
        return null;
    }
    try {
        return JSON.parse(tokenLabel.description);
    } catch {
        return null;
    }
}

export function normalizeTokenCounts(rawCounts = {}) {
    const normalized = {};
    for (const [sourceKey, columnName] of Object.entries(TOKEN_COUNT_FIELD_MAP)) {
        const value = Number(rawCounts?.[sourceKey]);
        normalized[columnName] = Number.isFinite(value) && value >= 0 ? value : 0;
    }
    return normalized;
}

export function resolveTokenCountsFromMetadata(metadata) {
    if (!metadata) {
        return null;
    }

    // Try tokenCounts field first, but only if it has non-zero values
    if (metadata.tokenCounts && typeof metadata.tokenCounts === 'object') {
        const normalized = normalizeTokenCounts(metadata.tokenCounts);
        if (hasAnyTokenCountValues(normalized)) {
            return normalized;
        }
    }

    // Fall back to parsing labels (which may have the correct counts)
    if (metadata.labels) {
        const parsed = extractTokenCountLabel(metadata.labels);
        if (parsed) {
            return normalizeTokenCounts(parsed);
        }
    }

    return null;
}

export function hasAnyTokenCountValues(counts) {
    if (!counts || typeof counts !== 'object') {
        return false;
    }
    return TOKEN_COUNT_COLUMNS.some(column => typeof counts[column] === 'number' && counts[column] > 0);
}

export function mergeTokenCounts(target, counts) {
    if (!counts) {
        TOKEN_COUNT_COLUMNS.forEach(column => {
            delete target[column];
        });
        delete target.tokenCounts;
        return target;
    }

    target.tokenCounts = { ...counts };
    TOKEN_COUNT_COLUMNS.forEach(column => {
        target[column] = counts[column] ?? 0;
    });
    return target;
}
