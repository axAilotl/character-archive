import { useState, useRef, useEffect, useCallback } from "react";
import { startSync as startSyncApi, startCtSync as startCtSyncApi } from "@/lib/api";

interface UseSyncResult {
  syncing: boolean;
  syncStatus: string | null;
  ctSyncing: boolean;
  ctSyncStatus: string | null;
  startChubSync: () => Promise<void>;
  startCtSync: () => Promise<void>;
  cancelChubSync: () => void;
  cancelCtSync: () => void;
}

/**
 * Custom hook for managing Chub and Character Tavern sync operations
 * Handles SSE streams, AbortControllers, and sync progress status
 */
export function useSync(onSyncComplete?: () => void): UseSyncResult {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [ctSyncing, setCtSyncing] = useState(false);
  const [ctSyncStatus, setCtSyncStatus] = useState<string | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);
  const ctSyncAbortRef = useRef<AbortController | null>(null);

  // Cancel Chub sync
  const cancelChubSync = useCallback(() => {
    if (syncAbortRef.current) {
      syncAbortRef.current.abort();
      syncAbortRef.current = null;
    }
  }, []);

  // Cancel CT sync
  const cancelCtSync = useCallback(() => {
    if (ctSyncAbortRef.current) {
      ctSyncAbortRef.current.abort();
      ctSyncAbortRef.current = null;
    }
  }, []);

  // Start Chub sync with SSE stream
  const startChubSync = useCallback(async () => {
    // Abort any existing sync
    cancelChubSync();

    const controller = new AbortController();
    syncAbortRef.current = controller;

    setSyncStatus(null);
    setSyncing(true);
    try {
      const stream = await startSyncApi(controller.signal);
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (chunk.startsWith("data:")) {
            const payload = JSON.parse(chunk.replace("data: ", ""));
            if (payload.error) {
              setSyncStatus(`Error: ${payload.error}`);
            } else if (payload.progress === 100) {
              setSyncStatus(`Sync complete. New cards: ${payload.newCards}`);
              // Trigger reload callback if provided
              if (onSyncComplete) {
                onSyncComplete();
              }
            } else {
              setSyncStatus(`Progress ${payload.progress ?? 0}% • ${payload.currentCard ?? ""}`);
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      reader.releaseLock();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setSyncStatus("Sync cancelled");
      } else {
        console.error(err);
        setSyncStatus(err.message || "Sync failed");
      }
    } finally {
      setSyncing(false);
      syncAbortRef.current = null;
    }
  }, [cancelChubSync, onSyncComplete]);

  // Start Character Tavern sync with SSE stream
  const startCtSync = useCallback(async () => {
    // Abort any existing CT sync
    cancelCtSync();

    const controller = new AbortController();
    ctSyncAbortRef.current = controller;

    setCtSyncStatus(null);
    setCtSyncing(true);
    try {
      const stream = await startCtSyncApi(controller.signal);
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (chunk.startsWith("data:")) {
            const payload = JSON.parse(chunk.replace("data: ", ""));
            if (payload.error) {
              setCtSyncStatus(`Error: ${payload.error}`);
            } else if (payload.progress === 100) {
              setCtSyncStatus(`CT sync complete. New cards: ${payload.newCards}`);
            } else {
              setCtSyncStatus(
                `CT sync in progress (${payload.added || payload.newCards || 0} new / ${payload.processed || 0} processed)`,
              );
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      reader.releaseLock();
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setCtSyncStatus("CT sync cancelled");
      } else {
        console.error(err);
        setCtSyncStatus(err?.message || "Unable to sync from Character Tavern");
      }
    } finally {
      setCtSyncing(false);
      ctSyncAbortRef.current = null;
    }
  }, [cancelCtSync]);

  // Cleanup on unmount - abort any running syncs
  useEffect(() => {
    return () => {
      if (syncAbortRef.current) {
        syncAbortRef.current.abort();
        syncAbortRef.current = null;
      }
      if (ctSyncAbortRef.current) {
        ctSyncAbortRef.current.abort();
        ctSyncAbortRef.current = null;
      }
    };
  }, []);

  return {
    syncing,
    syncStatus,
    ctSyncing,
    ctSyncStatus,
    startChubSync,
    startCtSync,
    cancelChubSync,
    cancelCtSync,
  };
}
