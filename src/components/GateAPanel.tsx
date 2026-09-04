/**
 * GateAPanel — a milestone's Gate-A review packet at `/gate-a/:repo/:trackingIssue`
 * (#90, slice 2/2 of claude-coordinator#3066).
 *
 * "Sign off a Gate-A contract from a phone or a screen share, no git
 * checkout." A thin client over `GET /api/gate-a/{repo}/{tracking_issue}`
 * (claude-coordinator#3069) — every byte rendered here (gate state, contract
 * markdown, mock HTML) comes off that one response; there is no second
 * fetch for a mock (`GateAMockWire.html` already has every relatively-linked
 * stylesheet inlined server-side) and no write path (see "Not in this
 * slice" below).
 *
 * Four pieces, matching the issue's acceptance bar exactly:
 *
 *  - **Gate state up front** — verdict badge, contract sha, and a stale
 *    banner that is impossible to miss (a full-width `role="alert"` bar
 *    above everything else, not a badge easily lost in a header row) —
 *    "Stale must be unmissable; it is the whole reason someone is looking."
 *  - **The contract**, rendered with `react-markdown` + `remark-gfm` (tables,
 *    task lists — contract.md files use both), with a quick-nav list of any
 *    `## Amendment` sections above the fold and each such heading visually
 *    called out where it renders — never just "buried" 200 lines down (the
 *    coord-portal ms-4 case the issue cites by name). `src/lib/gateA.ts`'s
 *    `extractAmendmentHeadings` finds them from the raw markdown; the
 *    quick-nav's click handler then matches by rendered heading text against
 *    the live DOM (`scrollIntoView`) rather than threading synthetic ids
 *    through the markdown pipeline, which stays correct regardless of how
 *    `react-markdown` numbers/escapes any given heading.
 *  - **Every mock in its own frame** (`<iframe srcDoc>` — the mock is a
 *    complete standalone HTML document with its own inlined `<style>`, so
 *    rendering it inline in this page's DOM would collide with this app's
 *    own styles/ids; an iframe is the only sound isolation boundary),
 *    rendered live with no further fetching.
 *  - **A width control** (phone/tablet/full — `GATE_A_WIDTH_PRESETS`) and
 *    **a theme control** (`GATE_A_MOCK_THEMES`) for the mock frames, both
 *    independent of this page's own chrome/theme. 390px is an exact
 *    requirement, not a rounded guess — see `gateA.ts`'s doc comment for
 *    why. The theme control sets `data-theme` directly on each iframe's own
 *    `<html>` (via `contentDocument`, permitted by `allow-same-origin`) —
 *    the same attribute-driven mechanism `src/index.css` documents this
 *    app's own tokens use, copied verbatim from the Gate-A design mocks'
 *    shared token file in the first place, so a mock's inlined stylesheet is
 *    expected to answer to it identically.
 *
 * Not in this slice: recording a verdict from the browser. This panel prints
 * the exact `coord gate-a` command (`gateAApprovedCommand`/
 * `gateAChangesCommand`, `src/lib/gateA.ts`) rather than a submit button —
 * verified against the installed `coord gate-a --help`, not guessed. A
 * Gate-A sign-off is a human authority gate; moving where it can be
 * exercised is a deliberate decision for a future issue, not a rendering one
 * for this panel to take on its own.
 */
import { Children, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle, Copy } from 'lucide-react'

import { fetchGateA, type GateAMockWire, type GateAPacket } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/use-toast'
import { paths } from '@/routes/paths'
import { issueRef } from '@/lib/repoRef'
import { formatRelativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import {
  extractAmendmentHeadings,
  gateAApprovedCommand,
  gateAChangesCommand,
  gateAStateLabel,
  gateAStateTone,
  gateAWidthPreset,
  GATE_A_MOCK_THEMES,
  GATE_A_WIDTH_PRESETS,
  isAmendmentHeadingText,
  type GateAMockTheme,
  type GateAWidthId,
} from '@/lib/gateA'

const shellClass = 'mx-auto w-full max-w-5xl px-4 py-6 md:px-8'

function headingText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string') return child
      if (typeof child === 'number') return String(child)
      if (isValidElement(child)) {
        const props = child.props as { children?: ReactNode }
        return headingText(props.children)
      }
      return ''
    })
    .join('')
}

