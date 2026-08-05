# Plain-text tab on the reply box — design

**Date:** 2026-08-04
**Status:** approved, not yet implemented

## The problem

The draft arrives in markdown. You paste it into LinkedIn, and LinkedIn shows
the asterisks.

`Use this draft` copies the machine's text into the reply box verbatim —
`✅ **Structured, reusable content** — Strapi's Content-Type Builder lets you…`
— and that box is a staging area for a paste into X, LinkedIn or Reddit. X and
LinkedIn have no markdown at all. Whatever formatting the model reached for is
delivered to the public as punctuation.

This is the other half of [the markdown-rendering
design](./2026-08-04-markdown-rendering-design.md). That one settled how markdown
should *display* inside Pulse, and deliberately left the reply textarea literal
because you paste its exact characters elsewhere. It did not answer what to do
about the characters themselves. This does.

## The rule

The recorded response is what you posted. So stripping is an action you take,
not a filter Pulse applies — and once you take it, the stored text is the
stripped text.

Copying a plain version out while Pulse keeps the markdown would leave the
response record describing a reply that never existed on the platform. That is
the same failure the rendering design was written to avoid, arriving from the
other direction.

## Component: `lib/plain-text.ts`

`toPlainText(markdown: string): string` — pure, no React, no new dependency.

Hand-written rather than parsed with remark. The app has no markdown parser
installed today — `react-markdown` is specified for the display surfaces but not
yet added — and pulling in a parse-and-serialize pipeline in order to *remove*
formatting would be heavier than the transform. This module also has no business
depending on a React rendering library to convert a string.

| in | out |
| --- | --- |
| `**b**` `__b__` `*i*` `_i_` `~~s~~` | inner text |
| `` `code` `` | inner text |
| ` ```fence ` | fence lines dropped, body kept |
| `# Heading` | text on its own line |
| `- ` `* ` `+ ` list markers | `• `, indentation preserved |
| `1. ` ordered markers | kept as-is |
| `[text](url)` | `text (url)` |
| `<https://…>` autolink | the bare URL |
| `![alt](url)` | dropped entirely |
| `> quote` | the text, no `>` |
| `---` `***` horizontal rules | dropped |
| `\*` escapes | the escaped character |
| GFM table | separator row dropped, cells joined by ` — ` |
| 3+ consecutive blank lines | 2 |

Link text is kept alongside the URL — `Content-Type Builder
(https://docs.strapi.io/ctb)` — rather than replaced by it. A link is usually
embedded in a sentence, and dropping the text to keep the URL leaves the
sentence broken.

Emoji are already literal characters and pass through untouched. `✅` in the
draft is `✅` in the output.

**Idempotence is a requirement, not a nice property.** `toPlainText` of already
plain text returns it unchanged, which is what lets the UI tell you honestly
that there is nothing to strip.

## The tab strip

Two tabs on the reply box: **Write** / **Plain text**.

Local to `components/reply/reply-box.tsx`. Nothing else in the app has tabs, so
a shared `<Tabs>` component would be an abstraction extracted from one caller —
if a second surface wants tabs later, that is when the shape is known.

- **Write** is today's textarea, unchanged.
- **Plain text** is a read-only pane, `whitespace-pre-wrap`, at the same height
  as the textarea so switching does not jump the page. Below it: `Copy` and
  `Use this as my reply`.

Both tabs stay visible at all times. A tab that appears only when markdown is
detected would move the controls under the pointer. When the conversion is a
no-op, `Use this as my reply` is disabled and reads *already plain text*.

## Convert, and undo

`Use this as my reply` calls the existing `replace(plain, 'plaintext')` from
`reply-draft-context`, so the existing `undo — restore what I wrote` covers it
with no new state. `Via` gains `'plaintext'` alongside `'refine'` and `'chat'`.

The `via === 'refine'` guard on the "technical claims were **not** verified"
note stays correct as written: a strip pass makes no claims and must not show a
verification verdict either way.

After converting, both tabs show the same text — a consequence of idempotence,
and the signal that the job is done.

## Not doing

**Unicode-bold substitution.** Mapping `**bold**` to mathematical-bold
codepoints (𝗯𝗼𝗹𝗱) does render as bold on LinkedIn and X, and was considered.
Rejected: screen readers announce those codepoints as gibberish or skip them,
and the text stops being searchable or cleanly quotable. A reply that reads as
noise to a blind reader is a worse outcome than a reply without bold.

**Auto-stripping on `Use this draft`.** The draft panel keeps handing over the
markdown it generated. Stripping belongs where you can see both versions before
committing to one.

## Error handling

None at runtime. `toPlainText` is a total function over strings: malformed or
half-written markdown yields text rather than throwing. An unclosed `**` is left
alone rather than guessed at — the reply is still readable, and the human is
about to read it anyway.

## Testing

**`e2e/plain-text.spec.ts`**, in a new Playwright project with no `setup`
dependency, so it needs no running server:

1. A table of conversion cases, one row per rule above.
2. Idempotence over every case: `toPlainText(toPlainText(x)) === toPlainText(x)`.
   This is what makes the disabled-button state honest — without it, *already
   plain text* is a guess.
3. Empty string and whitespace-only input return without throwing.

**One browser test** in the existing app project, on a mention detail page:
type `**bold**` into the reply box, switch to Plain text, assert the pane shows
`bold` and no asterisks, click `Use this as my reply`, assert the textarea
changed, click undo, assert the asterisks are back.

Plus the existing suite for regressions, and `next build`.
