import { useState } from "react";
import { Languages, Loader2, Plus, Trash2 } from "lucide-react";
import { detectLocale, detectedTag, getLocale, setLocale, t } from "@/i18n";
import {
  deleteCustomLocale,
  listCustomLocales,
  readCustomMessages,
  saveCustomLocale,
  type CustomLocaleMeta,
} from "@/i18n/customStore";
import { generateLocale, missingKeys, pickProvider } from "@/i18n/generate";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { GenerateLocaleDialog } from "./GenerateLocaleDialog";

/** Endonyms: a language is always listed in its own name, whatever the UI language is. */
const BUILT_IN = [
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
];

const DISMISS_KEY = "i18n.suggestDismissed";

/** The browser's language when it's neither zh nor en, and we haven't offered yet. */
function suggestion(): string | null {
  const tag = detectedTag();
  if (!tag || detectLocale() === "zh") return null;
  if (/^(zh|en)/i.test(tag)) return null;
  try {
    if (localStorage.getItem(DISMISS_KEY)) return null;
  } catch {
    return null;
  }
  // Name it in the user's own language when the browser can; the tag otherwise.
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function LanguageSection() {
  // Switching remounts the tree (see src/i18n), so a plain read is enough here.
  const current = getLocale();
  const [customs, setCustoms] = useState<CustomLocaleMeta[]>(listCustomLocales);
  const [generating, setGenerating] = useState<string | null>(null);
  const [toppingUp, setToppingUp] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [suggested, setSuggested] = useState(suggestion);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setSuggested(null);
  }

  function remove(meta: CustomLocaleMeta) {
    if (!confirm(t("locale.deleteConfirm", { name: meta.endonym }))) return;
    deleteCustomLocale(meta.id);
    setCustoms(listCustomLocales());
    if (current === `custom:${meta.id}`) setLocale(detectLocale());
  }

  /** Translate only the keys added since this locale was generated. */
  async function topUp(meta: CustomLocaleMeta) {
    const messages = readCustomMessages(meta.id);
    if (!messages) return;
    setToppingUp(meta.id);
    setNote(null);
    try {
      const provider = await pickProvider();
      const result = await generateLocale(
        provider,
        { tag: meta.tag, dir: meta.dir, endonym: meta.endonym },
        { keys: missingKeys(messages) },
      );
      const merged = { ...messages, ...result.messages };
      saveCustomLocale({ ...meta, count: Object.keys(merged).length }, merged);
      setCustoms(listCustomLocales());
      setNote(t("locale.toppedUp", { ok: result.ok }));
      if (current === `custom:${meta.id}`) setLocale(current); // re-resolve the catalog
    } catch (e) {
      setNote(t("locale.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setToppingUp(null);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className={styles.sectionHeading}>{t("settings.language.title")}</h2>
      <div className={cn(styles.card, "flex flex-col gap-3 p-4")}>
        <p className={styles.muted}>{t("settings.language.desc")}</p>

        <div className="flex flex-wrap items-center gap-2">
          {BUILT_IN.map((l) => (
            <LocaleChip
              key={l.id}
              label={l.label}
              active={current === l.id}
              onClick={() => setLocale(l.id)}
            />
          ))}
          {customs.map((meta) => {
            // Keys added by an app update since this locale was generated.
            const gaps = missingKeys(readCustomMessages(meta.id) ?? {});
            return (
              <span key={meta.id} className="flex items-center gap-1">
                <LocaleChip
                  label={meta.endonym}
                  active={current === `custom:${meta.id}`}
                  onClick={() => setLocale(`custom:${meta.id}`)}
                />
                {gaps.length > 0 && (
                  <button
                    className={cn(
                      styles.press,
                      "rounded-control px-2 py-1 text-xs text-amber-500 hover:bg-surface-2",
                    )}
                    onClick={() => topUp(meta)}
                    disabled={toppingUp !== null}
                  >
                    {toppingUp === meta.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      t("locale.topUp", { count: gaps.length })
                    )}
                  </button>
                )}
                <button
                  className="rounded-control p-1.5 text-text-3 hover:bg-surface-2 hover:text-red-500"
                  onClick={() => remove(meta)}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            );
          })}
          <button
            className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-sm")}
            onClick={() => setGenerating("")}
          >
            <Plus className="size-4" /> {t("locale.generate")}
          </button>
        </div>

        {note && <p className="text-xs text-text-3">{note}</p>}

        {suggested && (
          <div className="flex flex-wrap items-center gap-2 rounded-control bg-accent-soft p-3 text-sm">
            <Languages className="size-4 shrink-0 text-accent" />
            <span className="flex-1 text-text-2">
              {t("locale.detectedHint", { name: suggested })}
            </span>
            <button
              className={cn(styles.button, styles.press, "px-3 py-1.5 text-xs")}
              onClick={() => setGenerating(suggested)}
            >
              {t("locale.detectedGenerate", { name: suggested })}
            </button>
            <button
              className={cn(styles.buttonGhost, styles.press, "px-3 py-1.5 text-xs")}
              onClick={dismiss}
            >
              {t("locale.dismiss")}
            </button>
          </div>
        )}
      </div>

      {generating !== null && (
        <GenerateLocaleDialog
          initial={generating}
          onClose={() => {
            setGenerating(null);
            setCustoms(listCustomLocales());
          }}
        />
      )}
    </section>
  );
}

function LocaleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        styles.press,
        "rounded-control border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-accent bg-accent text-white"
          : "border-border-subtle text-text-2 hover:bg-surface-2 hover:text-text-1",
      )}
    >
      {label}
    </button>
  );
}
