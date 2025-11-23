import { useState, useCallback } from "react";
import type { Card } from "@/lib/types";

interface UseCardSelectionResult {
  selectedIds: string[];
  lastSelectedIndex: number | null;
  isSelected: (cardId: string) => boolean;
  toggleSelection: (card: Card, index: number, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, cards: Card[]) => void;
  selectAll: (cards: Card[]) => void;
  clearSelection: () => void;
  setSelectedIds: (ids: string[] | ((prev: string[]) => string[])) => void;
}

/**
 * Custom hook for managing card selection state
 * Handles single-click, Ctrl+click, Shift+click, and Ctrl+Shift+click selection modes
 */
export function useCardSelection(): UseCardSelectionResult {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  const isSelected = useCallback((cardId: string) => selectedIds.includes(cardId), [selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
    setLastSelectedIndex(null);
  }, []);

  const selectAll = useCallback((cards: Card[]) => {
    const allIds = cards.map(card => card.id);
    setSelectedIds(allIds);
    setLastSelectedIndex(allIds.length ? cards.length - 1 : null);
  }, []);

  const toggleSelection = useCallback(
    (card: Card, index: number, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, cards: Card[]) => {
      const { shiftKey, ctrlKey, metaKey } = event;
      const alreadyExclusiveSelection = selectedIds.length === 1 && selectedIds[0] === card.id;

      if (shiftKey) {
        // Shift+click: range selection
        const anchor = lastSelectedIndex ?? index;
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        const rangeIds = cards.slice(start, end + 1).map(c => c.id);

        if (ctrlKey || metaKey) {
          // Ctrl+Shift+click: add range to existing selection
          setSelectedIds(prev => Array.from(new Set([...prev, ...rangeIds])));
        } else {
          // Shift+click: replace selection with range
          setSelectedIds(rangeIds);
        }
        setLastSelectedIndex(index);
        return;
      }

      if (ctrlKey || metaKey) {
        // Ctrl+click: toggle individual card
        setSelectedIds(prev => (prev.includes(card.id) ? prev.filter(id => id !== card.id) : [...prev, card.id]));
        setLastSelectedIndex(index);
        return;
      }

      // Regular click: select single card (or clear if already exclusively selected)
      if (alreadyExclusiveSelection) {
        clearSelection();
      } else {
        setSelectedIds([card.id]);
        setLastSelectedIndex(index);
      }
    },
    [selectedIds, lastSelectedIndex, clearSelection],
  );

  return {
    selectedIds,
    lastSelectedIndex,
    isSelected,
    toggleSelection,
    selectAll,
    clearSelection,
    setSelectedIds,
  };
}
