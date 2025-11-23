"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState, Suspense, useRef } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Disclosure } from "@headlessui/react";
import {
  fetchCards,
  fetchCardMetadata,
  fetchPngInfo,
  fetchCardGallery,
  toggleFavorite,
  deleteCard as deleteCardApi,
  refreshCard as refreshCardApi,
  bulkDeleteCards,
  fetchTagAliases,
  cacheCardAssets as cacheCardAssetsApi,
  getCachedAssets,
  exportCard,
  pushCardToSilly,
  pushCardToArchitect,
  fetchChubFollows,
} from "@/lib/api";
import type { Card, CardsResponse, Config, GalleryAsset, ToggleFavoriteResponse, CachedAsset } from "@/lib/types";
import {
  BookOpen,
  Copy,
  Download,
  Globe,
  Hash,
  Heart,
  Loader2,
  PlugZap,
  Send,
  Sparkles,
  Search,
  Star,
} from "lucide-react";
import clsx from "clsx";
import { TagMultiSelect } from "./components/TagMultiSelect";
import { SettingsModal } from "./components/SettingsModal";
import { CardModal } from "./components/CardModal";
import { CardItem } from "./components/CardItem";
import { FilterBar } from "./components/FilterBar";
import { PaginationHeader } from "./components/PaginationHeader";
import { PaginationControls } from "./components/PaginationControls";
import { BulkActionBar } from "./components/BulkActionBar";
import { SyncStatus, PushNotification } from "./components/StatusBanners";
import { parseTagString } from "./utils/tags";
import { defaultFilters, normalizeFilters, type FiltersState, type SavedSearch } from "./types/filters";
import { defaultSillyTavernState, defaultCtSyncState, defaultVectorSearchState } from "./types/config";
import { useLightbox } from "./hooks/useLightbox";
import { useCardSelection } from "./hooks/useCardSelection";
import { useConfig } from "./hooks/useConfig";
import { useSync } from "./hooks/useSync";
import { useCardData } from "./hooks/useCardData";

