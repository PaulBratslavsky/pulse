#!/usr/bin/env node
/**
 * Delete e2e fixture data from the LOCAL dev database.
 *
 * The Playwright suite injects mentions through the real webhook (by design —
 * it exercises the actual ingest path), so fixtures accumulate in dev and
 * clutter the queue. They are unambiguous: the helper always generates
 * `externalId` = `e2e-<timestamp>-<rand>`.
 *
 * Muting the e2e author instead would break the suite — a muted author's
 * mentions are marked spam at intake and never reach the queue or search,
 * which is exactly what four tests assert against.
 *
 * Safe by construction: only rows whose externalId starts with `e2e-`, and
 * only against the local SQLite file. Never run this against production.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const DB = new URL('../.tmp/data.db', import.meta.url).pathname
if (!existsSync(DB)) {
  console.error(`no local database at ${DB} — nothing to clean`)
  process.exit(0)
}

const db = new DatabaseSync(DB)
const ids = db.prepare("SELECT id FROM mentions WHERE external_id LIKE 'e2e-%'").all().map((r) => r.id)
if (!ids.length) {
  console.log('no e2e fixtures found — queue is already clean')
  process.exit(0)
}

const list = ids.join(',')
const CHILD = [
  ['responses', 'responses_mention_lnk', 'response_id', 'mention_id'],
  ['comments', 'comments_mention_lnk', 'comment_id', 'mention_id'],
  ['activities', 'activities_mention_lnk', 'activity_id', 'mention_id'],
]
let removed = 0
for (const [table, link, childCol, parentCol] of CHILD) {
  try {
    const childIds = db
      .prepare(`SELECT ${childCol} AS id FROM ${link} WHERE ${parentCol} IN (${list})`)
      .all()
      .map((r) => r.id)
    if (!childIds.length) continue
    db.exec(`DELETE FROM ${link} WHERE ${parentCol} IN (${list})`)
    db.exec(`DELETE FROM ${table} WHERE id IN (${childIds.join(',')})`)
    removed += childIds.length
    console.log(`  removed ${childIds.length} ${table}`)
  } catch (err) {
    console.warn(`  skipped ${table}: ${err.message}`)
  }
}
try {
  db.exec(`DELETE FROM mentions_topics_lnk WHERE mention_id IN (${list})`)
} catch {}
db.exec(`DELETE FROM mentions WHERE id IN (${list})`)
console.log(`removed ${ids.length} e2e mention(s) and ${removed} child row(s)`)
db.close()
