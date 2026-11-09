#!/usr/bin/env node
/**
 * Stamps the build with the plugin's version, the git commit and the build
 * time, in dist/server/build-info.json. brain-guide returns it, so one call
 * after a deploy says which code production runs. No git (a tarball, a
 * shallow clone without it) leaves commit null; the build never fails on it.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
let commit = null
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
} catch {
  /* no git here */
}
const out = path.join(root, 'dist/server/build-info.json')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ version, commit, builtAt: new Date().toISOString() }, null, 2) + '\n')
