# ms-2 acceptance contract — Reports panel

**Milestone ms-2 · "Reports panel" · tracking issue #26**
**Driver: `web-playwright` · mocks: [`mocks/`](mocks/) (six screen states, listed in §0)**

## What this contract is for — read first

This is **Gate A**: the pre-work architecture gate, authored before any of
#21-#25 (RPT-2..RPT-6) exist in this repo. As of this writing there is no
`report` reference anywhere in `src/api/client.ts` or `src/api/generated.ts`
— confirmed by grep, not assumed. Unlike `tests/acceptance/ms-51` (which
pinned already-shipped Home/Active behaviour), **every mock here is a
proposed design**, not a screenshot of running code. Nothing in this
contract should be read as "the app already does this."

This document is written with zero context from whoever implements #21-#25
— the same independence the adversarial code reviewer has from the author.
Where the milestone's own issue bodies left something open, that is called
out explicitly in §7 rather than silently resolved. Workers and the
independent test-author should treat this contract, not the issue prose, as
the source of truth for exact strings/shapes; where the two conflict, fix
this file (`--amend`) rather than letting the suite quietly drift from it.

### The five issues this milestone covers

| # | RPT | What it ships | Depends on |
|---|-----|----------------|------------|
| #21 | RPT-2 | Rail entry + route + picker + `drive-queue-status` end-to-end | code-coordinator#2492 (RPT-1) |
| #22 | RPT-3 | Light up `issue-activity`, `completed`, `decisions`, `usage`, `queue-outcomes` | #21 |
| #23 | RPT-4 | Row navigation via `row_identity` | #22 |
| #24 | RPT-5 | CSV export (`?format=csv`) | #21 |
| #25 | RPT-6 | Chart rendering + `ChartPlan` Degrade fallback | #22 |

(The tracking issue #26's own "Work order" — `{group: A}` for #21, `{group:
B, after: #21}` for #22/#24, `{group: C, after: #22}` for #23/#25 — is
internally consistent with each issue's own "Depends on" line; nothing to
flag there.)

## §0 — Mock inventory

| Mock | Report | Chart state | row_identity |
|---|---|---|---|
| `mocks/reports-picker.html` | drive-queue-status | n/a — nothing run yet | n/a |
| `mocks/reports-grid.html` | drive-queue-status | None (no `chart` declared) | **absent** — see §7.1 |
| `mocks/reports-row-nav.html` | issue-activity | None | present (Link) |
| `mocks/reports-decisions.html` | decisions | None | present (Link) + `options` column |
| `mocks/reports-chart.html` | queue-outcomes | **Render** | absent |
| `mocks/reports-chart-degraded.html` | queue-outcomes | **Degrade** | absent |

There is no seventh mock for the chart's third outcome, **None**: it is
exactly what `reports-grid.html` / `reports-row-nav.html` /
`reports-decisions.html` already show — no chart region in the DOM at all,
for a report that never declares `chart`.

## §1 — Rail entry and routing (RPT-2, #21)

- **§1a** `ShellView` gains exactly one new member: `'reports'` (the literal
  string, per #21's own wording).
- **§1b** `paths.reports()` → `/reports`. (This contract's own choice for the
  path builder's name/shape, mirroring `paths.queue()`; #21 doesn't name it,
  see §7.2.)
- **§1c** A rail item labelled exactly **`Reports`**, `data-testid`
  `rail-item-reports`, `status: 'ready'` (not `'soon'`) — clickable and
  navigable, unlike its `Audit`/`Spend` neighbours in the same group, which
  stay dimmed `'soon'` placeholders.
- **§1d** It sits in the existing **`Insight`** rail group, i.e. below the
  `Insight` heading, alongside `Audit` and `Spend`. Its exact position
  *within* that group (before/after Audit and Spend) is **not** pinned — see
  §7.3.
- **§1e** Selecting it gives it `aria-current="page"` and the same leading
  accent-bar + wash-background treatment `ActivityRail.tsx`'s `NavItem`
  already applies to any selected, non-`soon` entry (see e.g. `Queue`).

## §2 — Panel header

- **§2a** An `h1` with the exact text **`Reports`**.
- **§2b** Before any report has been run this session, **no** count element
  renders next to the `h1` (`mocks/reports-picker.html`).
- **§2c** After a report has been run, a mono count element reads **`N
  rows`** (`countLabel="rows"`) where `N` is the number of rows actually
  rendered in the grid below it — e.g. `3 rows` (`reports-grid.html`,
  `reports-row-nav.html`), `1 row` singular (`reports-chart-degraded.html` —
  this contract pins `"1 row"` as the exact singular string, not `"1 rows"`),
  distinct from `PanelHeader`'s existing `countLabel="tracked"`/`"in view"`
  conventions elsewhere in the app which this report never reuses). No issue
  body says whether a large result set can be paginated/truncated such that
  this count would ever differ from the visible row count (contrast
  ms-51's Pipeline-tab count, which deliberately *does* diverge from its
  visible cards) — this contract assumes N always equals rendered rows and
  flags pagination as unaddressed rather than guessing at a scheme.

