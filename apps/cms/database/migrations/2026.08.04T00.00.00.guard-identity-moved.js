'use strict'

/**
 * Refuse to drop the identity columns unless the data is already out.
 *
 * PHASE B of the Person → SocialAccount split. Phase A copied identity onto
 * `social_accounts` from `bootstrap()`; this deploy removes the columns from
 * person/schema.json, and Strapi drops a column the moment its attribute leaves
 * the schema. If the copy never ran — a rollback, a failed boot, a fresh
 * environment that skipped a release — the drop would take the only copy of
 * 400+ people's handles, profile URLs and follower counts with it.
 *
 * Why this is a migration and not another bootstrap pass: user migrations run
 * BEFORE schema sync (@strapi/database/dist/schema/index.js — sync() calls
 * migrations.up() and only then syncSchema()), so this executes while the
 * columns still exist and can still be checked. Anything in bootstrap() would
 * run after the drop, when there is nothing left to verify.
 *
 * Why it ships in the SAME deploy as the drop: umzug records each migration
 * once. Shipped a release early it would run against already-migrated data,
 * pass trivially, and never fire again on the deploy that actually matters.
 *
 * Throwing here aborts the boot with the columns intact. That is the intended
 * outcome — a failed deploy is recoverable, a dropped column is not.
 */
async function up(knex) {
  const hasKey = await knex.schema.hasColumn('people', 'identity_key')
  if (!hasKey) return // already dropped on a previous deploy — nothing to guard

  const hasAccounts = await knex.schema.hasTable('social_accounts')
  if (!hasAccounts) {
    throw new Error(
      'refusing to drop the identity columns: social_accounts does not exist, so phase A never ran here. ' +
        'Deploy the previous release first, confirm "pulse: social accounts split out" in the boot log, then deploy this one.'
    )
  }

  // Compare against what actually landed, not against a count: a partial copy
  // is the dangerous case, and totals can match while the wrong rows moved.
  const [{ orphaned }] = await knex('people')
    .whereNotNull('identity_key')
    .whereNotExists(function () {
      this.select(knex.raw('1'))
        .from('social_accounts')
        .whereRaw('social_accounts.identity_key = people.identity_key')
    })
    .count({ orphaned: '*' })

  if (Number(orphaned) > 0) {
    throw new Error(
      `refusing to drop the identity columns: ${orphaned} person row(s) have an identity_key with no matching ` +
        'social_accounts row. Their handle and profile URL exist nowhere else. Roll back to the previous release, ' +
        'let the boot pass finish, and check for "pulse: social accounts split out" before retrying.'
    )
  }
}

async function down() {
  // Nothing to undo: this migration only ever reads.
}

module.exports = { up, down }
