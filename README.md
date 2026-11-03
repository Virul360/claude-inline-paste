# inline-paste

[![Release](https://img.shields.io/github/v/release/Virul360/claude-inline-paste?include_prereleases&label=release)](https://github.com/Virul360/claude-inline-paste/releases)
[![Tests](https://github.com/Virul360/claude-inline-paste/actions/workflows/test.yml/badge.svg)](https://github.com/Virul360/claude-inline-paste/actions/workflows/test.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Virul360/claude-inline-paste/blob/main/LICENSE)

A [Claude Code](https://claude.com/claude-code) mod that keeps pastes and voice dictations editable in the prompt box.

Claude Code folds any paste over 800 characters (or with more than 2 line breaks) into a `[Pasted text #1 +N lines]` placeholder, so you can't read or edit it before you send. That includes long voice dictations, because most dictation apps insert text by pasting.

With this mod, a paste up to a **limit you choose** is put back into the prompt box as plain text you can edit. Longer pastes stay folded as usual.

## Installation

At the prompt of a Claude Code terminal session:

```
/plugin install inline-paste --marketplace Virul360/claude-inline-paste
```

Answer `y` to add the marketplace, then pick a scope (the user scope loads it in every session).

From a shell:

```
claude plugin install inline-paste --marketplace Virul360/claude-inline-paste
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Virul360/claude-inline-paste`, then **Add plugin**.

## Configuration

**The limit is yours to set.** The default of **2,500 characters** (about a minute of dictation) is just the author's choice. Claude Code asks for the value when you install the mod, and you can change it any time in `/config`.

| Option | Default | What it does |
| --- | --- | --- |
| `maxChars` | `2500` | Pastes up to this many characters are shown in full. Longer ones stay folded. Any value from 1 to 100,000. |
| `debug` | `false` | Prints a dim line in the transcript saying why each paste was or wasn't expanded. |

You can also set the options in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "inline-paste@claude-inline-paste": {
      "options": { "maxChars": 10000 }
    }
  }
}
```

## How it works

1. You paste or dictate, and Claude Code folds the text into a `[Pasted text #N +M lines]` placeholder as it normally does.
2. The mod sees the new placeholder and looks for the full text in two places: the clipboard (with `pbpaste`) and, if you use Wispr Flow, its local dictation history.
3. If one of them is within your limit **and** its line breaks match the placeholder's line count, the mod swaps the placeholder for the full text. You see the placeholder for a moment, then your text.
4. If nothing matches, or the clipboard and a recent dictation both fit but differ, the mod leaves the placeholder alone rather than guess.

Nothing is sent anywhere, and Claude receives the same text either way: Claude Code expands placeholders when you send.

## Voice dictation

**[Wispr Flow](https://wisprflow.ai) works out of the box.** It restores your old clipboard right after it pastes, so the clipboard can't be used. Instead the mod reads the most recent dictations from Wispr Flow's history at `~/Library/Application Support/Wispr Flow/flow.sqlite`.

- That read is **read-only and stays on your Mac**, using the system's `sqlite3`. It only happens when a folded placeholder appears.
- That file holds your dictation history. The mod uses it only to recover the dictation you just made, and debug lines show lengths and counts, never your words.
- If you don't use Wispr Flow, the file isn't there and the mod just uses the clipboard.
- The database isn't a public Wispr Flow API. A Wispr Flow update could change it, and dictations would then stay folded.

Other dictation apps work if they leave the text on the clipboard after pasting. Apps that restore the clipboard stay folded.

## Limitations

- **macOS only.** It uses `pbpaste`, and reads the clipboard of the machine running Claude Code, so it won't help over SSH.
- **If you use Wispr Flow, copied pastes expand about half a second later,** because the mod first checks that no dictation is landing.
- **If a paste stays folded,** pasting the same text a second time also expands it (a built-in Claude Code feature).
- **Swapped-in text is sent as typed text,** not as a marked paste. That's what you want for dictation. Keep it in mind for copied third-party content, such as emails or web pages.
- **Claude Code's mod API is early access.** If a future release changes it, the most likely result is that the mod quietly stops expanding pastes, and you're back to placeholders.

## Development

Clone the repo and load it straight from the folder:

```
claude --plugin-dir ./claude-inline-paste
```

Run the checks the CI runs:

```
claude plugin validate .
claude plugin test .
```

The logic that decides whether to expand a paste, and from which source, is in [`hooks/paste.ts`](hooks/paste.ts), with no engine calls, so it's easy to test. The hook that wires it to Claude Code is in [`hooks/register.ts`](hooks/register.ts).

## License

[MIT](LICENSE)
