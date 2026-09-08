/**
 * BoardDetail — one tracked issue's Board entry at `/board/:repo/:issue`
 * (#101, swapped onto a real endpoint by #107): title, GitHub's own
 * open/closed state and labels, the queue-lifecycle badge, and the rendered
 * body — for every tracked issue, dispatched or not.
 *
 * `GET /api/issue/{repo}/{number}` (claude-coordinator#3194,
 * `fetchIssueDetail` in `src/api/client.ts`) is the one fetch this pane
 * needs for its own content: body, GitHub `state`, `labels`, and `html_url`
 * all come from that single response — rendered as markdown with
 * `react-markdown` + `remark-gfm`, same library `GateAPanel` already ships
 * for contract.md. `GET /api/drive-queue` is still read alongside it
 * (`['drive-queue']`, the same cache `BoardPanel`'s tree keeps warm), for the
 * queue-lifecycle badge only — see `src/lib/board.ts`'s header for why that
 * stays a distinct fact from GitHub's own state rather than being folded
 * into it.
 *
 * `html_url` is used verbatim for every link out to GitHub — never composed
 * from `repo` + `number` here. The coord repo name is not always the GitHub
 * `owner/repo` slug (`claude-coordinator` is `JDonaghy/code-coordinator`),
 * so a client-built URL would be wrong for exactly the repos it looks right
 * for.
 *
 * A 404 (the store has never synced this issue at all) renders an honest
 * empty state — no crash, no blank pane, and no invented GitHub link, since
 * there's no `html_url` on a 404 to build one from.
 *
 * The identity chrome — the back header, the repo badge and the queue-
 * lifecycle badge — is rendered from the ROUTE, not from the fetch, so it
 * survives loading, an error and a 404 alike. Those three facts are known
 * the moment `/board/:repo/:issue` resolves; hiding them behind the issue
 * fetch left the empty state unable to say which repo it was even about, and
 * broke the one signal `e2e/queue-issue-link-target.spec.ts` (#108) uses to
 * prove a Queue Issue link actually landed on the Board entry rather than
 * dead-ending — a real `coord web --fixture` server 404s `/api/issue/...`,
 * having no issues store to answer from.
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
import { ArrowLeft, FileText } from 'lucide-react'

import { fetchDriveQueue, fetchIssueDetail } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { boardIssuesFromDriveQueue } from '@/lib/board'
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

  const { data: queue, isPending: queuePending } = useQuery({
    queryKey: ['drive-queue'],
    queryFn: () => fetchDriveQueue(),
    enabled: validParams,
  })
  const {
    data: issue,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['issue-detail', repo, number],
    queryFn: () => fetchIssueDetail(repo, number),
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

  if (!validParams) {
    return (
      <div className={detailShellClass}>
        <p role="alert" className="text-sm text-destructive">
          Invalid Board link — expected /board/&lt;repo&gt;/&lt;issue&gt;.
        </p>
      </div>
    )
  }

  return (
    <div className={detailShellClass}>
      <BackHeader label={issueRef(repo, number)} />

      <section className="mb-4">
        {issue?.ok && (
          <h1 className="mb-2 text-step-1 font-semibold text-foreground" data-testid="board-detail-title">
            {issue.data.title}
          </h1>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" data-testid="board-detail-repo">
            {repo}
          </Badge>
          {issue?.ok && (
            <Badge
              variant={issue.data.state === 'open' ? 'success' : 'outline'}
              data-testid="board-detail-github-state"
            >
              {issue.data.state}
            </Badge>
          )}
          {row && (
            <Badge variant="secondary" data-testid="board-detail-queue-state">
              queue: {row.queueState}
            </Badge>
          )}
          {!row && !queuePending && (
            <Badge variant="outline" data-testid="board-detail-untracked">
              not in the tracked backlog
            </Badge>
          )}
          {issue?.ok &&
            issue.data.labels.map((label) => (
              <Badge key={label} variant="outline" data-testid={`board-detail-label-${label}`}>
                {label}
              </Badge>
            ))}
          {/* #110: the stage rail + turn stream for this issue's most recent
              leg. Always offered here (unlike the Queue panel's own Log
              link, which is gated on a known pipeline row) -- `LogPanel`
              itself already renders an honest "no run to show a log for"
              empty state when this issue has never been dispatched, so
              there's no dead end to guard against by pre-checking here. */}
          <Link
            to={paths.log(repo, number)}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
            data-testid="board-detail-log-link"
          >
            <FileText className="h-3 w-3" aria-hidden="true" />
            Log
          </Link>
        </div>
        {issue?.ok && (
          <p className="mt-2 text-xs text-faint">
            <a
              href={issue.data.html_url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {issue.data.html_url}
            </a>
          </p>
        )}
      </section>

      {isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading issue…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm text-destructive">Failed to load the issue</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && issue?.ok && (
        <section>
          <IssueBodyMarkdown markdown={issue.data.body} />
        </section>
      )}

      {!isLoading && !isError && issue && !issue.ok && (
        <div
          data-testid="board-detail-not-found"
          role="status"
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center"
        >
          <p className="text-sm font-medium text-foreground">Issue not found</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            coord hasn't synced {issueRef(repo, number)} yet, so there's nothing to show here.
          </p>
        </div>
      )}
    </div>
  )
}
