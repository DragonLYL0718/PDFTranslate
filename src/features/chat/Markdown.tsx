import { Suspense, lazy, useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface BodyProps {
  source: string;
  onGoToPage?: (page: number) => void;
}

// react-markdown + remark-gfm are ~35 KB gzipped and only the chat needs them,
// so they load on demand like the export and OCR chunks. Deliberately no
// rehype-raw: without it react-markdown escapes HTML, which is the whole
// sanitization story for model output.
const MarkdownBody = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: gfm }] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
  ]);
  return {
    default: ({ source, onGoToPage }: BodyProps) => (
      <ReactMarkdown
        remarkPlugins={[gfm]}
        components={{
          a({ href, children, ...rest }) {
            const page = href?.startsWith("#page-") ? Number(href.slice(6)) : null;
            if (page && onGoToPage) {
              return (
                <button
                  type="button"
                  onClick={() => onGoToPage(page)}
                  className="mx-0.5 rounded bg-accent-soft px-1 py-px align-baseline font-mono text-[0.7em] text-accent no-underline hover:bg-accent hover:text-white"
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    ),
  };
});

/** Page citations the prompts ask for: (p12) in English, （p12） in Chinese. */
const CITATION = /[(（]\s*p\.?\s*(\d{1,4})\s*[)）]/gi;

/**
 * Rewrite citations as links so react-markdown emits anchors we can intercept.
 * Applied to the text rather than inside a renderer so it also works on a
 * half-streamed reply.
 */
function linkCitations(text: string): string {
  return text.replace(CITATION, (_match, page: string) => `[p${page}](#page-${page})`);
}

interface Props {
  text: string;
  onGoToPage?: (page: number) => void;
  className?: string;
}

export function Markdown({ text, onGoToPage, className }: Props): ReactNode {
  const source = useMemo(() => (onGoToPage ? linkCitations(text) : text), [text, onGoToPage]);
  const plain = <div className="whitespace-pre-wrap text-sm leading-relaxed text-text-2">{text}</div>;

  return (
    <div className={cn("prose prose-sm chat-prose max-w-none", className)}>
      <Suspense fallback={plain}>
        <MarkdownBody source={source} onGoToPage={onGoToPage} />
      </Suspense>
    </div>
  );
}
