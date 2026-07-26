import { useState } from "react";
import { Filter, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/Modal";
import { t, type PlainKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { useSettings } from "@/store/useSettings";
import { applyPrune, planPrune, type PrunePlan } from "./extract";
import { glossaryName } from "./store";
import type { Glossary, TermStrictness } from "@/types";

const LEVELS: { value: TermStrictness; labelKey: PlainKey; hintKey: PlainKey }[] = [
  { value: "standard", labelKey: "prune.standard", hintKey: "prune.standardHint" },
  { value: "strict", labelKey: "prune.strict", hintKey: "prune.strictHint" },
];

/**
 * Review and remove the auto-extracted entries of a glossary that no longer meet
 * a chosen strictness. The plan is shown before anything is deleted — the model
 * decides what to propose, the user decides what actually goes.
 */
export function PruneDialog({ glossary, onClose }: { glossary: Glossary; onClose: () => void }) {
  const settings = useSettings();
  const [level, setLevel] = useState<TermStrictness>(
    settings.termStrictness === "loose" ? "standard" : settings.termStrictness,
  );
  const [plan, setPlan] = useState<PrunePlan | null>(null);
  const [spared, setSpared] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<number | null>(null);

  const doomed = plan?.doomed.filter((t) => !spared.has(t.id)) ?? [];

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setPlan(await planPrune(glossary.id, level));
      setSpared(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await applyPrune(doomed.map((t) => t.id));
      setRemoved(doomed.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("prune.title", { name: glossaryName(glossary) })}
      footer={
        removed !== null ? (
          <button className={cn(styles.button, styles.press)} onClick={onClose}>
            {t("prune.done")}
          </button>
        ) : (
          <>
            <button className={cn(styles.buttonGhost, styles.press)} onClick={onClose}>
              {t("common.cancel")}
            </button>
            {plan && plan.doomed.length > 0 ? (
              <button
                className={cn(styles.button, styles.press, "bg-red-500 hover:bg-red-600")}
                onClick={remove}
                disabled={busy || doomed.length === 0}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("prune.removeN", { count: doomed.length })}
              </button>
            ) : (
              <button className={cn(styles.button, styles.press)} onClick={check} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {plan ? t("prune.recheck") : t("prune.check")}
              </button>
            )}
          </>
        )
      }
    >
      {removed !== null ? (
        <p className="text-sm text-text-2">
          {t("prune.removed", { removed, kept: plan ? plan.reviewed - removed : 0 })}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 rounded-control bg-surface-2 p-3 text-sm text-text-2">
            <Filter className="mt-0.5 size-4 shrink-0 text-accent" />
            <p>{t("prune.intro")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium">{t("prune.levelTitle")}</div>
            {LEVELS.map((l) => (
              <button
                key={l.value}
                onClick={() => setLevel(l.value)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-control border p-3 text-left transition-colors",
                  level === l.value
                    ? "border-accent bg-accent-soft"
                    : "border-border-subtle hover:bg-surface-2",
                )}
              >
                <span className={cn("text-sm font-medium", level === l.value && "text-accent")}>
                  {t(l.labelKey)}
                  {l.value === settings.termStrictness && (
                    <span className="ml-2 text-xs font-normal text-text-3">{t("prune.currentSetting")}</span>
                  )}
                </span>
                <span className={styles.muted}>{t(l.hintKey)}</span>
              </button>
            ))}
          </div>

          {error && <p className="text-sm text-red-500">{t("prune.failed", { error })}</p>}

          {plan && !error && <PlanResult plan={plan} spared={spared} onToggle={setSpared} />}
        </div>
      )}
    </Modal>
  );
}

function PlanResult({
  plan,
  spared,
  onToggle,
}: {
  plan: PrunePlan;
  spared: Set<string>;
  onToggle: (next: Set<string>) => void;
}) {
  if (plan.reviewed < 2) {
    return <Note>{t("prune.noAuto")}</Note>;
  }
  if (plan.failed === plan.batches) {
    return (
      <Note warn>{t("prune.modelFailed")}</Note>
    );
  }
  if (!plan.doomed.length) {
    return <Note>{t("prune.allKept", { count: plan.reviewed })}</Note>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">
          {t("prune.suggest", { doomed: plan.doomed.length, reviewed: plan.reviewed })}
        </span>
        <span className={styles.muted}>{t("prune.uncheckToKeep")}</span>
      </div>
      {plan.failed > 0 && (
        <Note warn>{t("prune.batchesFailed", { count: plan.failed })}</Note>
      )}
      <div className="flex max-h-64 flex-col divide-y divide-border-subtle overflow-y-auto rounded-control border border-border-subtle pretty-scrollbar">
        {plan.doomed.map((term) => (
          <label key={term.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--accent)]"
              checked={!spared.has(term.id)}
              onChange={(e) => {
                const next = new Set(spared);
                if (e.target.checked) next.delete(term.id);
                else next.add(term.id);
                onToggle(next);
              }}
            />
            <span className="min-w-0 flex-1 truncate text-sm">{term.source}</span>
            <span className="text-text-3">→</span>
            <span className="min-w-0 flex-1 truncate text-sm text-text-2">{term.target}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Note({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <p className={cn("flex gap-2 text-sm", warn ? "text-amber-600 dark:text-amber-500" : styles.muted)}>
      {warn && <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
      {children}
    </p>
  );
}
