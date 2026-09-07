/**
 * BoardDetail — one tracked issue's Board entry at `/board/:repo/:issue`
 * (#101): title, repo, number, queue state, and the rendered body when one
 * is available.
 *
 * Two already-real, already-registered `coord-web` endpoints feed this,
 * both cache reads off queries other panels already keep warm (`['drive-
 * queue']` from `BoardPanel`, `['board']` — otherwise unused in the app
 * today, but a real route, see `src/api/client.ts`'s `fetchBoard`):
 *
 *  - **Title + queue state** come from the same `GET /api/drive-queue` row
 *    `BoardPanel`'s tree is built from (`src/lib/board.ts`).
 *  - **The body** comes from `GET /api/board`'s `active`/`completed`
 *    `Assignment.briefing`, when this issue has been dispatched at least
 *    once (`findBoardAssignment` + `extractBriefingBody`,
 *    `src/lib/board.ts`) — rendered as markdown with `react-markdown` +
 *    `remark-gfm`, same library `GateAPanel` already ships for contract.md.
 *
 * Neither GitHub's own open/closed state nor its labels are available from
 * this view — see `src/lib/board.ts`'s header for exactly why a dedicated
 * endpoint would be needed and isn't in reach of a coord-web-only change.
 * Rendering a fabricated state/labels pair would be worse than naming the
 * gap outright, so this shows what's real (the queue's own lifecycle state)
 * under a label that can't be mistaken for GitHub's, plus a plain link out
 * to GitHub for the rest — never a `fetch` to GitHub itself.
 *
 * Long bodies scroll with the detail pane itself; only `pre`/`table` ever
 * get their own horizontal scrollbar (mirroring `GateAPanel`'s
 * `ContractMarkdown`), so the page body never scrolls sideways.
 */
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react'

import { fetchBoard, fetchDriveQueue } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import {
  boardIssuesFromDriveQueue,
  extractBriefingBody,
  findBoardAssignment,
} from '@/lib/board'
import { issueRef } from '@/lib/repoRef'
import { paths } from '@/routes/paths'

const detailShellClass = 'mx-auto w-full max-w-3xl px-4 py-5 md:px-6'

function BackHeader({ label }: { label: string }) {
  return (
    <header className="mb-4 flex items-center gap-3">
      <Link
        to={paths.board()}
        aria-label="Back to Board"
        className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </Link>
      <span className="font-mono text-[.72rem] text-faint">{label}</span>
    </header>
  )
}

function IssueBodyMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="min-w-0 text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

export default function BoardDetail() {
  const params = useParams<{ repo: string; issue: string }>()
  const repo = params.repo ?? ''
  const parsedNumber = Number(params.issue)
  const number = Number.isInteger(parsedNumber) ? parsedNumber : Number.NaN
  const validParams = repo !== '' && Number.isInteger(number) && number > 0

  const {
    data: queue,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['drive-queue'],
    queryFn: () => fetchDriveQueue(),
    enabled: validParams,
  })
  const { data: board } = useQuery({
    queryKey: ['board'],
    queryFn: () => fetchBoard(),
    enabled: validParams,
  })

  const rows = useMemo(
    () => (queue ? boardIssuesFromDriveQueue(queue.entries, queue.titles) : []),
    [queue],
  )
  const row = useMemo(
    () => rows.find((r) => r.repo === repo && r.number === number) ?? null,
    [rows, repo, number],
  )
  const assignment = board ? findBoardAssignment(board, repo, number) : null
  const body = assignment ? extractBriefingBody(assignment.briefing) : null

  if (!validParams) {
    return (
      <div className={detailShellClass}>
        <p role="alert" className="text-sm text-destructive">
          Invalid Board link — expected /board/&lt;repo&gt;/&lt;issue&gt;.
        </p>
      </div>
    )
  }

  const githubHref = `https://github.com/${repo}/issues/${String(number)}`

  return (
    <div className={detailShellClass}>
      <BackHeader label={issueRef(repo, number)} />

      {isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading issue…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm text-destructive">Failed to load the board</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <section className="mb-4">
            <h1 className="mb-2 text-step-1 font-semibold text-foreground" data-testid="board-detail-title">
              {row?.title ?? `Issue #${String(number)}`}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" data-testid="board-detail-repo">
                {repo}
              </Badge>
              {row && (
                <Badge variant="secondary" data-testid="board-detail-queue-state">
                  queue: {row.queueState}
                </Badge>
              )}
              {!row && (
                <Badge variant="outline" data-testid="board-detail-untracked">
                  not in the tracked backlog
                </Badge>
              )}
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-faint">
              <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" aria-hidden="true" />
              GitHub's own open/closed state and labels aren't available from this view yet — see{' '}
              <a href={githubHref} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                the issue on GitHub
              </a>
              .
            </p>
          </section>

          <section>
            {body !== null ? (
              <IssueBodyMarkdown markdown={body} />
            ) : (
              <div
                data-testid="board-detail-no-body"
                role="status"
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center"
              >
                <p className="text-sm font-medium text-foreground">Full body not available here yet</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  This issue hasn't been dispatched, so coord-web has no cached copy of its body.
                </p>
                <a
                  href={githubHref}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                >
                  Open on GitHub
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
