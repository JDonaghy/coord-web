/**
 * Unit tests for `src/lib/gateA.ts` (#90 — the Gate-A review panel).
 */
import { describe, it, expect } from 'vitest'
import {
  extractAmendmentHeadings,
  gateAApprovedCommand,
  gateAChangesCommand,
  gateAStateLabel,
  gateAStateTone,
  gateAWidthPreset,
  GATE_A_WIDTH_PRESETS,
  isAmendmentHeadingText,
  type GateAState,
} from '../gateA'

describe('gateAStateLabel / gateAStateTone', () => {
  it('gives every real GateAPacket.state value a label and a tone', () => {
    const states: GateAState[] = ['approved', 'missing', 'stale', 'changes', 'exempt']
    for (const state of states) {
      expect(gateAStateLabel(state).length).toBeGreaterThan(0)
      expect(['success', 'warning', 'destructive', 'secondary']).toContain(gateAStateTone(state))
    }
  })

  it('marks stale as destructive -- the state the panel must make unmissable', () => {
    expect(gateAStateTone('stale')).toBe('destructive')
    expect(gateAStateLabel('stale')).toMatch(/stale/i)
  })

  it('marks approved as success and changes-requested as warning, not the same tone', () => {
    expect(gateAStateTone('approved')).toBe('success')
    expect(gateAStateTone('changes')).toBe('warning')
  })
})

describe('gateAApprovedCommand / gateAChangesCommand', () => {
  it('builds the exact `coord gate-a` invocation verified against --help', () => {
    expect(gateAApprovedCommand('coord-portal', 4)).toBe('coord gate-a coord-portal 4 --approved')
    expect(gateAChangesCommand('coord-portal', 4)).toBe(
      'coord gate-a coord-portal 4 --changes --note "..."',
    )
  })
})

describe('GATE_A_WIDTH_PRESETS / gateAWidthPreset', () => {
  it('has exactly phone (390px), tablet, and full presets', () => {
    expect(GATE_A_WIDTH_PRESETS.map((p) => p.id)).toEqual(['phone', 'tablet', 'full'])
    expect(gateAWidthPreset('phone').px).toBe(390)
  })

  it('full width has no forced pixel width', () => {
    expect(gateAWidthPreset('full').px).toBeNull()
  })
})

describe('isAmendmentHeadingText', () => {
  it('matches "Amendment" at the start of the heading, case-insensitively', () => {
    expect(isAmendmentHeadingText('Amendment 1: header reflow at narrow widths')).toBe(true)
    expect(isAmendmentHeadingText('AMENDMENT 2')).toBe(true)
    expect(isAmendmentHeadingText('amendments')).toBe(true)
    expect(isAmendmentHeadingText('  Amendment 1  ')).toBe(true)
  })

  it('does not match a heading that only mentions the word later', () => {
    expect(isAmendmentHeadingText('Notes on the amendment process')).toBe(false)
    expect(isAmendmentHeadingText('Scope')).toBe(false)
  })
})

describe('extractAmendmentHeadings', () => {
  it('finds every level-2 Amendment heading in document order, text only', () => {
    const markdown = [
      '# coord-portal ms-4',
      '',
      '## Scope',
      '',
      'Some body text.',
      '',
      '## Amendment 1: header reflow at 390px',
      '',
      'Body.',
      '',
      '### Amendment 1 detail',
      '',
      '## Amendment 2: mock naming',
      '',
      'More body.',
    ].join('\n')

    expect(extractAmendmentHeadings(markdown)).toEqual([
      'Amendment 1: header reflow at 390px',
      'Amendment 2: mock naming',
    ])
  })

  it('ignores non-Amendment level-2 headings and any level-3 headings', () => {
    const markdown = '## Scope\n\n## Amendment 1\n\n### Amendment 1 sub-detail\n'
    expect(extractAmendmentHeadings(markdown)).toEqual(['Amendment 1'])
  })

  it('returns an empty list for a contract with no amendments -- the common case', () => {
    const markdown = '# Milestone contract\n\n## Scope\n\n## Acceptance criteria\n'
    expect(extractAmendmentHeadings(markdown)).toEqual([])
  })

  it('handles an empty contract', () => {
    expect(extractAmendmentHeadings('')).toEqual([])
  })
})
