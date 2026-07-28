/**
 * Shared Tailwind class recipes (ported from rayleigh-lin.top).
 * Compose into className via the `cn` helper.
 */
export const styles = {
  pageTitle: "text-3xl font-semibold tracking-tight text-text-1",
  sectionHeading: "text-xl font-bold tracking-tight text-text-1",
  kicker:
    "text-xs font-mono font-medium uppercase tracking-widest text-accent",
  muted: "text-sm text-text-3",

  card: "bg-surface-1 border border-border-subtle rounded-card shadow-card",
  cardHover:
    "transition-[box-shadow,border-color,transform] duration-300 hover:shadow-card-hover hover:border-border-strong",
  cardPress: "motion-safe:active:scale-[0.99]",

  chip: "inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-1 px-3 py-1 text-xs font-medium text-text-2",

  press: "motion-safe:active:scale-95 active:duration-75",
  button:
    "inline-flex items-center justify-center gap-2 rounded-control bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-strong disabled:opacity-50 disabled:pointer-events-none",
  buttonGhost:
    "inline-flex items-center justify-center gap-2 rounded-control border border-border-subtle bg-surface-1 px-4 py-2 text-sm text-text-1 transition-colors hover:bg-surface-2 hover:border-border-strong disabled:opacity-50 disabled:pointer-events-none",

  input:
    "w-full rounded-control border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-text-1 outline-none transition-colors focus:border-accent placeholder:text-text-3",

  // Height is set imperatively by auto-grow callers, so no resize handle.
  textarea:
    "w-full resize-none rounded-control border border-border-subtle bg-surface-1 px-3 py-2 text-sm leading-relaxed text-text-1 outline-none transition-colors focus:border-accent placeholder:text-text-3 pretty-scrollbar",

  kbd: "font-mono text-xs text-text-3 bg-surface-2 border border-border-subtle rounded px-1 py-0.5",
} as const;
