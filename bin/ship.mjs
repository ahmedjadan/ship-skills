#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { approvalStatus, recordApproval, requireApproval } from '../lib/approvals.mjs';
import { configWarnings, loadConfig } from '../lib/config.mjs';
import { decide, hookOutput } from '../lib/guard.mjs';
import { reviewScope } from '../lib/review.mjs';
import * as runs from '../lib/run.mjs';
import { checkResult, checkTicket, createTracker, publishBreakdown, validateBreakdown } from '../lib/tracker/contract.mjs';
import { runConformance } from '../lib/tracker/conformance.mjs';
import { createFilesTracker } from '../lib/tracker/files.mjs';
import { readJson, sha256, ShipError } from '../lib/util.mjs';

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: 'string' }, quote: { type: 'string' }, by: { type: 'string' }, repo: { type: 'string' },
    name: { type: 'string' }, exit: { type: 'string' }, url: { type: 'string' }, spec: { type: 'string' },
    status: { type: 'string' }, note: { type: 'string' }, text: { type: 'string' }, 'ticket-file': { type: 'string' },
    base: { type: 'string' }, live: { type: 'boolean' },
  },
});

const [area, verb, ...rest] = positionals;
const print = (value) => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);

function need(value, label) {
  if (value === undefined || value === '') throw new ShipError('INVALID_ARGUMENT', `Missing ${label}`);
  return value;
}

const readStdin = () => readFileSync(0, 'utf8');
const specPath = (ctx, id) => join(ctx.root, ctx.config.specs.path, `${id}.md`);
const specHash = (ctx, id) => {
  try {
    return sha256(readFileSync(specPath(ctx, id), 'utf8'));
  } catch {
    throw new ShipError('NOT_FOUND', `No spec at ${specPath(ctx, id)}`);
  }
};

function agentTracker(ctx) {
  const tracker = createTracker(ctx);
  if (tracker) return tracker;
  throw new ShipError(
    'AGENT_ADAPTER',
    `Tracker "${ctx.config.tracker.kind}" runs through the agent: follow its adapter doc, then use "ship tracker check"`,
  );
}

async function approve(ctx, kind, ref) {
  let hash;
  if (kind === 'spec') hash = specHash(ctx, ref);
  else if (kind === 'tickets') hash = sha256(readFileSync(need(flags.file, '--file'), 'utf8'));
  else hash = runs.approvalHash(ctx, kind, runs.loadRun(ctx, ref));
  return recordApproval(ctx.stateDir, { kind, ref, hash, by: flags.by, quote: flags.quote });
}

async function trackerCommand(ctx) {
  if (verb === 'check') return checkResult(need(rest[0], 'operation'), JSON.parse(readStdin()));
  if (verb === 'conformance') {
    let dir = null;
    let tracker;
    if (ctx.config.tracker.kind === 'github' && !flags.live) {
      throw new ShipError('INVALID_ARGUMENT', 'Conformance on github creates real issues; pass --live');
    }
    if (ctx.config.tracker.kind === 'files') {
      dir = mkdtempSync(join(tmpdir(), 'ship-conformance-'));
      tracker = createFilesTracker(dir, 'work');
    } else {
      tracker = agentTracker(ctx);
    }
    const results = await runConformance(tracker, `conformance-${Date.now()}`);
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (results.some((result) => !result.ok)) process.exitCode = 1;
    return results;
  }
  const tracker = agentTracker(ctx);
  if (verb === 'get') return tracker.get(need(rest[0], 'ticket id'));
  if (verb === 'list') return tracker.list({ spec: flags.spec, status: flags.status });
  if (verb === 'next') return tracker.next({ spec: flags.spec });
  if (verb === 'transition') return tracker.transition(need(rest[0], 'ticket id'), need(rest[1], 'status'), flags.note);
  throw new ShipError('INVALID_ARGUMENT', `Unknown: tracker ${verb}`);
}

async function specCommand(ctx) {
  const id = need(rest[0], 'spec id');
  if (verb === 'status') return { id, status: approvalStatus(ctx.stateDir, 'spec', id, specHash(ctx, id)) === 'valid' ? 'approved' : 'draft' };
  throw new ShipError('INVALID_ARGUMENT', `Unknown: spec ${verb}`);
}

async function ticketsCommand(ctx) {
  const spec = need(flags.spec, '--spec');
  const file = need(flags.file, '--file');
  const tickets = readJson(file);
  validateBreakdown(tickets);
  if (verb === 'validate') return { valid: true, tickets: tickets.length };
  if (verb !== 'publish') throw new ShipError('INVALID_ARGUMENT', `Unknown: tickets ${verb}`);
  requireApproval(ctx.stateDir, 'spec', spec, specHash(ctx, spec));
  requireApproval(ctx.stateDir, 'tickets', spec, sha256(readFileSync(file, 'utf8')));
  return publishBreakdown(agentTracker(ctx), spec, tickets);
}

