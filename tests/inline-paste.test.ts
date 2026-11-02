import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, PromptChangeInput, PromptChangeResult } from 'claude-code'
import { decide, findPlaceholders, maxCharsFrom } from '../hooks/paste'

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

describe('decide', () => {
  const box = 'before [Pasted text #1 +2 lines] after'
  const ph = findPlaceholders(box)[0]!

  test('swaps in a matching clipboard and puts the cursor after it', async () => {
    const d = decide(box, ph, 'a\nb\nc', 2500)
    expect(d).toEqual({ expand: true, text: 'before a\nb\nc after', cursor: 12 })
  })

  test('normalises CRLF and tabs like Claude Code', async () => {
    const d = decide(box, ph, 'a\r\nb\r\n\tc', 2500)
    expect(d.expand && d.text).toBe('before a\nb\n    c after')
  })

  test('leaves it folded when over the limit', async () => {
    expect(decide(box, ph, 'a\nb\nc', 4).expand).toBe(false)
  })

  test('leaves it folded when the clipboard does not match', async () => {
    expect(decide(box, ph, 'only one line', 2500).expand).toBe(false)
  })

  test('leaves it folded when the clipboard is empty', async () => {
    expect(decide(box, ph, '', 2500).expand).toBe(false)
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

// The engine's side of a paste: the box holds `box`, the clipboard `clip`.
function engine(on: On, box: string, clip: string) {
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: clip, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('prompt.change', (_, e) => ({ text: e.text }))
  return fills
}

// The kit raises `prompt.change` at runtime, but its types leave it off `$.prompt`.
type Raise = { prompt: { change: (e: PromptChangeInput) => Promise<PromptChangeResult> } }
const paste = ($: unknown, kind: 'engine' | 'history') =>
  ($ as Raise).prompt.change({ text: BOX, cursor: BOX.length, origin: { kind } })

const PASTE = 'line one\nline two\nline three'
const BOX = '[Pasted text #1 +2 lines]'

test('a folded paste under the limit is expanded', async ($, on) => {
  const clock = mock.clock(on)
  const fills = engine(on, BOX, PASTE)

  await paste($, 'engine')
  await clock.advance(100)
  await clock.settle()

  expect(fills).toEqual([PASTE])
})

test('a paste over the configured limit stays folded', { options: { maxChars: 10 } }, async ($, on) => {
  const clock = mock.clock(on)
  const fills = engine(on, BOX, PASTE)

  await paste($, 'engine')
  await clock.advance(100)
  await clock.settle()

  expect(fills).toEqual([])
})

test('a recalled history entry is left alone', async ($, on) => {
  const clock = mock.clock(on)
  const fills = engine(on, BOX, PASTE)

  await paste($, 'history')
  await clock.advance(100)
  await clock.settle()

  expect(fills).toEqual([])
})
