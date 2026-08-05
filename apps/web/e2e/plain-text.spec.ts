import { test, expect } from '@playwright/test'

import { toPlainText } from '../lib/plain-text'

/**
 * The conversion, case by case. No browser: this is a string function, and a
 * table of inputs is a better description of it than any amount of clicking.
 */
const INLINE: Array<[name: string, input: string, expected: string]> = [
  ['bold with asterisks', '**Structured, reusable content**', 'Structured, reusable content'],
  ['bold with underscores', '__bold__', 'bold'],
  ['italic with asterisks', '*emphasis*', 'emphasis'],
  ['italic with underscores', '_emphasis_', 'emphasis'],
  ['strikethrough', '~~gone~~', 'gone'],
  ['code span', 'define a `schema` here', 'define a schema here'],
  ['code span keeps its asterisks', 'the `a ** b` operator', 'the a ** b operator'],
  [
    'link keeps text and url',
    'see [Content-Type Builder](https://docs.strapi.io/ctb) for more',
    'see Content-Type Builder (https://docs.strapi.io/ctb) for more',
  ],
  ['link with a title attribute', '[docs](https://x.dev "Title")', 'docs (https://x.dev)'],
  ['autolink', 'read <https://docs.strapi.io> first', 'read https://docs.strapi.io first'],
  ['image is dropped', 'before ![alt](https://x.dev/a.png) after', 'before  after'],
  ['escaped asterisk survives', 'a literal \\*star\\*', 'a literal *star*'],
  ['emoji passes through', '✅ **done**', '✅ done'],
  ['nested emphasis inside bold', '**very *very* bold**', 'very very bold'],
  // The false positives that make a naive strip worse than no strip:
  ['multiplication is not emphasis', '2 * 3 * 4 = 24', '2 * 3 * 4 = 24'],
  ['snake_case keeps its joints', 'call find_one_by_id soon', 'call find_one_by_id soon'],
  ['unclosed bold is left alone', 'the **unfinished thought', 'the **unfinished thought'],
]

for (const [name, input, expected] of INLINE) {
  test(`inline: ${name}`, () => {
    expect(toPlainText(input)).toBe(expected)
  })
}

test('inline: empty and whitespace-only input do not throw', () => {
  expect(toPlainText('')).toBe('')
  expect(toPlainText('   \n  \n ')).toBe('')
})

const BLOCK: Array<[name: string, input: string, expected: string]> = [
  ['heading loses its hashes', '## Why this matters', 'Why this matters'],
  ['dash bullet becomes a dot', '- Reusable components', '• Reusable components'],
  ['star bullet becomes a dot', '* Dynamic zones', '• Dynamic zones'],
  ['plus bullet becomes a dot', '+ Draft and publish', '• Draft and publish'],
  ['nested bullet keeps its indent', '- Components\n  - Nested one', '• Components\n  • Nested one'],
  ['ordered list is left as written', '1. First\n2. Second', '1. First\n2. Second'],
  ['blockquote loses its angle', '> quoted claim', 'quoted claim'],
  ['horizontal rule is dropped', 'before\n\n---\n\nafter', 'before\n\nafter'],
  [
    'fenced code keeps its body and loses its fence',
    'run it:\n\n```bash\nnpm run develop\n```',
    'run it:\n\nnpm run develop',
  ],
  [
    'code inside a fence is not treated as markdown',
    '```js\nconst a = b * c * d\n```',
    'const a = b * c * d',
  ],
  [
    'table flattens to one line per row',
    '| Field | Type |\n| --- | --- |\n| title | string |',
    'Field — Type\ntitle — string',
  ],
  ['three blank lines collapse to one gap', 'a\n\n\n\nb', 'a\n\nb'],
  [
    'the screenshot draft, end to end',
    "✅ **Structured, reusable content** — Strapi's [Content-Type Builder](https://docs.strapi.io/ctb) lets you define `schema`-driven structures:\n\n- Reusable components\n- Dynamic zones",
    "✅ Structured, reusable content — Strapi's Content-Type Builder (https://docs.strapi.io/ctb) lets you define schema-driven structures:\n\n• Reusable components\n• Dynamic zones",
  ],
]

for (const [name, input, expected] of BLOCK) {
  test(`block: ${name}`, () => {
    expect(toPlainText(input)).toBe(expected)
  })
}

/**
 * The property the disabled "already plain text" button rests on. Without it
 * that label is a guess.
 *
 * Escaped markers are excluded and that is not an oversight: `\*x\*` becomes
 * `*x*`, and nothing downstream can tell that asterisk from a marker. An
 * escape exists to make a character look like itself.
 */
for (const [name, input] of [...INLINE, ...BLOCK].filter(([, i]) => !i.includes('\\'))) {
  test(`idempotent: ${name}`, () => {
    const once = toPlainText(input)
    expect(toPlainText(once)).toBe(once)
  })
}
