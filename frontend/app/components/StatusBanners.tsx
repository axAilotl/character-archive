import { X } from "lucide-react";
import clsx from "clsx";

interface SyncStatusProps {
  syncStatus: string | null;
  ctSyncStatus: string | null;
}

export function SyncStatus({ syncStatus, ctSyncStatus }: SyncStatusProps) {
  if (!syncStatus && !ctSyncStatus) return null;
  
  return (
    <div className="flex flex-col gap-1">
      {syncStatus && (
        <p className="text-xs text-indigo-500 dark:text-indigo-300">{syncStatus}</p>
      )}
      {ctSyncStatus && (
        <p className="text-xs text-emerald-500 dark:text-emerald-300">{ctSyncStatus}</p>
      )}
    </div>
  );
}

interface PushNotificationProps {
  message: { type: "success" | "error"; message: string; cardId: string } | null;
  cardName: string | null | undefined;
  onDismiss: () => void;
}

export function PushNotification({ message, cardName, onDismiss }: PushNotificationProps) {
  if (!message) return null;

  return (
    <div
      className={clsx(
        "mx-auto mb-2 flex w-full max-w-7xl items-center justify-between gap-3 rounded-3xl border px-4 py-3 text-sm",
        message.type === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
          : "border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
      )}
    >
      <span className="font-medium">
        {message.type === "success" ? "Pushed to Silly Tavern" : "Silly Tavern push failed"}
        {" — "}
        {cardName || `Card ${message.cardId}`}:
        {" "}
        {message.message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-current/20 bg-white/70 text-current transition hover:bg-white dark:bg-slate-900/60"
        aria-label="Dismiss push message"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
