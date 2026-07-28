import { useEffect, useRef, useState } from "react";
import type { Bbox } from "@/types";

export interface PageSelection {
  text: string;
  pageNumber: number;
  /** Which pane the text came from: the source canvas or the translation overlay. */
  side: "source" | "target";
  /** In PDF points, top-left origin — the same convention as TextBlock.bbox. */
  bbox: Bbox;
  /** Where to float the action bubble, in viewport coordinates. */
  anchor: { x: number; y: number };
  /** Engine A translations only: the block the selection landed in. */
  blockId?: string;
}

/** Nearest ancestor matching `selector`, starting from a possibly-text node. */
function closestOf(node: Node | null, selector: string): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement;
  return el?.closest<HTMLElement>(selector) ?? null;
}

/**
 * Reports a selection made inside a rendered page, with geometry mapped back to
 * PDF points so it can be quoted in the chat or stored as an annotation.
 *
 * `scale` has to be passed in rather than read off the DOM: the pixel rects are
 * only meaningful divided by the zoom that produced them.
 */
export function useTextSelection(
  root: React.RefObject<HTMLElement | null>,
  scale: number,
): { selection: PageSelection | null; clear: () => void } {
  const [selection, setSelection] = useState<PageSelection | null>(null);
  /** The page the current bubble is anchored to, for the scroll check below. */
  const pageElRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const scope = container;

    function read() {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || text.length < 2) {
        setSelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const pageEl = closestOf(range.commonAncestorContainer, "[data-page]");
      if (!pageEl || !scope.contains(pageEl)) {
        setSelection(null);
        return;
      }

      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) {
        setSelection(null);
        return;
      }
      const page = pageEl.getBoundingClientRect();
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));

      pageElRef.current = pageEl;
      setSelection({
        text,
        pageNumber: Number(pageEl.dataset.page),
        side: pageEl.dataset.side === "target" ? "target" : "source",
        bbox: {
          x: (left - page.left) / scale,
          y: (top - page.top) / scale,
          w: (right - left) / scale,
          h: (bottom - top) / scale,
        },
        anchor: { x: (left + right) / 2, y: top },
        blockId: closestOf(range.commonAncestorContainer, "[data-block]")?.dataset.block,
      });
    }

    // `selectionchange` fires continuously mid-drag, so settle on release.
    const onUp = () => window.setTimeout(read, 0);
    const onDown = () => setSelection(null);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    container.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
      container.removeEventListener("mousedown", onDown);
    };
  }, [root, scale]);

  // A scroll moves the page out from under a viewport-anchored bubble — but only
  // if it was the page that scrolled. This listener is in the capture phase and
  // so sees every scroller on the screen, including the chat panel's message
  // list: attaching the selection as a quote grows the composer, which clamps a
  // bottom-pinned list, which used to dismiss the bubble the instant it appeared.
  useEffect(() => {
    if (!selection) return;
    const onScroll = (e: Event) => {
      const scroller = e.target instanceof Element ? e.target : document.documentElement;
      if (!scroller.contains(pageElRef.current)) return;
      setSelection(null);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [selection]);

  return {
    selection,
    clear: () => {
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    },
  };
}
