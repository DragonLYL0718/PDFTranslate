import { useState } from "react";
import { Check, Copy, Highlighter, MessageSquareText, Sparkles } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import type { PageSelection } from "./useTextSelection";

interface Props {
  selection: PageSelection;
  onAsk: () => void;
  onExplain: () => void;
  onHighlight: () => void;
  onDone: () => void;
}

/** Floating actions for text selected on a page. */
export function SelectionBubble({ selection, onAsk, onExplain, onHighlight, onDone }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(selection.text);
    setCopied(true);
    setTimeout(onDone, 700);
  }

  return (
    <div
      // Above the fullscreen shell (z-50), which the bubble has to survive.
      className={cn(styles.card, "fixed z-60 flex items-center gap-0.5 p-1")}
      style={{
        left: Math.min(Math.max(selection.anchor.x, 130), window.innerWidth - 130),
        top: Math.max(selection.anchor.y - 46, 8),
        transform: "translateX(-50%)",
      }}
      // Keep the selection alive: a mousedown here would collapse it.
      onMouseDown={(e) => e.preventDefault()}
    >
      <Action icon={<MessageSquareText className="size-3.5" />} label={t("chat.selection.ask")} onClick={onAsk} />
      <Action icon={<Sparkles className="size-3.5" />} label={t("chat.selection.explain")} onClick={onExplain} />
      <Action icon={<Highlighter className="size-3.5" />} label={t("chat.selection.highlight")} onClick={onHighlight} />
      <Action
        icon={copied ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
        label={t("chat.selection.copy")}
        onClick={copy}
      />
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 whitespace-nowrap rounded-control px-2 py-1 text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1"
    >
      {icon}
      {label}
    </button>
  );
}
