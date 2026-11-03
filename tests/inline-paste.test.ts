import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, PromptChangeInput, PromptChangeResult } from 'claude-code'
import { decide, findPlaceholders, fits, matchDictation, maxCharsFrom, parseRows } from '../hooks/paste'
import type { DictationRow, Sources } from '../hooks/paste'

const PASTE = 'line one\nline two\nline three\nline four'
const BOX = '[Pasted text #1 +3 lines]'
const LIMIT = 2500

const row = (over: Partial<DictationRow> = {}): DictationRow => ({
  id: 'row-1',
  status: 'formatted',
  pastedText: PASTE,
  formattedText: PASTE,
  age: 5,
  duration: 60,
  ...over,
})

const sources = (over: Partial<Sources> = {}): Sources => ({
  clipboard: '',
  rows: undefined,
  used: new Set(),
  maxChars: LIMIT,
  attempt: 0,
  isLastAttempt: false,
  ...over,
})

describe('findPlaceholders', () => {
  test('reads id, line count and position', async () => {
    const [ph] = findPlaceholders('hi [Pasted text #3 +4 lines] there')
    expect(ph).toEqual({ id: 3, lines: 4, index: 3, match: '[Pasted text #3 +4 lines]' })
  })

  test('a single-line paste has no line count', async () => {
    expect(findPlaceholders('[Pasted text #1]')[0]?.lines).toBe(0)
  })

  test('ignores image placeholders', async () => {
    expect(findPlaceholders('[Image #2]')).toEqual([])
  })
})

describe('fits', () => {
  const single = findPlaceholders('[Pasted text #1]')[0]!

  test('rejects text Claude Code would not have folded', async () => {
    expect(fits('short single line', single)).toBe(false)
  })

  test('accepts a long single line', async () => {
    expect(fits('x'.repeat(801), single)).toBe(true)
  })
})

describe('decide from the clipboard', () => {
  const box = `before ${BOX} after`
  const ph = findPlaceholders(box)[0]!

  test('swaps in a matching clipboard and puts the cursor after it', async () => {
    const d = decide(box, ph, sources({ clipboard: PASTE }))
    expect(d).toEqual({
      kind: 'expand',
      text: `before ${PASTE} after`,
      cursor: 7 + PASTE.length,
      source: 'clipboard',
    })
  })

  test('normalises CRLF and tabs like Claude Code', async () => {
    const d = decide(box, ph, sources({ clipboard: 'a\r\nb\r\nc\r\n\td' }))
    expect(d.kind === 'expand' && d.text).toBe('before a\nb\nc\n    d after')
  })

  test('leaves it folded when over the limit', async () => {
    expect(decide(box, ph, sources({ clipboard: PASTE, maxChars: 4 })).kind).toBe('leave')
  })

  test('leaves it folded when the clipboard does not match', async () => {
    expect(decide(box, ph, sources({ clipboard: 'only one line' })).kind).toBe('leave')
  })

  test('leaves it folded when the clipboard is empty', async () => {
    expect(decide(box, ph, sources()).kind).toBe('leave')
  })

  test('with Wispr Flow present, looks once more before trusting the clipboard', async () => {
    expect(decide(box, ph, sources({ clipboard: PASTE, rows: [] })).kind).toBe('wait')
    const d = decide(box, ph, sources({ clipboard: PASTE, rows: [], attempt: 1 }))
    expect(d.kind === 'expand' && d.source).toBe('clipboard')
  })
})

