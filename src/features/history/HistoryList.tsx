import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router-dom";
import { FileText, Trash2, Loader2, CircleAlert, CheckCircle2 } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { styles } from "@/lib/styles";
import { db, deleteDocument } from "@/db/db";
import { langName } from "@/features/import/languages";
import type { DocRecord } from "@/types";

export function HistoryList() {
  const docs = useLiveQuery(() => db.documents.orderBy("createdAt").reverse().toArray(), [], []);

  if (docs && docs.length === 0) {
    return (
      <div className={cn(styles.card, "p-8 text-center")}>
        <p className={styles.muted}>{t("history.empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {docs?.map((doc) => (
        <DocCard key={doc.id} doc={doc} />
      ))}
    </div>
  );
}

function DocCard({ doc }: { doc: DocRecord }) {
  return (
    <div className={cn(styles.card, styles.cardHover, "flex items-center gap-4 p-4")}>
      <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
        <FileText className="size-5" />
      </span>

      <Link to={`/reader/${doc.id}`} className="min-w-0 flex-1">
        <div className="truncate font-medium">{doc.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
          <span>{langName(doc.detectedLang ?? doc.sourceLang)} → {langName(doc.targetLang)}</span>
          <span>
            {doc.selectedPages
              ? t("history.pagesSelected", { count: doc.pageCount, selected: doc.selectedPages.length })
              : t("history.pages", { count: doc.pageCount })}
          </span>
          <span>{new Date(doc.createdAt).toLocaleString()}</span>
        </div>
      </Link>

      <StatusBadge doc={doc} />

      <button
        onClick={() => deleteDocument(doc.id)}
        className="rounded-control p-2 text-text-3 transition-colors hover:bg-surface-2 hover:text-red-500"
        aria-label={t("common.delete")}
        title={t("common.delete")}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function StatusBadge({ doc }: { doc: DocRecord }) {
  if (doc.status === "translating") {
    return (
      <span className={cn(styles.chip, "text-accent")}>
        <Loader2 className="size-3.5 animate-spin" />
        {Math.round(doc.progress * 100)}%
      </span>
    );
  }
  if (doc.status === "translated") {
    return (
      <span className={styles.chip}>
        <CheckCircle2 className="size-3.5 text-accent" /> {t("history.done")}
      </span>
    );
  }
  if (doc.status === "error") {
    return (
      <span className={cn(styles.chip, "text-red-500")} title={doc.error}>
        <CircleAlert className="size-3.5" /> {t("history.failed")}
      </span>
    );
  }
  return <span className={styles.chip}>{t("history.pending")}</span>;
}
