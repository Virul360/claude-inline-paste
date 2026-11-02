import type { Register, EngineInterface } from 'claude-code'

// Pastes (and dictation, which arrives as a paste) up to this many characters
// are swapped back to plain, editable text in the prompt box. Longer ones keep
// Claude Code's "[Pasted text #N +M lines]" placeholder.
//
// Claude Code folds a paste straight into the box (over 800 characters or more
// than 2 line breaks) without passing it to mods. So when a new placeholder
// appears, this mod reads the clipboard, checks it matches the placeholder's
// line count, and puts the full text in its place.
const INLINE_LIMIT = 2500

// TEMP: debug lines in the transcript while we confirm it works.
const DEBUG = false

type Placeholder = { id: number; lines: number; index: number; match: string }

const handled = new Set<number>()

function findPlaceholders(text: string): Placeholder[] {
  return [...text.matchAll(/\[Pasted text #(\d+)(?: \+(\d+) lines)?\]/g)].map(m => ({
    id: Number(m[1]),
    lines: Number(m[2] ?? 0),
    index: m.index ?? 0,
    match: m[0],
  }))
}

function note($: EngineInterface, line: string) {
  if (DEBUG) $.ui.log(`inline-paste debug: ${line}`)
}

async function expand($: EngineInterface, id: number) {
  const box = await $.prompt.read()
  const ph = findPlaceholders(box.text).find(p => p.id === id)
  if (!ph) return note($, `#${id}: placeholder no longer in the box`)

  const run = await $.process.run(['pbpaste'], {
    env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    timeoutMs: 5000,
  })
  if (run.exitCode !== 0) return note($, `#${id}: pbpaste failed (${run.exitCode})`)

  const clip = run.stdout.replace(/\r\n|\r/g, '\n').replaceAll('\t', '    ')
  if (clip.length === 0) return note($, `#${id}: clipboard is empty`)
  if (clip.length > INLINE_LIMIT) return note($, `#${id}: ${clip.length} chars, over ${INLINE_LIMIT}: left folded`)

  const lines = (clip.match(/\n/g) ?? []).length
  if (lines !== ph.lines) {
    return note($, `#${id}: clipboard has ${lines} line breaks, placeholder says ${ph.lines}: left folded`)
  }

  const text = box.text.slice(0, ph.index) + clip + box.text.slice(ph.index + ph.match.length)
  const filled = await $.prompt.fill({ text, mode: 'replace', cursor: ph.index + clip.length })
  const stillFolded = findPlaceholders(filled.text).some(p => p.match === ph.match)
  note($, `#${id}: ${clip.length} chars, filled=${filled.isFilled}${filled.refusal ? ` (${filled.refusal})` : ''}, stillFolded=${stillFolded}`)
}

export const register: Register = on => {
  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind !== 'engine') return result

    for (const p of findPlaceholders(e.text)) {
      if (handled.has(p.id)) continue
      handled.add(p.id)
      // Run after this change has settled, so the fill isn't nested inside it.
      $.clock.after(50, () => {
        void expand($, p.id).catch(err => note($, `#${p.id}: error ${String(err)}`))
      })
    }
    return result
  })
}
