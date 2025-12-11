import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { defaultFilters, normalizeFilters, type FiltersState } from "../types/filters";
import { parseTagString } from "../utils/tags";

interface UseFiltersResult {
  filters: FiltersState;
  setFilters: React.Dispatch<React.SetStateAction<FiltersState>>;
  searchInputValue: string;
  setSearchInputValue: (value: string) => void;
  advancedFilterInput: string;
  setAdvancedFilterInput: (value: string) => void;
  includeTagsSelected: string[];
  excludeTagsSelected: string[];
  highlightedTags: string[];
  highlightedTagsSet: Set<string>;
  page: number;
  setPage: (page: number) => void;
  handleFilterChange: (updates: Partial<FiltersState>) => void;
  handleIncludeTagsChange: (selected: string[]) => void;
  handleExcludeTagsChange: (selected: string[]) => void;
  handleTagClick: (tag: string) => void;
  handleAuthorClick: (author: string | undefined | null) => void;
  handleClearFilters: () => void;
  updateURL: (newFilters: FiltersState, newPage: number, cardId?: string | null, shouldPush?: boolean) => void;
  getCardIdFromURL: () => string | null;
}

export function useFilters(
  onFiltersChange?: () => void,
  clearSelection?: () => void
): UseFiltersResult {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<FiltersState>({ ...defaultFilters });
  const [searchInputValue, setSearchInputValue] = useState(defaultFilters.searchTerm);
  const [advancedFilterInput, setAdvancedFilterInput] = useState(defaultFilters.advancedFilter);
  const [includeTagsSelected, setIncludeTagsSelected] = useState<string[]>(parseTagString(defaultFilters.includeTags));
  const [excludeTagsSelected, setExcludeTagsSelected] = useState<string[]>(parseTagString(defaultFilters.excludeTags));
  const [highlightedTags, setHighlightedTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const highlightedTagsSet = useMemo(
    () => new Set(highlightedTags.map(tag => tag.toLowerCase())),
    [highlightedTags]
  );

  // Parse URL params into filters
  const parseURLParams = useCallback((): FiltersState => {
    const urlFilters: Partial<FiltersState> = { ...defaultFilters };
    const query = searchParams.get("q");
    const exclude = searchParams.get("exclude");
    const tagMatchMode = searchParams.get("tagMatchMode");
    const sort = searchParams.get("sort");
    const favorite = searchParams.get("favorite");
    const source = searchParams.get("source");

    if (query) urlFilters.searchTerm = query;
    if (exclude) urlFilters.excludeTags = exclude;
    if (tagMatchMode) urlFilters.tagMatchMode = tagMatchMode as typeof urlFilters.tagMatchMode;
    if (sort) urlFilters.sort = sort;
    if (favorite) urlFilters.favorite = favorite as typeof urlFilters.favorite;
    if (source) {
      if (source === "chub" || source === "ct" || source === "risuai" || source === "wyvern") {
        urlFilters.source = source;
      } else {
        urlFilters.source = "all";
      }
    }
    const minTokensParam = searchParams.get("minTokens");
    if (minTokensParam) urlFilters.minTokens = minTokensParam;

    if (searchParams.get("hasExampleDialogues") === "true") urlFilters.hasExampleDialogues = true;
    if (searchParams.get("hasAlternateGreetings") === "true") urlFilters.hasAlternateGreetings = true;
    if (searchParams.get("hasSystemPrompt") === "true") urlFilters.hasSystemPrompt = true;
    if (searchParams.get("hasLorebook") === "true") urlFilters.hasLorebook = true;
    if (searchParams.get("hasEmbeddedLorebook") === "true") urlFilters.hasEmbeddedLorebook = true;
    if (searchParams.get("hasLinkedLorebook") === "true") urlFilters.hasLinkedLorebook = true;
    if (searchParams.get("hasGallery") === "true") urlFilters.hasGallery = true;
    if (searchParams.get("hasEmbeddedImages") === "true") urlFilters.hasEmbeddedImages = true;
    if (searchParams.get("hasExpressions") === "true") urlFilters.hasExpressions = true;
    if (searchParams.get("inSillyTavern") === "true") urlFilters.inSillyTavern = true;
    if (searchParams.get("followedOnly") === "true") urlFilters.followedOnly = true;

    const includeTagsParam = searchParams.get("includeTags");
    if (includeTagsParam) urlFilters.includeTags = includeTagsParam;

    const advancedFilterParam = searchParams.get("advancedFilter");
    if (advancedFilterParam) urlFilters.advancedFilter = advancedFilterParam;

    return normalizeFilters(urlFilters);
  }, [searchParams]);

  // Update URL when filters change
  const updateURL = useCallback((
    newFilters: FiltersState,
    newPage: number,
    cardId?: string | null,
    shouldPush = false
  ) => {
    const params = new URLSearchParams();

    if (newFilters.searchTerm) params.set("q", newFilters.searchTerm);
    if (newFilters.excludeTags) params.set("exclude", newFilters.excludeTags);
    if (newFilters.tagMatchMode !== "or") params.set("tagMatchMode", newFilters.tagMatchMode);
    if (newFilters.sort !== "new") params.set("sort", newFilters.sort);
    if (newFilters.favorite) params.set("favorite", newFilters.favorite);
    if (newFilters.source && newFilters.source !== "all") params.set("source", newFilters.source);
    if (newFilters.minTokens) params.set("minTokens", newFilters.minTokens);
    if (newFilters.hasExampleDialogues) params.set("hasExampleDialogues", "true");
    if (newFilters.hasAlternateGreetings) params.set("hasAlternateGreetings", "true");
    if (newFilters.hasSystemPrompt) params.set("hasSystemPrompt", "true");
    if (newFilters.hasLorebook) params.set("hasLorebook", "true");
    if (newFilters.hasEmbeddedLorebook) params.set("hasEmbeddedLorebook", "true");
    if (newFilters.hasLinkedLorebook) params.set("hasLinkedLorebook", "true");
    if (newFilters.hasGallery) params.set("hasGallery", "true");
    if (newFilters.hasEmbeddedImages) params.set("hasEmbeddedImages", "true");
    if (newFilters.hasExpressions) params.set("hasExpressions", "true");
    if (newFilters.includeTags) params.set("includeTags", newFilters.includeTags);
    if (newFilters.inSillyTavern) params.set("inSillyTavern", "true");
    if (newFilters.followedOnly) params.set("followedOnly", "true");
    if (newFilters.advancedFilter) params.set("advancedFilter", newFilters.advancedFilter);

    if (newPage > 1) params.set("page", newPage.toString());
    if (cardId) params.set("card", cardId);

    const newUrl = params.toString() ? `?${params.toString()}` : "/";

    if (shouldPush) {
      router.push(newUrl, { scroll: false });
    } else {
      router.replace(newUrl, { scroll: false });
    }
  }, [router]);

  const getCardIdFromURL = useCallback(() => {
    return searchParams.get("card");
  }, [searchParams]);

  // Initialize from URL on mount
  useEffect(() => {
    const urlFilters = parseURLParams();
    const hasFilterChanges = JSON.stringify(urlFilters) !== JSON.stringify(filters);

    if (hasFilterChanges) {
      setFilters(urlFilters);
      setSearchInputValue(urlFilters.searchTerm);
      setIncludeTagsSelected(parseTagString(urlFilters.includeTags));
      setExcludeTagsSelected(parseTagString(urlFilters.excludeTags));
      setAdvancedFilterInput(urlFilters.advancedFilter);
    }

    const pageParam = searchParams.get("page");
    const urlPage = pageParam ? parseInt(pageParam) || 1 : 1;
    if (urlPage !== page) {
      setPage(urlPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Sync search input with filters
  useEffect(() => {
    setSearchInputValue(filters.searchTerm);
  }, [filters.searchTerm]);

  useEffect(() => {
    setAdvancedFilterInput(filters.advancedFilter);
  }, [filters.advancedFilter]);

  // Sync tag selections with filters
  useEffect(() => {
    setIncludeTagsSelected(parseTagString(filters.includeTags));
  }, [filters.includeTags]);

  useEffect(() => {
    setExcludeTagsSelected(parseTagString(filters.excludeTags));
  }, [filters.excludeTags]);

  // Sync highlighted tags with include tags
  useEffect(() => {
    setHighlightedTags(includeTagsSelected);
  }, [includeTagsSelected]);

  // Search input debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInputValue !== filters.searchTerm) {
        setFilters(prev => normalizeFilters({ ...prev, searchTerm: searchInputValue }));
        setPage(1);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [searchInputValue, filters.searchTerm]);

  // Advanced filter debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (advancedFilterInput !== filters.advancedFilter) {
        setFilters(prev => normalizeFilters({ ...prev, advancedFilter: advancedFilterInput }));
        setPage(1);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [advancedFilterInput, filters.advancedFilter]);

  const handleFilterChange = useCallback((updates: Partial<FiltersState>) => {
    const newFilters = normalizeFilters({ ...filters, ...updates });
    setFilters(newFilters);
    setPage(1);
    clearSelection?.();
    updateURL(newFilters, 1);
  }, [filters, clearSelection, updateURL]);

  const handleIncludeTagsChange = useCallback((selected: string[]) => {
    setIncludeTagsSelected(selected);
    const tagString = selected.join(",");
    const updated = { ...filters, includeTags: tagString };
    setFilters(updated);
    updateURL(updated, 1);
  }, [filters, updateURL]);

  const handleExcludeTagsChange = useCallback((selected: string[]) => {
    setExcludeTagsSelected(selected);
    const tagString = selected.join(",");
    const updated = { ...filters, excludeTags: tagString };
    setFilters(updated);
    updateURL(updated, 1);
  }, [filters, updateURL]);

  const handleTagClick = useCallback((tag: string) => {
    const cleaned = tag.trim();
    if (!cleaned) return;

    setIncludeTagsSelected([cleaned]);
    const newFilters = normalizeFilters({ ...filters, includeTags: cleaned, searchTerm: "" });
    setFilters(newFilters);
    setSearchInputValue("");
    setPage(1);
    setHighlightedTags([cleaned]);
    clearSelection?.();
    updateURL(newFilters, 1, null, true);
    onFiltersChange?.();
  }, [filters, clearSelection, updateURL, onFiltersChange]);

  const handleAuthorClick = useCallback((author: string | undefined | null) => {
    const cleaned = (author || "").trim();
    if (!cleaned) return;

    const escapedAuthor = cleaned.replace(/"/g, '\\"');
    const authorFilter = `author = "${escapedAuthor}"`;

    const newFilters = normalizeFilters({
      ...filters,
      searchTerm: "",
      includeTags: "",
      excludeTags: "",
      advancedFilter: authorFilter
    });
    setFilters(newFilters);
    setIncludeTagsSelected([]);
    setExcludeTagsSelected([]);
    setHighlightedTags([]);
    setSearchInputValue("");
    setAdvancedFilterInput(authorFilter);
    setPage(1);
    clearSelection?.();
    updateURL(newFilters, 1, null, true);
  }, [filters, clearSelection, updateURL]);

  const handleClearFilters = useCallback(() => {
    setFilters({ ...defaultFilters });
    setSearchInputValue("");
    setIncludeTagsSelected([]);
    setExcludeTagsSelected([]);
    setHighlightedTags([]);
    setAdvancedFilterInput("");
    setPage(1);
    clearSelection?.();
    updateURL(defaultFilters, 1, null);
  }, [clearSelection, updateURL]);

  return {
    filters,
    setFilters,
    searchInputValue,
    setSearchInputValue,
    advancedFilterInput,
    setAdvancedFilterInput,
    includeTagsSelected,
    excludeTagsSelected,
    highlightedTags,
    highlightedTagsSet,
    page,
    setPage,
    handleFilterChange,
    handleIncludeTagsChange,
    handleExcludeTagsChange,
    handleTagClick,
    handleAuthorClick,
    handleClearFilters,
    updateURL,
    getCardIdFromURL,
  };
}
