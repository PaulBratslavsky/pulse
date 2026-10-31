import type { Core } from '@strapi/strapi';

import { UID } from '../content-types';
import { utcDay } from '../utils/youtube-math';

/**
 * Reports and the decisions they record. Written by agents through
 * brain-save-report / brain-update-decision, read back by the next report so
 * "what did we decide last month, and did it work?" has an answer.
 *
 * Same rules as Pulse's draft tools: writes are conditional (a second report
 * for the same kind and date is refused unless overwrite is true), updates are
 * partial, every write is stamped with `via`, and nothing leaves Pulse.
 */

const docs = (strapi: Core.Strapi, uid: string) => strapi.documents(uid as any) as any;

const shapeDecision = (d: any) => ({
  documentId: d.documentId,
  text: d.text,
  owner: d.owner ?? null,
  due: d.due ?? null,
  status: d.status,
  outcome: d.outcome ?? null,
  ...(d.report ? { report: { documentId: d.report.documentId, date: d.report.date, kind: d.report.kind } } : {}),
});

export type NewDecision = { text: string; owner?: string; due?: string };

export const reports = ({ strapi }: { strapi: Core.Strapi }) => ({
  async save(
    args: { date?: string; kind?: string; summary: string; data?: unknown; decisions?: NewDecision[]; overwrite?: boolean },
    via: string
  ) {
    const date = args.date ? utcDay(args.date) : utcDay();
    const kind = args.kind ?? 'youtube-monthly';
    const existing: any = await docs(strapi, UID.report).findFirst({ filters: { kind, date } });
    if (existing && !args.overwrite) {
      return {
        saved: false,
        reason: `a ${kind} report for ${date} already exists — pass overwrite: true to replace its summary and data`,
        existing: { documentId: existing.documentId, via: existing.via ?? null, updatedAt: existing.updatedAt },
      };
    }

    const fields = { summary: args.summary, data: args.data ?? null, via };
    const report: any = existing
      ? await docs(strapi, UID.report).update({ documentId: existing.documentId, data: fields })
      : await docs(strapi, UID.report).create({ data: { date, kind, ...fields } });

    // decisions are only ever added here, never replaced: on an overwrite the
    // earlier ones stay, with whatever status people have given them since
    const created = [];
    for (const d of args.decisions ?? []) {
      const row = await docs(strapi, UID.decision).create({
        data: { report: report.documentId, text: d.text, owner: d.owner ?? null, due: d.due ? utcDay(d.due) : null, status: 'open', via },
      });
      created.push(shapeDecision(row));
    }
    return { saved: true, overwritten: Boolean(existing), documentId: report.documentId, date, kind, decisions: created, via };
  },

  async decisions({ status = 'open', owner, limit = 50 }: { status?: string; owner?: string; limit?: number } = {}) {
    const filters: any = {
      ...(status !== 'any' ? { status } : {}),
      ...(owner ? { owner: { $containsi: owner } } : {}),
    };
    const [rows, total] = await Promise.all([
      docs(strapi, UID.decision).findMany({
        filters,
        populate: { report: { fields: ['date', 'kind'] } },
        sort: 'createdAt:desc',
        limit,
      }),
      docs(strapi, UID.decision).count({ filters }),
    ]);
    // soonest due first, undated last — sorted here because SQLite and
    // Postgres put NULLs at opposite ends of an ORDER BY
    const byDue = [...(rows as any[])].sort((a, b) =>
      a.due === b.due ? 0 : !a.due ? 1 : !b.due ? -1 : String(a.due).localeCompare(String(b.due))
    );
    return { status, total, decisions: byDue.map(shapeDecision) };
  },

  async updateDecision(args: { documentId: string; status?: string; outcome?: string }, via: string) {
    const existing: any = await docs(strapi, UID.decision).findOne({ documentId: args.documentId });
    if (!existing) return { error: `decision ${args.documentId} not found` };
    const data: Record<string, unknown> = {};
    if (args.status !== undefined) data.status = args.status;
    if (args.outcome !== undefined) data.outcome = args.outcome;
    if (!Object.keys(data).length) return { error: 'nothing to update — pass status and/or outcome' };
    const row = await docs(strapi, UID.decision).update({
      documentId: args.documentId,
      data: { ...data, via },
      populate: { report: { fields: ['date', 'kind'] } },
    });
    return { updated: true, changed: Object.keys(data), decision: shapeDecision(row) };
  },
});

export default reports;
