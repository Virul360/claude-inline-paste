import type { Register, EngineInterface } from 'claude-code'
import { decide, findPlaceholders, maxCharsFrom } from './paste'

// Claude Code folds a paste (over 800 characters, or more than 2 line breaks)
// straight into a `[Pasted text #N +M lines]` placeholder without passing the
// text to mods. So when a new placeholder appears, this mod reads the
// clipboard, checks it matches the placeholder, and swaps the full text in.

type Settings = { maxChars: number; debug: boolean }

function note($: EngineInterface, settings: Settings, line: string) {
  if (settings.debug) $.ui.log(`inline-paste: ${line}`)
}

async function expand($: EngineInterface, settings: Settings, id: number) {
  const box = await $.prompt.read()
  const ph = findPlaceholders(box.text).find(p => p.id === id)
  if (!ph) return note($, settings, `#${id}: placeholder no longer in the box`)

  const run = await $.process.run(['pbpaste'], {
    env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    timeoutMs: 5000,
  })
  if (run.exitCode !== 0) return note($, settings, `#${id}: pbpaste failed (exit ${run.exitCode})`)

  const decision = decide(box.text, ph, run.stdout, settings.maxChars)
  if (!decision.expand) return note($, settings, `#${id}: left folded: ${decision.reason}`)

  const filled = await $.prompt.fill({ text: decision.text, mode: 'replace', cursor: decision.cursor })
  note($, settings, `#${id}: expanded=${filled.isFilled}${filled.refusal ? ` (${filled.refusal})` : ''}`)
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    maxChars: maxCharsFrom(options.maxChars),
    debug: options.debug === true,
  }
  const handled = new Set<number>()

  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    // Only the engine's own paste writes; not history recalls or plugin fills.
    if (e.origin.kind !== 'engine') return result

    for (const p of findPlaceholders(e.text)) {
      if (handled.has(p.id)) continue
      handled.add(p.id)
      // Run once this change has settled, so the fill is not nested inside it.
      $.clock.after(50, () => {
        void expand($, settings, p.id).catch(err => note($, settings, `#${p.id}: error ${String(err)}`))
      })
    }
    return result
  })
}
