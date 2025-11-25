import { useState, useCallback, useEffect } from "react";
import { normalizeFilters, type FiltersState, type SavedSearch } from "../types/filters";
import { parseTagString } from "../utils/tags";

interface UseSavedSearchesResult {
  savedSearches: SavedSearch[];
  handleSaveSearch: (
    filters: FiltersState,
    includeTagsSelected: string[],
    excludeTagsSelected: string[]
  ) => void;
  applySavedSearch: (
    search: SavedSearch,
    callbacks: {
      setFilters: React.Dispatch<React.SetStateAction<FiltersState>>;
      setPage: (page: number) => void;
      setIncludeTagsSelected: (tags: string[]) => void;
      setExcludeTagsSelected: (tags: string[]) => void;
      setHighlightedTags: (tags: string[]) => void;
      setSearchInputValue: (value: string) => void;
      setAdvancedFilterInput: (value: string) => void;
      updateURL: (filters: FiltersState, page: number, cardId: string | null, shouldPush: boolean) => void;
    }
  ) => void;
  removeSavedSearch: (id: string) => void;
}

export function useSavedSearches(): UseSavedSearchesResult {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  // Load saved searches from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("chubSavedSearches");
      if (stored) {
        const parsed: SavedSearch[] = JSON.parse(stored);
        setSavedSearches(parsed);
      }
    } catch (err) {
      console.error("Failed to load saved searches", err);
    }
  }, []);

  const persistSavedSearches = useCallback((next: SavedSearch[]) => {
    setSavedSearches(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("chubSavedSearches", JSON.stringify(next));
    }
  }, []);

  const handleSaveSearch = useCallback((
    filters: FiltersState,
    includeTagsSelected: string[],
    excludeTagsSelected: string[]
  ) => {
    if (typeof window === "undefined") return;
    const defaultName = filters.searchTerm || filters.includeTags || `Search ${savedSearches.length + 1}`;
    const name = window.prompt("Save search as", defaultName);
    if (!name) return;

    const id = typeof window !== "undefined" && "crypto" in window && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}`;

    const sanitizedName = name.trim();
    if (!sanitizedName) return;

    const existingIndex = savedSearches.findIndex(
      search => search.name.toLowerCase() === sanitizedName.toLowerCase()
    );
    const newSaved: SavedSearch = {
      id: existingIndex !== -1 ? savedSearches[existingIndex].id : id,
      name: sanitizedName,
      filters: {
        ...filters,
        includeTags: includeTagsSelected.join(","),
        excludeTags: excludeTagsSelected.join(","),
      },
    };

    if (existingIndex !== -1) {
      const next = [...savedSearches];
      next[existingIndex] = newSaved;
      persistSavedSearches(next);
    } else {
      persistSavedSearches([...savedSearches, newSaved]);
    }
  }, [savedSearches, persistSavedSearches]);

  const applySavedSearch = useCallback((
    search: SavedSearch,
    callbacks: {
      setFilters: React.Dispatch<React.SetStateAction<FiltersState>>;
      setPage: (page: number) => void;
      setIncludeTagsSelected: (tags: string[]) => void;
      setExcludeTagsSelected: (tags: string[]) => void;
      setHighlightedTags: (tags: string[]) => void;
      setSearchInputValue: (value: string) => void;
      setAdvancedFilterInput: (value: string) => void;
      updateURL: (filters: FiltersState, page: number, cardId: string | null, shouldPush: boolean) => void;
    }
  ) => {
    const {
      setFilters,
      setPage,
      setIncludeTagsSelected,
      setExcludeTagsSelected,
      setHighlightedTags,
      setSearchInputValue,
      setAdvancedFilterInput,
      updateURL,
    } = callbacks;

    const mergedFilters = normalizeFilters(search.filters);
    setFilters(mergedFilters);
    setPage(1);
    const include = parseTagString(mergedFilters.includeTags);
    const exclude = parseTagString(mergedFilters.excludeTags);
    setIncludeTagsSelected(include);
    setExcludeTagsSelected(exclude);
    setHighlightedTags(include);
    setSearchInputValue(mergedFilters.searchTerm || "");
    setAdvancedFilterInput(mergedFilters.advancedFilter || "");
    updateURL(mergedFilters, 1, null, false);
  }, []);

  const removeSavedSearch = useCallback((id: string) => {
    persistSavedSearches(savedSearches.filter(search => search.id !== id));
  }, [savedSearches, persistSavedSearches]);

  return {
    savedSearches,
    handleSaveSearch,
    applySavedSearch,
    removeSavedSearch,
  };
}
