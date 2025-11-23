import { useState, useCallback, useEffect } from "react";
import type { GalleryAsset } from "@/lib/types";

interface UseLightboxResult {
  index: number | null;
  asset: GalleryAsset | null;
  open: (index: number) => void;
  close: () => void;
  prev: () => void;
  next: () => void;
}

/**
 * Custom hook for managing lightbox/gallery viewer state
 * Handles keyboard navigation (Escape, Arrow keys) and gallery bounds checking
 */
export function useLightbox(assets: GalleryAsset[], cardId?: string | number): UseLightboxResult {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const openLightbox = useCallback(
    (index: number) => {
      if (index >= 0 && index < assets.length) {
        setLightboxIndex(index);
      }
    },
    [assets.length],
  );

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const showPrevAsset = useCallback(() => {
    setLightboxIndex(prev => {
      if (prev === null || assets.length === 0) return prev;
      const nextIndex = (prev - 1 + assets.length) % assets.length;
      return nextIndex;
    });
  }, [assets.length]);

  const showNextAsset = useCallback(() => {
    setLightboxIndex(prev => {
      if (prev === null || assets.length === 0) return prev;
      const nextIndex = (prev + 1) % assets.length;
      return nextIndex;
    });
  }, [assets.length]);

  // Handle gallery changes - close lightbox if gallery becomes empty or index out of bounds
  useEffect(() => {
    if (lightboxIndex !== null && assets.length === 0) {
      setLightboxIndex(null);
    } else if (lightboxIndex !== null && lightboxIndex >= assets.length) {
      setLightboxIndex(assets.length > 0 ? assets.length - 1 : null);
    }
  }, [assets.length, lightboxIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeLightbox();
      } else if (event.key === "ArrowRight") {
        showNextAsset();
      } else if (event.key === "ArrowLeft") {
        showPrevAsset();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightboxIndex, closeLightbox, showNextAsset, showPrevAsset]);

  // Reset lightbox when card changes
  useEffect(() => {
    setLightboxIndex(null);
  }, [cardId]);

  const activeLightboxAsset = lightboxIndex !== null ? assets[lightboxIndex] : null;

  return {
    index: lightboxIndex,
    asset: activeLightboxAsset,
    open: openLightbox,
    close: closeLightbox,
    prev: showPrevAsset,
    next: showNextAsset,
  };
}
