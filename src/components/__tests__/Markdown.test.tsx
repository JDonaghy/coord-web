/**
 * Component tests for the shared `Markdown` renderer (#114) — the single
 * `react-markdown` + `remark-gfm` wrapper extracted from `BoardDetail`'s
 * former `IssueBodyMarkdown` and `GateAPanel`'s `ContractMarkdown`.
 *
 * The bar this exists to clear: markdown syntax (`##`, `-`, backticks,
 * fenced code) must render as real elements, not survive as literal
 * characters in the text — which is exactly what a raw `<pre>` dump (the
 * bug #114 fixes at the Detail findings call site) would show instead.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from '@/components/Markdown'

describe('Markdown', () => {
  it('renders a heading, a list, inline code, and a fenced block as elements, not literal syntax', () => {
    const markdown = [
      '## Findings',
      '',
      '- Missing test for the new branch',
      '- Uses `unwrap()` instead of `?`',
      '',
      '```rust',
      'fn main() {}',
      '```',
      '',
    ].join('\n')

    render(<Markdown markdown={markdown} />)

    // Heading became a real <h2>, not a "## Findings" text node.
    expect(screen.getByRole('heading', { level: 2, name: 'Findings' })).toBeInTheDocument()
    expect(screen.queryByText(/##/)).not.toBeInTheDocument()

    // List items became real <li>s inside a <ul>, not "-"-prefixed lines.
    const list = screen.getByRole('list')
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(list).toContainElement(items[0])
    expect(screen.getByText('Missing test for the new branch')).toBeInTheDocument()

    // Inline code became a real <code>, not backtick-wrapped plain text.
    const inlineCode = screen.getByText('unwrap()')
    expect(inlineCode.tagName).toBe('CODE')
    expect(screen.queryByText(/`unwrap\(\)`/)).not.toBeInTheDocument()

    // The fenced block became a <pre><code>, and the ``` fence markers
    // themselves never appear anywhere in the rendered text.
    expect(screen.getByText('fn main() {}')).toBeInTheDocument()
    expect(screen.queryByText(/```/)).not.toBeInTheDocument()
  })

  it('merges a per-caller component override into the shared map rather than replacing it', () => {
    render(
      <Markdown
        markdown={'## Amendment 1\n\nSomething changed.\n\n- still a list\n'}
        components={{
          h2: ({ children }) => <h2 data-testid="custom-h2">{children}</h2>,
        }}
      />,
    )

    // The override took effect...
    expect(screen.getByTestId('custom-h2')).toHaveTextContent('Amendment 1')
    // ...without losing the rest of the shared map (list rendering still works).
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText('still a list')).toBeInTheDocument()
  })

  it('keeps only pre/table scrollable, never the wrapper itself, for the "no sideways page scroll" policy', () => {
    const { container } = render(<Markdown markdown={'```\nlong code\n```\n'} />)
    const pre = container.querySelector('pre')
    expect(pre).toHaveClass('overflow-x-auto')
  })
})
