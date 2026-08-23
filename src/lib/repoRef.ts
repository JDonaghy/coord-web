/**
 * Repo issue-ref display helpers (#46) — render a human-visible issue
 * reference as the two-letter repo alias joined directly to the number,
 * `CC#2639`, never `code-coordinator #2639` or `CC #2639`.
 *
 * Mirrors `repo_alias()` in `tui/src/app/drive_queue.rs`
 * (claude-coordinator#2042) exactly, so the web app and the TUI never
 * disagree about what a given repo's alias is. This is the coord-web half of
 * claude-coordinator#2641, which does the same thing for the TUI's own
 * doc-tab strips.
 *
 * Display-only. Two identity-bearing formats deliberately keep the raw,
 * unaliased `repo#N` wire format and must NOT route through these helpers:
 * `queueEntryKey()` (`src/lib/driveQueue.ts`) — its doc comment is a
 * contract that its output matches `after_json` entries verbatim, and it
 * doubles as a React `key` / busy-state key — and `issueKey()`
 * (`src/lib/pipeline.ts`) — an internal dedup identity, never rendered.
 * Alias at the point of *display* only.
 *
 * Alias collisions across repos are a known limitation, same as
 * claude-coordinator#2042 — no disambiguation here.
 */

/**
 * Two-letter(ish) alias for a repo name: strip any `owner/` prefix, split
 * the basename on `-`, take each non-empty segment's first character,
 * uppercase, concatenate.
 *
 * `coord-web` -> `CW`, `claude-coordinator` -> `CC`, `quadraui` -> `Q`,
 * `JDonaghy/coord-web` -> `CW` (owner prefix stripped before aliasing --
 * aliasing the slug naively would yield `JCW`-ish garbage).
 */
export function repoAlias(repo: string): string {
  const basename = repo.slice(repo.lastIndexOf('/') + 1)
  return basename
    .split('-')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0].toUpperCase())
    .join('')
}

/** `repoAlias(repo)` joined directly to `issue` with no space -- `CC#2639`. */
export function issueRef(repo: string, issue: number | string): string {
  return `${repoAlias(repo)}#${issue}`
}

/**
 * Takes a wire key already in `repo#N` form (what `after_json` entries and
 * `queueEntryKey()` produce) and returns the aliased spelling --
 * `repo-alpha#9101` -> `RA#9101`. Splits on the *last* `#` so a repo name
 * that itself happened to contain one wouldn't break the split.
 */
export function aliasIssueRef(key: string): string {
  const hashIndex = key.lastIndexOf('#')
  if (hashIndex === -1) return key
  return issueRef(key.slice(0, hashIndex), key.slice(hashIndex + 1))
}
