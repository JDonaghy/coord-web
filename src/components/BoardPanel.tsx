/**
 * BoardPanel — the Board panel's list-slot content (#101).
 *
 * "The issue body IS the agent's brief" — this is the panel that puts a
 * queue row and the brief that produced it side by side, in-app, without
 * leaving for GitHub. `ShellLayout` owns the frame (rail, status bar) and
 * renders this into the list slot for `/board`, same convention every other
 * list/detail panel in this app documents. Rows navigate to
 * `/board/:repo/:issue` (`BoardDetail`).
 *
 * See `src/lib/board.ts`'s header for why this reads `GET /api/drive-queue`
 * rather than a dedicated Board endpoint: coord-web's own API has no route
 * that returns an issue's body yet, and this repo ships no backend code to
 * add one (CLAUDE.md) — `api-routes.spec.ts` (#78) would fail the build the
 * instant this file named a path the *served* spec doesn't have, the exact
 * coord-web#76 mistake that check exists to catch. `filterActiveQueueEntries`
 * is deliberately NOT applied here (unlike `DriveQueuePanel`): a `blocked`
 * backlog issue that has never run (`format-converter`#2-#6, this issue's
 * own mock) is exactly what "browse issues by repo" means, and dropping it
 * to match Queue's "active work" scope would empty out the one example the
 * issue itself gives.
 *
 * **A tree grouped by repo.** Collapse state persists in `localStorage`
 * across navigation, the same way the rest of the shell remembers its own
 * geometry (`src/shell/shellState.ts`) — scoped to this panel rather than
 * folded into that blob, since it's this screen's own concern, not shell
 * geometry.
 *
 * **A filter that takes an issue number.** `src/lib/board.ts`'s
 * `parseBoardFilter` tells a bare number (narrows every repo to that issue
 * number) apart from a `<repo-or-alias>#<number>` ref (jumps straight to
 * that issue, matching this issue's own `FC#3` / `format-converter#3`
 * examples — `FC` resolved via `repoAlias`, the same alias table the TUI
 * uses). Every repo group with a match renders open regardless of its
 * persisted collapse state — a filter that hides its own results would be a
 * worse bug than the persisted memory it briefly overrides.
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, LayoutDashboard, Search } from 'lucide-react'

import { fetchDriveQueue } from '@/api/client'
import { PanelHeader } from '@/components/PanelHeader'
import {
  boardIssuesFromDriveQueue,
  filterBoardGroups,
  groupBoardIssuesByRepo,
  parseBoardFilter,
  type BoardIssueRow,
} from '@/lib/board'
import { issueRef } from '@/lib/repoRef'
import { paths } from '@/routes/paths'

const EXPANDED_STORAGE_KEY = 'coord-web-board-expanded-repos'

function readExpandedRepos(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

function writeExpandedRepos(repos: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(repos)))
  } catch {
    // Persistence is a nice-to-have; the panel still works this session.
  }
}

function BoardIssueButton({
  repo,
  issue,
  onSelect,
}: {
  repo: string
  issue: BoardIssueRow
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`board-issue-${repo}-${String(issue.number)}`}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/40 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <span className="w-16 flex-none font-mono text-[.7rem] text-faint">
        {issueRef(repo, issue.number)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{issue.title}</span>
    </button>
  )
}

export default function BoardPanel() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    data: queue,
    isLoading,
    isError,
    refetch,
  } = useQuery({ queryKey: ['drive-queue'], queryFn: () => fetchDriveQueue() })

  const [filterInput, setFilterInput] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => readExpandedRepos())

  const rows = useMemo(
    () => (queue ? boardIssuesFromDriveQueue(queue.entries, queue.titles) : []),
    [queue],
  )
  const groups = useMemo(() => groupBoardIssuesByRepo(rows), [rows])
  const repos = useMemo(() => groups.map((g) => g.repo), [groups])
  const filter = useMemo(() => parseBoardFilter(filterInput, repos), [filterInput, repos])
  const filteredGroups = useMemo(() => filterBoardGroups(groups, filter), [groups, filter])
  const filtering = filter.kind !== 'none'

  // `FC#3` / `format-converter#3` is the "jump straight to it" case (#101) --
  // navigate the moment the ref resolves, and only once (the pathname guard
  // stops a re-navigate on every keystroke after the jump already landed).
  useEffect(() => {
    if (filter.kind !== 'ref') return
    const target = paths.boardItem(filter.repo, filter.number)
    if (location.pathname !== target) navigate(target)
  }, [filter, navigate, location.pathname])

  const toggleGroup = (repo: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(repo)) {
        next.delete(repo)
      } else {
        next.add(repo)
      }
      writeExpandedRepos(next)
      return next
    })
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4">
      <PanelHeader title="Board" count={rows.length || undefined} countLabel="tracked" />

      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <input
          type="text"
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          placeholder="Filter — issue number, FC#3, or a title"
          aria-label="Filter issues"
          data-testid="board-filter-input"
          className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-2 text-sm text-card-foreground placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading board…</p>}

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

      {queue && rows.length === 0 && (
        <div data-testid="board-empty" className="flex flex-col items-center gap-3 py-14 text-center">
          <LayoutDashboard className="h-7 w-7 text-faint" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No tracked issues</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Nothing in the drive queue carries a title yet. An issue shows up here once it's synced.
          </p>
        </div>
      )}

      {queue && rows.length > 0 && filteredGroups.length === 0 && (
        <p data-testid="board-no-matches" className="py-10 text-center text-sm text-muted-foreground">
          No issues match “{filterInput}”.
        </p>
      )}

      {filteredGroups.map((group) => {
        const open = filtering || expanded.has(group.repo)
        return (
          <section key={group.repo} className="mb-1">
            <button
              type="button"
              onClick={() => toggleGroup(group.repo)}
              aria-expanded={open}
              data-testid={`board-group-${group.repo}`}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/40"
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5 flex-none text-faint" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 flex-none text-faint" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {group.repo}
              </span>
              <span className="font-mono text-[.7rem] text-faint">{group.issues.length}</span>
            </button>
            {open && (
              <div className="ml-4 flex flex-col gap-0.5 border-l border-border py-0.5 pl-2">
                {group.issues.map((issue) => (
                  <BoardIssueButton
                    key={`${group.repo}#${String(issue.number)}`}
                    repo={group.repo}
                    issue={issue}
                    onSelect={() => navigate(paths.boardItem(group.repo, issue.number))}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