## §3 — Report picker

- **§3a** A `role="tablist"` element, accessible name **`Reports catalogue`**,
  `data-testid` `reports-tablist`.
- **§3b** It contains exactly **six** `role="tab"` elements, in this order,
  each with a `data-testid` of `reports-tab-<key>` and the exact visible
  text shown:

  | `data-testid` key | Catalogue key (from #21/#22) | Visible tab text (this contract's copy) |
  |---|---|---|
  | `drive-queue-status` | `drive-queue-status` | `Drive queue status` |
  | `issue-activity` | `issue-activity` | `Issue activity` |
  | `completed` | `completed` | `Completed` |
  | `decisions` | `decisions` | `Decisions` |
  | `usage` | `usage` | `Usage` |
  | `queue-outcomes` | `queue-outcomes` | `Queue outcomes` |

  The right-hand column (`Drive queue status`, `Issue activity`, …) is this
  mock's own display copy — the milestone issues only name the lowercase
  hyphenated catalogue keys, never a display title. Workers may render
  different capitalization/wording as long as the test-author amends this
  table to match; the **keys** (left/middle columns) are the part actually
  sourced from the issue bodies and should not drift.
- **§3c** `drive-queue-status`'s tab has `aria-selected="true"` on cold load;
  the other five have `aria-selected="false"`. Activating another tab moves
  the selection and swaps the description/params/grid below it.
- **§3d** A one-line description paragraph, `data-testid`
  `reports-description`, directly under the tablist. Exact wording is this
  mock's placeholder copy (not sourced from the issues — no report
  description text exists anywhere in #21/#22's bodies); only its presence,
  position and `data-testid` are contractual.
- **§3e** This contract pins a **tablist**, not a left-hand list — #21's own
  text explicitly leaves this open ("tabs or a left list of catalogue titles
  and descriptions"). Flagged in §7.4: not a milestone requirement, a Gate-A
  choice made so there is one concrete shape to write a test-author's slice
  against.

## §4 — Parameter bar and Run action

- **§4a** A `<form>` (or equivalent container), accessible name **`Report
  parameters`**, `data-testid` `reports-param-bar`.
- **§4b** Each catalogue parameter of kind `choice` renders as a `<select>`;
  each parameter of kind `text` renders as a text `<input>` — per #21's
  literal mapping. This contract's mocks show one of each (`Repo` as
  `choice`, `Search` as `text` on `drive-queue-status`; `Window` as `choice`
  on `queue-outcomes`) — the exact parameter set per report is **not**
  pinned (no issue body enumerates it); only the choice→`<select>` /
  text→`<input>` dispatch rule is contractual.
- **§4c** A submit button with the exact text **`Run report`**,
  `data-testid` `reports-run-button`.

## §5 — Export CSV (RPT-5, #24)

- **§5a** Before any report has run this session: a **disabled** control
  with the exact accessible name **`Export CSV`**, `data-testid`
  `reports-export-action`, and a `title`/tooltip explaining why (this
  contract's wording: `Run a report to enable CSV export` — #24 only
  specifies the *posture* — "disabled-with-tooltip", same guard
  `reports_export_action`/`DriveQueuePanel`'s row actions already use — not
  the exact tooltip string).
- **§5b** After a report has run this session: a real `<a>` element with the
  `download` attribute, same accessible name `Export CSV`, same
  `data-testid`. Its `href` carries `format=csv` in the query string — this
  is the one wire detail #24 states explicitly ("hitting
  code-coordinator#2492's `?format=csv` route directly"). The **base path**
  shown in the mocks (`/api/reports/<key>?format=csv...`) is this contract's
  own placeholder, inferred from this repo's existing flat `/api/*`
  convention (`/api/drive-queue`, `/api/pipeline`) and #21's
  `fetchReportCatalogue`/`fetchReport` naming — it is **not confirmed by any
  ms-2 issue body** and must be checked against code-coordinator#2492's
  actual route before being treated as contractual. See §7.5.
- **§5c** No client-side CSV generation — the export is a navigation/download
  of a server-rendered file, never a blob built in the browser.

## §6 — Grid

- **§6a** A table (or equivalent grid), `data-testid` `reports-grid`, with
  one `<th>` per `ColumnMeta` column and one row per result.
- **§6b** Column-kind → cell rendering (port of `reports_cell_text` /
  `tui/src/app/reports.rs`, per #21's literal kind list — `text`, `int`,
  `timestamp`, `list`, `money`, `duration`, `enum`):

  | `ColumnMeta.kind` | Rendering pinned by this contract | Shown in |
  |---|---|---|
  | `text` | Plain text, left-aligned | all grids |
  | `int` | Mono, right-aligned | `reports-grid.html` (`#`, `Tries`), `reports-chart.html` (`Count`) |
  | `enum` | A status pill matching the same success/warning/destructive/outline/idle wash-background convention `Badge` already uses elsewhere (`DriveQueuePanel`'s `stateBadgeVariant`) — never solid-fill-plus-white-text | `State`, `Outcome` columns |
  | `timestamp` | `YYYY-MM-DD HH:MM`, mono | `Updated`, `Timestamp` columns |
  | `duration` | Compact human string (`3h 12m`, `1d 4h`), mono | `Age` column |
  | `list` | Comma-joined, mono, em-dash (`—`) when empty | `After` column |
  | `money` | **Not demonstrated in any mock** — no report in this milestone's five newly-lit reports obviously needs it; flagged in §7.6 rather than inventing a report to show it | — |

  An unrecognised/future `kind` is explicitly out of scope for this
  contract; #21 doesn't specify a fallback and this mock set doesn't invent
  one.
- **§6c** Clicking a sortable column header toggles client-side ascending/
  descending sort. The sorted header carries `aria-sort` (`"ascending"` /
  `"descending"`) and a visible glyph suffix (▲/▼) — pinned in
  `reports-grid.html`'s `#` column (`aria-sort="ascending"`, `▲`).
- **§6d** The `decisions` report's `options` column (#22's specific risk:
  *"dicts with `label`/`command_or_action`/`recommended`, not scalars ...
  render sanely instead of falling through to raw JSON"*): each cell is a
  list, one line per option —
  - the visible text is the option's `label`;
  - `recommended: true` adds a trailing **★** glyph plus a visually-hidden
    `(recommended)` suffix (an `.sr-only` span) — so the distinction survives
    for a screen reader, not just sighted color;
  - `command_or_action` is carried in the native `title` attribute only,
    never printed inline — it is the machine-facing value, not something a
    human reads by default.
  - **What this contract does NOT pin**: raw JSON, or any single-line
    stringified-dict rendering, must never appear in this cell. That
    negative assertion is the one #22 explicitly asks for.

## §7 — Row navigation via `row_identity` (RPT-4, #23)

- **§7a** Exactly **three** of the six catalogue reports declare
  `row_identity` today, per #23's own literal list: **`issue-activity`**,
  **`completed`**, **`decisions`**. `usage` and `queue-outcomes` do not (they
  are aggregate reports with no single owning issue per row — inferred, not
  stated, but consistent with #23's "Reports with none render exactly as
  before").
- **§7b** On a `row_identity`-declaring report, the identifying cell renders
  as a `<Link to={paths.pipelineItem(repo, issue)}>` **plus** a small
  secondary "open in new tab" `<a target="_blank">` affordance immediately
  next to it — the exact pattern #23 cites verbatim: *"same pattern +
  open-in-new-tab affordance DriveQueuePanel's Issue column already uses
  (#9)"*. Pinned in `reports-row-nav.html` and `reports-decisions.html`:
  `<a class="primary-link">` (the mono issue key, e.g. `api#42`) followed by
  a second `<a>` with `aria-label="Open <key> in a new tab"` and `title="Open
  in new tab"`.
- **§7c** On a non-`row_identity` report, the same-shaped identifying column
  (if the report has one at all) renders as plain text — no `<Link>`, no
  external-link affordance. Pinned in `reports-grid.html`'s `Issue` column.

### §7.1 — Flagged: is drive-queue-status's row_identity omission deliberate?

`drive-queue-status` (RPT-2's own report, #21) is conspicuously **absent**
from RPT-4's row_identity list (#23: *"issue-activity, completed, decisions
today"*), despite being structurally identical issue-keyed data
(`repo_name`/`issue_number` per row) to `DriveQueuePanel`'s existing grid,
which **already has** row navigation (#9, shipped). This contract does not
resolve whether that's an intentional scope cut for RPT-2 (ships before
RPT-4 exists) that was simply never revisited, or an oversight in #23's
issue body. `reports-grid.html` renders the literal, stated behavior (no
Link) — but a worker landing #23 should double-check whether
`drive-queue-status` was meant to be a fourth entry on that list before
building against this mock as-is.

### §7.2-§7.6 — Other open questions, not resolved here

- **§7.2** `paths.reports()`'s name and the `/reports` path itself are this
  contract's own choice (mirroring `paths.queue()`/`paths.board()`) — no
  issue body names either.
- **§7.3** The `Reports` rail item's exact position within the `Insight`
  group (relative to `Audit`/`Spend`) is unpinned.
- **§7.4** Tabs-vs-left-list for the picker (§3e) — #21 explicitly leaves
  this open; this contract picks tabs.
- **§7.5** The CSV export's base route path (§5b) is inferred, not
  confirmed against code-coordinator#2492.
- **§7.6** No report in this milestone's set obviously exercises
  `ColumnMeta.kind: money` — not demonstrated, not invented.
- **§7.7** RPT-6 (#25) explicitly defers its own charting-library and exact
  mark-type decision to itself ("needs a charting-library decision first ...
  check the dataviz skill for house style before picking one"). This
  contract's chart mocks (`reports-chart.html` /
  `reports-chart-degraded.html`) are illustrative of *shape* — chart above
  grid, direct value labels, status-colour reuse, one-line Degrade fallback
  — not a mandated library, mark type, or pixel geometry. Section 8 below
  lists exactly what IS load-bearing from those two mocks.

## §8 — Chart rendering (RPT-6, #25)

- **§8a** When the running report's result declares a `chart`, a chart
  region renders **above** the grid (never in place of it, never below it).
  `data-testid` `reports-chart` on the Render outcome, `role="img"` with a
  full-text `aria-label` summarizing every category+value (accessibility
  fallback for a hand-drawn chart with no native table semantics).
- **§8b** Category colours are the same `pass`/`attn`/`fail`/`idle` status
  colours the grid's own badges already use for the identical semantic
  values (`completed`→pass/green, `held`→attn/amber, `blocked`→fail/red,
  `abandoned`→idle/gray) — never a freshly generated categorical hue for a
  value that is really a status. Pinned exactly in `reports-chart.html`.
- **§8c** Every mark carries a direct, visible value label — colour is never
  the sole carrier of the count (dataviz house style: status colours "ship
  with an icon + label, never colour alone"). No legend is required for a
  single-series chart whose categories are already axis-labelled.
- **§8d** **Degrade outcome** (`ChartPlan::Degrade`, ported from
  `tui/src/app/reports.rs`): when the chart can't be rendered (pinned
  example: fewer than two non-zero categories), the chart's region shows a
  **one-line reason** instead — `role="status"`, `data-testid`
  `reports-chart-degraded`, the reason text itself in a child element
  `data-testid="reports-chart-degraded-reason"` — and the grid below renders
  in full, completely unaffected. Pinned in `reports-chart-degraded.html`.
  **The failure mode this guards against**: a half-drawn chart, or a chart
  that silently vanishes while giving no indication anything was skipped.
  Either is wrong even if the grid itself is fine.
- **§8e** **None outcome** (no `chart` in the result at all): no chart region
  in the DOM — see §0's table; not a separate mock.

## Not in scope

- Any visual property beyond what's pinned above — colour, spacing, font,
  exact chart geometry. The mocks render a full visual so a human can
  recognise the screen; the contract asserts none of that beyond §8's
  colour-semantics rule (which is about *meaning*, not aesthetics).
- Loading and error states for the panel (query in flight, fetch failure) —
  no issue body describes them and inventing one here would be scope creep
  for a pre-work gate.
- The exact set of parameters per report beyond the choice/text dispatch
  rule (§4b).
- Narrow/phone layout for this panel — none of #21-#25 mention it, and
  `ActivityRail`'s narrow mode already only shows `'ready'` items, so
  `Reports` will appear there once built; its list-panel layout under 768px
  is unaddressed.
- Pagination/truncation of large result sets (see §2c) — unaddressed by any
  ms-2 issue body.

## Amending

This contract is versioned and amendable, not frozen. If an implementer
discovers this contract is wrong once #21-#25 actually land (most likely
candidates: §7.1's flagged omission gets resolved either way, or §7.5's
guessed route path turns out different), amend this file **and** re-author
the affected mock/slice together — don't let the two drift apart, which is
exactly what the oracle-loop process (docs/ORACLE_LOOP.md) exists to
prevent.

## SMOKE_TESTS

SMOKE_TESTS:
- Reports rail entry — open any mock in a browser — confirm a "Reports" item is visible and highlighted/selected in the left rail, under the "Insight" group heading (below "Audit" and "Spend", both dimmed with a "soon" pill), and that it does NOT look dimmed like its Audit/Spend neighbours.
- Report picker tabs — open `mocks/reports-picker.html` — confirm six pill-shaped tabs read "Drive queue status", "Issue activity", "Completed", "Decisions", "Usage", "Queue outcomes" in that order, with "Drive queue status" highlighted (filled, not outlined).
- Export gating — open `mocks/reports-picker.html` — confirm the "Export CSV" button looks greyed-out/disabled and hovering it shows a tooltip explaining a report must be run first; then open `mocks/reports-grid.html` — confirm "Export CSV" now looks like a normal enabled link (accent-coloured border/text).
- Grid column variety — open `mocks/reports-grid.html` — confirm the grid shows a mix of plain text, a colored status pill (State column: green "running", red "blocked", outlined "waiting"), right-aligned numbers, and a sorted "#" column header with a "▲" arrow.
- Row navigation contrast — open `mocks/reports-row-nav.html` — confirm the Issue column values (e.g. "api#42") are underlined-on-hover links with a small arrow/external-link glyph next to each; then open `mocks/reports-grid.html` — confirm its Issue column ("api#42" etc.) is plain, non-clickable-looking text by contrast.
- Decisions options rendering — open `mocks/reports-decisions.html` — confirm the "Options" column shows short readable option lines (e.g. "Release gate ★", "Extend hold") stacked per row, NOT a raw JSON blob or a single run-on string; hovering an option should show a tooltip with a `coord ...` command.
- Chart above the grid — open `mocks/reports-chart.html` — confirm a bar chart (4 colored bars labelled Completed/Held/Blocked/Abandoned, each with a number above it) sits above a data table, and the bar colors visually match each row's status-pill color in the table beneath.
- Chart degrade fallback — open `mocks/reports-chart-degraded.html` — confirm the chart's usual position instead shows a single amber-tinted line of text with a warning glyph (no chart/SVG at all), and the data table below it still renders normally with real data.
END_SMOKE_TESTS
