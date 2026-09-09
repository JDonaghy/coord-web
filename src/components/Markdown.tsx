/**
 * Markdown — the shared `react-markdown` + `remark-gfm` renderer for every
 * pipeline surface that carries real markdown (#114): milestone contracts
 * (`GateAPanel`), issue bodies (`BoardDetail`), and review findings
 * (`Detail`). One component map, one overflow policy, extracted from the two
 * near-identical copies `GateAPanel`'s `ContractMarkdown` and `BoardDetail`'s
 * `IssueBodyMarkdown` carried before this — a third hand-rolled copy for
 * findings would have been the wrong move.
 *
 * Overflow policy (`BoardDetail`'s original header called this out
 * explicitly, so it's restated here rather than left to whoever next reads
 * one call site): the page/pane this renders into must never scroll
 * sideways. Only `pre` (fenced code) and `table` get their own horizontal
 * scrollbar, each wrapped so the overflow is contained locally instead of
 * blowing out the container.
 *
 * `components` lets a caller extend or override one element's renderer
 * without re-declaring the rest of the map — `GateAPanel` uses it for the
 * `h2` override that flags `## Amendment` headings.
 *
 * This module is a dependency boundary, not just a component: importing it
 * pulls in `react-markdown` + `remark-gfm`. Every current call site is
 * behind its own `lazy()` (`App.tsx`) precisely so those two libraries never
 * land in the main bundle — importing `Markdown` from an eagerly-loaded
 * module undoes that. See `Detail.tsx`'s findings section for how it stays
 * lazy despite `Detail` itself being eager.
 */
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-lg font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2.5 mt-6 text-base font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-sm font-semibold">{children}</h3>,
  p: ({ children }) => <p className="mb-3">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 font-mono text-xs">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-line-strong pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-5 border-border" />,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1.5 font-semibold text-muted-foreground">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border/60 px-2 py-1.5 align-top">{children}</td>,
}

export interface MarkdownProps {
  /** Raw markdown source. */
  markdown: string
  /** Extra classes on the wrapping `div`, appended to the shared base. */
  className?: string
  /** Per-element overrides merged over `markdownComponents`. */
  components?: Partial<Components>
}

export function Markdown({ markdown, className, components }: MarkdownProps) {
  return (
    <div className={cn('text-sm leading-relaxed text-foreground', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ...markdownComponents, ...components }}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

export default Markdown
