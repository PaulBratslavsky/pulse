# Plain-text tab on the reply box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the reply box a Plain text tab that shows the reply with markdown stripped, copies it, and — on one click — converts the reply itself so what Pulse records is what you posted.

**Architecture:** One pure string transform in `apps/web/lib/plain-text.ts` (`toPlainText`), tested without a browser. One tab strip local to `apps/web/components/reply/reply-box.tsx` that renders either today's textarea or a read-only stripped pane. Converting routes through the `replace()` already in `reply-draft-context`, so the existing undo covers it and no new state is introduced.

**Tech Stack:** Next.js 16.2.11, React 19.2.4, TypeScript 5, Tailwind 4, Playwright 1.62. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-08-04-plain-text-tab-design.md`

## Global Constraints

- **No new npm dependencies.** The transform is hand-written; do not add `remark`, `unified`, `strip-markdown`, or any parser.
- `toPlainText` is **pure** — no React import, no DOM access, no I/O. It must be importable from a Node-only test file.
- `toPlainText` is **total**: every string input returns a string. It never throws, and never returns `undefined` or `null`.
- **Idempotent** for every input except escaped markers (`\*`), which is documented in the spec and asserted as a known exception.
- Emoji pass through untouched. `✅` in, `✅` out.
- Never strip formatting automatically. Conversion happens only when the human clicks `Use this as my reply`.
- Existing behaviour of the Write tab is unchanged — same textarea, same placeholder `What you actually replied…`, same `Record response` flow. Existing e2e tests must keep passing without edits.
- This repo's Next.js has breaking changes vs. training data (see `apps/web/AGENTS.md`). No new Next.js APIs are needed here; if you reach for one, read `node_modules/next/dist/docs/` first.
- Run all commands from `apps/web/`.

---

### Task 1: The inline pass — emphasis, code, links, escapes

Sets up the server-free test project and delivers the half of `toPlainText` that works within a single line.

**Files:**
- Create: `apps/web/lib/plain-text.ts`
- Create: `apps/web/e2e/plain-text.spec.ts`
- Modify: `apps/web/playwright.config.ts:23-24` (add a `unit` project to the `projects` array)

**Interfaces:**
- Consumes: nothing.
- Produces: `export function toPlainText(markdown: string): string` from `@/lib/plain-text`. Task 2 extends the same function; Task 3 imports it into the reply box.

- [ ] **Step 1: Add the server-free Playwright project**

In `apps/web/playwright.config.ts`, add this as the FIRST entry of the `projects` array, above `{ name: 'setup', ... }`:

```ts
    // Pure-function tests: no auth, no page, no fixtures. Deliberately has no
    // `dependencies`, so a failing sign-in cannot hide a conversion bug.
    { name: 'unit', testMatch: /plain-text\.spec\.ts/ },
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/e2e/plain-text.spec.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx playwright test --project=unit`
Expected: FAIL — `Cannot find module '../lib/plain-text'`.

- [ ] **Step 4: Write the implementation**

Create `apps/web/lib/plain-text.ts`:

```ts
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
  return markdown
    .split('\n')
    .map((line) => inlineToPlainText(line).trimEnd())
    .join('\n')
    .trim()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test --project=unit`
Expected: PASS, 18 tests.

If `nested emphasis inside bold` fails, check that bold runs before italic. If `multiplication is not emphasis` fails, check the `\S` guards are present on the italic rules.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/plain-text.ts apps/web/e2e/plain-text.spec.ts apps/web/playwright.config.ts
git commit -m "feat(plain-text): strip inline markdown from a reply"
```

---

### Task 2: The block pass — headings, lists, quotes, rules, fences, tables

**Files:**
- Modify: `apps/web/lib/plain-text.ts` (replace the body of `toPlainText`; `inlineToPlainText` is unchanged)
- Modify: `apps/web/e2e/plain-text.spec.ts` (append a second table and the idempotence test)

