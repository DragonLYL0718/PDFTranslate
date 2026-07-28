import { useEffect, useLayoutEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage, renderTextLayer } from "@/features/pdf/pdf";
import type { Annotation, Bbox, DocPage, TextBlock } from "@/types";

interface Props {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  page?: DocPage;
  scale: number;
  /** When true, cover original text and overlay the translation. */
  translated: boolean;
  /** Highlights to paint under the text, in PDF points. */
  annotations?: Annotation[];
  /** Passages a citation just jumped to, breathing briefly so the eye finds them. */
  cited?: Bbox[];
}

/** One rendered page: original canvas, optionally with translated text overlaid at original positions. */
export function PageView({ pdf, pageNumber, page, scale, translated, annotations, cited }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderPage(pdf, pageNumber, scale, canvas);
  }, [pdf, pageNumber, scale]);

  // A selectable text layer, but only where it is actually reachable: engine A's
  // translated pane covers the canvas with opaque overlay divs, and those are
  // real DOM text already — a layer underneath would be unselectable and would
  // hand back source text while the reader is looking at the translation.
  useEffect(() => {
    const container = textLayerRef.current;
    if (!container || translated) return;
    renderTextLayer(pdf, pageNumber, scale, container).catch(() => {});
    return () => container.replaceChildren();
  }, [pdf, pageNumber, scale, translated]);

  const hasTranslation = translated && page && Object.keys(page.translations).length > 0;

  return (
    <div
      className="relative bg-white shadow-card"
      style={{ lineHeight: 0 }}
      data-page={pageNumber}
      data-side={translated ? "target" : "source"}
    >
      <canvas ref={canvasRef} />

      {/* Under the text layer (z-index 1) so glyphs stay selectable. */}
      {!!annotations?.length && (
        <div className="pointer-events-none absolute inset-0" style={{ zIndex: 0 }}>
          {annotations.map((a) =>
            a.bbox ? (
              <div
                key={a.id}
                className="absolute rounded-sm"
                style={{
                  left: a.bbox.x * scale,
                  top: a.bbox.y * scale,
                  width: a.bbox.w * scale,
                  height: a.bbox.h * scale,
                  background: `color-mix(in oklch, ${a.color} 28%, transparent)`,
                }}
                title={a.comment || a.anchor}
              />
            ) : null,
          )}
        </div>
      )}

      {!translated && <div ref={textLayerRef} className="textLayer" />}

      {/* Above the translation overlay (z-index 2), so the cited paragraph is
          visible in either pane. One rect per block rather than their union: a
          two-column page would otherwise get a box spanning both columns. */}
      {cited?.map((box, i) => (
        <div
          key={i}
          className="cite-flash pointer-events-none absolute rounded-sm"
          style={{
            left: box.x * scale - 3,
            top: box.y * scale - 2,
            width: box.w * scale + 6,
            height: box.h * scale + 4,
            zIndex: 3,
          }}
        />
      ))}

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
      data-block={block.id}
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
        zIndex: 2,
      }}
      title={text}
    >
      {text}
    </div>
  );
}
