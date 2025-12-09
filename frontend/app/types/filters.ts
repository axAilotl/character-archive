export const defaultFilters = {
    searchTerm: '',
    includeTags: '',
    excludeTags: '',
    tagMatchMode: 'or' as 'and' | 'or',
    sort: 'new',
    favorite: '' as '' | 'fav' | 'not_fav' | 'shadowban' | 'deleted',
    source: 'all' as 'all' | 'chub' | 'ct' | 'risuai' | 'wyvern',
    minTokens: '',
    hasExampleDialogues: false,
    hasAlternateGreetings: false,
    hasSystemPrompt: false,
    hasLorebook: false,
    hasEmbeddedLorebook: false,
    hasLinkedLorebook: false,
    hasGallery: false,
    hasEmbeddedImages: false,
    hasExpressions: false,
    inSillyTavern: false,
    followedOnly: false,
    advancedFilter: '',  // Manual filter expression for power users
};

export type FiltersState = typeof defaultFilters;

export const normalizeFilters = (value: Partial<FiltersState> | FiltersState): FiltersState => ({
    ...defaultFilters,
    ...value,
});

export type SavedSearch = {
    id: string;
    name: string;
    filters: FiltersState;
};

export type TagOption = {
    label: string;
    value: string;
    isCanonical?: boolean;
};