function CopyCommandRow({ command, testId }: { command: string; testId: string }) {
  const handleCopy = () => {
    navigator.clipboard?.writeText(command).then(
      () => toast({ variant: 'success', title: 'Copied', description: command }),
      () => toast({ variant: 'destructive', title: 'Could not copy', description: command }),
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2">
      <code data-testid={testId} className="flex-1 overflow-x-auto whitespace-pre font-mono text-xs text-foreground">
        {command}
      </code>
      <Button variant="ghost" size="icon" aria-label="Copy command" onClick={handleCopy}>
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  )
}

interface MockFrameProps {
  mock: GateAMockWire
  widthPx: number | null
  theme: GateAMockTheme
}

function MockFrame({ mock, widthPx, theme }: MockFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const applyTheme = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    doc?.documentElement?.setAttribute('data-theme', theme)
  }, [theme])

  // Re-applies whenever the theme control changes, not just on first load --
  // `srcDoc` doesn't change with `theme`, so there is no reload to hook the
  // attribute onto otherwise.
  useEffect(() => {
    applyTheme()
  }, [applyTheme])

  return (
    <Card data-testid={`gate-a-mock-${mock.name}`} className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 border-b border-border py-2.5">
        <CardTitle className="text-sm font-medium">{mock.title}</CardTitle>
        <span className="font-mono text-xs text-muted-foreground">{mock.name}</span>
      </CardHeader>
      <div className="overflow-x-auto bg-secondary/20 p-4">
        <iframe
          ref={iframeRef}
          title={mock.title}
          data-testid={`gate-a-mock-frame-${mock.name}`}
          srcDoc={mock.html}
          onLoad={applyTheme}
          sandbox="allow-same-origin allow-scripts"
          style={{ width: widthPx ? `${widthPx}px` : '100%', height: '640px' }}
          className="mx-auto block max-w-full rounded-md border border-line-strong bg-background"
        />
      </div>
    </Card>
  )
}