**Interfaces:**
- Consumes: `toPlainText(markdown: string): string` and the module-private `inlineToPlainText(line: string): string` from Task 1.
- Produces: the same `toPlainText` signature, now handling multi-line input. Task 3 imports it.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/e2e/plain-text.spec.ts`:

```ts
const BLOCK: Array<[name: string, input: string, expected: string]> = [
  ['heading loses its hashes', '## Why this matters', 'Why this matters'],
  ['dash bullet becomes a dot', '- Reusable components', '• Reusable components'],
  ['star bullet becomes a dot', '* Dynamic zones', '• Dynamic zones'],
  ['plus bullet becomes a dot', '+ Draft and publish', '• Draft and publish'],
  [
    'nested bullet keeps its indent',
    '- Components\n  - Nested one',
    '• Components\n  • Nested one',
  ],
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
    '✅ **Structured, reusable content** — Strapi\'s [Content-Type Builder](https://docs.strapi.io/ctb) lets you define `schema`-driven structures:\n\n- Reusable components\n- Dynamic zones',
    '✅ Structured, reusable content — Strapi\'s Content-Type Builder (https://docs.strapi.io/ctb) lets you define schema-driven structures:\n\n• Reusable components\n• Dynamic zones',
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test --project=unit`
Expected: the `block:` tests FAIL (headings keep `##`, bullets keep `-`, fences appear in the output). The `inline:` and `idempotent:` tests pass — the inline pass is already idempotent.

- [ ] **Step 3: Write the implementation**

In `apps/web/lib/plain-text.ts`, replace the whole `toPlainText` function from Task 1 with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test --project=unit`
Expected: PASS, all tests including every `idempotent:` case.

If `horizontal rule is dropped` leaves a triple newline, confirm the `\n{3,}` collapse runs after the join and not per-line.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/plain-text.ts apps/web/e2e/plain-text.spec.ts
git commit -m "feat(plain-text): strip block markdown, and prove the transform settles"
```

---

### Task 3: The tab strip on the reply box

**Files:**
- Modify: `apps/web/components/reply/reply-draft-context.tsx:22` (widen the `Via` union)
- Modify: `apps/web/components/reply/reply-box.tsx` (tab strip, plain pane, two buttons)
- Modify: `apps/web/e2e/queue-and-detail.spec.ts` (append one test)
- Modify: `apps/web/playwright.config.ts:32` — no change needed; `queue-and-detail.spec.ts` is already in the `app` project's `testMatch`.

**Interfaces:**
- Consumes: `toPlainText(markdown: string): string` from `@/lib/plain-text` (Task 2). From `useReplyDraft()`: `text: string`, `setText: (t: string) => void`, `replace: (next: string, via: Via) => void`, `previous: string | null`, `via: Via`.
- Produces: no new exports. `Via` becomes `'refine' | 'chat' | 'plaintext'`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/e2e/queue-and-detail.spec.ts`, at the END of the file and at top level — OUTSIDE the existing `test.describe('queue → claim → respond → outcome (the core loop)', …)` block, since these are not part of that loop. The file already imports `{ test, expect }` from `@playwright/test` and `{ injectMention }` from `./helpers`; add no new imports.

```ts
test('the plain text tab strips markdown, converts the reply, and undoes', async ({
  page,
  request,
}) => {
  const { documentId } = await injectMention(request)
  await page.goto(`/mentions/${documentId}`)

  const box = page.getByPlaceholder('What you actually replied…')
  await box.fill('**Bold claim** — see [the docs](https://docs.strapi.io/ctb)\n\n- one\n- two')

  await page.getByRole('tab', { name: 'Plain text' }).click()

  // What you would paste into LinkedIn: no markers, url still reachable.
  const pane = page.getByRole('tabpanel', { name: 'Plain text' })
  await expect(pane).toContainText('Bold claim — see the docs (https://docs.strapi.io/ctb)')
  await expect(pane).toContainText('• one')
  await expect(pane).not.toContainText('**')

  // Converting rewrites the reply, because the response Pulse records has to
  // be the text that actually went out.
  await page.getByRole('button', { name: 'Use this as my reply' }).click()
  await page.getByRole('tab', { name: 'Write' }).click()
  await expect(box).toHaveValue(/Bold claim — see the docs/)
  await expect(box).not.toHaveValue(/\*\*/)

  // And the existing one-slot undo covers it.
  await page.getByRole('button', { name: /restore what I wrote/i }).click()
  await expect(box).toHaveValue(/\*\*Bold claim\*\*/)
})

test('the plain text tab says so when there is nothing to strip', async ({ page, request }) => {
  const { documentId } = await injectMention(request)
  await page.goto(`/mentions/${documentId}`)

  await page.getByPlaceholder('What you actually replied…').fill('Thanks — fixed in 5.4.2.')
  await page.getByRole('tab', { name: 'Plain text' }).click()

  await expect(page.getByRole('button', { name: 'Use this as my reply' })).toBeDisabled()
  await expect(page.getByText('already plain text')).toBeVisible()
})
```

Note on the undo assertion: today the undo control is a `<button>` rendered only when `previous !== null`, with the text `undo — restore what I wrote`. Task 3's implementation must keep it a `<button>` so `getByRole('button')` finds it.

- [ ] **Step 2: Run the test to verify it fails**

The stack must be running: from the repo root, `npm run dev` (Next on :3000, Strapi on :1338).

Run: `npx playwright test --project=app -g "plain text tab"`
Expected: FAIL — no element with role `tab` named `Plain text`.

- [ ] **Step 3: Widen the `Via` union**

In `apps/web/components/reply/reply-draft-context.tsx`, line 22:

```ts
type Via = 'refine' | 'chat' | 'plaintext'
```

Change nothing else in that file. The `via === 'refine'` guard in `reply-box.tsx` stays correct as written — a strip pass makes no technical claims, so it must show no verification verdict either way.

- [ ] **Step 4: Add the tab state and the stripped text**

In `apps/web/components/reply/reply-box.tsx`, update the React import on line 3 and add the imports:

```ts
import { useEffect, useMemo, useState } from 'react'
```

Add below the existing `lucide-react` import:

```ts
import { Check, Copy } from 'lucide-react'
```
(merge into the existing line so it reads `import { Check, Copy, Sparkles } from 'lucide-react'`)

And below the `pulseFetch` import:

```ts
import { toPlainText } from '@/lib/plain-text'
```

Then inside the component, immediately after `const [notes, setNotes] = useState('')`:

```ts
  // Two views of one reply. The textarea is what you record; the plain view is
  // what X and LinkedIn will actually show, since neither renders markdown.
  const [tab, setTab] = useState<'write' | 'plain'>('write')
  const [copied, setCopied] = useState(false)
  const plain = useMemo(() => toPlainText(finalText), [finalText])
  const nothingToStrip = plain === finalText.trim()

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])
```

- [ ] **Step 5: Replace the textarea with the tab strip and both panes**

In `apps/web/components/reply/reply-box.tsx`, replace the `<textarea>` element (currently lines 88-94) with:

```tsx
      <div>
        <div role="tablist" aria-label="Reply format" className="mb-2 flex gap-1">
          {(
            [
              ['write', 'Write'],
              ['plain', 'Plain text'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              id={`reply-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`reply-panel-${id}`}
              onClick={() => setTab(id)}
              className={
                tab === id
                  ? 'rounded-md bg-zinc-100 px-2.5 py-1 text-xs font-medium dark:bg-zinc-800'
                  : 'rounded-md px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
              }
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'write' ? (
          <textarea
            id="reply-panel-write"
            role="tabpanel"
            aria-labelledby="reply-tab-write"
            value={finalText}
            onChange={(e) => setFinalText(e.target.value)}
            placeholder="What you actually replied…"
            rows={6}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        ) : (
          <div id="reply-panel-plain" role="tabpanel" aria-labelledby="reply-tab-plain">
            {/* Same rows={6} height as the textarea, so switching tabs does not
                jump the buttons out from under the pointer. */}
            <div className="min-h-[8.5rem] w-full overflow-y-auto rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-950">
              {plain || (
                <span className="text-zinc-500">Nothing to show yet — write a reply first.</span>
              )}
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">
              What X, LinkedIn or Reddit will actually show. None of them render markdown.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(plain)
                  setCopied(true)
                }}
                disabled={!plain}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              {/* Converting rewrites the reply on purpose: the response Pulse
                  records has to be the text that actually went out, not a
                  formatted version that never existed on the platform. */}
              <button
                onClick={() => {
                  replace(plain, 'plaintext')
                  setTab('write')
                }}
                disabled={!plain || nothingToStrip}
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium disabled:opacity-50 dark:border-zinc-700"
              >
                Use this as my reply
              </button>
              {nothingToStrip && plain && (
                <span className="text-xs text-zinc-500">already plain text</span>
              )}
            </div>
          </div>
        )}
      </div>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx playwright test --project=app -g "plain text tab"`
Expected: PASS, 2 tests.

If the undo assertion fails, check that `replace(plain, 'plaintext')` was called rather than `setFinalText(plain)` — only `replace` records the undo slot.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/reply/reply-box.tsx apps/web/components/reply/reply-draft-context.tsx apps/web/e2e/queue-and-detail.spec.ts
git commit -m "feat(reply): a plain text tab, because LinkedIn shows the asterisks"
```

---

### Task 4: Verify the whole suite and the production build

A new tab on the busiest page in the app, and a `whitespace-pre-wrap` block inside a column that has to survive a phone. Both are things a dev server hides.

**Files:** none changed unless a failure is found.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing.

- [ ] **Step 1: Run the full Playwright suite**

The stack must be running (`npm run dev` from the repo root).

Run: `npx playwright test`
Expected: PASS. The baseline before this work was 70 passing; expect 70 plus the new `unit` cases plus the 2 browser tests.

If `responsive.spec.ts` fails on horizontal overflow, the plain pane is the suspect — a long unbroken URL in `whitespace-pre-wrap` will push the column. The fix is `break-words` on the pane div, not a viewport change.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit any fixes**

Only if Steps 1-3 turned up something:

```bash
git add -A
git commit -m "fix(reply): <what the suite or build caught>"
```

---

## Done when

- `Write` / `Plain text` tabs sit above the reply box; Write is byte-for-byte today's textarea.
- The Plain text pane shows the reply with markdown stripped by the rules in the spec's table, and says so when there is nothing to strip.
- `Copy` puts that text on the clipboard; `Use this as my reply` rewrites the reply and `undo — restore what I wrote` brings the markdown back.
- `npx playwright test` and `npm run build` both pass.
- No new npm dependency appears in `apps/web/package.json`.
