import { useEffect, useRef } from "react";
import { Check, Trash2 } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import type { ChatSession } from "@/types";

interface Props {
  sessions: ChatSession[];
  activeId: string | null;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** Day and time is enough — these are all from one document's reading sessions. */
function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Past conversations about this document, most recent first. */
export function SessionMenu({ sessions, activeId, onPick, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Same outside-click dismissal as the prompt settings popover.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={cn(styles.card, "absolute right-0 top-full z-20 mt-1 w-72 overflow-hidden p-1")}
    >
      <div className="px-2 py-1.5 text-xs font-medium text-text-3">{t("chat.history")}</div>
      {!sessions.length && (
        <p className="px-2 py-3 text-center text-xs text-text-3">{t("chat.noSessions")}</p>
      )}
      <div className="max-h-72 overflow-y-auto pretty-scrollbar">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="group flex items-center gap-1 rounded-control px-1 hover:bg-surface-2"
          >
            <button
              onClick={() => onPick(s.id)}
              className="min-w-0 flex-1 px-1 py-1.5 text-left"
              title={s.title || t("chat.sessionUntitled")}
            >
              <div className="flex items-center gap-1">
                {s.id === activeId && <Check className="size-3 shrink-0 text-accent" />}
                <span className="truncate text-xs text-text-1">
                  {s.title || t("chat.sessionUntitled")}
                </span>
              </div>
              <span className="text-[0.65rem] text-text-3">{when(s.updatedAt)}</span>
            </button>
            <button
              onClick={() => onDelete(s.id)}
              className="rounded p-1 text-text-3 opacity-0 hover:bg-surface-3 group-hover:opacity-100"
              title={t("chat.deleteSession")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
