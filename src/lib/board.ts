/**
 * Board panel helpers (#101, updated for #107) — group the tracked issue
 * backlog by repo for the tree, and parse the number/ref filter.
 *
 * ## Why the tree still reads drive-queue, and why the body no longer does
 *
 * #101 asks for a full per-repo issue browser: title, state, labels and the
 * rendered GitHub body. **The tree** comes from `GET /api/drive-queue` — no
 * dedicated "list every tracked issue" endpoint exists, and the queue rows
 * already carry repo, issue number and title. Rows are scoped to `entries`
 * that also have a `titles` hit: every entry missing one is a `done`,
 * long-since-synced-away issue (verified: of 1025 live entries, the ~680
 * missing a title were *all* `state: 'done'`), so this is "the tracked,
 * still-relevant backlog", not the full historical table. A real gap versus
 * the full repo backlog (an epic that never entered the queue, an issue
 * closed and rolled off entirely) — not hidden here, just the honest
 * boundary of what this data source knows.
 *
 * **The body, GitHub state/labels and the GitHub link** used to come from a
 * best-effort scrape of `GET /api/board`'s `Assignment.briefing` — a real
 * gap this module's header used to document at length, since a briefing only
 * exists once an issue has been dispatched at least once, and no client-side
 * data carried GitHub's own state/labels/URL at all. `GET /api/issue/{repo}/
 * {number}` (claude-coordinator#3194) closed that gap for real: it answers
 * for every tracked issue, dispatched or not, with the actual body, GitHub's
 * own `state`/`labels`, and a server-built `html_url` (the coord repo name is
 * not always the GitHub `owner/repo` slug, so only the server can build this
 * correctly). `BoardDetail` (`src/components/BoardDetail.tsx`) reads that
 * endpoint directly via `fetchIssueDetail` (`src/api/client.ts`) — this
 * module no longer has a body/state/labels export at all; `queueState` below
 * is deliberately the only state this module still carries, since it's a
 * different fact (queue lifecycle, not GitHub open/closed) that only this
 * module's data source knows.
 */
import { queueEntryKey } from '@/lib/driveQueue'
import { repoAlias } from '@/lib/repoRef'
import type { BoardDriveQueueEntry } from '@/api/client'

export interface BoardIssueRow {
  repo: string
  number: number
  title: string
  /** Queue-lifecycle state (`waiting`/`blocked`/`running`/`done`) —
   * deliberately NOT GitHub's open/closed. There is no real open/closed
   * source for an issue browsed here without a dedicated fetch per row
   * (see this module's header), and rendering a queue state as if it were
   * GitHub state would be a worse bug than not showing one at all. */
  queueState: string
}

/**
 * Build the browsable rows from `GET /api/drive-queue`'s own envelope.
 * Drops any entry with no `titles` hit — see this module's header for why
 * that's exactly the entries a title lookup was never going to have (synced-
 * away `done` history), not an arbitrary cut.
 */
export function boardIssuesFromDriveQueue(
  entries: readonly BoardDriveQueueEntry[],
  titles: Readonly<Record<string, string>> | undefined,
): BoardIssueRow[] {
  if (!titles) return []
  const rows: BoardIssueRow[] = []
  for (const entry of entries) {
    const title = titles[queueEntryKey(entry)]
    if (!title) continue
    rows.push({
      repo: entry.repo_name,
      number: entry.issue_number,
      title,
      queueState: entry.state,
    })
  }
  return rows
}

/** Group rows by repo, alphabetical by repo name, issues ascending by
 * number within each group — the order the issue's own mock shows. */
export function groupBoardIssuesByRepo(
  rows: readonly BoardIssueRow[],
): Array<{ repo: string; issues: BoardIssueRow[] }> {
  const byRepo = new Map<string, BoardIssueRow[]>()
  for (const row of rows) {
    const bucket = byRepo.get(row.repo)
    if (bucket) {
      bucket.push(row)
    } else {
      byRepo.set(row.repo, [row])
    }
  }
  return Array.from(byRepo.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, issues]) => ({
      repo,
      issues: [...issues].sort((a, b) => a.number - b.number),
    }))
}

// ── the number/ref filter ────────────────────────────────────────────────────

export type BoardFilter =
  | { kind: 'none' }
  | { kind: 'number'; value: number }
  | { kind: 'ref'; repo: string; number: number }
  | { kind: 'text'; value: string }

/**
 * Parse the filter box's raw text against the known repo list (so `FC#3`
 * and `format-converter#3` both resolve to the same repo — the alias table
 * this app already shares with the TUI, `src/lib/repoRef.ts`).
 *
 *  - a bare integer -> `'number'` (narrows every repo to that issue number)
 *  - `<alias-or-repo>#<number>` -> `'ref'` when the prefix resolves to a
 *    known repo (case-insensitive against both the repo's own name and its
 *    alias) — this is the "jump straight to it" case
 *  - anything else -> `'text'`, a plain case-insensitive title search
 */
export function parseBoardFilter(input: string, repos: readonly string[]): BoardFilter {
  const trimmed = input.trim()
  if (trimmed === '') return { kind: 'none' }
  if (/^\d+$/.test(trimmed)) return { kind: 'number', value: Number(trimmed) }

  const refMatch = /^([A-Za-z0-9._/-]+)#(\d+)$/.exec(trimmed)
  if (refMatch) {
    const [, ref, numberText] = refMatch
    const repo = resolveRepoRef(ref, repos)
    if (repo) return { kind: 'ref', repo, number: Number(numberText) }
  }

  return { kind: 'text', value: trimmed.toLowerCase() }
}

function resolveRepoRef(ref: string, repos: readonly string[]): string | null {
  const lower = ref.toLowerCase()
  return (
    repos.find((r) => r.toLowerCase() === lower) ??
    repos.find((r) => repoAlias(r).toLowerCase() === lower) ??
    null
  )
}

/** Apply a parsed filter to grouped rows, dropping any repo group left with
 * no matches — a `'none'` filter is a pass-through copy. */
export function filterBoardGroups(
  groups: ReadonlyArray<{ repo: string; issues: readonly BoardIssueRow[] }>,
  filter: BoardFilter,
): Array<{ repo: string; issues: BoardIssueRow[] }> {
  if (filter.kind === 'none') {
    return groups.map((g) => ({ repo: g.repo, issues: [...g.issues] }))
  }
  const matches = (row: BoardIssueRow): boolean => {
    if (filter.kind === 'number') return row.number === filter.value
    if (filter.kind === 'ref') return row.repo === filter.repo && row.number === filter.number
    return row.title.toLowerCase().includes(filter.value)
  }
  return groups
    .map((g) => ({ repo: g.repo, issues: g.issues.filter(matches) }))
    .filter((g) => g.issues.length > 0)
}