describe('decide from a dictation', () => {
  const ph = findPlaceholders(BOX)[0]!

  test('uses the dictation when the clipboard was restored', async () => {
    const d = decide(BOX, ph, sources({ clipboard: 'old clipboard', rows: [row()] }))
    expect(d).toEqual({
      kind: 'expand',
      text: PASTE,
      cursor: PASTE.length,
      source: 'dictation',
      rowId: 'row-1',
    })
  })

  test('a trailing space does not count as a disagreement', async () => {
    const d = decide(BOX, ph, sources({ clipboard: PASTE, rows: [row({ pastedText: `${PASTE} ` })] }))
    expect(d.kind === 'expand' && d.source).toBe('dictation')
  })

  test('stays folded when the clipboard and a dictation both fit but differ', async () => {
    const other = 'other a\nother b\nother c\nother d'
    expect(decide(BOX, ph, sources({ clipboard: other, rows: [row()] })).kind).toBe('leave')
  })

  test('stays folded when the dictation is over the limit', async () => {
    expect(decide(BOX, ph, sources({ rows: [row()], maxChars: 4 })).kind).toBe('leave')
  })

  test('keeps waiting for a row, then gives up', async () => {
    expect(decide(BOX, ph, sources({ rows: [] })).kind).toBe('wait')
    expect(decide(BOX, ph, sources({ rows: [], isLastAttempt: true })).kind).toBe('leave')
  })
})

describe('matchDictation', () => {
  const ph = findPlaceholders(BOX)[0]!

  test('falls back to formattedText when pastedText does not fit', async () => {
    const found = matchDictation([row({ pastedText: 'nope' })], ph, new Set())
    expect(found?.text).toBe(PASTE)
  })

  test('skips a row already used', async () => {
    expect(matchDictation([row()], ph, new Set(['row-1']))).toBeUndefined()
  })

  test('skips an old dictation', async () => {
    expect(matchDictation([row({ age: 200, duration: 60 })], ph, new Set())).toBeUndefined()
  })

  test('counts a long recording as recent', async () => {
    expect(matchDictation([row({ age: 310, duration: 300 })], ph, new Set())?.row.id).toBe('row-1')
  })
})

describe('parseRows', () => {
  test('reads sqlite3 JSON, and no output as no rows', async () => {
    expect(parseRows('[{"id":"a"}]')).toEqual([{ id: 'a' }] as unknown as DictationRow[])
    expect(parseRows('')).toEqual([])
  })
})

describe('maxCharsFrom', () => {
  test('defaults to 2500', async () => {
    expect(maxCharsFrom(undefined)).toBe(2500)
    expect(maxCharsFrom(-1)).toBe(2500)
  })

  test('uses the configured value', async () => {
    expect(maxCharsFrom(10000)).toBe(10000)
  })
})

// The engine's side of a paste. `history` is what sqlite3 prints; `undefined`
// stands for a Mac without Wispr Flow.
function engine(on: On, clip: string, history?: readonly DictationRow[]) {
  const fills: string[] = []
  mock.env(on, { HOME: '/Users/test' })
  on('prompt.read', () => ({ value: { text: BOX, cursor: BOX.length } }))
  on('process.run', (_, e) => {
    const isClipboard = e.argv[0] === 'pbpaste'
    const exitCode = isClipboard || history ? 0 : 1
    const stdout = isClipboard ? clip : JSON.stringify(history ?? [])
    return { value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.change', (_, e) => ({ text: e.text }))
  return fills
}

// The kit raises `prompt.change` at runtime, but its types leave it off `$.prompt`.
type Raise = { prompt: { change: (e: PromptChangeInput) => Promise<PromptChangeResult> } }

async function paste($: unknown, on: On, kind: 'engine' | 'history' = 'engine') {
  const clock = mock.clock(on)
  await ($ as Raise).prompt.change({ text: BOX, cursor: BOX.length, origin: { kind } })
  // Long enough for every retry.
  for (let i = 0; i < 12; i++) {
    await clock.advance(500)
    await clock.settle()
  }
}

test('a folded copy and paste under the limit is expanded', async ($, on) => {
  const fills = engine(on, PASTE)
  await paste($, on)
  expect(fills).toEqual([PASTE])
})

test('a folded dictation is expanded after the clipboard was restored', async ($, on) => {
  const fills = engine(on, 'old clipboard', [row()])
  await paste($, on)
  expect(fills).toEqual([PASTE])
})

test('a paste over the configured limit stays folded', { options: { maxChars: 10 } }, async ($, on) => {
  const fills = engine(on, PASTE)
  await paste($, on)
  expect(fills).toEqual([])
})

test('a recalled history entry is left alone', async ($, on) => {
  const fills = engine(on, PASTE)
  await paste($, on, 'history')
  expect(fills).toEqual([])
})
