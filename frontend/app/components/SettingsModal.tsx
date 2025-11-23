'use client';

import { Fragment, type RefObject } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { X, Loader2, Save, Download } from 'lucide-react';
import clsx from 'clsx';
import type { Config } from '@/lib/types';

type MessageStatus = { type: 'success' | 'error'; message: string } | null;

type SettingsModalProps = {
    showSettings: boolean;
    setShowSettings: (show: boolean) => void;
    config: Config | null;
    handleSaveConfig: (e: React.FormEvent<HTMLFormElement>) => void;
    configLoading: boolean;
    configSaveStatus: MessageStatus;
    chubProfileInputRef: RefObject<HTMLInputElement | null>;
    followedCreatorsTextareaRef: RefObject<HTMLTextAreaElement | null>;
    handleFetchChubFollows: () => void;
    isFetchingChubFollows: boolean;
    chubFollowStatus: MessageStatus;
    defaultSillyTavernState: {
        enabled: boolean;
        baseUrl: string;
        importEndpoint: string;
        csrfToken: string;
        sessionCookie: string;
        extraHeaders: Record<string, string>;
    };
    defaultCtSyncState: {
        enabled: boolean;
        intervalMinutes: number;
        pages: number;
        hitsPerPage: number;
        minTokens: number;
        maxTokens: number;
        bannedTags: string[];
        excludedWarnings: string[];
        bearerToken: string;
        cfClearance: string;
        session: string;
        allowedWarnings: string;
    };
    defaultVectorSearchState: {
        enabled: boolean;
        cardsIndex: string;
        chunksIndex: string;
        embedModel: string;
        embedderName: string;
        ollamaUrl: string;
        semanticRatio: number;
        cardsMultiplier: number;
        maxCardHits: number;
        chunkLimit: number;
        chunkWeight: number;
        rrfK: number;
    };
};

