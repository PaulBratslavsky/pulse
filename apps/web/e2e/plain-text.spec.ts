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
