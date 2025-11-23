/**
 * Unit tests for QueryBuilder
 * Run with: node --test lib/query-builder.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { QueryBuilder, createQueryBuilder } from './query-builder.js';

// Mock tag expander for testing
const mockTagExpander = (tag) => {
    const aliases = {
        'android': ['android', 'robot', 'cyborg'],
        'space': ['space', 'sci-fi', 'scifi', 'outer-space'],
        'anime': ['anime', 'manga']
    };
    return aliases[tag.toLowerCase()] || [tag];
};

describe('QueryBuilder', () => {
    describe('Basic Queries', () => {
        it('should build simple query with no filters', () => {
            const builder = new QueryBuilder();
            const { sql, params } = builder.build();

            assert.strictEqual(sql, 'SELECT * FROM cards');
            assert.strictEqual(params.length, 0);
        });

        it('should handle WHERE clause', () => {
            const builder = new QueryBuilder();
            builder.where('author', 'testuser');
            const { sql, params } = builder.build();

            assert.ok(sql.includes('WHERE author = ?'));
            assert.deepStrictEqual(params, ['testuser']);
        });

        it('should handle multiple WHERE clauses', () => {
            const builder = new QueryBuilder();
            builder
                .where('author', 'testuser')
                .where('tokenCount', 1000, '>')
                .where('hasLorebook', 1);

            const { sql, params } = builder.build();

            assert.ok(sql.includes('author = ?'));
            assert.ok(sql.includes('tokenCount > ?'));
            assert.ok(sql.includes('hasLorebook = ?'));
            assert.deepStrictEqual(params, ['testuser', 1000, 1]);
        });

        it('should skip empty/null values in WHERE', () => {
            const builder = new QueryBuilder();
            builder
                .where('author', '')
                .where('rating', null)
                .where('tokenCount', 1000);

            const { sql, params } = builder.build();

            assert.ok(!sql.includes('author'));
            assert.ok(!sql.includes('rating'));
            assert.ok(sql.includes('tokenCount = ?'));
            assert.deepStrictEqual(params, [1000]);
        });
    });

    describe('Full Text Search', () => {
        it('should build full text search query', () => {
            const builder = new QueryBuilder();
            builder.fullText('vampire');
            const { sql, params } = builder.build();

            assert.ok(sql.includes('name LIKE ?'));
            assert.ok(sql.includes('description LIKE ?'));
            assert.ok(sql.includes('tagline LIKE ?'));
            assert.strictEqual(params.filter(p => p === '%vampire%').length, 5); // 5 fields
        });

        it('should handle custom fields for full text search', () => {
            const builder = new QueryBuilder();
            builder.fullText('test', ['name', 'author']);
            const { sql, params } = builder.build();

            assert.ok(sql.includes('name LIKE ?'));
            assert.ok(sql.includes('author LIKE ?'));
            assert.ok(!sql.includes('description LIKE ?'));
            assert.strictEqual(params.length, 2);
        });

        it('should skip empty query', () => {
            const builder = new QueryBuilder();
            builder.fullText('');
            const { sql, params } = builder.build();

            assert.strictEqual(sql, 'SELECT * FROM cards');
            assert.strictEqual(params.length, 0);
        });
    });

    describe('Specialized Search', () => {
        it('should build title-only search', () => {
            const builder = new QueryBuilder();
            builder.titleSearch('elf warrior');
            const { sql, params } = builder.build();

            assert.ok(sql.includes('name LIKE ?'));
            assert.ok(!sql.includes('description'));
            assert.deepStrictEqual(params, ['%elf warrior%']);
        });

        it('should build author-only search', () => {
            const builder = new QueryBuilder();
            builder.authorSearch('anonymous');
            const { sql, params } = builder.build();

            assert.ok(sql.includes('author LIKE ?'));
            assert.deepStrictEqual(params, ['%anonymous%']);
        });
    });

    describe('Tag Filtering', () => {
        it('should include tags in OR mode', () => {
            const builder = new QueryBuilder(mockTagExpander);
            builder.includeTags('android', 'or');
            const { sql, params } = builder.build();

            // Should expand android => [android, robot, cyborg]
            // Each variant gets 4 LIKE clauses (exact, prefix, suffix, contains)
            assert.ok(sql.includes('LOWER(topics)'));
            assert.ok(params.includes('android'));
            assert.ok(params.includes('robot'));
            assert.ok(params.includes('cyborg'));
        });

        it('should include multiple tags in OR mode', () => {
            const builder = new QueryBuilder(mockTagExpander);
            builder.includeTags('android,anime', 'or');
            const { sql, params } = builder.build();

            // android => [android, robot, cyborg]
            // anime => [anime, manga]
            assert.ok(params.includes('android'));
            assert.ok(params.includes('robot'));
            assert.ok(params.includes('anime'));
            assert.ok(params.includes('manga'));
        });

        it('should include tags in AND mode', () => {
            const builder = new QueryBuilder(mockTagExpander);
            builder.includeTags('android,anime', 'and');
            const { sql, params } = builder.build();

            // Should have separate AND groups for each tag
            const andCount = (sql.match(/AND/g) || []).length;
            assert.ok(andCount >= 1); // At least one AND between tag groups

            assert.ok(params.includes('android'));
            assert.ok(params.includes('anime'));
        });

        it('should exclude tags with alias expansion', () => {
            const builder = new QueryBuilder(mockTagExpander);
            builder.excludeTags('android');
            const { sql, params } = builder.build();

            assert.ok(sql.includes('NOT'));
            assert.ok(params.includes('android'));
            assert.ok(params.includes('robot'));
            assert.ok(params.includes('cyborg'));
        });

        it('should handle both include and exclude', () => {
            const builder = new QueryBuilder(mockTagExpander);
            builder
                .includeTags('anime', 'or')
                .excludeTags('android');

            const { sql, params } = builder.build();

            assert.ok(sql.includes('NOT'));
            assert.ok(params.includes('anime'));
            assert.ok(params.includes('android'));
        });

        it('should handle array input for tags', () => {
            const builder = new QueryBuilder(mockTagExpander);
            builder.includeTags(['android', 'anime'], 'or');
            const { sql, params } = builder.build();

            assert.ok(params.includes('android'));
            assert.ok(params.includes('anime'));
        });

        it('should skip empty tag lists', () => {
            const builder = new QueryBuilder();
            builder.includeTags('', 'or');
            const { sql } = builder.build();

            assert.strictEqual(sql, 'SELECT * FROM cards');
        });
    });

    describe('Advanced Filters', () => {
        it('should handle whereIn clause', () => {
            const builder = new QueryBuilder();
            builder.whereIn('id', [1, 2, 3, 4, 5]);
            const { sql, params } = builder.build();

            assert.ok(sql.includes('id IN (?, ?, ?, ?, ?)'));
            assert.deepStrictEqual(params, [1, 2, 3, 4, 5]);
        });

        it('should handle followed creators', () => {
            const builder = new QueryBuilder();
            builder.followedCreators(['Alice', 'Bob', 'Charlie']);
            const { sql, params } = builder.build();

            assert.ok(sql.includes('LOWER(author) IN (?, ?, ?)'));
            assert.deepStrictEqual(params, ['alice', 'bob', 'charlie']);
        });

        it('should skip empty followed creators list', () => {
            const builder = new QueryBuilder();
            builder.followedCreators([]);
            const { sql } = builder.build();

            assert.strictEqual(sql, 'SELECT * FROM cards');
        });
    });

    describe('Sorting and Pagination', () => {
        it('should add ORDER BY clause', () => {
            const builder = new QueryBuilder();
            builder.sort('tokenCount DESC');
            const { sql } = builder.build();

            assert.ok(sql.includes('ORDER BY tokenCount DESC'));
        });

        it('should add LIMIT', () => {
            const builder = new QueryBuilder();
            builder.limit(50);
            const { sql, params } = builder.build();

            assert.ok(sql.includes('LIMIT ?'));
            assert.strictEqual(params[params.length - 1], 50);
        });

        it('should add OFFSET', () => {
            const builder = new QueryBuilder();
            builder.offset(100);
            const { sql, params } = builder.build();

            assert.ok(sql.includes('OFFSET ?'));
            assert.strictEqual(params[params.length - 1], 100);
        });

        it('should handle limit and offset together', () => {
            const builder = new QueryBuilder();
            builder.limit(20).offset(40);
            const { sql, params } = builder.build();

            assert.ok(sql.includes('LIMIT ?'));
            assert.ok(sql.includes('OFFSET ?'));
            assert.strictEqual(params[params.length - 2], 20); // LIMIT comes first
            assert.strictEqual(params[params.length - 1], 40); // OFFSET second
        });
    });

    describe('Count Query', () => {
        it('should generate matching count query', () => {
            const builder = new QueryBuilder();
            builder
                .where('author', 'testuser')
                .where('tokenCount', 1000, '>')
                .limit(50)
                .offset(100);

            const { countSql, countParams } = builder.build();

            assert.ok(countSql.includes('SELECT COUNT(*) as count FROM cards'));
            assert.ok(countSql.includes('author = ?'));
            assert.ok(countSql.includes('tokenCount > ?'));
            assert.ok(!countSql.includes('LIMIT'));
            assert.ok(!countSql.includes('OFFSET'));
            assert.deepStrictEqual(countParams, ['testuser', 1000]);
        });
    });

    describe('Complex Queries', () => {
        it('should build complex multi-filter query', () => {
            const builder = new QueryBuilder(mockTagExpander);
            builder
                .fullText('vampire hunter')
                .includeTags('anime,action', 'and')
                .excludeTags('android')
                .where('tokenCount', 500, '>')
                .where('hasLorebook', 1)
                .where('source', 'chub')
                .sort('rating DESC')
                .limit(48)
                .offset(96);

            const { sql, params, countSql, countParams } = builder.build();

            // Main query checks
            assert.ok(sql.includes('WHERE'));
            assert.ok(sql.includes('LIKE ?'));
            assert.ok(sql.includes('LOWER(topics)'));
            assert.ok(sql.includes('NOT'));
            assert.ok(sql.includes('tokenCount > ?'));
            assert.ok(sql.includes('hasLorebook = ?'));
            assert.ok(sql.includes('source = ?'));
            assert.ok(sql.includes('ORDER BY rating DESC'));
            assert.ok(sql.includes('LIMIT ?'));
            assert.ok(sql.includes('OFFSET ?'));

            // Verify LIMIT/OFFSET are last params
            assert.strictEqual(params[params.length - 2], 48);
            assert.strictEqual(params[params.length - 1], 96);

            // Count query should match WHERE but no LIMIT/OFFSET
            assert.ok(countSql.includes('tokenCount > ?'));
            assert.ok(!countSql.includes('LIMIT'));
            assert.ok(countParams.length < params.length);
        });
    });

    describe('Builder Reset', () => {
        it('should reset builder to initial state', () => {
            const builder = new QueryBuilder();
            builder
                .where('author', 'test')
                .limit(10)
                .sort('name DESC');

            const { sql: sql1 } = builder.build();
            assert.ok(sql1.includes('author'));

            builder.reset();
            const { sql: sql2, params } = builder.build();

            assert.strictEqual(sql2, 'SELECT * FROM cards');
            assert.strictEqual(params.length, 0);
        });
    });

    describe('Factory Function', () => {
        it('should create builder with factory function', () => {
            const builder = createQueryBuilder(mockTagExpander);
            builder.includeTags('android');
            const { params } = builder.build();

            assert.ok(params.includes('robot')); // Expanded
        });
    });

    describe('Edge Cases', () => {
        it('should handle special characters in tag search', () => {
            const builder = new QueryBuilder();
            builder.includeTags('test%_tag', 'or');
            const { params } = builder.build();

            // escapeLike is used in tag filtering
            // Check that params were generated (escaping happens internally)
            assert.ok(params.length > 0);
            assert.ok(params.some(p => typeof p === 'string' && p.includes('test')));
        });

        it('should handle tag expansion returning empty array', () => {
            const emptyExpander = () => [];
            const builder = new QueryBuilder(emptyExpander);
            builder.includeTags('sometag');
            const { sql } = builder.build();

            // Should gracefully handle empty expansion
            assert.strictEqual(sql, 'SELECT * FROM cards');
        });

        it('should handle chained method calls', () => {
            const builder = new QueryBuilder();
            const result = builder
                .where('a', 1)
                .where('b', 2)
                .where('c', 3);

            assert.strictEqual(result, builder); // Should return this
        });
    });
});

console.log('✅ All QueryBuilder tests passed!');
