"use client";

import type { EscrowLifecycleNotification } from "@/src/hooks/useEscrowLifecycleNotifications";

function formatLocalTime(occurredAt: string): string {
  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) {
    return occurredAt;
  }
  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function EscrowNotificationList({
  notifications,
}: {
  notifications: EscrowLifecycleNotification[];
}) {
  return (
    <section aria-labelledby="escrow-notification-heading">
      <h2 id="escrow-notification-heading" className="sr-only">
        Escrow notifications
      </h2>
      <div aria-live="polite" aria-relevant="additions" role="log">
        {notifications.length === 0 ? null : (
          <ul className="mb-6 space-y-3">
            {notifications.map((notice) => (
              <li
                key={notice.id}
                className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 px-4 py-3"
              >
                <p className="text-sm font-semibold text-emerald-200">
                  Escrow {notice.escrowId}
                </p>
                <p className="mt-1 text-sm text-white">{notice.label}</p>
                <time
                  className="mt-1 block text-xs text-zinc-400"
                  dateTime={notice.occurredAt}
                >
                  {formatLocalTime(notice.occurredAt)}
                </time>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">
                  {notice.message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