function AmendmentQuickNav({ headings, contractRef }: { headings: string[]; contractRef: React.RefObject<HTMLDivElement> }) {
  if (headings.length === 0) return null

  const scrollToHeading = (text: string) => {
    const container = contractRef.current
    if (!container) return
    const target = Array.from(container.querySelectorAll('h1,h2,h3')).find(
      (el) => el.textContent?.trim() === text,
    )
    // Optional-chained on the method itself, not just the element: jsdom
    // (this repo's test environment) has no `scrollIntoView` implementation
    // at all (https://github.com/jsdom/jsdom/issues/1695) -- a real browser
    // always has the method, so this is a no-op only in tests, never live.
    target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      data-testid="gate-a-amendment-nav"
      role="alert"
      className="mb-4 rounded-lg border border-attn/40 bg-attn-wash px-4 py-3"
    >
      <p className="mb-1.5 text-sm font-semibold text-attn">
        {headings.length === 1 ? 'This contract has an amendment' : `This contract has ${headings.length} amendments`}
      </p>
      <ul className="flex flex-col gap-1">
        {headings.map((text) => (
          <li key={text}>
            <button
              type="button"
              data-testid={`gate-a-amendment-link-${text}`}
              onClick={() => scrollToHeading(text)}
              className="text-left text-sm text-attn underline underline-offset-2 hover:opacity-80"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ContractMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="prose-contract text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-3 mt-6 text-lg font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => {
            const text = headingText(children)
            const isAmendment = isAmendmentHeadingText(text)
            return (
              <h2
                className={cn(
                  'mb-2.5 mt-6 text-base font-semibold first:mt-0',
                  isAmendment && 'rounded-md border border-attn/40 bg-attn-wash px-2 py-1 text-attn',
                )}
              >
                {isAmendment && <AlertTriangle className="mr-1.5 inline-block h-4 w-4" aria-hidden="true" />}
                {children}
              </h2>
            )
          },
          h3: ({ children }) => <h3 className="mb-2 mt-5 text-sm font-semibold">{children}</h3>,
          p: ({ children }) => <p className="mb-3">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="mb-1">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[.85em]">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 font-mono text-xs">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 border-line-strong pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-5 border-border" />,
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-2 py-1.5 font-semibold text-muted-foreground">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-border/60 px-2 py-1.5 align-top">{children}</td>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

function GateStateBanner({ packet }: { packet: GateAPacket }) {
  if (!packet.stale) return null
  return (
    <div
      data-testid="gate-a-stale-banner"
      role="alert"
      className="mb-4 flex items-center gap-2 rounded-lg border border-fail/50 bg-fail-wash px-4 py-3 text-fail"
    >
      <AlertTriangle className="h-5 w-5 flex-none" aria-hidden="true" />
      <p className="text-sm font-semibold">
        Stale — the contract has changed since this verdict was recorded. Re-read it before relying on the sign-off below.
      </p>
    </div>
  )
}

export default function GateAPanel() {
  const { repo, trackingIssue } = useParams<{ repo: string; trackingIssue: string }>()
  const trackingIssueNumber = Number(trackingIssue)
  const validParams = !!repo && Number.isFinite(trackingIssueNumber) && trackingIssueNumber > 0

  const { data, isLoading, isError } = useQuery({
    queryKey: ['gate-a', repo, trackingIssueNumber],
    queryFn: () => fetchGateA(repo as string, trackingIssueNumber),
    enabled: validParams,
  })

  const [widthId, setWidthId] = useState<GateAWidthId>('full')
  const [mockTheme, setMockTheme] = useState<GateAMockTheme>('dark')
  const contractRef = useRef<HTMLDivElement>(null)

  if (!validParams) {
    return (
      <div className={shellClass}>
        <p role="alert" className="text-sm text-destructive">
          Invalid Gate-A link — expected /gate-a/&lt;repo&gt;/&lt;tracking issue&gt;.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={shellClass}>
        <p className="py-12 text-center text-sm text-muted-foreground">Loading Gate-A packet…</p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className={shellClass}>
        <p role="alert" className="text-sm text-destructive">
          Failed to load the Gate-A packet for {repo}#{trackingIssue}.
        </p>
      </div>
    )
  }

  if (!data.ok) {
    return (
      <div className={shellClass}>
        <div
          data-testid="gate-a-fetch-error"
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-sm text-destructive"
        >
          {data.error}
        </div>
      </div>
    )
  }

  const packet = data.data
  const amendments = extractAmendmentHeadings(packet.contract_markdown)
  const width = gateAWidthPreset(widthId)

  return (
    <div className={shellClass}>
      <header className="mb-5">
        <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Gate A review packet</p>
        <h1 className="text-step-2 font-semibold tracking-tight text-foreground">
          {packet.repo_name} · {packet.milestone_title || `Milestone ${packet.milestone_number}`}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tracking issue{' '}
          <a
            href={`https://github.com/${packet.repo_name}/issues/${packet.tracking_issue}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {issueRef(packet.repo_name, packet.tracking_issue)}
          </a>{' '}
          — {packet.tracking_issue_title}
        </p>
      </header>

      <GateStateBanner packet={packet} />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge data-testid="gate-a-state-badge" variant={gateAStateTone(packet.state)}>
              {gateAStateLabel(packet.state)}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground" title={packet.contract_sha}>
              sha {packet.contract_sha.slice(0, 12)}
            </span>
          </div>

          {packet.reason && <p className="text-sm text-muted-foreground">{packet.reason}</p>}

          {packet.approval && (
            <p data-testid="gate-a-approval-summary" className="text-sm text-muted-foreground">
              Last verdict: <span className="font-medium text-foreground">{packet.approval.verdict}</span> by{' '}
              {packet.approval.actor} ({formatRelativeTime(packet.approval.recorded_at)})
              {packet.approval.note && <> — “{packet.approval.note}”</>}
            </p>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sign off from the CLI — this panel is read-only
            </p>
            <CopyCommandRow
              testId="gate-a-approved-command"
              command={gateAApprovedCommand(packet.repo_name, packet.tracking_issue)}
            />
            <CopyCommandRow
              testId="gate-a-changes-command"
              command={gateAChangesCommand(packet.repo_name, packet.tracking_issue)}
            />
          </div>
        </CardContent>
      </Card>

      <section className="mb-8">
        <h2 className="mb-3 text-step-1 font-semibold tracking-tight text-foreground">Contract</h2>
        <AmendmentQuickNav headings={amendments} contractRef={contractRef} />
        <Card>
          <CardContent ref={contractRef} className="p-5">
            {packet.contract_markdown ? (
              <ContractMarkdown markdown={packet.contract_markdown} />
            ) : (
              <p className="text-sm text-muted-foreground">No contract.md found for this milestone.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-step-1 font-semibold tracking-tight text-foreground">
            Mocks {packet.mocks.length > 0 && <span className="font-mono text-sm text-faint">({packet.mocks.length})</span>}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Mock frame width" className="flex rounded-md border border-border p-0.5">
              {GATE_A_WIDTH_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`gate-a-width-${preset.id}`}
                  aria-pressed={widthId === preset.id}
                  onClick={() => setWidthId(preset.id)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    widthId === preset.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Mock frame theme" className="flex rounded-md border border-border p-0.5">
              {GATE_A_MOCK_THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-testid={`gate-a-theme-${t}`}
                  aria-pressed={mockTheme === t}
                  onClick={() => setMockTheme(t)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    mockTheme === t
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {packet.mocks.length > 0 ? (
          <div className="flex flex-col gap-5">
            {packet.mocks.map((mock) => (
              <MockFrame key={mock.name} mock={mock} widthPx={width.px} theme={mockTheme} />
            ))}
          </div>
        ) : (
          <p data-testid="gate-a-mocks-empty" className="text-sm text-muted-foreground">
            {packet.mocks_note || 'No mocks for this milestone.'}
          </p>
        )}
      </section>

      <footer className="mt-8 text-center">
        <Link
          to={paths.pipelineItem(packet.repo_name, packet.tracking_issue)}
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          View {issueRef(packet.repo_name, packet.tracking_issue)} in the pipeline
        </Link>
      </footer>
    </div>
  )
}
