#!/usr/bin/env node
/**
 * The brain plugin is self-contained (docs/architecture.md → "Marketing brain
 * data hub"): its content types, sync, cron, MCP tools and permissions live in
 * src/plugins/brain, and the two sides only meet where Pulse enables it.
 *
 * Fails when:
 * 1. Pulse code (src/, config/) refers to the brain anywhere but config/plugins.ts
 * 2. the plugin imports a file outside its own folder
 *
 * Run from apps/cms: `node scripts/check-brain-boundary.mjs`.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const plugin = path.join(root, 'src/plugins/brain')
const allowed = new Set([path.join(root, 'config/plugins.ts')])

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : walk(p)
    return /\.(ts|tsx|js|mjs|cjs)$/.test(e.name) ? [p] : []
  })

const problems = []

// 1. Pulse → brain
const BRAIN_REF = /plugin\(\s*['"]brain['"]\s*\)|plugin::brain\.|plugins\/brain|BRAIN_[A-Z_]+|['"]brain-[a-z-]+['"]/
for (const file of [...walk(path.join(root, 'src')), ...walk(path.join(root, 'config'))]) {
  if (file.startsWith(plugin + path.sep) || allowed.has(file)) continue
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (BRAIN_REF.test(line)) problems.push(`${path.relative(root, file)}:${i + 1} refers to the brain: ${line.trim()}`)
    })
}

// 2. brain → outside its folder
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]*)['"]/g
for (const file of walk(plugin)) {
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(IMPORT)) {
    const target = path.resolve(path.dirname(file), m[1])
    if (target !== plugin && !target.startsWith(plugin + path.sep)) {
      const line = text.slice(0, m.index).split('\n').length
      problems.push(`${path.relative(root, file)}:${line} imports from outside the plugin: ${m[1]}`)
    }
  }
}

if (problems.length) {
  console.error('The brain plugin must stay self-contained (docs/architecture.md):')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log('brain boundary ok')
