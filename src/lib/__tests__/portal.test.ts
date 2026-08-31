/**
 * Unit tests for `src/lib/portal.ts` (#59 — the Answers screen).
 */
import { describe, it, expect } from 'vitest'
import {
  canSubmitPortalAnswer,
  isPortalAnswerSource,
  PORTAL_ANSWER_SOURCES,
  portalAnswerSourceLabel,
  portalItemDisplayRef,
  todayIsoDate,
} from '../portal'

describe('isPortalAnswerSource', () => {
  it('accepts exactly the three wire-valid sources', () => {
    expect(isPortalAnswerSource('verbal')).toBe(true)
    expect(isPortalAnswerSource('phone')).toBe(true)
    expect(isPortalAnswerSource('email')).toBe(true)
  })

  it('rejects the unset select value and anything else', () => {
    expect(isPortalAnswerSource('')).toBe(false)
    expect(isPortalAnswerSource('carrier-pigeon')).toBe(false)
  })
})

describe('portalAnswerSourceLabel', () => {
  it('gives every PORTAL_ANSWER_SOURCES entry a non-empty label', () => {
    for (const source of PORTAL_ANSWER_SOURCES) {
      expect(portalAnswerSourceLabel(source).length).toBeGreaterThan(0)
    }
  })
})

describe('canSubmitPortalAnswer', () => {
  it('requires non-whitespace text and a valid source', () => {
    expect(canSubmitPortalAnswer('They confirmed the address', 'phone')).toBe(true)
  })

  it('refuses an empty or whitespace-only answer', () => {
    expect(canSubmitPortalAnswer('', 'phone')).toBe(false)
    expect(canSubmitPortalAnswer('   \n\t  ', 'email')).toBe(false)
  })

  it('refuses a submission with no source selected -- provenance is not optional (#59)', () => {
    expect(canSubmitPortalAnswer('They confirmed the address', '')).toBe(false)
  })

  it('refuses an unrecognised source string', () => {
    expect(canSubmitPortalAnswer('Some answer', 'carrier-pigeon')).toBe(false)
  })
})

describe('todayIsoDate', () => {
  it('formats a given date as YYYY-MM-DD, zero-padded', () => {
    expect(todayIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(todayIsoDate(new Date(2026, 10, 23))).toBe('2026-11-23')
  })
})

describe('portalItemDisplayRef', () => {
  it('prefers an explicit title', () => {
    expect(
      portalItemDisplayRef({
        submission_id: 'sub-1',
        title: 'Acme Corp intake',
        repo_name: 'coord-portal',
        issue_number: 42,
      }),
    ).toBe('Acme Corp intake')
  })

  it('falls back to the aliased issue ref when there is no title', () => {
    expect(
      portalItemDisplayRef({
        submission_id: 'sub-1',
        title: null,
        repo_name: 'coord-portal',
        issue_number: 42,
      }),
    ).toBe('CP#42')
  })

  it('falls back to the bare submission id when neither is known', () => {
    expect(
      portalItemDisplayRef({
        submission_id: 'sub-1',
        title: null,
        repo_name: null,
        issue_number: null,
      }),
    ).toBe('Submission sub-1')
  })
})
