import { useState, useCallback } from 'react';
import {
  fetchFederationPlatforms,
  updateFederationPlatform,
  testPlatformConnection,
  fetchCardSyncState,
  pushCardToPlatform,
  bulkPushToPlatform,
} from '@/lib/api';
import type { FederationPlatform, SyncState, ConnectionTestResult, PushResult } from '@/lib/types';

interface PushStatus {
  cardId: string;
  platform: string;
  status: 'pending' | 'success' | 'error';
  message?: string;
}

interface UseFederationResult {
  platforms: FederationPlatform[];
  loading: boolean;
  error: string | null;

  // Actions
  loadPlatforms: () => Promise<void>;
  updatePlatform: (platform: string, config: { base_url?: string; api_key?: string; enabled?: boolean }) => Promise<void>;
  testConnection: (platform: string) => Promise<ConnectionTestResult>;

  // Card sync
  getCardSyncState: (cardId: string) => Promise<SyncState[]>;
  pushCard: (cardId: string, platform: string, overwrite?: boolean) => Promise<PushResult>;
  bulkPush: (cardIds: string[], platform: string, overwrite?: boolean) => Promise<void>;

  // Status
  connectionStatus: Record<string, ConnectionTestResult>;
  pushStatus: PushStatus | null;
  clearPushStatus: () => void;
}

export function useFederation(): UseFederationResult {
  const [platforms, setPlatforms] = useState<FederationPlatform[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionTestResult>>({});
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);

  const loadPlatforms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { platforms: loaded } = await fetchFederationPlatforms();
      setPlatforms(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platforms');
    } finally {
      setLoading(false);
    }
  }, []);

  const updatePlatform = useCallback(async (
    platform: string,
    config: { base_url?: string; api_key?: string; enabled?: boolean }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const { platform: updated } = await updateFederationPlatform(platform, config);
      setPlatforms(prev => prev.map(p => p.platform === platform ? updated : p));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update platform');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const testConnection = useCallback(async (platform: string): Promise<ConnectionTestResult> => {
    const result = await testPlatformConnection(platform);
    setConnectionStatus(prev => ({ ...prev, [platform]: result }));
    return result;
  }, []);

  const getCardSyncState = useCallback(async (cardId: string): Promise<SyncState[]> => {
    const { syncStates } = await fetchCardSyncState(cardId);
    return syncStates;
  }, []);

  const pushCard = useCallback(async (
    cardId: string,
    platform: string,
    overwrite: boolean = false
  ): Promise<PushResult> => {
    setPushStatus({ cardId, platform, status: 'pending' });
    try {
      const result = await pushCardToPlatform(cardId, platform, overwrite);
      setPushStatus({ cardId, platform, status: 'success', message: result.filename || result.remoteId });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Push failed';
      setPushStatus({ cardId, platform, status: 'error', message });
      throw err;
    }
  }, []);

  const bulkPush = useCallback(async (
    cardIds: string[],
    platform: string,
    overwrite: boolean = false
  ) => {
    setLoading(true);
    try {
      await bulkPushToPlatform(cardIds, platform, overwrite);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearPushStatus = useCallback(() => {
    setPushStatus(null);
  }, []);

  return {
    platforms,
    loading,
    error,
    loadPlatforms,
    updatePlatform,
    testConnection,
    getCardSyncState,
    pushCard,
    bulkPush,
    connectionStatus,
    pushStatus,
    clearPushStatus,
  };
}
