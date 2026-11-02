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

/** Normalises clipboard text the way Claude Code normalises a paste. */
export function normalise(clip: string): string {
  return clip.replace(/\r\n|\r/g, '\n').replaceAll('\t', '    ')
}

export type Decision =
  | { expand: true; text: string; cursor: number }
  | { expand: false; reason: string }

/**
 * Decides whether the placeholder `ph` in `box` can be swapped for `clip`, and
 * builds the new box text if so. The clipboard must be non-empty, within
 * `maxChars`, and have the same number of line breaks the placeholder names,
 * so a stale clipboard is never swapped in for a different paste.
 */
export function decide(box: string, ph: Placeholder, rawClip: string, maxChars: number): Decision {
  const clip = normalise(rawClip)
  if (clip.length === 0) return { expand: false, reason: 'clipboard is empty' }
  if (clip.length > maxChars) {
    return { expand: false, reason: `${clip.length} chars is over the ${maxChars} limit` }
  }

  const lines = (clip.match(/\n/g) ?? []).length
  if (lines !== ph.lines) {
    return { expand: false, reason: `clipboard has ${lines} line breaks, placeholder says ${ph.lines}` }
  }

  return {
    expand: true,
    text: box.slice(0, ph.index) + clip + box.slice(ph.index + ph.match.length),
    cursor: ph.index + clip.length,
  }
}

/** Reads the `maxChars` option, falling back to the default. */
export function maxCharsFrom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_CHARS
}