export const SettingsModal = ({
    showSettings,
    setShowSettings,
    config,
    handleSaveConfig,
    configLoading,
    configSaveStatus,
    chubProfileInputRef,
    followedCreatorsTextareaRef,
    handleFetchChubFollows,
    isFetchingChubFollows,
    chubFollowStatus,
    defaultSillyTavernState,
    defaultCtSyncState,
    defaultVectorSearchState,
}: SettingsModalProps) => {
    return (
        <Transition.Root show={showSettings} as={Fragment}>
            <Dialog onClose={() => setShowSettings(false)} className="relative z-50">
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" aria-hidden="true" />
                </Transition.Child>

                <div className="fixed inset-0 flex items-center justify-center p-4">
                    <Transition.Child
                        as={Fragment}
                        enter="ease-out duration-300"
                        enterFrom="opacity-0 scale-95"
                        enterTo="opacity-100 scale-100"
                        leave="ease-in duration-200"
                        leaveFrom="opacity-100 scale-100"
                        leaveTo="opacity-0 scale-95"
                    >
                        <Dialog.Panel className="relative w-full max-w-[72rem] max-h-[90vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
                            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
                                <Dialog.Title className="text-xl font-bold text-slate-900 dark:text-slate-100">
                                    Settings
                                </Dialog.Title>
                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <form
                                id="settings-form"
                                onSubmit={handleSaveConfig}
                                className="overflow-y-auto max-h-[calc(90vh-8rem)] px-6 py-6"
                            >
                                <div className="space-y-6">
                                    <div className="space-y-3">
                                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            API Configuration
                                        </h3>
                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">API Key</span>
                                            <input
                                                type="text"
                                                name="apikey"
                                                defaultValue={config?.apikey || ''}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">Public Base URL</span>
                                            <input
                                                type="text"
                                                name="publicBaseUrl"
                                                defaultValue={config?.publicBaseUrl || ''}
                                                placeholder="http://localhost:6969"
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                            <span className="text-xs text-slate-400 dark:text-slate-500">
                                                Used when building absolute URLs shared with external tools (e.g. Silly Tavern).
                                            </span>
                                        </label>
                                    </div>

                                    <div className="space-y-3">
                                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Silly Tavern Integration
                                        </h3>
                                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                name="silly_enabled"
                                                defaultChecked={config?.sillyTavern?.enabled || false}
                                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
                                            />
                                            Enable push-to-Silly Tavern button
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">Silly Tavern Base URL</span>
                                            <input
                                                type="text"
                                                name="silly_baseUrl"
                                                defaultValue={config?.sillyTavern?.baseUrl || ''}
                                                placeholder="http://purrsephone.local.vega.nyc:8100"
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">Import Endpoint</span>
                                            <input
                                                type="text"
                                                name="silly_importEndpoint"
                                                defaultValue={
                                                    config?.sillyTavern?.importEndpoint || defaultSillyTavernState.importEndpoint
                                                }
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                            <span className="text-xs text-slate-400 dark:text-slate-500">
                                                Defaults to /api/content/importURL.
                                            </span>
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">CSRF Token</span>
                                            <input
                                                type="text"
                                                name="silly_csrfToken"
                                                defaultValue={config?.sillyTavern?.csrfToken || ''}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">Session Cookie</span>
                                            <input
                                                type="text"
                                                name="silly_sessionCookie"
                                                defaultValue={config?.sillyTavern?.sessionCookie || ''}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                            <span className="text-xs text-slate-400 dark:text-slate-500">
                                                Paste the full cookie header value if Silly Tavern requires authentication.
                                            </span>
                                        </label>
                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">Extra Headers (JSON)</span>
                                            <textarea
                                                name="silly_extraHeaders"
                                                defaultValue={
                                                    config?.sillyTavern?.extraHeaders
                                                        ? JSON.stringify(config.sillyTavern.extraHeaders, null, 2)
                                                        : ''
                                                }
                                                rows={3}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                            <span className="text-xs text-slate-400 dark:text-slate-500">
                                            Optional JSON map of additional headers to include with each request.
                                            </span>
                                        </label>
                                    </div>

                                    <div className="space-y-3">
                                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Vector Search
                                        </h3>
                                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                name="vector_enabled"
                                                defaultChecked={config?.vectorSearch?.enabled ?? defaultVectorSearchState.enabled}
                                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
                                            />
                                            Enable semantic + chunk search (requires Meilisearch vector indexes)
                                        </label>
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Cards index UID</span>
                                                <input
                                                    type="text"
                                                    name="vector_cardsIndex"
                                                    defaultValue={config?.vectorSearch?.cardsIndex ?? defaultVectorSearchState.cardsIndex}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Chunk index UID</span>
                                                <input
                                                    type="text"
                                                    name="vector_chunksIndex"
                                                    defaultValue={config?.vectorSearch?.chunksIndex ?? defaultVectorSearchState.chunksIndex}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Embed model</span>
                                                <input
                                                    type="text"
                                                    name="vector_embedModel"
                                                    defaultValue={config?.vectorSearch?.embedModel ?? defaultVectorSearchState.embedModel}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Meili embedder name</span>
                                                <input
                                                    type="text"
                                                    name="vector_embedderName"
                                                    defaultValue={config?.vectorSearch?.embedderName ?? defaultVectorSearchState.embedderName}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm md:col-span-2">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Ollama URL</span>
                                                <input
                                                    type="text"
                                                    name="vector_ollamaUrl"
                                                    defaultValue={config?.vectorSearch?.ollamaUrl ?? defaultVectorSearchState.ollamaUrl}
                                                    placeholder="http://127.0.0.1:11434"
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                        </div>
                                        <div className="grid gap-4 md:grid-cols-3">
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Semantic ratio</span>
                                                <input
                                                    type="number"
                                                    name="vector_semanticRatio"
                                                    min="0"
                                                    max="1"
                                                    step="0.1"
                                                    defaultValue={config?.vectorSearch?.semanticRatio ?? defaultVectorSearchState.semanticRatio}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Cards multiplier</span>
                                                <input
                                                    type="number"
                                                    name="vector_cardsMultiplier"
                                                    min="1"
                                                    step="0.5"
                                                    defaultValue={config?.vectorSearch?.cardsMultiplier ?? defaultVectorSearchState.cardsMultiplier}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Max card hits</span>
                                                <input
                                                    type="number"
                                                    name="vector_maxCardHits"
                                                    min="50"
                                                    defaultValue={config?.vectorSearch?.maxCardHits ?? defaultVectorSearchState.maxCardHits}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Chunk limit</span>
                                                <input
                                                    type="number"
                                                    name="vector_chunkLimit"
                                                    min="20"
                                                    defaultValue={config?.vectorSearch?.chunkLimit ?? defaultVectorSearchState.chunkLimit}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Chunk weight</span>
                                                <input
                                                    type="number"
                                                    name="vector_chunkWeight"
                                                    min="0"
                                                    step="0.1"
                                                    defaultValue={config?.vectorSearch?.chunkWeight ?? defaultVectorSearchState.chunkWeight}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">RRF k</span>
                                                <input
                                                    type="number"
                                                    name="vector_rrfK"
                                                    min="1"
                                                    defaultValue={config?.vectorSearch?.rrfK ?? defaultVectorSearchState.rrfK}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                        </div>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">
                                            These settings control how hybrid Meilisearch + Ollama queries are executed when advanced search is enabled.
                                        </p>
                                        <details className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-xs text-slate-600 transition dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                            <summary className="cursor-pointer font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                                                How the knobs affect results
                                            </summary>
                                            <div className="mt-3 space-y-2 leading-relaxed">
                                                <p>
                                                    <strong>Enable</strong> only after both Meili indexes (<code>cards_vsem</code> + <code>card_chunks</code>) are populated. The cards index stores one embedding per narrative section, while the chunk index stores every over-length section or alternate greeting.
                                                </p>
                                                <p>
                                                    <strong>Ollama URL &amp; Embed model</strong> must match whatever powered the backfill. Changing the model requires regenerating embeddings or results will be meaningless.
                                                </p>
                                                <p>
                                                    <strong>Cards / chunk indexes</strong> tell the API which Meili UID to query. Keep them in sync with whatever UID you swap into production (e.g. <code>cards_vsem</code> while it is staged, <code>cards</code> once you swap).
                                                </p>
                                                <p>
                                                    <strong>Semantic ratio</strong> biases Meili between lexical and vector scoring. Values around 0.3‑0.5 keep keyword intent intact; go lower for proper nouns, higher for vibes.
                                                </p>
                                                <p>
                                                    <strong>Cards multiplier</strong> controls how many lexical hits we fetch before fusing with chunk hits. If exact matches disappear, bump this toward 3‑4 so the baseline list stays deep enough.
                                                </p>
                                                <p>
                                                    <strong>Chunk limit / weight</strong> governs how many chunk-only hits are allowed to outrank lexical ones. Lower the weight if semantic snippets drown out obvious keyword matches; raise it when you want long-form alternates to drive the ranking.
                                                </p>
                                                <p>
                                                    <strong>RRF k</strong> is the denominator inside reciprocal-rank fusion. Higher values flatten the advantage of top-ranked items; leave it at 60 unless you have a reason to rebalance the curve.
                                                </p>
                                            </div>
                                        </details>
                                    </div>

                                    <div className="space-y-3">
                                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Character Tavern Sync
                                        </h3>
                                        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                name="ct_enabled"
                                                defaultChecked={config?.ctSync?.enabled || false}
                                                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600"
                                            />
                                            Enable CT sync (manual + auto)
                                        </label>
                                        <div className="grid gap-4 md:grid-cols-3">
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Interval (minutes)</span>
                                                <input
                                                    type="number"
                                                    name="ct_intervalMinutes"
                                                    min="15"
                                                    defaultValue={config?.ctSync?.intervalMinutes ?? defaultCtSyncState.intervalMinutes}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Pages</span>
                                                <input
                                                    type="number"
                                                    name="ct_pages"
                                                    min="1"
                                                    defaultValue={config?.ctSync?.pages ?? defaultCtSyncState.pages}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Hits per page</span>
                                                <input
                                                    type="number"
                                                    name="ct_hitsPerPage"
                                                    min="1"
                                                    max="49"
                                                    defaultValue={config?.ctSync?.hitsPerPage ?? defaultCtSyncState.hitsPerPage}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Min tokens</span>
                                                <input
                                                    type="number"
                                                    name="ct_minTokens"
                                                    defaultValue={config?.ctSync?.minTokens ?? defaultCtSyncState.minTokens}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Max tokens</span>
                                                <input
                                                    type="number"
                                                    name="ct_maxTokens"
                                                    defaultValue={config?.ctSync?.maxTokens ?? defaultCtSyncState.maxTokens}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm md:col-span-3">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Bearer token</span>
                                                <input
                                                    type="text"
                                                    name="ct_bearerToken"
                                                    defaultValue={config?.ctSync?.bearerToken || ''}
                                                    placeholder="Paste CT search bearer token"
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                        </div>
                                        <div className="grid gap-3 md:grid-cols-3">
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">cf_clearance cookie</span>
                                                <input
                                                    type="text"
                                                    name="ct_cfClearance"
                                                    defaultValue={config?.ctSync?.cfClearance || ''}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">session cookie</span>
                                                <input
                                                    type="text"
                                                    name="ct_session"
                                                    defaultValue={config?.ctSync?.session || ''}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                                    Allowed warnings cookie
                                                </span>
                                                <input
                                                    type="text"
                                                    name="ct_allowedWarnings"
                                                    defaultValue={config?.ctSync?.allowedWarnings || ''}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                        </div>
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Banned tags</span>
                                                <textarea
                                                    name="ct_bannedTags"
                                                    rows={2}
                                                    defaultValue={(config?.ctSync?.bannedTags || defaultCtSyncState.bannedTags).join(
                                                        ', ',
                                                    )}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                                    Cards containing any of these tags will be skipped.
                                                </span>
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Excluded warnings</span>
                                                <textarea
                                                    name="ct_excludedWarnings"
                                                    rows={2}
                                                    defaultValue={(
                                                        config?.ctSync?.excludedWarnings || defaultCtSyncState.excludedWarnings
                                                    ).join(', ')}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                                    CT cards with these content warnings are ignored.
                                                </span>
                                            </label>
                                        </div>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">
                                            Provide the CT bearer token (and optional cookies) from your browser. Auto-sync pulls the
                                            latest CT cards and de-dupes against the local archive.
                                        </p>
                                    </div>

                                    <div className="space-y-3">
                                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Auto-Update Settings
                                        </h3>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-inner transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    name="autoUpdateMode"
                                                    defaultChecked={config?.autoUpdateMode || false}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                Enable Auto-Update
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                                    Auto-Update Interval (seconds)
                                                </span>
                                                <input
                                                    type="number"
                                                    name="autoUpdateInterval"
                                                    defaultValue={config?.autoUpdateInterval || 900}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            Sync Settings
                                        </h3>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Min Tokens</span>
                                                <input
                                                    type="number"
                                                    name="min_tokens"
                                                    defaultValue={config?.min_tokens || 0}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Cards per Page</span>
                                                <input
                                                    type="number"
                                                    name="syncLimit"
                                                    defaultValue={config?.syncLimit || 20}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Page Limit</span>
                                                <input
                                                    type="number"
                                                    name="pageLimit"
                                                    defaultValue={config?.pageLimit || 10}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-2 text-sm">
                                                <span className="font-medium text-slate-700 dark:text-slate-300">Start Page</span>
                                                <input
                                                    type="number"
                                                    name="startPage"
                                                    defaultValue={config?.startPage || 1}
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </label>
                                        </div>

                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">
                                                Include Tags (comma-separated)
                                            </span>
                                            <textarea
                                                name="topic"
                                                defaultValue={config?.topic || ''}
                                                rows={3}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                        </label>

                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">
                                                Exclude Tags (comma-separated)
                                            </span>
                                            <textarea
                                                name="excludeTopic"
                                                defaultValue={config?.excludeTopic || ''}
                                                rows={3}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                        </label>

                                        <div className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">Chub Profile Name</span>
                                            <input
                                                ref={chubProfileInputRef}
                                                type="text"
                                                name="chubProfileName"
                                                defaultValue={config?.chubProfileName || ''}
                                                placeholder="e.g. honest_leg_4796"
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                                <button
                                                    type="button"
                                                    onClick={handleFetchChubFollows}
                                                    disabled={isFetchingChubFollows}
                                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-600 transition hover:border-indigo-300 hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-100"
                                                >
                                                    {isFetchingChubFollows ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Download className="h-4 w-4" />
                                                    )}
                                                    {isFetchingChubFollows ? 'Fetching...' : 'Load Followed Creators'}
                                                </button>
                                                {chubFollowStatus && (
                                                    <span
                                                        className={clsx(
                                                            'text-xs font-medium',
                                                            chubFollowStatus.type === 'success'
                                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                                : 'text-red-600 dark:text-red-400',
                                                        )}
                                                    >
                                                        {chubFollowStatus.message}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <label className="flex flex-col gap-2 text-sm">
                                            <span className="font-medium text-slate-700 dark:text-slate-300">
                                                Followed Creators (comma-separated)
                                            </span>
                                            <textarea
                                                ref={followedCreatorsTextareaRef}
                                                name="followedCreators"
                                                defaultValue={config?.followedCreators?.join(', ') || ''}
                                                rows={3}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                            />
                                        </label>

                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-inner transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    name="cycle_topics"
                                                    defaultChecked={config?.cycle_topics || false}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                Cycle Topics
                                            </label>
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-inner transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    name="followedCreatorsOnly"
                                                    defaultChecked={config?.followedCreatorsOnly || false}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                Followed Creators Only
                                            </label>
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-inner transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    name="syncFollowedCreators"
                                                    defaultChecked={config?.syncFollowedCreators || false}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                Sync Followed Creators
                                            </label>
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-inner transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    name="syncTagsMode"
                                                    defaultChecked={config?.syncTagsMode || false}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                Sync Tags Mode
                                            </label>
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-inner transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    name="backupMode"
                                                    defaultChecked={config?.backupMode || false}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                Backup Mode
                                            </label>
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-inner transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    name="use_timeline"
                                                    defaultChecked={config?.use_timeline || false}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                Use Timeline
                                            </label>
                                            <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-inner transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-200">
                                                <input
                                                    type="checkbox"
                                                    name="syncByNew"
                                                    defaultChecked={config?.syncByNew || false}
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                Sync By New (Created Date)
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </form>

                            <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
                                {configSaveStatus && (
                                    <div
                                        className={clsx(
                                            'rounded-2xl border px-4 py-3 text-sm transition-opacity duration-300',
                                            configSaveStatus.type === 'success'
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100'
                                                : 'border-red-200 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100',
                                        )}
                                    >
                                        {configSaveStatus.message}
                                    </div>
                                )}
                                <div className="flex items-center justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowSettings(false)}
                                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                    >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    form="settings-form"
                                    disabled={configLoading}
                                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-500 disabled:bg-indigo-400"
                                >
                                        {configLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                        Save Settings
                                    </button>
                                </div>
                            </div>
                        </Dialog.Panel>
                    </Transition.Child>
                </div>
            </Dialog>
        </Transition.Root>
    );
};
