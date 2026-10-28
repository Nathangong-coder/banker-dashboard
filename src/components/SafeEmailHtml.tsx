"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/util";

/**
 * An email's HTML, shown safely: the browser's Sanitizer API (`setHTML`) with a short allowlist. No images at all (so
 * no tracking pixel, ours or anyone's, ever loads from here), no styles, no attributes but href; links open in a new
 * tab. Browsers without `setHTML` (Safari today) get the plain-text version instead: no sanitizer library is shipped.
 */

const SANITIZER = {
  elements: ["p", "div", "br", "span", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "blockquote", "table", "tbody", "tr", "td", "th"],
  attributes: ["href"],
  replaceWithChildrenElements: ["font", "center"],
};

type SetHtml = (html: string, opts: { sanitizer: typeof SANITIZER }) => void;

const noop = () => () => {};
const canSetHtml = () => typeof Element !== "undefined" && "setHTML" in Element.prototype;

export function SafeEmailHtml({ html, text, className }: { html?: string; text: string; className?: string }) {
  const native = useSyncExternalStore(noop, canSetHtml, () => false);
  const ref = useRef<HTMLDivElement>(null);
  const useHtml = native && !!html;

  useEffect(() => {
    const el = ref.current;
    if (!el || !useHtml || !html) return;
    // Images are dropped before parsing too (belt and braces: the sanitizer drops them anyway).
    (el as unknown as { setHTML: SetHtml }).setHTML(html.replace(/<img\b[^>]*>/gi, ""), { sanitizer: SANITIZER });
    for (const a of el.querySelectorAll("a")) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  }, [html, useHtml]);

  if (!useHtml) return <pre className={cn("font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-ink [overflow-wrap:anywhere]", className)}>{text}</pre>;
  return (
    <div
      ref={ref}
      className={cn(
        "text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere] [&_a]:text-navy [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_table]:max-w-full [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
    />
  );
}
