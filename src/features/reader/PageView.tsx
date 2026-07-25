import { useEffect, useLayoutEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "@/features/pdf/pdf";
import type { DocPage, TextBlock } from "@/types";

interface Props {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  page?: DocPage;
  scale: number;
  /** When true, cover original text and overlay the translation. */
  translated: boolean;
}

/** One rendered page: original canvas, optionally with translated text overlaid at original positions. */
export function PageView({ pdf, pageNumber, page, scale, translated }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPage(pdf, pageNumber, scale, canvas).then((size) => {
      if (!cancelled) sizeRef.current = size;
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, scale]);

  const hasTranslation = translated && page && Object.keys(page.translations).length > 0;

  return (
    <div className="relative bg-white shadow-card" style={{ lineHeight: 0 }}>
      <canvas ref={canvasRef} />
      {hasTranslation &&
        page!.blocks.map((b) => {
          const text = page!.translations[b.id];
          if (!text) return null;
          return <OverlayBlock key={b.id} block={b} text={text} scale={scale} />;
        })}
    </div>
  );
}

function OverlayBlock({ block, text, scale }: { block: TextBlock; text: string; scale: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { x, y, w, h } = block.bbox;

  // Shrink font until the translation fits the original block box; if it
  // still doesn't fit at a readable minimum, grow the box instead of
  // clipping — a translated CJK paragraph often needs more room than the
  // original (denser scripts, longer expansions), and silently clipped/
  // shrunk-to-illegible text reads as "the translation is just missing".
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = `${h * scale}px`;
    let fs = block.fontSize * scale;
    el.style.fontSize = `${fs}px`;
    let guard = 40;
    const minFs = 8;
    while (el.scrollHeight > el.clientHeight + 1 && fs > minFs && guard-- > 0) {
      fs -= 0.5;
      el.style.fontSize = `${fs}px`;
    }
    if (el.scrollHeight > el.clientHeight) {
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [text, scale, block.fontSize, h]);

  return (
    <div
      ref={ref}
      className="absolute overflow-hidden text-black"
      style={{
        left: x * scale,
        top: y * scale,
        width: w * scale,
        // height is set imperatively above — may grow past h*scale to fit content
        background: "white",
        lineHeight: 1.2,
        fontFamily: '"Noto Sans SC", "Inter", sans-serif',
        wordBreak: "break-word",
      }}
      title={text}
    >
      {text}
    </div>
  );
}
