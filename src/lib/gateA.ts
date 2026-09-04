/**
 * Gate-A review panel — pure helpers (#90, slice 2/2 of claude-coordinator#3066).
 *
 * `GateAPanel.tsx` is a thin client over `GET /api/gate-a/{repo}/{tracking_issue}`
 * (claude-coordinator#3069) — this module holds the logic worth unit-testing on
 * its own: verdict/state display mapping, the exact `coord gate-a` command
 * strings this read-only panel surfaces (never executes — see the issue's
 * "Not in this slice"), the width-control presets, and finding `## Amendment`
 * sections in the raw contract markdown so the panel can surface them instead
 * of leaving them wherever they happen to sit in the document (issue #90:
 * "On coord-portal ms-4 the amendment is the only part anyone needs to read,
 * and it sits 200 lines down").
 */
import type { GateAPacket } from '@/api/client'
import { BREAKPOINT_MEDIUM_PX } from '@/shell/breakpoints'

// ── Verdict / state display ─────────────────────────────────────────────────

/** `GateAPacket.state`'s real value set (`coord.gate_a.evaluate()` — see
 * `src/api/generated.ts`'s `GateAPacket` doc comment: this endpoint reads the
 * same decision the CLI prints, so this list can never disagree with it). */
export type GateAState = GateAPacket['state']

const STATE_LABELS: Record<GateAState, string> = {
  approved: 'Approved',
  missing: 'No verdict recorded',
  stale: 'Stale — contract changed since sign-off',
  changes: 'Changes requested',
  exempt: 'Exempt',
}

/** Human label for a gate state — the panel's own vocabulary, not a raw enum
 * value, so `stale` in particular reads as the unmissable warning issue #90
 * asks for ("Stale must be unmissable; it is the whole reason someone is
 * looking") rather than a bare word. */
export function gateAStateLabel(state: GateAState): string {
  return STATE_LABELS[state] ?? state
}

export type GateABadgeTone = 'success' | 'warning' | 'destructive' | 'secondary'

const STATE_TONES: Record<GateAState, GateABadgeTone> = {
  approved: 'success',
  missing: 'secondary',
  stale: 'destructive',
  changes: 'warning',
  exempt: 'secondary',
}

/** Which `Badge` variant (`src/components/ui/badge.tsx`) a state renders as
 * — `stale` and `changes` both read as attention-needing, but distinctly
 * (destructive vs warning), matching this file's own `STATE_LABELS`
 * severity ordering. */
export function gateAStateTone(state: GateAState): GateABadgeTone {
  return STATE_TONES[state] ?? 'secondary'
}

// ── CLI commands this read-only panel surfaces (never executes) ────────────
//
// Issue #90's "Not in this slice": "A Gate-A sign-off is a human authority
// gate; moving where it can be exercised is a deliberate decision, not a
// rendering one." So this panel only ever prints these two commands for an
// operator to run themselves — verified against the installed
// `code-coordinator==0.5.359`'s own `coord gate-a --help` (REPO
// TRACKING_ISSUE positionals, `--approved`/`--changes`/`--note`), not
// guessed from the issue text.

/** `coord gate-a REPO TRACKING_ISSUE --approved`. */
export function gateAApprovedCommand(repo: string, trackingIssue: number): string {
  return `coord gate-a ${repo} ${trackingIssue} --approved`
}

/** `coord gate-a REPO TRACKING_ISSUE --changes` — `--note` is left as a
 * placeholder for the operator to fill in, not guessed at here. */
export function gateAChangesCommand(repo: string, trackingIssue: number): string {
  return `coord gate-a ${repo} ${trackingIssue} --changes --note "..."`
}

// ── Width control (#90's explicit acceptance bar) ───────────────────────────
//
// "ms-4's amendment existed *because* a header reflowed at narrow widths, so
// checking the fix at 390px was the substance of that review." 390 is
// therefore an exact requirement, not a rounded phone-ish guess. Tablet
// mirrors this repo's own shell breakpoint (`BREAKPOINT_MEDIUM_PX`,
// `src/shell/breakpoints.ts`) so "tablet" means the same width everywhere in
// this app. `full` is `null` — no forced width, the mock frame fills its
// container.

export type GateAWidthId = 'phone' | 'tablet' | 'full'

export interface GateAWidthPreset {
  id: GateAWidthId
  label: string
  /** Forced pixel width, or `null` for "fill the container". */
  px: number | null
}

export const GATE_A_WIDTH_PRESETS: readonly GateAWidthPreset[] = [
  { id: 'phone', label: 'Phone (390px)', px: 390 },
  { id: 'tablet', label: `Tablet (${BREAKPOINT_MEDIUM_PX}px)`, px: BREAKPOINT_MEDIUM_PX },
  { id: 'full', label: 'Full width', px: null },
]

export function gateAWidthPreset(id: GateAWidthId): GateAWidthPreset {
  return GATE_A_WIDTH_PRESETS.find((p) => p.id === id) ?? GATE_A_WIDTH_PRESETS[2]
}

// ── Mock frame theme control ────────────────────────────────────────────────

export type GateAMockTheme = 'light' | 'dark'
export const GATE_A_MOCK_THEMES: readonly GateAMockTheme[] = ['dark', 'light']

// ── Amendment sections ──────────────────────────────────────────────────────

/** Does a level-2 heading's text mark it as an amendment section — "## Amendment 1: ..."
 * etc. Matched at the start of the (trimmed) heading text, case-insensitively,
 * so "## Amendment" / "## AMENDMENT 2" / "## amendments" all count, but a
 * heading that merely mentions the word later ("## Notes on the Amendment
 * process") does not. */
export function isAmendmentHeadingText(text: string): boolean {
  return /^amendments?\b/i.test(text.trim())
}

/**
 * Every `## `-level heading in *markdown* whose text marks it as an
 * amendment (`isAmendmentHeadingText`), in document order, heading text only
 * (no leading `## `).
 *
 * Regex over the raw markdown source, not a full parse — good enough for
 * `coord.acceptance`-authored contract.md files, which use plain ATX
 * (`## `) headings throughout; a literal `## Amendment` string sitting
 * inside a fenced code block would false-positive here, but contract docs
 * don't do that in practice and this stays dependency-free. Only `##`
 * (level 2) matches, matching issue #90's own example verbatim ("any `##
 * Amendment` sections").
 */
export function extractAmendmentHeadings(markdown: string): string[] {
  const headings: string[] = []
  const re = /^##[ \t]+(.+?)[ \t]*$/gm
  for (const match of markdown.matchAll(re)) {
    const text = match[1].trim()
    if (isAmendmentHeadingText(text)) headings.push(text)
  }
  return headings
}
