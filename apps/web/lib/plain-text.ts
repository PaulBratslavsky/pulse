/**
 * Markdown in, the characters a social platform will actually show out.
 *
 * X and LinkedIn have no markdown at all, so a draft's `**bold**` reaches the
 * public as asterisks. This runs before you paste.
 *
 * A string transform rather than a parse, on purpose: the app has no markdown
 * parser installed, and adding a parse-and-serialize pipeline in order to
 * REMOVE formatting would be heavier than the transform.
 *
 * Idempotent — toPlainText(toPlainText(x)) === toPlainText(x) — which is what
 * lets the reply box say "already plain text" honestly. One exception, and it
 * is inherent rather than a bug: `\*literal\*` becomes `*literal*`, and a
 * second pass cannot tell that asterisk from a marker. An escape exists
 * precisely to make a character look like itself.
 */

/** A private-use codepoint, so held content cannot collide with real text. */
const MASK = '\uE000'

function hold(store: string[], value: string): string {
  store.push(value)
  return `${MASK}${store.length - 1}${MASK}`
}

function release(text: string, store: string[]): string {
  return text.replace(new RegExp(`${MASK}(\\d+)${MASK}`, 'g'), (_, i) => store[Number(i)])
}

/**
 * Everything that happens within one line.
 *
 * Order matters twice over: escapes and code spans are held aside FIRST so no
 * later rule mistakes their contents for syntax, and bold runs before italic
 * because `**x**` would otherwise read as an empty italic wrapping `*x*`.
 */
function inlineToPlainText(line: string): string {
  const held: string[] = []

  // `\*` is a literal asterisk. Held as its bare character.
  let out = line.replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, (_, ch: string) => hold(held, ch))

  // `a ** b` inside backticks is code, not emphasis.
  out = out.replace(/`([^`]+)`/g, (_, code: string) => hold(held, code))

  // An image carries nothing a plain-text reply can use.
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '')

  // Link text stays WITH the url. Dropping it to keep the url leaves the
  // sentence the link sat inside broken.
  out = out.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, '$1 ($2)')
  out = out.replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')

  // The \S guards are what keep "2 * 3 * 4" and "find_one_by_id" intact:
  // real emphasis never has whitespace against the inside of its markers, and
  // an underscore between word characters is part of a name.
  out = out.replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, '$1')
  out = out.replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, '$1')
  out = out.replace(/(?<!\w)__(\S(?:[\s\S]*?\S)?)__(?!\w)/g, '$1')
  out = out.replace(/\*(\S(?:[\s\S]*?\S)?)\*/g, '$1')
  out = out.replace(/(?<!\w)_(\S(?:[\s\S]*?\S)?)_(?!\w)/g, '$1')

  return release(out, held)
}

export function toPlainText(markdown: string): string {
  const out: string[] = []
  let inFence = false

  for (const raw of markdown.split('\n')) {
    // The fence lines go; the code between them stays exactly as typed.
    // Running the inline pass over code would eat the characters it quotes.
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push(raw.trimEnd())
      continue
    }

    let line = raw

    // A rule is decoration, and decoration is what we are here to remove.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue

    // A table's separator row is pure syntax — no content to keep.
    if (/^\s*\|?[\s:|-]*-[\s:|-]*\|[\s:|-]*$/.test(line)) continue

    line = line.replace(/^\s*#{1,6}\s+/, '')
    line = line.replace(/^(\s*)(?:>\s?)+/, '$1')

    // A row becomes one line of cells. The grid cannot survive a paste into a
    // platform with no monospace, so joining beats pretending.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      out.push(
        line
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((cell) => inlineToPlainText(cell).trim())
          .filter(Boolean)
          .join(' — ')
      )
      continue
    }

    line = line.replace(/^(\s*)[-*+]\s+/, '$1• ')

    out.push(inlineToPlainText(line).trimEnd())
  }

  // Three blank lines is a rendering artefact, not a pause anyone wrote.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
