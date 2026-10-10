import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchCards } from './api';
import { normalizeFilters } from '../app/types/filters';

test('search query serialization preserves grouped OR phrases and AND NOT exclusions', async t => {
    const query = '("spaceship" OR "space station" OR "starship" OR "star ship" OR "space ship") AND NOT ("gold ship" OR "goldship" OR "azure lane")';
    const filters = normalizeFilters({ searchTerm: query });
    const pageParams = new URLSearchParams();
    pageParams.set('q', filters.searchTerm);
    const restored = normalizeFilters({ searchTerm: new URLSearchParams(pageParams.toString()).get('q')! });
    assert.equal(restored.searchTerm, query);

    const requests: URL[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        requests.push(new URL(String(input), 'http://localhost'));
        return Response.json({ cards: [], count: 0, totalPages: 0 });
    });

    await fetchCards({ advanced: 'true', query: restored.searchTerm });
    await fetchCards({ advanced: 'true', advancedFilter: query });

    assert.equal(requests[0].pathname, '/api/cards');
    assert.equal(requests[0].searchParams.get('advanced'), 'true');
    assert.equal(requests[0].searchParams.get('query'), query);
    assert.equal(requests[1].searchParams.get('advancedFilter'), query);
});
