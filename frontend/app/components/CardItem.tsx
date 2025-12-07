import Image from "next/image";
import clsx from "clsx";
import {
  Archive,
  BookOpen,
  Copy,
  Download,
  Globe,
  Hash,
  Heart,
  Image as ImageIcon,
  Images,
  PenTool,
  PlugZap,
  Send,
  Sparkles,
  Star,
  Smile,
  Trash2,
} from "lucide-react";
import type { Card } from "@/lib/types";

interface CardItemProps {
  card: Card;
  index: number;
  isSelected: boolean;
  highlightedTagsSet: Set<string>;
  canPushToSilly: boolean;
  chubUrl: string | null;
  onOpenDetails: (card: Card) => void;
  onCardTextClick: (event: React.MouseEvent<HTMLDivElement>, card: Card, index: number) => void;
  onTagClick: (tag: string) => void;
  onAuthorClick: (author: string) => void;
  onToggleFavorite: (card: Card) => void;
  onDownload: (card: Card) => void;
  onPushToSilly: (card: Card) => void;
  onCopyLink: (card: Card) => void;
  onDelete: (card: Card) => void;
}

/**
 * Individual card component displaying character information and actions
 * Handles card image, metadata, tags, and action buttons
 */
export function CardItem({
  card,
  index,
  isSelected,
  highlightedTagsSet,
  canPushToSilly,
  chubUrl,
  onOpenDetails,
  onCardTextClick,
  onTagClick,
  onAuthorClick,
  onToggleFavorite,
  onDownload,
  onPushToSilly,
  onCopyLink,
  onDelete,
}: CardItemProps) {
  const authorName = (card.author || "").trim();
  const displayAuthor = authorName || "Unknown";
  const authorClickable = authorName.length > 0;

  return (
    <div
      className={clsx(
        "group flex flex-col overflow-hidden rounded-3xl border bg-white transition hover:-translate-y-1 hover:shadow-2xl dark:bg-slate-900",
        isSelected
          ? "border-indigo-500 ring-2 ring-indigo-400/50 dark:border-indigo-400"
          : "border-slate-200 dark:border-slate-800",
      )}
    >
      <div
        className="relative h-64 w-full overflow-hidden cursor-pointer"
        onClick={() => onOpenDetails(card)}
      >
        <Image
          src={card.imagePath}
          alt={card.name}
          width={420}
          height={320}
          loading="lazy"
          className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
        <div className="absolute left-4 top-4 flex items-center gap-2 text-xs font-semibold text-white">
          <span className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 backdrop-blur">
            <Star className="h-3 w-3 text-yellow-300" />
            {card.starCount || 0}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 backdrop-blur">
            <Heart className="h-3 w-3 text-red-300" />
            {card.n_favorites || 0}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 backdrop-blur">
            <Hash className="h-3 w-3 text-blue-300" />
            {card.tokenCount || 0}
          </span>
          <span
            className={clsx(
              "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur",
              card.source === "ct" ? "bg-emerald-500/80 text-white" : "bg-slate-900/40 text-white",
            )}
          >
            {card.source === "ct" ? <Globe className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
            {card.source === "ct" ? "CT" : "Chub"}
          </span>
          {card.loadedInSillyTavern && (
            <span
              className="flex items-center gap-1 rounded-full bg-emerald-500/80 px-3 py-1 backdrop-blur"
              title="Loaded in SillyTavern"
            >
              <PlugZap className="h-3 w-3 text-white" />
              ST
            </span>
          )}
          {card.syncedToArchitect && (
            <span
              className="flex items-center gap-1 rounded-full bg-violet-500/80 px-3 py-1 backdrop-blur"
              title="Synced to Character Architect"
            >
              <PenTool className="h-3 w-3 text-white" />
              CA
            </span>
          )}
        </div>
        <div className="absolute inset-0 flex flex-col items-start justify-end gap-2 p-5 text-left">
          <button
            type="button"
            disabled={!authorClickable}
            onClick={event => {
              event.stopPropagation();
              if (!authorClickable) return;
              onAuthorClick(authorName);
            }}
            className={clsx(
              "text-xs font-semibold uppercase tracking-wide",
              authorClickable
                ? "text-white/70 underline-offset-2 hover:underline"
                : "cursor-default text-white/60"
            )}
          >
            {displayAuthor}
          </button>
          <span className="text-xl font-bold text-white">{card.name}</span>
          {card.tagline && <span className="line-clamp-2 text-sm text-white/80">{card.tagline}</span>}
        </div>
      </div>

      <div
        className="flex flex-1 cursor-pointer flex-col gap-4 p-5"
        onClick={event => onCardTextClick(event, card, index)}
      >
        <div className="flex flex-wrap gap-2">
          {card.topics.slice(0, 12).map((tag, tagIndex) => (
            <button
              key={`${card.id}-${tag}-${tagIndex}`}
              onClick={event => {
                event.stopPropagation();
                onTagClick(tag);
              }}
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                highlightedTagsSet.has(tag.toLowerCase())
                  ? "bg-indigo-600 text-white shadow-md"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
              )}
            >
              {tag}
            </button>
          ))}
        </div>

        {(card.hasAlternateGreetings || card.hasLorebook || card.hasGallery || card.hasEmbeddedImages || card.hasExpressions) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {card.hasAlternateGreetings && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 font-medium text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-200">
                <Sparkles className="h-3 w-3" /> Alt greetings
              </span>
            )}
            {card.hasLorebook && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-200">
                <BookOpen className="h-3 w-3" /> Lorebook
              </span>
            )}
            {card.hasGallery && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 font-medium text-teal-600 dark:bg-teal-500/20 dark:text-teal-200">
                <Images className="h-3 w-3" /> Gallery
              </span>
            )}
            {card.hasEmbeddedImages && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 font-medium text-orange-600 dark:bg-orange-500/20 dark:text-orange-200">
                <ImageIcon className="h-3 w-3" /> Images
              </span>
            )}
            {card.hasExpressions && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-3 py-1 font-medium text-purple-600 dark:bg-purple-500/20 dark:text-purple-200">
                <Smile className="h-3 w-3" /> Expressions
              </span>
            )}
          </div>
        )}

        <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div>
            <span className="font-semibold">Updated</span>
            <p>{card.lastModified}</p>
          </div>
          <div>
            <span className="font-semibold">Language</span>
            <p>{card.language}</p>
          </div>
          <div>
            <span className="font-semibold">Visibility</span>
            <p className="capitalize">{card.visibility}</p>
          </div>
          <div>
            <span className="font-semibold">Creator</span>
            <button
              type="button"
              disabled={!authorClickable}
              onClick={event => {
                event.stopPropagation();
                if (!authorClickable) return;
                onAuthorClick(authorName);
              }}
              className={clsx(
                "ml-1 text-left",
                authorClickable
                  ? "text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300"
                  : "cursor-default text-slate-400 dark:text-slate-600"
              )}
            >
              {displayAuthor}
            </button>
          </div>
        </div>

        {card.vectorMatch?.text && (
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 text-sm text-slate-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-slate-100">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
              <Sparkles className="h-3 w-3" />
              Semantic match
              {card.vectorMatch.section && (
                <span className="text-slate-500 normal-case dark:text-slate-400">
                  {card.vectorMatch.section}
                </span>
              )}
            </div>
            <p className="line-clamp-3 whitespace-pre-line text-sm text-slate-700 dark:text-slate-100">
              {card.vectorMatch.text}
            </p>
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onToggleFavorite(card);
            }}
            aria-label={card.favorited ? "Remove favorite" : "Add favorite"}
            className={clsx(
              "inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition",
              card.favorited
                ? "border-red-200 text-red-500 dark:border-red-500/40 dark:text-red-300"
                : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:hover:border-slate-600",
            )}
          >
            {card.favorited ? <Heart className="h-4 w-4 fill-current" /> : <Heart className="h-4 w-4" />}
          </button>
          {chubUrl ? (
            <a
              href={chubUrl}
              target="_blank"
              rel="noreferrer"
              onClick={event => event.stopPropagation()}
              aria-label="Open on Chub"
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:hover:border-slate-600"
            >
              <Globe className="h-4 w-4" />
            </a>
          ) : (
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-400 opacity-40 dark:border-slate-700">
              <Globe className="h-4 w-4" />
            </span>
          )}
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onDownload(card);
            }}
            aria-label="Download PNG"
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:hover:border-slate-600"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onPushToSilly(card);
            }}
            aria-label="Push to Silly Tavern"
            disabled={!canPushToSilly}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-200 text-emerald-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:border-emerald-400"
            title={canPushToSilly ? "Push to Silly Tavern" : "Configure Silly Tavern integration in settings"}
          >
            <Send className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onCopyLink(card);
            }}
            aria-label="Copy image URL"
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:hover:border-slate-600"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onDelete(card);
            }}
            aria-label={`Delete ${card.name}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-red-200 text-red-500 transition hover:bg-red-50 dark:border-red-600/40 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