async function runCommand(ctx) {
  const id = need(rest[0], 'ticket id');
  const tracker = createTracker(ctx);
  switch (verb) {
    case 'start': {
      if (tracker) {
        const ticket = await tracker.get(id);
        const blockers = await Promise.all(ticket.blockedBy.map((blocker) => tracker.get(blocker)));
        const run = runs.startRun(ctx, ticket, blockers);
        if (ticket.status === 'ready') await tracker.transition(id, 'in_progress', 'Run started');
        return run;
      }
      const { ticket, blockers = [] } = readJson(need(flags['ticket-file'], '--ticket-file'));
      checkTicket(ticket);
      return { ...runs.startRun(ctx, ticket, blockers), trackerAction: { operation: 'transition', id, status: 'in_progress' } };
    }
    case 'plan': return runs.setPlan(ctx, id, readJson(need(flags.file, '--file')));
    case 'step': return runs.completeStep(ctx, id, need(rest[1], 'step id'));
    case 'decide': return runs.addDecision(ctx, id, need(flags.text, '--text'));
    case 'transition': return runs.transition(ctx, id, need(rest[1], 'state'), tracker);
    case 'resume': {
      const report = await runs.resume(ctx, id, tracker);
      if (report.mismatches.length > 0) process.exitCode = 1;
      return report;
    }
    case 'review': return runs.setReview(ctx, id, readJson(need(flags.file, '--file')));
    case 'show': return runs.loadRun(ctx, id);
    default: throw new ShipError('INVALID_ARGUMENT', `Unknown: run ${verb}`);
  }
}

function gateCommand(ctx) {
  const id = need(rest[0], 'ticket id');
  if (verb === 'run') {
    const result = runs.runGates(ctx, id, { repo: flags.repo, name: flags.name });
    if (result.ran.some((item) => item.exit !== 0)) process.exitCode = 1;
    return result;
  }
  if (verb === 'status') return runs.gateStatus(ctx, runs.loadRun(ctx, id));
  if (verb === 'report') {
    runs.reportGate(ctx, id, {
      repo: need(flags.repo, '--repo'), name: need(flags.name, '--name'), exit: Number(need(flags.exit, '--exit')), quote: flags.quote,
    });
    return runs.gateStatus(ctx, runs.loadRun(ctx, id));
  }
  throw new ShipError('INVALID_ARGUMENT', `Unknown: gate ${verb}`);
}

function prCommand(ctx) {
  const id = need(rest[0], 'ticket id');
  if (verb === 'body') return runs.prBody(ctx, runs.loadRun(ctx, id), runs.prTemplate());
  if (verb === 'record') return runs.recordPr(ctx, id, need(flags.repo, '--repo'), need(flags.url, '--url'));
  throw new ShipError('INVALID_ARGUMENT', `Unknown: pr ${verb}`);
}

// The config is optional here: a standalone review works on any git repo.
function reviewInput() {
  const cwd = process.cwd();
  let ctx = null;
  try {
    ctx = loadConfig(cwd);
  } catch (error) {
    if (error.code !== 'CONFIG_MISSING') throw error;
  }
  return { cwd, ctx, target: rest[0], repo: flags.repo, base: flags.base };
}

async function main() {
  if (area === 'guard') {
    const decision = decide(JSON.parse(readStdin()));
    const output = hookOutput(decision);
    if (output) print(output);
    return undefined;
  }
  if (area === 'review' && verb === 'scope') return reviewScope(reviewInput());
  const ctx = loadConfig(process.cwd());
  switch (area) {
    case 'config': return { valid: true, root: ctx.root, repos: ctx.config.repos.map((repo) => repo.name), tracker: ctx.config.tracker.kind, warnings: configWarnings(ctx) };
    case 'approve': return approve(ctx, need(verb, 'kind'), need(rest[0], 'reference'));
    case 'spec': return specCommand(ctx);
    case 'tickets': return ticketsCommand(ctx);
    case 'tracker': return trackerCommand(ctx);
    case 'run': return runCommand(ctx);
    case 'gate': return gateCommand(ctx);
    case 'coverage': return runs.coverage(ctx, runs.loadRun(ctx, need(verb, 'ticket id')));
    case 'pr': return prCommand(ctx);
    default: throw new ShipError('INVALID_ARGUMENT', `Unknown command "${area ?? ''}"`);
  }
}

main().then(
  (result) => {
    if (result !== undefined) print(result);
  },
  (error) => {
    if (area === 'guard') {
      // Never let a guard crash read as permission.
      print(hookOutput({ policy: 'ask', reason: `Ship guard failed: ${error.message}` }));
      return;
    }
    const known = error instanceof ShipError;
    process.stderr.write(`${JSON.stringify({ error: { code: known ? error.code : 'INTERNAL', message: error.message, details: error.details } }, null, 2)}\n`);
    process.exitCode = 1;
  },
);
