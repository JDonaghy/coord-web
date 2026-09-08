import { describe, it, expect } from 'vitest'
import {
  buildLogEntries,
  formatCompactDuration,
  formatDelta,
  parseWorkerLogLine,
  parseWorkerLogText,
  splitCompleteLines,
  turnStats,
  type TurnEntry,
  type RateLimitEntry,
  type ResultEntry,
} from '@/lib/workerLog'

describe('parseWorkerLogLine', () => {
  it('parses a well-formed NDJSON object line', () => {
    const event = parseWorkerLogLine('{"type":"assistant","message":{}}')
    expect(event).toEqual({ type: 'assistant', subtype: null, timestamp: null, raw: { type: 'assistant', message: {} } })
  })

  it('returns null for a blank line', () => {
    expect(parseWorkerLogLine('')).toBeNull()
    expect(parseWorkerLogLine('   ')).toBeNull()
  })

  it('returns null for a `#`-prefixed comment the agent itself writes (argv/reap lines)', () => {
    expect(parseWorkerLogLine('# agent=dell64 repo=x issue=#1 argv=claude -p ...')).toBeNull()
    expect(parseWorkerLogLine('# reap: done (exit_code=0 status=done)')).toBeNull()
  })

  it('returns null for a JSON array or scalar, not an object', () => {
    expect(parseWorkerLogLine('[1,2,3]')).toBeNull()
    expect(parseWorkerLogLine('42')).toBeNull()
    expect(parseWorkerLogLine('"just a string"')).toBeNull()
  })

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseWorkerLogLine('{not json')).toBeNull()
  })

  it('parses a real ISO timestamp field to epoch ms', () => {
    const event = parseWorkerLogLine('{"type":"assistant","timestamp":"2026-09-03T19:37:36.405Z"}')
    expect(event?.timestamp).toBe(Date.parse('2026-09-03T19:37:36.405Z'))
  })

  it('leaves timestamp null when the field is absent or unparseable', () => {
    expect(parseWorkerLogLine('{"type":"rate_limit_event"}')?.timestamp).toBeNull()
    expect(parseWorkerLogLine('{"type":"assistant","timestamp":"not a date"}')?.timestamp).toBeNull()
  })
})

describe('parseWorkerLogText', () => {
  it('parses every valid line and skips the rest', () => {
    const text = [
      '# agent=dell64 argv=claude -p ...',
      '{"type":"system","subtype":"init"}',
      '',
      '{"type":"assistant","message":{"content":[]}}',
      '# reap: done',
    ].join('\n')
    const events = parseWorkerLogText(text)
    expect(events.map((e) => e.type)).toEqual(['system', 'assistant'])
  })
})

