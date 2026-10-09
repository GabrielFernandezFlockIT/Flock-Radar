import { Fragment, type ReactNode } from "react";

/**
 * Renders an answer with its citations as chips.
 *
 * The model is told to name concrete records inline (PROMPT §5.3, "answers
 * must cite evidence"), so this turns `BCN-123`, `#42`, short SHAs, and bare
 * URLs into visible chips. It is deliberately a linkifier, not a validator:
 * the chips make the citation visible, while the tool layer is what keeps the
 * underlying data honest.
 */

const CITATION_PATTERN =
  /(https?:\/\/[^\s<>()"']+)|(\b[A-Z][A-Z0-9]{1,9}-\d+\b)|(#\d+\b)|(\b(?=[0-9a-f]{7,40}\b)\d*[a-f][0-9a-f]*\b)/g;

function Chip({ children, href }: { children: ReactNode; href?: string }) {
  const className =
    "inline-flex items-center rounded-4xl border border-border bg-muted/50 px-1.5 font-mono text-[0.72rem] text-foreground";
  if (href === undefined) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} transition-colors hover:bg-muted hover:underline`}
    >
      {children}
    </a>
  );
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export function CitedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  for (const match of text.matchAll(CITATION_PATTERN)) {
    const start = match.index;
    if (start > cursor) parts.push(text.slice(cursor, start));
    const token = match[0];
    const isUrl = token.startsWith("http");
    parts.push(
      <Chip key={`citation-${index}`} href={isUrl ? token : undefined}>
        {isUrl ? shortenUrl(token) : token}
      </Chip>,
    );
    cursor = start + token.length;
    index += 1;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <>
      {parts.map((part, position) => (
        <Fragment key={position}>{part}</Fragment>
      ))}
    </>
  );
}
