import type { Register, EngineInterface } from 'claude-code'
import { countLines, decide, findPlaceholders, maxCharsFrom, normalise, parseRows } from './paste'
import type { DictationRow } from './paste'

// Claude Code folds a paste (over 800 characters, or more than 2 line breaks)
// straight into a `[Pasted text #N +M lines]` placeholder without passing the
// text to mods. So when a new placeholder appears, this mod looks for the full
// text and swaps it in. It looks in the clipboard, and in Wispr Flow's local
// history (read-only), because Wispr Flow restores the old clipboard after it
// pastes. Debug lines hold lengths and counts, never the text.

type Settings = { maxChars: number; debug: boolean }

const RETRY_MS = 400
const MAX_ATTEMPTS = 8

const QUERY = `SELECT transcriptEntityId AS id, status, pastedText, formattedText, duration,
  (julianday('now') - julianday(substr(timestamp, 1, 23))) * 86400 AS age
  FROM History WHERE timestamp > datetime('now', '-600 seconds')
  ORDER BY timestamp DESC LIMIT 5`

function note($: EngineInterface, settings: Settings, line: string) {
  if (settings.debug) $.ui.log(`inline-paste: ${line}`)
}

async function readClipboard($: EngineInterface): Promise<string> {
  const run = await $.process.run(['pbpaste'], {
    env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    timeoutMs: 5000,
  })
  return run.exitCode === 0 ? run.stdout : ''
}

/** Recent Wispr Flow dictations, or `undefined` where its history can't be read. */
async function readDictations($: EngineInterface): Promise<DictationRow[] | undefined> {
  const home = await $.env.get('HOME')
  if (!home) return undefined
  const db = `${home}/Library/Application Support/Wispr Flow/flow.sqlite`
  try {
    const run = await $.process.run(['/usr/bin/sqlite3', '-readonly', '-json', db, QUERY], {
      env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      timeoutMs: 3000,
    })
    return run.exitCode === 0 ? parseRows(run.stdout) : undefined
  } catch {
    return undefined
  }
}

function describeRows(rows: readonly DictationRow[] | undefined): string {
  if (!rows) return 'none'
  return rows
    .slice(0, 2)
    .map(r => {
      const text = normalise(r.pastedText ?? '')
      return `age=${Math.round(r.age)}s dur=${Math.round(r.duration ?? 0)}s ${r.status} pasted=${text.length}c/${countLines(text)}nl fmt=${(r.formattedText ?? '').length}c`
    })
    .join(' | ')
}

async function attempt($: EngineInterface, settings: Settings, used: Set<string>, id: number, n: number) {
  const box = await $.prompt.read()
  const ph = findPlaceholders(box.text).find(p => p.id === id)
  if (!ph) return note($, settings, `#${id} try ${n}: placeholder no longer in the box`)

  const [clipboard, rows] = await Promise.all([readClipboard($), readDictations($)])
  const decision = decide(box.text, ph, {
    clipboard,
    rows,
    used,
    maxChars: settings.maxChars,
    attempt: n,
    isLastAttempt: n === MAX_ATTEMPTS - 1,
  })

  const clip = normalise(clipboard)
  const seen = `want ${ph.lines}nl; clip=${clip.length}c/${countLines(clip)}nl; rows: ${describeRows(rows)}`

  if (decision.kind === 'wait') {
    note($, settings, `#${id} try ${n}: wait (${decision.reason}); ${seen}`)
    $.clock.after(RETRY_MS, () => {
      void attempt($, settings, used, id, n + 1).catch(err => note($, settings, `#${id}: error ${String(err)}`))
    })
    return
  }
  if (decision.kind === 'leave') return note($, settings, `#${id} try ${n}: left folded (${decision.reason}); ${seen}`)

  if (decision.rowId) used.add(decision.rowId)
  const filled = await $.prompt.fill({ text: decision.text, mode: 'replace', cursor: decision.cursor })
  note($, settings, `#${id} try ${n}: expanded from ${decision.source}, filled=${filled.isFilled}; ${seen}`)
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    maxChars: maxCharsFrom(options.maxChars),
    debug: options.debug === true,
  }
  const handled = new Set<number>()
  const used = new Set<string>()

  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    // Only the engine's own paste writes; not history recalls or plugin fills.
    if (e.origin.kind !== 'engine') return result

    for (const p of findPlaceholders(e.text)) {
      if (handled.has(p.id)) continue
      handled.add(p.id)
      // Run once this change has settled, so the fill is not nested inside it.
      $.clock.after(50, () => {
        void attempt($, settings, used, p.id, 0).catch(err => note($, settings, `#${p.id}: error ${String(err)}`))
      })
    }
    return result
  })
}
