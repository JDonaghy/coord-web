/**
 * Unit tests for `src/lib/repoRef.ts` (#46).
 *
 * `repoAlias` mirrors `repo_alias()` in `tui/src/app/drive_queue.rs`
 * (claude-coordinator#2042) -- these fixtures deliberately match the ones in
 * this issue's own write-up so a future reader can compare the two directly.
 */
import { describe, it, expect } from 'vitest'
import { repoAlias, issueRef, aliasIssueRef } from '../repoRef'

describe('repoAlias', () => {
  it('aliases a hyphenated repo name to its segments\' first letters, uppercased', () => {
    expect(repoAlias('coord-web')).toBe('CW')
    expect(repoAlias('claude-coordinator')).toBe('CC')
    expect(repoAlias('repo-alpha')).toBe('RA')
    expect(repoAlias('repo-beta')).toBe('RB')
  })

  it('aliases a repo name with no hyphen to its single first letter', () => {
    expect(repoAlias('quadraui')).toBe('Q')
  })

  it('strips an owner/ prefix before aliasing, rather than aliasing the whole slug', () => {
    expect(repoAlias('JDonaghy/coord-web')).toBe('CW')
  })
})

describe('issueRef', () => {
  it('joins the alias directly to the issue number, with no space before #', () => {
    expect(issueRef('claude-coordinator', 2639)).toBe('CC#2639')
    expect(issueRef('coord-web', 26)).toBe('CW#26')
  })

  it('accepts a string issue number too', () => {
    expect(issueRef('quadraui', '597')).toBe('Q#597')
  })
})

describe('aliasIssueRef', () => {
  it('aliases a wire repo#N key to its display spelling', () => {
    expect(aliasIssueRef('repo-alpha#9101')).toBe('RA#9101')
    expect(aliasIssueRef('coord-web#7')).toBe('CW#7')
  })

  it('returns the input unchanged when it has no # separator', () => {
    expect(aliasIssueRef('not-a-key')).toBe('not-a-key')
  })
})
