/**
 * The activity rail's contents (#1547).
 *
 * "Panels not yet built are visibly *coming*, not silently absent — the rail
 * is the program's own progress bar." So this list is the whole planned M-W1
 * surface, and each entry carries its own truth about whether it exists yet.
 * A `'soon'` entry renders dimmed with a `soon` pill and is not activatable
 * (the Gate-A mock, docs/mocks/web/pipeline-wide.html, gives them
 * `opacity:.42` and `cursor:default`); flipping one to `'ready'` when its
 * story lands is a one-line change here plus a case in `ShellLayout`.
 *
 * Grouping follows the mock exactly: an ungrouped top block, then Flow, then
 * Insight, with Theme / Settings / Collapse pinned to the rail foot.
 */
import {
  BarChart3,
  BookOpen,
  FileBarChart2,
  GitMerge,
  LayoutDashboard,
  ListOrdered,
  Milestone,
  PhoneCall,
  ScrollText,
  Server,
  SquareTerminal,
  Terminal,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

import type { ShellView } from './shellState'

export type RailItemStatus = 'ready' | 'soon'

export interface RailItem {
  id: ShellView
  label: string
  icon: LucideIcon
  status: RailItemStatus
  /** Group heading this item sits under; `undefined` = the top block. */
  group?: string
  /** Shown on hover / in the `soon` pill's tooltip. */
  hint?: string
  /** `data-testid` on the rendered nav button — only set where a contract
   * (e.g. `tests/acceptance/ms-2/contract.md` §1c's `rail-item-reports`)
   * pins one; `ActivityRail`'s `NavItem` omits the attribute entirely when
   * this is unset rather than inventing an id nobody asked for. */
  testId?: string
}

export const RAIL_ITEMS: readonly RailItem[] = [
  { id: 'pipeline', label: 'Pipeline', icon: Workflow, status: 'ready' },
  { id: 'board', label: 'Board', icon: LayoutDashboard, status: 'soon', hint: 'Board panel — M-W2' },
  { id: 'sessions', label: 'Sessions', icon: SquareTerminal, status: 'ready' },
  {
    // #59 — record an out-of-band client answer (in person, on a call, by
    // email) against a `needs-input` submission's open question. Ungrouped,
    // alongside Pipeline/Sessions rather than under Flow/Insight: the
    // triggering event is a live phone call, so this needs the same
    // one-tap-from-anywhere reach those two get, not the lower priority a
    // grouped/collapsed entry implies.
    id: 'answers',
    label: 'Answers',
    icon: PhoneCall,
    status: 'ready',
    hint: 'Record an out-of-band client answer — #59',
  },
  {
    // #93 — one submission's whole run as an ordered narrative. Ungrouped,
    // next to Answers, for the same reason Answers is: the audience is a
    // client on a call or someone watching a screen share, not an operator
    // browsing Flow/Insight — it needs the same one-tap-from-anywhere reach,
    // not the lower priority a grouped entry implies.
    id: 'journal',
    // `BookOpen`, not `ScrollText`: Audit below already owns the scroll, and
    // two rail entries wearing the same glyph is exactly the kind of thing a
    // 60px collapsed rail turns into a coin flip.
    label: 'Journal',
    icon: BookOpen,
    status: 'ready',
    hint: "One submission's run, in order — #93",
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: Terminal,
    status: 'soon',
    hint: 'Standalone terminal panel — open one from Sessions for now',
  },
  {
    id: 'machines',
    label: 'Machines',
    icon: Server,
    // #61: rail entry + route + API client wiring ship in this story, same
    // "route + nav are done, the rest fills in later" posture `queue`'s own
    // comment below documents for QW-2/QW-3 — the full metrics/health grid
    // (milestone #4's later stories) isn't built yet.
    status: 'ready',
    hint: 'Machine roster, health & work stats — milestone #4',
  },

  {
    id: 'merge-queue',
    label: 'Merge queue',
    icon: GitMerge,
    status: 'soon',
    group: 'Flow',
    hint: 'Merge queue panel — M-W2',
  },
  {
    // #91: flipped from 'soon' to 'ready' the day the backend it needs
    // actually shipped — claude-coordinator#3072's `GET /api/milestones` +
    // `GET /api/milestones/{repo}/{number}`. The old `soon` label was
    // misleading in a specific way this repo has been burned by three times
    // (#76/#84/#85): it implied a panel merely awaiting UI work, when there
    // was no route of any kind behind it. The panel below is written against
    // a live, curled endpoint, and still degrades to an explanatory empty
    // state on a coord server too old to serve it.
    id: 'milestones',
    label: 'Milestones',
    icon: Milestone,
    status: 'ready',
    group: 'Flow',
    hint: 'Milestone roster, work order & Gate-A sign-off — #91',
  },
  {
    id: 'queue',
    label: 'Queue',
    icon: ListOrdered,
    // Route + rail entry ship in this story (QW-2); the grid that fills it
    // is QW-3. Unlike the other 'soon' entries above, this one is already
    // navigable — landing on `ComingSoon` today is a placeholder for its
    // *content*, not a sign the route itself is unbuilt.
    status: 'ready',
    group: 'Flow',
    hint: 'Queue grid — QW-3',
  },

  {
    id: 'audit',
    label: 'Audit',
    icon: ScrollText,
    status: 'soon',
    group: 'Insight',
    hint: 'Audit trail — milestone #33',
  },
  {
    id: 'spend',
    label: 'Spend',
    icon: BarChart3,
    status: 'soon',
    group: 'Insight',
    hint: 'Spend & time observability — milestone #37',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileBarChart2,
    // #21 RPT-2: unlike its Audit/Spend neighbours above, Reports ships a
    // real panel (the catalogue picker + drive-queue-status grid) in this
    // same story — 'ready', not another placeholder.
    status: 'ready',
    group: 'Insight',
    hint: 'Report catalogue + drive-queue-status grid — RPT-2',
    testId: 'rail-item-reports',
  },
] as const

/**
 * Rail items in render order, split into their heading groups. Computed once
 * at module scope: `RAIL_ITEMS` is a constant, so recomputing per render would
 * be pure waste and would break `React.memo` on any consumer.
 */
export const RAIL_GROUPS: ReadonlyArray<{ heading?: string; items: RailItem[] }> =
  RAIL_ITEMS.reduce<Array<{ heading?: string; items: RailItem[] }>>((groups, item) => {
    const last = groups[groups.length - 1]
    if (last && last.heading === item.group) {
      last.items.push(item)
    } else {
      groups.push({ heading: item.group, items: [item] })
    }
    return groups
  }, [])
