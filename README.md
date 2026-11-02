# inline-paste

A Claude Code mod that keeps short and medium pastes editable.

Claude Code folds any paste over 800 characters (or with more than 2 line breaks) into a `[Pasted text #1 +N lines]` placeholder, so you can't read or edit it before sending. That includes long voice dictations, since most dictation apps insert text by pasting.

With this mod, any paste of **2,500 characters or less** is put back into the prompt box as plain text you can edit. Longer pastes stay folded as usual.

## How it works

When a new `[Pasted text #N …]` placeholder appears, the mod reads the clipboard with `pbpaste`. If the clipboard text is 2,500 characters or less and its line breaks match the placeholder's line count, the mod replaces the placeholder with the full text. Otherwise it leaves the placeholder alone.

Everything runs locally. Nothing is sent anywhere, and the text Claude receives is the same either way.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install inline-paste --marketplace Virul360/claude-inline-paste
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install inline-paste --marketplace Virul360/claude-inline-paste
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Virul360/claude-inline-paste`, then Add plugin.

## Notes and limits

- **macOS only.** It uses `pbpaste`, and reads the clipboard of the machine running Claude Code (so not over SSH).
- **Dictation apps that restore your clipboard** after pasting may leave the text folded, because the clipboard no longer matches. Pasting the same text a second time also expands a placeholder (a built-in Claude Code feature).
- **Text swapped in reads as typed text**, not as a marked paste.
- **Change the limit** by editing `INLINE_LIMIT` in `hooks/register.ts`.
- Claude Code's mod API is early access. If an update changes it, the mod most likely just stops expanding pastes.

## License

MIT