describe('splitCompleteLines', () => {
  it('splits a chunk that ends on a line boundary, leaving no remainder', () => {
    const { lines, remainder } = splitCompleteLines('', '{"a":1}\n{"b":2}\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(remainder).toBe('')
  })

  it('holds back a trailing partial line as the remainder', () => {
    const { lines, remainder } = splitCompleteLines('', '{"a":1}\n{"b":2')
    expect(lines).toEqual(['{"a":1}'])
    expect(remainder).toBe('{"b":2')
  })

  it('stitches a line split across two chunks back together', () => {
    const first = splitCompleteLines('', '{"a":1}\n{"b":')
    expect(first.lines).toEqual(['{"a":1}'])
    const second = splitCompleteLines(first.remainder, '2}\n{"c":3}\n')
    expect(second.lines).toEqual(['{"b":2}', '{"c":3}'])
    expect(second.remainder).toBe('')
  })
})

describe('buildLogEntries', () => {
  function assistantLine(text: string | null, tools: Array<{ name: string; input?: unknown }> = [], timestamp?: string) {
    const content: unknown[] = []
    if (text != null) content.push({ type: 'text', text })
    for (const t of tools) content.push({ type: 'tool_use', name: t.name, input: t.input })
    return JSON.stringify({
      type: 'assistant',
      ...(timestamp ? { timestamp } : {}),
      message: { content },
    })
  }

  it('turns each assistant line into a numbered turn with its narration and tool calls', () => {
    const text = [
      assistantLine('Looking at the failing test.', [{ name: 'Bash', input: { command: 'npm test' } }]),
      assistantLine(null, [{ name: 'Write', input: { file_path: '/tmp/foo.txt' } }]),
    ].join('\n')
    const entries = buildLogEntries(parseWorkerLogText(text))
    expect(entries).toHaveLength(2)

    const [first, second] = entries as [TurnEntry, TurnEntry]
    expect(first.kind).toBe('turn')
    expect(first.turn).toBe(1)
    expect(first.text).toBe('Looking at the failing test.')
    expect(first.tools).toEqual([{ name: 'Bash', detail: 'npm test' }])

    expect(second.turn).toBe(2)
    expect(second.text).toBe('')
    expect(second.tools).toEqual([{ name: 'Write', detail: '/tmp/foo.txt' }])
  })

  it('computes each turn delta from the previous turn with a known timestamp', () => {
    const text = [
      assistantLine('one', [], '2026-01-01T00:00:00.000Z'),
      assistantLine('two', [], '2026-01-01T00:00:23.000Z'),
    ].join('\n')
    const entries = buildLogEntries(parseWorkerLogText(text)) as TurnEntry[]
    expect(entries[0].deltaMs).toBeNull()
    expect(entries[1].deltaMs).toBe(23_000)
  })

  it('never drops a rate_limit_event, throttled or not (#110: must explain timing gaps)', () => {
    const text = [
      JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed', resetsAt: 1234 },
      }),
      JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: 5678 },
      }),
    ].join('\n')
    const entries = buildLogEntries(parseWorkerLogText(text)) as RateLimitEntry[]
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ kind: 'rate_limit', status: 'allowed', resetsAt: 1234 })
    expect(entries[1]).toMatchObject({ kind: 'rate_limit', status: 'rejected', resetsAt: 5678 })
  })

  it('renders a terminal result event', () => {
    const text = JSON.stringify({
      type: 'result',
      total_cost_usd: 1.5,
      stop_reason: 'end_turn',
      num_turns: 12,
      duration_ms: 65_000,
      is_error: false,
    })
    const entries = buildLogEntries(parseWorkerLogText(text)) as ResultEntry[]
    expect(entries).toEqual([
      {
        kind: 'result',
        key: 'result-0',
        costUsd: 1.5,
        stopReason: 'end_turn',
        numTurns: 12,
        durationMs: 65_000,
        isError: false,
      },
    ])
  })

  it('drops noise types the Log view does not surface (tool_progress, thinking_tokens, tool_result)', () => {
    const text = [
      JSON.stringify({ type: 'tool_progress', elapsed_time_seconds: 3 }),
      JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 10 }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    ].join('\n')
    expect(buildLogEntries(parseWorkerLogText(text))).toEqual([])
  })
})

describe('turnStats', () => {
  it('counts turns and tracks first/last known timestamps', () => {
    const events = parseWorkerLogText(
      [
        JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:00:00.000Z', message: {} }),
        JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }),
        JSON.stringify({ type: 'assistant', timestamp: '2026-01-01T00:01:00.000Z', message: {} }),
      ].join('\n'),
    )
    expect(turnStats(events)).toEqual({
      turnCount: 2,
      firstTurnAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
      lastTurnAtMs: Date.parse('2026-01-01T00:01:00.000Z'),
    })
  })

  it('returns zero/nulls for an empty event list', () => {
    expect(turnStats([])).toEqual({ turnCount: 0, firstTurnAtMs: null, lastTurnAtMs: null })
  })
})

describe('formatCompactDuration / formatDelta', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatCompactDuration(45_000)).toBe('45s')
  })

  it('formats minute-scale durations without a space, matching the issue example', () => {
    expect(formatCompactDuration(6 * 60_000 + 54_000)).toBe('6m54s')
  })

  it('formats hour-scale durations', () => {
    expect(formatCompactDuration(83 * 60_000)).toBe('1h23m')
  })

  it('formats a turn delta with a leading +, or null when the gap is unknown', () => {
    expect(formatDelta(23_000)).toBe('+23s')
    expect(formatDelta(null)).toBeNull()
  })
})
