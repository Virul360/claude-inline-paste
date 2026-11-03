// Pure helpers: no engine calls, so they are easy to test.

/** The limit used when the person sets none. */
export const DEFAULT_MAX_CHARS = 2500

/** A `[Pasted text #N +M lines]` placeholder found in the prompt box. */
export type Placeholder = { id: number; lines: number; index: number; match: string }

/** Every text-paste placeholder in `text`, in order. */
export function findPlaceholders(text: string): Placeholder[] {
  return [...text.matchAll(/\[Pasted text #(\d+)(?: \+(\d+) lines)?\]/g)].map(m => ({
    id: Number(m[1]),
    lines: Number(m[2] ?? 0),
    index: m.index ?? 0,
    match: m[0],
  }))
}

/** Normalises text the way Claude Code normalises a paste. */
export function normalise(text: string): string {
  return text.replace(/\r\n|\r/g, '\n').replaceAll('\t', '    ')
}

export const countLines = (text: string): number => (text.match(/\n/g) ?? []).length

/**
 * Whether `text` could be what Claude Code folded into `ph`: the same number of
 * line breaks, and long enough or tall enough to have been folded at all (over
 * 800 characters, or more than 2 line breaks). This rejects most stale text.
 */
export function fits(text: string, ph: Placeholder): boolean {
  const lines = countLines(text)
  return lines === ph.lines && (text.length > 800 || lines > 2)
}

/** One recent dictation from Wispr Flow's local history. */
export type DictationRow = {
  id: string
  status: string | null
  pastedText: string | null
  formattedText: string | null
  /** Seconds since the row's timestamp. */
  age: number
  /** Length of the recording, in seconds. */
  duration: number | null
}

/** How long after a dictation's recording ended its paste can still arrive. */
export const DICTATION_WINDOW_SECONDS = 30

/** Parses the JSON rows `sqlite3 -json` prints; empty output means no rows. */
export function parseRows(stdout: string): DictationRow[] {
  if (stdout.trim() === '') return []
  const rows: unknown = JSON.parse(stdout)
  return Array.isArray(rows) ? (rows as DictationRow[]) : []
}

/** The newest unused recent dictation whose text fits `ph`, and that text. */
export function matchDictation(
  rows: readonly DictationRow[],
  ph: Placeholder,
  used: ReadonlySet<string>,
): { row: DictationRow; text: string } | undefined {
  for (const row of rows) {
    if (used.has(row.id) || row.age > (row.duration ?? 0) + DICTATION_WINDOW_SECONDS) continue
    // pastedText is what Wispr Flow reports it pasted; it can differ from formattedText.
    for (const candidate of [row.pastedText, row.formattedText]) {
      if (!candidate) continue
      const text = normalise(candidate)
      if (fits(text, ph)) return { row, text }
    }
  }
  return undefined
}

export type Decision =
  | { kind: 'expand'; text: string; cursor: number; source: 'clipboard' | 'dictation'; rowId?: string }
  | { kind: 'wait'; reason: string }
  | { kind: 'leave'; reason: string }

export type Sources = {
  clipboard: string
  /** Recent dictations; `undefined` when Wispr Flow's history isn't available. */
  rows: readonly DictationRow[] | undefined
  used: ReadonlySet<string>
  maxChars: number
  /** Zero-based try; a stale clipboard is only trusted after the first. */
  attempt: number
  isLastAttempt: boolean
}

function swap(box: string, ph: Placeholder, text: string) {
  return {
    text: box.slice(0, ph.index) + text + box.slice(ph.index + ph.match.length),
    cursor: ph.index + text.length,
  }
}

/**
 * Decides what to do about the placeholder `ph` in `box`. The full text comes
 * from one of two places: the clipboard, or (for dictation apps that restore
 * the clipboard after pasting) Wispr Flow's history. It never guesses: if the
 * two disagree, the placeholder stays.
 */
export function decide(box: string, ph: Placeholder, s: Sources): Decision {
  const clip = normalise(s.clipboard)
  const clipFits = clip.length > 0 && fits(clip, ph)
  const dictation = s.rows && matchDictation(s.rows, ph, s.used)

  const notYet = (reason: string): Decision =>
    s.rows !== undefined && !s.isLastAttempt ? { kind: 'wait', reason } : { kind: 'leave', reason }

  if (dictation) {
    if (clipFits && clip.trim() !== dictation.text.trim()) {
      return { kind: 'leave', reason: 'clipboard and dictation both fit but differ' }
    }
    if (dictation.text.length > s.maxChars) {
      return { kind: 'leave', reason: `${dictation.text.length} chars is over the ${s.maxChars} limit` }
    }
    return { kind: 'expand', ...swap(box, ph, dictation.text), source: 'dictation', rowId: dictation.row.id }
  }

  if (clipFits) {
    if (clip.length > s.maxChars) return notYet(`${clip.length} chars is over the ${s.maxChars} limit`)
    // A dictation's row can land just after its paste: give it one more look
    // before trusting a clipboard that might be stale.
    if (s.rows !== undefined && s.attempt === 0 && !s.isLastAttempt) {
      return { kind: 'wait', reason: 'clipboard fits; checking no dictation is landing' }
    }
    return { kind: 'expand', ...swap(box, ph, clip), source: 'clipboard' }
  }

  return notYet('neither the clipboard nor a recent dictation fits')
}

/** Reads the `maxChars` option, falling back to the default. */
export function maxCharsFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_CHARS
}
