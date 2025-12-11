'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend,
    AreaChart, Area
} from 'recharts';
import { ArrowLeft, RefreshCw, Database, Tags, TrendingUp, BarChart3, Loader2, Star, Flame } from 'lucide-react';
import { fetchMetricsStats, fetchMetricsTimeline, fetchTrendingTags, fetchTopCardsByPlatform, MetricsStats, TimelineEntry, TrendingTag, TopCardByPlatform } from '@/lib/api';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const SOURCE_COLORS: Record<string, string> = {
    chub: '#6366f1',
    ct: '#10b981',
    risuai: '#f59e0b',
    wyvern: '#8b5cf6'
};

function formatNumber(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toLocaleString();
}

function StatCard({ title, value, subtitle, icon: Icon }: { title: string; value: string | number; subtitle?: string; icon: React.ComponentType<{ className?: string }> }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{typeof value === 'number' ? formatNumber(value) : value}</p>
                    {subtitle && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
                </div>
                <div className="rounded-lg bg-indigo-50 p-2 dark:bg-indigo-900/30">
                    <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
            </div>
        </div>
    );
}

export default function MetricsPage() {
    const [stats, setStats] = useState<MetricsStats | null>(null);
    const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
    const [trendingTags, setTrendingTags] = useState<TrendingTag[]>([]);
    const [topCardsByPlatform, setTopCardsByPlatform] = useState<Record<string, TopCardByPlatform[]>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            const [statsData, timelineData, trendingData, topCardsData] = await Promise.all([
                fetchMetricsStats(),
                fetchMetricsTimeline(30),
                fetchTrendingTags(15),
                fetchTopCardsByPlatform(5)
            ]);
            setStats(statsData);
            setTimeline(timelineData);
            setTrendingTags(trendingData);
            setTopCardsByPlatform(topCardsData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load metrics');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // Prepare chart data
    const sourceData = stats ? Object.entries(stats.cardsBySource).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        fill: SOURCE_COLORS[name] || COLORS[0]
    })) : [];

    const distributionData = stats?.tokenDistribution || [];

    const topTagsData = (stats?.topTags || []).slice(0, 15);

    const featureData = stats ? [
        { name: 'Lorebook', count: stats.cardsWithLorebook, pct: Math.round((stats.cardsWithLorebook / stats.totalCards) * 100) },
        { name: 'Gallery', count: stats.cardsWithGallery, pct: Math.round((stats.cardsWithGallery / stats.totalCards) * 100) },
        { name: 'Expressions', count: stats.cardsWithExpressions, pct: Math.round((stats.cardsWithExpressions / stats.totalCards) * 100) },
        { name: 'Alt Greets', count: stats.cardsWithAlternateGreetings, pct: Math.round((stats.cardsWithAlternateGreetings / stats.totalCards) * 100) },
        { name: 'System Prompt', count: stats.cardsWithSystemPrompt, pct: Math.round((stats.cardsWithSystemPrompt / stats.totalCards) * 100) },
        { name: 'Examples', count: stats.cardsWithExampleDialogues, pct: Math.round((stats.cardsWithExampleDialogues / stats.totalCards) * 100) }
    ] : [];

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
                <div className="text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-600" />
                    <p className="mt-2 text-slate-600 dark:text-slate-400">Loading metrics...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
                <div className="text-center">
                    <p className="text-red-600 dark:text-red-400">Error: {error}</p>
                    <button onClick={loadData} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500">
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
            {/* Header */}
            <div className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="mx-auto flex max-w-7xl items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-700">
                            <ArrowLeft className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Archive Metrics</h1>
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {stats?.computedAt ? `Last computed: ${new Date(stats.computedAt).toLocaleString()}` : 'Real-time stats'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={loadData}
                        className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="mx-auto max-w-7xl space-y-6 p-4">
                {/* Overview Stats */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard title="Total Cards" value={stats?.totalCards || 0} subtitle={`+${stats?.newCardsToday || 0} today`} icon={Database} />
                    <StatCard title="Total Tokens" value={formatNumber(stats?.totalTokens || 0)} subtitle={`Avg: ${formatNumber(stats?.avgTokenCount || 0)}`} icon={BarChart3} />
                    <StatCard title="This Week" value={`+${formatNumber(stats?.newCardsThisWeek || 0)}`} subtitle="New cards" icon={TrendingUp} />
                    <StatCard title="Favorited" value={stats?.favoritedCount || 0} subtitle="Cards marked" icon={Tags} />
                </div>

                {/* Charts Row 1 */}
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Source Breakdown */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cards by Source</h2>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={sourceData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                                    >
                                        {sourceData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.fill} />
                                        ))}
                                    </Pie>
                                    <Legend />
                                    <Tooltip formatter={(value: number) => formatNumber(value)} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Token Distribution */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Token Distribution</h2>
                        <div className="h-64">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={distributionData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 12 }} />
                                    <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={formatNumber} />
                                    <Tooltip formatter={(value: number) => formatNumber(value)} />
                                    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

                {/* Timeline */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Cards Added (Last 30 Days)</h2>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={timeline}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fill: '#64748b', fontSize: 12 }}
                                    tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                />
                                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} />
                                <Tooltip
                                    labelFormatter={(d) => new Date(d).toLocaleDateString()}
                                    formatter={(value: number) => [value, 'Cards']}
                                />
                                <Area type="monotone" dataKey="count" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Trending Tags */}
                {trendingTags.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                        <div className="mb-4 flex items-center gap-2">
                            <Flame className="h-4 w-4 text-orange-500" />
                            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Trending Tags (vs Yesterday)</h2>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {trendingTags.map((tag) => (
                                <div
                                    key={tag.tag}
                                    className="flex items-center gap-1.5 rounded-full border px-3 py-1.5"
                                    style={{
                                        borderColor: tag.isNew ? '#f59e0b' : '#10b981',
                                        backgroundColor: tag.isNew ? '#fef3c720' : '#10b98110'
                                    }}
                                >
                                    <span className="text-sm text-slate-700 dark:text-slate-300">{tag.tag}</span>
                                    <span
                                        className="text-xs font-medium"
                                        style={{ color: tag.isNew ? '#f59e0b' : '#10b981' }}
                                    >
                                        {tag.isNew ? 'NEW' : `+${tag.change}`}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Top Cards Per Platform */}
                <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
                    {Object.entries(topCardsByPlatform).map(([platform, cards]) => (
                        <div key={platform} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                            <div className="mb-3 flex items-center gap-2">
                                <Star className="h-4 w-4" style={{ color: SOURCE_COLORS[platform] }} />
                                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Top {platform.charAt(0).toUpperCase() + platform.slice(1)}
                                </h2>
                            </div>
                            <div className="space-y-2">
                                {cards.map((card, idx) => (
                                    <div key={card.id} className="flex items-center gap-2">
                                        <span className="w-5 text-xs font-bold text-slate-400">{idx + 1}.</span>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{card.name}</div>
                                            <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                                {card.author} · {formatNumber(card.starCount || 0)} stars
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Charts Row 2 */}
                <div className="grid gap-6 lg:grid-cols-2">
                    {/* Top Tags */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Top Tags</h2>
                        <div className="h-80">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topTagsData} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                    <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={formatNumber} />
                                    <YAxis type="category" dataKey="tag" tick={{ fill: '#64748b', fontSize: 11 }} width={100} />
                                    <Tooltip formatter={(value: number) => formatNumber(value)} />
                                    <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Feature Adoption */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Feature Adoption</h2>
                        <div className="space-y-3">
                            {featureData.map((feature, i) => (
                                <div key={feature.name} className="flex items-center gap-3">
                                    <div className="w-24 text-sm text-slate-600 dark:text-slate-300">{feature.name}</div>
                                    <div className="flex-1">
                                        <div className="h-4 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                                            <div
                                                className="h-full rounded-full transition-all"
                                                style={{
                                                    width: `${feature.pct}%`,
                                                    backgroundColor: COLORS[i % COLORS.length]
                                                }}
                                            />
                                        </div>
                                    </div>
                                    <div className="w-16 text-right text-sm font-medium text-slate-700 dark:text-slate-300">
                                        {feature.pct}%
                                    </div>
                                    <div className="w-16 text-right text-xs text-slate-500 dark:text-slate-400">
                                        {formatNumber(feature.count)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Largest Cards Table */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                    <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Largest Cards by Token Count</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700">
                                    <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">Name</th>
                                    <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">Author</th>
                                    <th className="pb-2 text-left font-medium text-slate-500 dark:text-slate-400">Source</th>
                                    <th className="pb-2 text-right font-medium text-slate-500 dark:text-slate-400">Tokens</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(stats?.largestCards || []).map((card) => (
                                    <tr key={card.id} className="border-b border-slate-100 dark:border-slate-800">
                                        <td className="py-2 text-slate-900 dark:text-slate-100">{card.name}</td>
                                        <td className="py-2 text-slate-600 dark:text-slate-400">{card.author}</td>
                                        <td className="py-2">
                                            <span
                                                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                                                style={{
                                                    backgroundColor: `${SOURCE_COLORS[card.source] || COLORS[0]}20`,
                                                    color: SOURCE_COLORS[card.source] || COLORS[0]
                                                }}
                                            >
                                                {card.source}
                                            </span>
                                        </td>
                                        <td className="py-2 text-right font-mono text-slate-900 dark:text-slate-100">
                                            {formatNumber(card.tokenCount)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
