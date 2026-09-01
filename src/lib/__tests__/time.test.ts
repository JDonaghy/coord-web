/**
 * Unit tests for `src/lib/time.ts`'s `formatRelativeTime`.
 *
 * Extracted from `PipelineCard.tsx` (#63) once `MachineDetail` needed the
 * same "3h ago" bucketing for last-contact / worker / job-history ages --
 * `PipelineCard.test.tsx`'s "relative-time label" describe block covers the
 * identical bucket boundaries indirectly (through the rendered card, since
 * the function used to be module-private there); this file covers the
 * function directly now that it's a real module with its own export.
 */
import { describe, it, expect } from 'vitest'

import { formatRelativeTime } from '../time'

describe('formatRelativeTime', () => {
  const now = 1_800_000_000_000 // fixed reference instant, in ms

  it('renders "just now" for timestamps under a minute old', () => {
    expect(formatRelativeTime(now / 1000 - 30, now)).toBe('just now')
  })

  it('renders minutes for timestamps under an hour old', () => {
    expect(formatRelativeTime(now / 1000 - 5 * 60, now)).toBe('5m ago')
  })

  it('renders hours for timestamps under a day old', () => {
    expect(formatRelativeTime(now / 1000 - 3 * 60 * 60, now)).toBe('3h ago')
  })

  it('renders days for timestamps under a week old', () => {
    expect(formatRelativeTime(now / 1000 - 2 * 24 * 60 * 60, now)).toBe('2d ago')
  })

  it('renders a month/day date for timestamps a week or older', () => {
    const eightDaysAgoSeconds = 8 * 24 * 60 * 60
    const epochSeconds = now / 1000 - eightDaysAgoSeconds
    const expected = new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
    expect(formatRelativeTime(epochSeconds, now)).toBe(expected)
  })

  it('defaults `now` to the real clock when omitted', () => {
    const nowSeconds = Date.now() / 1000
    expect(formatRelativeTime(nowSeconds)).toBe('just now')
  })
})