interface CardDetails {
  metadata: Record<string, any> | null;
  pngInfo: Record<string, any> | null;
  gallery: GalleryAsset[];
  galleryError: string | null;
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<FiltersState>({ ...defaultFilters });
  const [searchInputValue, setSearchInputValue] = useState(defaultFilters.searchTerm);
  const [advancedFilterInput, setAdvancedFilterInput] = useState(defaultFilters.advancedFilter);
  const [highlightedTags, setHighlightedTags] = useState<string[]>([]);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [cardDetails, setCardDetails] = useState<CardDetails>({ metadata: null, pngInfo: null, gallery: [], galleryError: null });
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [refreshingCardId, setRefreshingCardId] = useState<string | null>(null);
  const [bulkRefreshing, setBulkRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<{ cardId: string; type: "success" | "error"; message: string } | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [includeTagsSelected, setIncludeTagsSelected] = useState<string[]>(parseTagString(defaultFilters.includeTags));
  const [excludeTagsSelected, setExcludeTagsSelected] = useState<string[]>(parseTagString(defaultFilters.excludeTags));
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [tagAliases, setTagAliases] = useState<Record<string, string[]> | null>(null);
  const [cachingAssets, setCachingAssets] = useState(false);
  const [assetCacheStatus, setAssetCacheStatus] = useState<{ cached: boolean; count: number } | null>(null);
  const [cachedAssetsDetails, setCachedAssetsDetails] = useState<CachedAsset[]>([]);
  const [cachedAssetsLoading, setCachedAssetsLoading] = useState(false);
  const [assetCacheMessage, setAssetCacheMessage] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [galleryMessage, setGalleryMessage] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [pushStatus, setPushStatus] = useState<{ cardId: string; type: "success" | "error"; message: string } | null>(null);
  const [isFetchingChubFollows, setIsFetchingChubFollows] = useState(false);
  const [chubFollowStatus, setChubFollowStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const chubProfileInputRef = useRef<HTMLInputElement | null>(null);
  const followedCreatorsTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Card selection management
  const selection = useCardSelection();
  const { selectedIds, isSelected: isCardSelected, clearSelection, selectAll: selectAllCards, toggleSelection, setSelectedIds } = selection;

  // Config management
  const configManager = useConfig();
  const { config, setConfig, showSettings, setShowSettings, loading: configLoading, saveStatus: configSaveStatus, saveConfig: handleSaveConfig } = configManager;

  // Card data management
  const cardData = useCardData(filters, 1);
  const { cards, page, setPage, totalPages, count, vectorMeta, isLoading, error, loadCards, setCards, setCount } = cardData;

  const hasFollowedCreators = useMemo(() => (config?.followedCreators?.length || 0) > 0, [config?.followedCreators]);
  const activeAuthor = useMemo(() => (selectedCard?.author || "").trim(), [selectedCard?.author]);
  const activeAuthorDisplay = activeAuthor || "Unknown";
  const activeAuthorClickable = activeAuthor.length > 0;

  const shouldShowGallerySection = useMemo(() => {
    if (!selectedCard) return false;
    if (selectedCard.hasGallery) return true;
    if (cardDetails.gallery.length > 0) return true;
    if (cardDetails.galleryError) return true;
    return false;
  }, [selectedCard, cardDetails.gallery.length, cardDetails.galleryError]);

  // Helper to parse URL params into filters
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
      if (source === "chub" || source === "ct") {
        urlFilters.source = source;
      } else {
        urlFilters.source = "all";
      }
    }
    const minTokensParam = searchParams.get("minTokens");
    if (minTokensParam) {
      urlFilters.minTokens = minTokensParam;
    }

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

  useEffect(() => {
    let cancelled = false;
    fetchTagAliases()
      .then(({ aliases }) => {
        if (!cancelled) {
          setTagAliases(aliases);
        }
      })
      .catch(error => {
        console.error("Failed to load tag aliases", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canonicalTagSet = useMemo(() => {
    if (!tagAliases) return undefined;
    return new Set(Object.keys(tagAliases).map(tag => tag.toLowerCase()));
  }, [tagAliases]);

  // Initialize filters from URL on mount and handle back/forward navigation
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

    const cardId = searchParams.get("card");
    const currentCardId = selectedCard?.id.toString();
    
    if (cardId && cards.length > 0) {
      const card = cards.find(c => c.id.toString() === cardId);
      if (card && cardId !== currentCardId) {
        // Open card without updating URL (URL is already correct)
        setSelectedCard(card);
        setDetailsLoading(true);
        const shouldFetchGallery = card.favorited === 1 || card.hasGallery;
        setGalleryLoading(shouldFetchGallery);
        setGalleryMessage(null);
        Promise.all([
          fetchCardMetadata(card.id).catch(() => null),
          fetchPngInfo(card.id).catch(() => null),
          shouldFetchGallery
            ? fetchCardGallery(card.id).catch(err => ({ success: false, assets: [], error: err?.message || "Failed to load gallery" }))
            : Promise.resolve(null),
        ])
          .then(([metadata, pngInfo, galleryResult]) => {
            const galleryAssets = galleryResult && galleryResult.success !== false ? galleryResult.assets ?? [] : [];
            const galleryError = galleryResult && galleryResult.success === false ? galleryResult.error || "Unable to load gallery" : null;
            setCardDetails({ metadata, pngInfo, gallery: galleryAssets, galleryError });
          })
          .catch(err => {
            console.error(err);
            setCardDetails({ metadata: null, pngInfo: null, gallery: [], galleryError: null });
          })
          .finally(() => {
            setDetailsLoading(false);
            setGalleryLoading(false);
          });
      } else if (!card && currentCardId) {
        setSelectedCard(null);
      }
    } else if (!cardId && currentCardId) {
      setSelectedCard(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]); // Listen to searchParams changes for back/forward navigation

  // Handle card opening/closing when URL changes (including back button)
  useEffect(() => {
    const cardId = searchParams.get("card");
    const currentCardId = selectedCard ? selectedCard.id.toString() : null;

    // Close card if URL no longer has card ID (back button pressed)
    if (!cardId && currentCardId) {
      setSelectedCard(null);
      return;
    }

    // Open card if URL has card ID and it's not already open
    if (cardId && cards.length > 0 && currentCardId !== cardId) {
      const card = cards.find(c => c.id.toString() === cardId);
      if (card) {
        setSelectedCard(card);
        setDetailsLoading(true);
        const shouldFetchGallery = card.favorited === 1 || card.hasGallery;
        setGalleryLoading(shouldFetchGallery);
        setGalleryMessage(null);
        Promise.all([
          fetchCardMetadata(card.id).catch(() => null),
          fetchPngInfo(card.id).catch(() => null),
          shouldFetchGallery
            ? fetchCardGallery(card.id).catch(err => ({ success: false, assets: [], error: err?.message || "Failed to load gallery" }))
            : Promise.resolve(null),
        ])
          .then(([metadata, pngInfo, galleryResult]) => {
            const galleryAssets = galleryResult && galleryResult.success !== false ? galleryResult.assets ?? [] : [];
            const galleryError = galleryResult && galleryResult.success === false ? galleryResult.error || "Unable to load gallery" : null;
            setCardDetails({ metadata, pngInfo, gallery: galleryAssets, galleryError });
          })
          .catch(err => {
            console.error(err);
            setCardDetails({ metadata: null, pngInfo: null, gallery: [], galleryError: null });
          })
          .finally(() => {
            setDetailsLoading(false);
            setGalleryLoading(false);
          });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, searchParams, selectedCard?.id]);

  // Update URL when filters or lightbox state changes
  const updateURL = useCallback((newFilters: typeof filters, newPage: number, cardId?: string | null, shouldPush = false) => {
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

    // Use push for opening cards (adds to history), replace for filter changes
    if (shouldPush) {
      router.push(newUrl, { scroll: false });
    } else {
      router.replace(newUrl, { scroll: false });
    }
  }, [router]);

  // Handle tag selection changes and update URL
  const handleIncludeTagsChange = useCallback((selected: string[]) => {
    setIncludeTagsSelected(selected);
    const tagString = selected.join(",");
    const updated = { ...filters, includeTags: tagString };
    setFilters(updated);
    updateURL(updated, 1);  // Reset to page 1 when filters change
  }, [filters, updateURL]);

  const handleExcludeTagsChange = useCallback((selected: string[]) => {
    setExcludeTagsSelected(selected);
    const tagString = selected.join(",");
    const updated = { ...filters, excludeTags: tagString };
    setFilters(updated);
    updateURL(updated, 1);  // Reset to page 1 when filters change
  }, [filters, updateURL]);

  const pngData = cardDetails.pngInfo?.data?.data ?? null;

  const definitionData = useMemo(() => {
    const definition = (cardDetails.metadata as any)?.definition;
    if (!definition) return null;
    if (definition?.data) {
      return definition.data as Record<string, any>;
    }
    return null;
  }, [cardDetails.metadata]);

  const resolveTextField = useCallback(
    (key: string) => {
      const pickValue = (source: Record<string, any> | null | undefined) => {
        if (!source) return "";
        const value = source[key];
        if (typeof value === "string") {
          return value.trim().length > 0 ? value : "";
        }
        return "";
      };

      const fromPng = pickValue(pngData);
      if (fromPng) return fromPng;
      return pickValue(definitionData);
    },
    [pngData, definitionData],
  );

  const tokenCounts = useMemo(() => {
    const labels = (cardDetails.metadata as any)?.labels;
    if (cardDetails.metadata && cardDetails.metadata.tokenCounts) {
      return cardDetails.metadata.tokenCounts as Record<string, number>;
    }
    if (!Array.isArray(labels)) return null;
    const tokenLabel = labels.find((label: any) => label.title === "TOKEN_COUNTS");
    if (!tokenLabel?.description) return null;
    try {
      return JSON.parse(tokenLabel.description);
    } catch {
      return null;
    }
  }, [cardDetails.metadata]);

  const textSections = useMemo(() => {
    const sections: Array<{ title: string; value: string; defaultOpen?: boolean }> = [
      { title: "Description", value: resolveTextField("description") },
      { title: "Scenario", value: resolveTextField("scenario") },
      { title: "Personality", value: resolveTextField("personality") },
      { title: "First Message", value: resolveTextField("first_mes"), defaultOpen: true },
      { title: "Message Examples", value: resolveTextField("mes_example") },
      { title: "System Prompt", value: resolveTextField("system_prompt") },
      { title: "Post-History Instructions", value: resolveTextField("post_history_instructions") },
    ];

    return sections.filter(section => section.value && section.value.trim().length > 0);
  }, [resolveTextField]);

  const alternateGreetings = useMemo(() => {
    const pick = (source: Record<string, any> | null | undefined) =>
      source?.alternate_greetings && Array.isArray(source.alternate_greetings)
        ? source.alternate_greetings.filter((g: any) => typeof g === "string" && g.trim().length > 0)
        : [];

    const fromPng = pick(pngData);
    if (fromPng.length > 0) {
      return fromPng;
    }
    return pick(definitionData);
  }, [pngData, definitionData]);

  const lorebookEntries = useMemo(() => {
    const entries =
      (pngData as any)?.character_book?.entries ??
      (definitionData as any)?.character_book?.entries ??
      [];
    if (!Array.isArray(entries)) return [];
    return entries.filter(entry => entry && typeof entry === "object");
  }, [pngData, definitionData]);

  const linkedLorebooks = useMemo(() => {
    const related = cardDetails.metadata?.related_lorebooks;
    if (!Array.isArray(related)) return [];
    return related.filter(lorebook => lorebook && typeof lorebook === "object");
  }, [cardDetails.metadata]);

  const galleryAssets = cardDetails.gallery ?? [];

  // Lightbox management
  const lightbox = useLightbox(galleryAssets, selectedCard?.id);

  const pushMessage = useMemo(
    () =>
      pushStatus && selectedCard && pushStatus.cardId === selectedCard.id ? pushStatus : null,
    [pushStatus, selectedCard],
  );
  const globalPushMessage = useMemo(
    () =>
      pushStatus && (!selectedCard || pushStatus.cardId !== selectedCard.id) ? pushStatus : null,
    [pushStatus, selectedCard],
  );
  const canPushToSilly = useMemo(
    () => !!(config?.sillyTavern?.enabled && config?.sillyTavern?.baseUrl),
    [config?.sillyTavern?.enabled, config?.sillyTavern?.baseUrl],
  );
  const canPushToArchitect = useMemo(
    () => !!config?.characterArchitect?.url,
    [config?.characterArchitect?.url],
  );
  const pushedCard = useMemo(() => {
    if (!pushStatus) return null;
    if (selectedCard && selectedCard.id === pushStatus.cardId) {
      return selectedCard;
    }
    return cards.find(card => card.id === pushStatus.cardId) || null;
  }, [pushStatus, selectedCard, cards]);

  const formatTokenKey = useCallback(
    (key: string) =>
      key
        .split("_")
        .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join(" "),
    [],
  );

  // Sync management (Chub and Character Tavern)
  const sync = useSync(loadCards);
  const { syncing, syncStatus, ctSyncing, ctSyncStatus, startChubSync: startSyncing, startCtSync: startCtSyncing } = sync;

  useEffect(() => {
    setSearchInputValue(filters.searchTerm);
  }, [filters.searchTerm]);

  useEffect(() => {
    setAdvancedFilterInput(filters.advancedFilter);
  }, [filters.advancedFilter]);

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

  // Advanced filter input debounce (for power users)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (advancedFilterInput !== filters.advancedFilter) {
        setFilters(prev => normalizeFilters({ ...prev, advancedFilter: advancedFilterInput }));
        setPage(1);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [advancedFilterInput, filters.advancedFilter]);

  useEffect(() => {
    if (!selectedCard) {
      setGalleryMessage(null);
    }
  }, [selectedCard]);

  useEffect(() => {
    if (!showSettings) {
      setChubFollowStatus(null);
      setIsFetchingChubFollows(false);
    }
  }, [showSettings]);

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

  useEffect(() => {
    setIncludeTagsSelected(parseTagString(filters.includeTags));
  }, [filters.includeTags]);

  useEffect(() => {
    setExcludeTagsSelected(parseTagString(filters.excludeTags));
  }, [filters.excludeTags]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (!refreshStatus) return;
    const timer = setTimeout(() => setRefreshStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [refreshStatus]);

  const computedTagSuggestions = useMemo(() => {
    // Load initial tag suggestions from visible cards
    const tags = new Set<string>([...includeTagsSelected, ...excludeTagsSelected]);
    cards.forEach(card => {
      card.topics.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [cards, includeTagsSelected, excludeTagsSelected]);

  useEffect(() => {
    setTagSuggestions(computedTagSuggestions);
  }, [computedTagSuggestions]);

  const highlightedTagsSet = useMemo(() => new Set(highlightedTags.map(tag => tag.toLowerCase())), [highlightedTags]);

  useEffect(() => {
    setHighlightedTags(includeTagsSelected);
  }, [includeTagsSelected]);

  useEffect(() => {
    const cardIdSet = new Set(cards.map(card => card.id));
    setSelectedIds(prev => prev.filter(id => cardIdSet.has(id)));
  }, [cards, setSelectedIds]);


  // Load asset cache status when card is selected
  useEffect(() => {
    if (!selectedCard) {
      setAssetCacheStatus(null);
      setAssetCacheMessage(null);
      return;
    }

    const loadCacheStatus = async () => {
      setCachedAssetsLoading(true);
      try {
        const assets = await getCachedAssets(selectedCard.id);
        setAssetCacheStatus({
          cached: assets.assets && assets.assets.length > 0,
          count: assets.assets?.length || 0,
        });
        setCachedAssetsDetails(assets.assets || []);
      } catch (err) {
        console.error("Failed to load cache status:", err);
        setAssetCacheStatus({ cached: false, count: 0 });
        setCachedAssetsDetails([]);
      } finally {
        setCachedAssetsLoading(false);
      }
    };

    loadCacheStatus();
  }, [selectedCard]);

  const persistSavedSearches = useCallback((next: SavedSearch[]) => {
    setSavedSearches(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("chubSavedSearches", JSON.stringify(next));
    }
  }, []);

  const handleFilterChange = (updates: Partial<typeof filters>) => {
    const newFilters = normalizeFilters({ ...filters, ...updates });
    setFilters(newFilters);
    setPage(1);
    clearSelection();
    updateURL(newFilters, 1, selectedCard?.id.toString());
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const handleTagClick = useCallback(
    async (tag: string) => {
      const cleaned = tag.trim();
      if (!cleaned) return;

      setIncludeTagsSelected([cleaned]);
      const newFilters = normalizeFilters({ ...filters, includeTags: cleaned, searchTerm: "" });
      setFilters(newFilters);
      setSearchInputValue("");
      setPage(1);
      setHighlightedTags([cleaned]);
      clearSelection();
      setSelectedCard(null);
      updateURL(newFilters, 1, null, true);

      // Trigger a fresh load immediately so the modal click navigates instantly
      await loadCards();
    },
    [clearSelection, filters, loadCards, updateURL],
  );

  const handleAuthorClick = useCallback(
    (author: string | undefined | null) => {
      const cleaned = (author || "").trim();
      if (!cleaned) return;

      // Search for cards by this author using exact author filter
      // Escape double quotes in author name for Meilisearch filter syntax
      const escapedAuthor = cleaned.replace(/"/g, '\\"');
      const authorFilter = `author = "${escapedAuthor}"`;

      const newFilters = normalizeFilters({
        ...filters,
        searchTerm: "",  // Clear search term
        includeTags: "",
        excludeTags: "",
        advancedFilter: authorFilter  // Use author-specific filter
      });
      setFilters(newFilters);
      setIncludeTagsSelected([]);
      setExcludeTagsSelected([]);
      setHighlightedTags([]);
      setSearchInputValue("");  // Clear search input since we're using advancedFilter
      setAdvancedFilterInput(authorFilter);  // Show filter in advanced search input
      setPage(1);
      clearSelection();
      // Close modal when searching for an author, push to history so back works
      setSelectedCard(null);
      updateURL(newFilters, 1, null, true);
      // Note: loadCards() will be called automatically by useEffect watching filters change
    },
    [clearSelection, filters, updateURL],
  );

  const toggleFavoriteCard = async (card: Card) => {
    try {
      const result: ToggleFavoriteResponse = await toggleFavorite(card.id);

      setCards(prev =>
        prev.map(c =>
          c.id === card.id
            ? { ...c, favorited: result.favorited, hasGallery: !!result.hasGallery }
            : c,
        ),
      );
      setSelectedCard(prev =>
        prev && prev.id === card.id
          ? { ...prev, favorited: result.favorited, hasGallery: !!result.hasGallery }
          : prev,
      );

      if (result.favorited === 1) {
        setGalleryLoading(true);
        setGalleryMessage(null);
        try {
          const galleryResponse = await fetchCardGallery(card.id);
          setCardDetails(prev =>
            prev
              ? {
                  ...prev,
                  gallery: galleryResponse?.assets ?? [],
                  galleryError:
                    galleryResponse && galleryResponse.success === false
                      ? galleryResponse.error || "Unable to load gallery"
                      : null,
                }
              : prev,
          );

          if (result.gallery?.error) {
            setGalleryMessage({ type: "error", message: result.gallery.error });
          } else if (galleryResponse?.assets?.length) {
            const cached = result.gallery?.cached ?? 0;
            const skipped = result.gallery?.skipped ?? 0;
            const messageParts: string[] = [];
            if (cached > 0) messageParts.push(`${cached} new`);
            if (skipped > 0) messageParts.push(`${skipped} existing`);
            const suffix = messageParts.length > 0 ? ` (${messageParts.join(", ")})` : "";
            setGalleryMessage({ type: "success", message: `Gallery cached${suffix}` });
          } else if (result.gallery?.message) {
            setGalleryMessage({ type: "error", message: result.gallery.message });
          } else {
            setGalleryMessage({ type: "error", message: "No gallery items available" });
          }
          
          // Automatically cache assets when favorited
          handleCacheAssets(card);
        } catch (galleryError: any) {
          const message = galleryError?.message || "Failed to load gallery";
          setCardDetails(prev => (prev ? { ...prev, gallery: [], galleryError: message } : prev));
          setGalleryMessage({ type: "error", message });
        } finally {
          setGalleryLoading(false);
        }
      } else {
        setCardDetails(prev => (prev ? { ...prev, gallery: [], galleryError: null } : prev));
        if (result.gallery?.removed) {
          setGalleryMessage({ type: "success", message: `Gallery cache cleared (${result.gallery.removed})` });
        } else {
          setGalleryMessage(null);
        }
      }
    } catch (err: any) {
      console.error(err);
      setGalleryMessage({ type: "error", message: err?.message || "Failed to toggle favorite" });
    }
  };

  const deleteCard = async (card: Card) => {
    if (!window.confirm(`Delete ${card.name}?`)) return;
    try {
      await deleteCardApi(card.id);
      setCards(prev => prev.filter(c => c.id !== card.id));
      setCount(prev => Math.max(0, prev - 1));
      selection.setSelectedIds(prev => prev.filter(id => id !== card.id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleRefreshCard = async (card: Card) => {
    setRefreshingCardId(card.id);
    setRefreshStatus(null);
    try {
      await refreshCardApi(card.id);
      const response = await loadCards();
      const updatedCard = response?.cards?.find(c => c.id === card.id) || card;
      await openCardDetails(updatedCard);
      setRefreshStatus({ cardId: card.id, type: "success", message: "Card refreshed" });
    } catch (err: any) {
      console.error(err);
      setRefreshStatus({ cardId: card.id, type: "error", message: err.message || "Failed to refresh card" });
    } finally {
      setRefreshingCardId(null);
    }
  };

  const closeCardDetails = useCallback(() => {
    const currentId = selectedCard?.id ?? null;
    setSelectedCard(null);
    setGalleryLoading(false);
    setGalleryMessage(null);
    // Lightbox automatically closes when selectedCard.id changes (handled by useLightbox hook)
    setPushStatus(prev => (prev && prev.cardId === currentId ? null : prev));
    updateURL(filters, page, null);
  }, [filters, page, selectedCard?.id, updateURL]);

  const handleNavigateBack = useCallback(() => {
    if (page <= 1) return;
    const newPage = page - 1;
    setPage(newPage);
    clearSelection();
    setSelectedCard(null);
    updateURL(filters, newPage, null, true);
  }, [page, clearSelection, filters, updateURL]);

  const handleNavigateForward = useCallback(() => {
    if (page >= totalPages) return;
    const newPage = page + 1;
    setPage(newPage);
    clearSelection();
    setSelectedCard(null);
    updateURL(filters, newPage, null, true);
  }, [page, totalPages, clearSelection, filters, updateURL]);

  const handleGoToFirstPage = useCallback(() => {
    if (page === 1) return;
    setPage(1);
    clearSelection();
    setSelectedCard(null);
    updateURL(filters, 1, null, true);
  }, [page, clearSelection, filters, updateURL]);

  const handleGoToLastPage = useCallback(() => {
    if (page === totalPages) return;
    setPage(totalPages);
    clearSelection();
    setSelectedCard(null);
    updateURL(filters, totalPages, null, true);
  }, [page, totalPages, clearSelection, filters, updateURL]);

  const handleCacheAssets = async (card: Card) => {
    setCachingAssets(true);
    setAssetCacheMessage(null);
    try {
      const result = await cacheCardAssetsApi(card.id);
      if (result.success) {
        const message = result.cached > 0
          ? `Cached ${result.cached} asset(s). ${result.skipped > 0 ? `${result.skipped} already cached. ` : ""}${result.failed > 0 ? `${result.failed} failed.` : ""}`
          : result.total === 0
          ? "No media URLs found in card"
          : `All ${result.total} asset(s) already cached`;
        setAssetCacheMessage({ type: "success", message });

        // Update cache status
        const assets = await getCachedAssets(card.id);
        setAssetCacheStatus({ cached: true, count: assets.assets?.length || 0 });
      } else {
        setAssetCacheMessage({ type: "error", message: result.error || "Failed to cache assets" });
      }
    } catch (err: any) {
      console.error(err);
      setAssetCacheMessage({ type: "error", message: err.message || "Failed to cache assets" });
    } finally {
      setCachingAssets(false);
    }
  };

  const handleExportCard = async (card: Card, useLocal: boolean) => {
    try {
      const { blob, filename } = await exportCard(card.id, useLocal);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      alert(`Export failed: ${err.message}`);
    }
  };

  const openCardDetails = async (card: Card) => {
    setSelectedCard(card);
    // Push to history so back button works
    updateURL(filters, page, card.id.toString(), true);
    setDetailsLoading(true);
    const shouldFetchGallery = card.favorited === 1 || card.hasGallery;
    setGalleryLoading(shouldFetchGallery);
    setGalleryMessage(null);
    try {
      const [metadata, pngInfo, galleryResult] = await Promise.all([
        fetchCardMetadata(card.id).catch(() => null),
        fetchPngInfo(card.id).catch(() => null),
        shouldFetchGallery
          ? fetchCardGallery(card.id).catch(err => ({ success: false, assets: [], error: err?.message || 'Failed to load gallery' }))
          : Promise.resolve(null),
      ]);
      const metadataFlags = metadata
        ? {
            hasAlternateGreetings: typeof metadata.hasAlternateGreetings === "boolean" ? metadata.hasAlternateGreetings : card.hasAlternateGreetings,
            hasLorebook: typeof metadata.hasLorebook === "boolean" ? metadata.hasLorebook : card.hasLorebook,
            hasEmbeddedLorebook: typeof metadata.hasEmbeddedLorebook === "boolean" ? metadata.hasEmbeddedLorebook : card.hasEmbeddedLorebook,
            hasLinkedLorebook: typeof metadata.hasLinkedLorebook === "boolean" ? metadata.hasLinkedLorebook : card.hasLinkedLorebook,
            hasExampleDialogues: typeof metadata.hasExampleDialogues === "boolean" ? metadata.hasExampleDialogues : card.hasExampleDialogues,
            hasSystemPrompt: typeof metadata.hasSystemPrompt === "boolean" ? metadata.hasSystemPrompt : card.hasSystemPrompt,
            hasGallery: typeof metadata.hasGallery === "boolean" ? metadata.hasGallery : card.hasGallery,
          }
        : null;
      if (metadataFlags) {
        setSelectedCard(prev => (prev && prev.id === card.id ? { ...prev, ...metadataFlags } : prev));
        setCards(prev =>
          prev.map(existing => (existing.id === card.id ? { ...existing, ...metadataFlags } : existing))
        );
      }
      const galleryAssets = galleryResult && galleryResult.success !== false ? galleryResult.assets ?? [] : [];
      const galleryError = galleryResult && galleryResult.success === false ? galleryResult.error || 'Unable to load gallery' : null;
      setCardDetails({ metadata: metadata && metadataFlags ? { ...metadata, ...metadataFlags } : metadata, pngInfo, gallery: galleryAssets, galleryError });
    } catch (err) {
      console.error(err);
      setCardDetails({ metadata: null, pngInfo: null, gallery: [], galleryError: null });
    } finally {
      setDetailsLoading(false);
      setGalleryLoading(false);
    }
  };

  const getDownloadFilename = (card: Card) => {
    const base = (card.name || "card")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const slug = base || "card";
    return `${slug}_${card.id}.png`;
  };

  const handleDownload = async (card: Card) => {
    try {
      const response = await fetch(card.imagePath);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getDownloadFilename(card);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyLink = (card: Card) => {
    const url = `${window.location.origin}${card.imagePath}`;

    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(console.error);
    } else {
      // Fallback for non-secure contexts
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Failed to copy:', err);
      }
      document.body.removeChild(textarea);
    }
  };

  const handlePushToSilly = async (card: Card) => {
    if (!canPushToSilly) {
      setPushStatus({
        cardId: card.id,
        type: "error",
        message: "Enable Silly Tavern integration in settings before pushing.",
      });
      return;
    }
    try {
      const result = await pushCardToSilly(card.id);
      const status = (result as any)?.status ? ` (status ${(result as any).status})` : "";
      const responseMessage = (result as any)?.response?.message || (result as any)?.message;
      const message =
        responseMessage ||
        `Pushed card ${card.name || card.id} to Silly Tavern${status}`;
      setPushStatus({ cardId: card.id, type: "success", message });
      
      // Automatically cache assets on push
      handleCacheAssets(card);
    } catch (err: any) {
      setPushStatus({
        cardId: card.id,
        type: "error",
        message: err?.message || "Failed to push card to Silly Tavern",
      });
    }
  };

  const handlePushToArchitect = async (card: Card) => {
    if (!canPushToArchitect) {
      setPushStatus({
        cardId: card.id,
        type: "error",
        message: "Configure Character Architect URL in settings before pushing.",
      });
      return;
    }
    try {
      const result = await pushCardToArchitect(card.id);
      const responseMessage = (result as any)?.message;
      const message =
        responseMessage ||
        `Pushed card ${card.name || card.id} to Character Architect`;
      setPushStatus({ cardId: card.id, type: "success", message });
    } catch (err: any) {
      setPushStatus({
        cardId: card.id,
        type: "error",
        message: err?.message || "Failed to push card to Character Architect",
      });
    }
  };

  const getChubUrl = (card: Card) => {
    if (card.source === "ct" && card.sourceUrl) {
      return card.sourceUrl;
    }
    if (card.fullPath) {
      return `https://chub.ai/characters/${card.fullPath}`;
    }
    if (card.silly_link) {
      return card.silly_link;
    }
    return null;
  };

  const handleSelectAll = () => {
    selectAllCards(cards);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} selected card(s)?`)) return;
    try {
      await bulkDeleteCards(selectedIds);
      setCards(prev => prev.filter(card => !selectedIds.includes(card.id)));
      setCount(prev => Math.max(0, prev - selectedIds.length));
      clearSelection();
    } catch (err) {
      console.error(err);
    }
  };

  const handleBulkRefresh = async () => {
    if (selectedIds.length === 0) return;
    setBulkRefreshing(true);
    setRefreshStatus(null);
    try {
      for (const cardId of selectedIds) {
        await refreshCardApi(cardId);
      }
      const response = await loadCards();
      if (response?.cards && selectedCard) {
        const updated = response.cards.find(card => card.id === selectedCard.id);
        if (updated) {
          setSelectedCard(updated);
        }
      }
      const countLabel = selectedIds.length === 1 ? "card" : "cards";
      setRefreshStatus({
        cardId: selectedIds[selectedIds.length - 1],
        type: "success",
        message: `Refreshed ${selectedIds.length} ${countLabel}`,
      });
    } catch (err: any) {
      console.error(err);
      setRefreshStatus({
        cardId: selectedIds[0],
        type: "error",
        message: err?.message || "Failed to refresh selected cards",
      });
    } finally {
      setBulkRefreshing(false);
    }
  };

  const handleSaveSearch = () => {
    if (typeof window === "undefined") return;
    const defaultName = filters.searchTerm || filters.includeTags || `Search ${savedSearches.length + 1}`;
    const name = window.prompt("Save search as", defaultName);
    if (!name) return;

    const id = typeof window !== "undefined" && "crypto" in window && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}`;

    const sanitizedName = name.trim();
    if (!sanitizedName) return;

    const existingIndex = savedSearches.findIndex(search => search.name.toLowerCase() === sanitizedName.toLowerCase());
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
  };

  const applySavedSearch = (search: SavedSearch) => {
    const mergedFilters = normalizeFilters(search.filters);
    setFilters(mergedFilters);
    setPage(1);
    const include = parseTagString(mergedFilters.includeTags);
    const exclude = parseTagString(mergedFilters.excludeTags);
    setIncludeTagsSelected(include);
    setExcludeTagsSelected(exclude);
    setHighlightedTags(include);
    setSearchInputValue(mergedFilters.searchTerm || '');
    setAdvancedFilterInput(mergedFilters.advancedFilter || '');

    // Update URL with new filters (replace, not push, to avoid adding to history)
    updateURL(mergedFilters, 1, null, false);

    // Note: loadCards() will be called automatically by the useEffect that watches loadCards
  };

  const removeSavedSearch = (id: string) => {
    persistSavedSearches(savedSearches.filter(search => search.id !== id));
  };

  const handleFetchChubFollows = async () => {
    const fromInput = chubProfileInputRef.current?.value?.trim();
    const profile = (fromInput || config?.chubProfileName || "").trim();
    if (!profile) {
      setChubFollowStatus({ type: "error", message: "Enter your Chub profile name first." });
      return;
    }

    setIsFetchingChubFollows(true);
    setChubFollowStatus(null);
    try {
      const result = await fetchChubFollows(profile);
      const usernames = Array.isArray(result.creators)
        ? result.creators
            .map(creator => creator.username)
            .filter(username => typeof username === "string" && username.trim().length > 0)
        : [];

      if (followedCreatorsTextareaRef.current) {
        followedCreatorsTextareaRef.current.value = usernames.join(", ");
      }

      if (chubProfileInputRef.current) {
        chubProfileInputRef.current.value = result.profile;
      }

      setConfig(prev => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          chubProfileName: result.profile,
          followedCreators: usernames,
        };
      });

      setChubFollowStatus({
        type: "success",
        message: `Loaded ${usernames.length} creator${usernames.length === 1 ? "" : "s"} from Chub.`,
      });
    } catch (error: any) {
      setChubFollowStatus({
        type: "error",
        message: error?.message || "Failed to fetch followed creators.",
      });
    } finally {
      setIsFetchingChubFollows(false);
    }
  };

  const handleCardTextClick = (event: React.MouseEvent<HTMLDivElement>, card: Card, index: number) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea")) {
      return;
    }

    toggleSelection(card, index, event, cards);
  };

  const pageLabel = useMemo(() => `${page} of ${totalPages} | ${count.toLocaleString()} Cards`, [page, totalPages, count]);

  const renderCards = () => {
    if (isLoading) {
  return (
        <div className="flex h-64 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading cards...
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex h-64 items-center justify-center rounded-3xl border border-red-200 bg-red-50 text-sm text-red-600 dark:border-red-600/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      );
    }

    if (cards.length === 0) {
      return (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <span>No cards match these filters.</span>
          <button
            onClick={() => {
              setFilters(() => ({ ...defaultFilters }));
              setPage(1);
              setHighlightedTags([]);
              updateURL(defaultFilters, 1, null);
            }}
            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"
          >
            Reset filters
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {vectorMeta?.enabled && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-indigo-100 bg-indigo-50/80 px-5 py-4 text-sm text-slate-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-slate-100">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-200">
              <Sparkles className="h-4 w-4" />
              Semantic search active
            </div>
            <div className="flex flex-col gap-2 text-xs text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:gap-4">
              <span>Cards fetched: {vectorMeta.meta?.cardsFetched ?? "—"}</span>
              <span>Chunks fetched: {vectorMeta.meta?.chunksFetched ?? "—"}</span>
              {typeof vectorMeta.meta?.semanticRatio === "number" && (
                <span>Ratio: {Math.round(vectorMeta.meta.semanticRatio * 100)}% vector</span>
              )}
              {vectorMeta.appliedFilter && (
                <span className="text-slate-500 dark:text-slate-400">Filter: {vectorMeta.appliedFilter}</span>
              )}
            </div>
          </div>
        )}
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card, index) => (
            <CardItem
              key={card.id}
              card={card}
              index={index}
              isSelected={isCardSelected(card.id)}
              highlightedTagsSet={highlightedTagsSet}
              canPushToSilly={canPushToSilly}
              chubUrl={getChubUrl(card)}
              onOpenDetails={openCardDetails}
              onCardTextClick={handleCardTextClick}
              onTagClick={handleTagClick}
              onAuthorClick={handleAuthorClick}
              onToggleFavorite={toggleFavoriteCard}
              onDownload={handleDownload}
              onPushToSilly={handlePushToSilly}
              onCopyLink={handleCopyLink}
              onDelete={deleteCard}
            />
          ))}
        </div>
    </div>
    );
  };





  return (
    <div className="min-h-screen bg-slate-50 pb-16 transition dark:bg-slate-950">
      <PaginationHeader
        page={page}
        totalPages={totalPages}
        pageLabel={pageLabel}
        isLoading={isLoading}
        syncing={syncing}
        ctSyncing={ctSyncing}
        darkMode={darkMode}
        onGoToFirstPage={handleGoToFirstPage}
        onNavigateBack={handleNavigateBack}
        onNavigateForward={handleNavigateForward}
        onGoToLastPage={handleGoToLastPage}
        onRefresh={() => loadCards()}
        onSaveSearch={handleSaveSearch}
        onSync={async () => {
          await startSyncing();
          await startCtSyncing();
        }}
        onOpenSettings={() => setShowSettings(true)}
        onToggleDarkMode={() => setDarkMode(prev => !prev)}
      />

      <header className="mx-auto w-full max-w-7xl px-6 pt-6 pb-2">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Character Archive
          </h1>
          <SyncStatus syncStatus={syncStatus} ctSyncStatus={ctSyncStatus} />
        </div>
      </header>

      <PushNotification
        message={globalPushMessage}
        cardName={pushedCard?.name}
        onDismiss={() => setPushStatus(null)}
      />

      <main className="mx-auto w-full max-w-7xl space-y-6 px-6">
        <FilterBar
          filters={filters}
          searchInputValue={searchInputValue}
          advancedFilterInput={advancedFilterInput}
          includeTagsSelected={includeTagsSelected}
          excludeTagsSelected={excludeTagsSelected}
          tagSuggestions={tagSuggestions}
          savedSearches={savedSearches}
          darkMode={darkMode}
          hasFollowedCreators={hasFollowedCreators}
          canonicalTagSet={canonicalTagSet}
          onSearchInputChange={setSearchInputValue}
          onAdvancedFilterChange={setAdvancedFilterInput}
          onIncludeTagsChange={handleIncludeTagsChange}
          onExcludeTagsChange={handleExcludeTagsChange}
          onFilterChange={handleFilterChange}
          onSearchSubmit={handleSearchSubmit}
          onClearFilters={() => {
            setFilters(() => ({ ...defaultFilters }));
            setSearchInputValue("");
            setIncludeTagsSelected([]);
            setExcludeTagsSelected([]);
            setHighlightedTags([]);
            setPage(1);
            clearSelection();
            updateURL(defaultFilters, 1, null);
          }}
          onSaveSearch={handleSaveSearch}
          onApplySavedSearch={applySavedSearch}
          onRemoveSavedSearch={removeSavedSearch}
        />

        <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <BulkActionBar
            selectedCount={selectedIds.length}
            bulkRefreshing={bulkRefreshing}
            onSelectAll={handleSelectAll}
            onClearSelection={clearSelection}
            onBulkRefresh={handleBulkRefresh}
            onBulkDelete={handleBulkDelete}
          />
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-100">
              <span className="font-semibold">{selectedIds.length} selected</span>
              <span className="text-xs uppercase tracking-wide">Use Ctrl/Cmd for multi-select, Shift for ranges.</span>
        </div>
          )}
          {renderCards()}
          {totalPages > 1 && (
            <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <PaginationControls
                page={page}
                totalPages={totalPages}
                size="sm"
                onFirst={handleGoToFirstPage}
                onPrev={handleNavigateBack}
                onNext={handleNavigateForward}
                onLast={handleGoToLastPage}
              />
              <span className="text-xs font-medium">{pageLabel}</span>
              <div className="w-[140px]"></div>
            </div>
          )}
        </section>
      </main>

      <CardModal
        selectedCard={selectedCard}
        closeCardDetails={closeCardDetails}
        getChubUrl={getChubUrl}
        refreshStatus={refreshStatus}
        toggleFavoriteCard={toggleFavoriteCard}
        handleRefreshCard={handleRefreshCard}
        refreshingCardId={refreshingCardId}
        handleDownload={handleDownload}
        handlePushToSilly={handlePushToSilly}
        canPushToSilly={canPushToSilly}
        handlePushToArchitect={handlePushToArchitect}
        canPushToArchitect={canPushToArchitect}
        handleCopyLink={handleCopyLink}
        handleCacheAssets={handleCacheAssets}
        cachingAssets={cachingAssets}
        assetCacheStatus={assetCacheStatus}
        handleExportCard={handleExportCard}
        assetCacheMessage={assetCacheMessage}
        galleryMessage={galleryMessage}
        pushMessage={pushMessage}
        detailsLoading={detailsLoading}
        cardDetails={cardDetails}
        tokenCounts={tokenCounts}
        formatTokenKey={formatTokenKey}
        textSections={textSections}
        alternateGreetings={alternateGreetings}
        lorebookEntries={lorebookEntries}
        linkedLorebooks={linkedLorebooks}
        shouldShowGallerySection={shouldShowGallerySection}
        galleryAssets={galleryAssets}
        galleryLoading={galleryLoading}
        openLightbox={lightbox.open}
        cachedAssetsDetails={cachedAssetsDetails}
        cachedAssetsLoading={cachedAssetsLoading}
        activeAuthorClickable={activeAuthorClickable}
        activeAuthor={activeAuthor}
        activeAuthorDisplay={activeAuthorDisplay}
        handleAuthorClick={handleAuthorClick}
        highlightedTagsSet={highlightedTagsSet}
        handleTagClick={handleTagClick}
        activeLightboxAsset={lightbox.asset}
        closeLightbox={lightbox.close}
        showPrevAsset={lightbox.prev}
        showNextAsset={lightbox.next}
        lightboxIndex={lightbox.index}
      />
      <SettingsModal
        showSettings={showSettings}
        setShowSettings={setShowSettings}
        config={config}
        handleSaveConfig={handleSaveConfig}
        configLoading={configLoading}
        configSaveStatus={configSaveStatus}
        chubProfileInputRef={chubProfileInputRef}
        followedCreatorsTextareaRef={followedCreatorsTextareaRef}
        handleFetchChubFollows={handleFetchChubFollows}
        isFetchingChubFollows={isFetchingChubFollows}
        chubFollowStatus={chubFollowStatus}
        defaultSillyTavernState={defaultSillyTavernState}
        defaultCtSyncState={defaultCtSyncState}
        defaultVectorSearchState={defaultVectorSearchState}
      />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}
