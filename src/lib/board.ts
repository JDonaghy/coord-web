/**
 * Board panel helpers (#101) — group the tracked issue backlog by repo for
 * the tree, parse the number/ref filter, and pull a best-effort issue body
 * out of data coord-web already has.
 *
 * ## Why this reads drive-queue + board-briefing instead of a dedicated endpoint
 *
 * #101 asks for a full per-repo issue browser: title, state, labels and the
 * rendered GitHub body. The daemon that already carries exactly that shape
 * is coord-serve's board projection — `GET /board` on "the board daemon"
 * (`dellserver:7435`, coord-serve's own systemd description), verified live
 * while building this panel: its `issues[]` carries `repo_name`/`number`/
 * `title`/`body`/`state`/`labels` for 857 rows across 9 repos, and
 * `GET /issue/{repo_name}/{number}` on that same daemon returns the full,
 * untruncated body. (`format-converter`#2/#3's titles — "Cloudflare Pages
 * scaffold: static, no-Access, strict no-egress CSP" / "YAML <-> JSON
 * conversion engine with positioned error reporting" — match this issue's
 * own mock verbatim, confirming this is the intended source, not a guess.)
 *
 * `coord-web`'s OWN API (port 7434, same-origin — the only host this browser
 * app is allowed to call, see this repo's CLAUDE.md) has no equivalent route
 * yet: `GET /openapi.json` against the daemon this was built against
 * (code-coordinator==0.5.401) lists no `/api/board/issues` or
 * `/api/issue/{repo}/{number}`, and `e2e/api-routes.spec.ts` (#78) fails the
 * build the instant `API_ROUTES` names a path the *served* spec doesn't
 * have — the exact coord-web#76 mistake that check exists to catch, and
 * confirmed by `MilestonesPanel`'s own history: that panel's `'soon' ->
 * 'ready'` flip in `railItems.ts` landed only the day claude-coordinator#3072
 * actually shipped, never ahead of it. Adding the coord-web-side route is
 * backend work in claude-coordinator's `coord/dashboard/server.py` — out of
 * reach for a coord-web-only change (this repo ships no backend code, see
 * CLAUDE.md) and out of this issue's own file list.
 *
 * So this ships the honest interim version, entirely over data `coord-web`
 * already serves for real, today:
 *
 *  - **The tree** comes from `GET /api/drive-queue` — this issue's own words
 *    ("the queue rows already carry repo, issue number and title"). Rows are
 *    scoped to `entries` that also have a `titles` hit: every entry missing
 *    one is a `done`, long-since-synced-away issue (verified: of 1025 live
 *    entries, the ~680 missing a title were *all* `state: 'done'`), so this
 *    is "the tracked, still-relevant backlog", not the full historical
 *    table. A real gap versus the full repo backlog (an epic that never
 *    entered the queue, an issue closed and rolled off entirely) — not
 *    hidden here, just the honest boundary of what this data source knows.
 *  - **The body** comes from `GET /api/board`'s `active`/`completed`
 *    `Assignment.briefing`, for the — much smaller — set of issues that have
 *    actually been dispatched at least once. `extractBriefingBody` strips
 *    the leading `Issue #N: <title>` line `coord`'s dispatcher synthesizes,
 *    so what's left is exactly the body markdown. Everything else is an
 *    honest "not available from this coord server yet" state
 *    (`BoardDetail`), with a plain `<a>` out to GitHub — never a `fetch` to
 *    GitHub itself, per this issue's own constraint.
 *
 * The day `/api/board/issues` + `/api/issue/{repo}/{number}` land for real
 * on coord-web's own API (mirroring the coord-serve shape verified above),
 * this file's exports are the one place to swap over.
 */
import { queueEntryKey } from '@/lib/driveQueue'
import { repoAlias } from '@/lib/repoRef'
import type { Assignment, BoardDriveQueueEntry } from '@/api/client'

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

// ── best-effort body, from an already-dispatched assignment's briefing ─────

/**
 * Find the most recent `Assignment` for this repo+issue in `/api/board`'s
 * `active`+`completed` windows — `active` checked first, since a currently
 * running assignment's briefing is more likely to be what's live than a
 * possibly-stale completed one for the same issue re-queued since.
 */
export function findBoardAssignment(
  board: { active: readonly Assignment[]; completed: readonly Assignment[] },
  repo: string,
  number: number,
): Assignment | null {
  const match = (a: Assignment) => a.repo_name === repo && a.issue_number === number
  return board.active.find(match) ?? board.completed.find(match) ?? null
}

/**
 * Strip the leading `Issue #N: <title>` line `coord`'s dispatcher
 * synthesizes onto every briefing, leaving just the body markdown. Falls
 * back to the untouched briefing when the prefix doesn't match the expected
 * shape — never hides data behind a fragile parse.
 */
export function extractBriefingBody(briefing: string): string {
  const match = /^Issue #\d+:[^\n]*\n+/.exec(briefing)
  return match ? briefing.slice(match[0].length) : briefing
}
