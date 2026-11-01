import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { approvalStatus, requireApproval } from './approvals.mjs';
import { assertRunTransition, TICKET_STATUS_FOR_RUN } from './lifecycle.mjs';
import { currentBranch, git, gitOk, head, isDirty, readJson, safeName, sha256, ShipError, writeJson } from './util.mjs';

const OUTPUT_TAIL = 2000;

const runPath = (ctx, id) => join(ctx.stateDir, 'runs', `${safeName(id)}.json`);
const now = () => new Date().toISOString();

export function loadRun(ctx, id) {
  const path = runPath(ctx, id);
  if (!existsSync(path)) throw new ShipError('RUN_NOT_FOUND', `No run for ticket ${id}`);
  return readJson(path);
}

export const saveRun = (ctx, run) => writeJson(runPath(ctx, run.ticket.id), run);

export const runRepos = (run) => [...new Set(run.steps.map((step) => step.repo))];
export const planHash = (run) => sha256(run.plan ?? null);
const heads = (ctx, run) => Object.fromEntries(runRepos(run).map((repo) => [repo, head(ctx.repoPath(repo))]));

export function startRun(ctx, ticket, blockers) {
  if (existsSync(runPath(ctx, ticket.id))) throw new ShipError('CONFLICT', `Run for ${ticket.id} already exists; resume it`);
  const open = blockers.filter((blocker) => blocker.status !== 'done');
  if (open.length > 0) {
    throw new ShipError('TICKET_BLOCKED', `Blocked by ${open.map((blocker) => blocker.id).join(', ')}`);
  }
  if (ticket.status !== 'ready' && ticket.status !== 'in_progress') {
    throw new ShipError('ILLEGAL_TRANSITION', `Ticket is ${ticket.status}, not ready`);
  }
  const run = {
    ticket,
    state: 'planned',
    steps: [],
    evidence: [],
    decisions: [],
    prs: [],
    history: [{ to: 'planned', at: now() }],
  };
  saveRun(ctx, run);
  return run;
}

export function setPlan(ctx, id, plan) {
  const run = loadRun(ctx, id);
  if (run.state !== 'planned') throw new ShipError('ILLEGAL_TRANSITION', `Plan is locked once the run is ${run.state}`);
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new ShipError('INVALID_ARGUMENT', 'Plan needs steps');
  const ids = new Set();
  for (const step of plan.steps) {
    if (!step.id || !step.title || !step.repo) throw new ShipError('INVALID_ARGUMENT', 'Each step needs id, title, repo');
    if (ids.has(step.id)) throw new ShipError('INVALID_ARGUMENT', `Duplicate step ${step.id}`);
    ids.add(step.id);
    ctx.repoPath(step.repo);
  }
  run.plan = plan;
  run.steps = plan.steps.map(({ id: stepId, title, repo }) => ({ id: stepId, title, repo }));
  saveRun(ctx, run);
  return run;
}

export function completeStep(ctx, id, stepId) {
  const run = loadRun(ctx, id);
  if (run.state !== 'building') throw new ShipError('ILLEGAL_TRANSITION', `Steps complete while building, not ${run.state}`);
  const step = run.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new ShipError('NOT_FOUND', `No step ${stepId}`);
  const cwd = ctx.repoPath(step.repo);
  if (isDirty(cwd)) throw new ShipError('DIRTY_WORKTREE', `Commit ${step.repo} before completing a step`);
  Object.assign(step, { sha: head(cwd), branch: currentBranch(cwd), at: now() });
  saveRun(ctx, run);
  return run;
}

export function addDecision(ctx, id, text) {
  const run = loadRun(ctx, id);
  run.decisions.push({ text, at: now() });
  saveRun(ctx, run);
  return run;
}

// Evidence is only written here, from a command this process ran, or marked as
// the user's report. An agent has no path to record a pass it did not see.
export function runGates(ctx, id, only) {
  const run = loadRun(ctx, id);
  const repos = runRepos(run);
  const gates = ctx.config.gates.filter(
    (gate) => repos.includes(gate.repo) && (!only?.repo || gate.repo === only.repo) && (!only?.name || gate.name === only.name),
  );
  const ran = [];
  const handoff = [];
  for (const gate of gates) {
    if (!gate.agent_may_run) {
      handoff.push({ repo: gate.repo, name: gate.name, command: gate.command });
      continue;
    }
    const cwd = ctx.repoPath(gate.repo);
    const dirty = isDirty(cwd);
    const result = spawnSync(gate.command, { cwd, shell: true, encoding: 'utf8' });
    const entry = {
      repo: gate.repo,
      name: gate.name,
      command: gate.command,
      exit: result.status ?? 1,
      sha: head(cwd),
      dirty,
      source: 'cli',
      at: now(),
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-OUTPUT_TAIL),
    };
    run.evidence.push(entry);
    ran.push({ repo: entry.repo, name: entry.name, exit: entry.exit, output: entry.exit === 0 ? '' : entry.output });
  }
  saveRun(ctx, run);
  return { ran, handoff };
}

export function reportGate(ctx, id, { repo, name, exit, quote }) {
  const run = loadRun(ctx, id);
  const gate = ctx.config.gates.find((candidate) => candidate.repo === repo && candidate.name === name);
  if (!gate) throw new ShipError('NOT_FOUND', `No gate ${repo}/${name}`);
  if (gate.agent_may_run) throw new ShipError('INVALID_ARGUMENT', `${repo}/${name} is agent-run; use "ship gate run"`);
  if (!quote?.trim()) throw new ShipError('APPROVAL_NEEDS_QUOTE', "A user report needs --quote with the user's reply");
  const cwd = ctx.repoPath(repo);
  run.evidence.push({
    repo, name, command: gate.command, exit, sha: head(cwd), dirty: isDirty(cwd), source: 'user', quote, at: now(),
  });
  saveRun(ctx, run);
  return run;
}

export function gateStatus(ctx, run) {
  const repos = runRepos(run);
  return ctx.config.gates
    .filter((gate) => repos.includes(gate.repo))
    .map((gate) => {
      const base = { repo: gate.repo, name: gate.name, command: gate.command, agentMayRun: gate.agent_may_run };
      const entry = run.evidence.findLast((item) => item.repo === gate.repo && item.name === gate.name);
      if (!entry) return { ...base, status: 'not_run' };
      const current = entry.sha === head(ctx.repoPath(gate.repo)) && !entry.dirty;
      if (!current) return { ...base, status: 'stale', sha: entry.sha, at: entry.at };
      if (entry.exit !== 0) return { ...base, status: 'failed', sha: entry.sha, at: entry.at };
      return { ...base, status: entry.source === 'user' ? 'user_reported' : 'passed', sha: entry.sha, at: entry.at };
    });
}

// Test files are found by path so a mention in a spec or doc does not count.
export function coverage(ctx, run) {
  const missing = [];
  for (const id of run.ticket.acceptance) {
    const covered = runRepos(run).some((repo) => {
      const cwd = ctx.repoPath(repo);
      if (!gitOk(cwd, 'grep', '-q', '-F', id)) return false;
      return git(cwd, 'grep', '-l', '-F', id).split('\n').some((file) => /(^|[/._-])(test|tests|spec|specs|e2e)([/._-]|$)/i.test(file));
    });
    if (!covered) missing.push(id);
  }
  return { acceptance: run.ticket.acceptance, missing };
}

const reviewHash = (ctx, run) => sha256({ findings: run.review?.findings ?? null, heads: heads(ctx, run) });

export function setReview(ctx, id, findings) {
  const run = loadRun(ctx, id);
  if (run.state !== 'reviewing') throw new ShipError('ILLEGAL_TRANSITION', `Review is recorded while reviewing, not ${run.state}`);
  if (!Array.isArray(findings)) throw new ShipError('INVALID_ARGUMENT', 'Findings must be an array');
  const merged = [...findings];
  for (const missing of coverage(ctx, run).missing) {
    const findingId = `coverage:${missing}`;
    if (!merged.some((finding) => finding.id === findingId)) {
      merged.push({ id: findingId, axis: 'spec', summary: `${missing} has no test naming it`, decision: null });
    }
  }
  run.review = { findings: merged };
  saveRun(ctx, run);
  return run;
}

export function recordPr(ctx, id, repo, url) {
  const run = loadRun(ctx, id);
  ctx.repoPath(repo);
  run.prs = [...run.prs.filter((pr) => pr.repo !== repo), { repo, url }];
  saveRun(ctx, run);
  return run;
}

export const prHash = (ctx, run) => sha256({ heads: heads(ctx, run), review: reviewHash(ctx, run) });

export function approvalHash(ctx, kind, run) {
  if (kind === 'plan') return planHash(run);
  if (kind === 'review') return reviewHash(ctx, run);
  return prHash(ctx, run);
}

function checkPreconditions(ctx, run, to) {
  const id = run.ticket.id;
  if (to === 'building' && run.state === 'planned') {
    if (!run.plan) throw new ShipError('PLAN_REQUIRED', 'Set a plan first');
    requireApproval(ctx.stateDir, 'plan', id, planHash(run));
  }
  if (to === 'verifying') {
    const open = run.steps.filter((step) => !step.sha);
    if (open.length > 0) throw new ShipError('STEPS_INCOMPLETE', `Open steps: ${open.map((step) => step.id).join(', ')}`);
  }
  if (to === 'reviewing') {
    const bad = gateStatus(ctx, run).filter(
      (gate) => (gate.agentMayRun && gate.status !== 'passed') || gate.status === 'failed',
    );
    if (bad.length > 0) {
      const list = bad.map((gate) => `${gate.repo}/${gate.name} (${gate.status})`).join(', ');
      throw new ShipError('EVIDENCE_REQUIRED', `Gates without a fresh pass: ${list}`);
    }
  }
  if (to === 'pr_open') {
    if (!run.review) throw new ShipError('REVIEW_REQUIRED', 'Record the review first');
    const undecided = run.review.findings.filter((finding) => !finding.decision || finding.decision === 'fix');
    if (undecided.length > 0) {
      throw new ShipError('FINDINGS_OPEN', `Undecided or unfixed: ${undecided.map((finding) => finding.id).join(', ')}`);
    }
    requireApproval(ctx.stateDir, 'review', id, reviewHash(ctx, run));
    requireApproval(ctx.stateDir, 'pr', id, prHash(ctx, run));
    const missing = runRepos(run).filter((repo) => !run.prs.some((pr) => pr.repo === repo));
    if (missing.length > 0) throw new ShipError('PR_REQUIRED', `No PR recorded for: ${missing.join(', ')}`);
  }
}

export async function transition(ctx, id, to, tracker) {
  const run = loadRun(ctx, id);
  assertRunTransition(run, to);
  const resuming = run.state === 'paused';
  if (!resuming && to !== 'paused') checkPreconditions(ctx, run, to);
  const from = run.state;
  const ticketStatus = TICKET_STATUS_FOR_RUN[to];
  let trackerAction = null;
  if (to !== 'paused' && !resuming && ticketStatus !== TICKET_STATUS_FOR_RUN[from]) {
    // The tracker moves first: if it refuses, the run has not advanced.
    if (tracker) await tracker.transition(id, ticketStatus, `Run moved to ${to}`);
    else trackerAction = { operation: 'transition', id, status: ticketStatus };
  }
  if (to === 'paused') run.pausedFrom = from;
  else delete run.pausedFrom;
  run.state = to;
  run.history.push({ from, to, at: now() });
  saveRun(ctx, run);
  return { state: run.state, trackerAction };
}

export async function resume(ctx, id, tracker) {
  const run = loadRun(ctx, id);
  const mismatches = [];
  for (const step of run.steps.filter((candidate) => candidate.sha)) {
    const cwd = ctx.repoPath(step.repo);
    if (!gitOk(cwd, 'cat-file', '-e', `${step.sha}^{commit}`)) {
      mismatches.push(`Step ${step.id}: commit ${step.sha.slice(0, 8)} no longer exists in ${step.repo}`);
    } else if (!gitOk(cwd, 'merge-base', '--is-ancestor', step.sha, 'HEAD')) {
      mismatches.push(`Step ${step.id}: commit ${step.sha.slice(0, 8)} is not on the current HEAD of ${step.repo}`);
    }
    const branch = currentBranch(cwd);
    if (branch !== step.branch) mismatches.push(`Step ${step.id}: ${step.repo} is on ${branch}, run used ${step.branch}`);
  }
  if (tracker) {
    const state = run.state === 'paused' ? run.pausedFrom : run.state;
    const ticket = await tracker.get(id);
    if (ticket.status !== TICKET_STATUS_FOR_RUN[state]) {
      mismatches.push(`Tracker shows ${ticket.status}, run ${state} expects ${TICKET_STATUS_FOR_RUN[state]}`);
    }
  }
  if (run.plan && approvalStatus(ctx.stateDir, 'plan', id, planHash(run)) === 'void') {
    mismatches.push('Plan changed after approval');
  }
  return {
    ticket: id,
    state: run.state,
    pausedFrom: run.pausedFrom,
    nextStep: run.steps.find((step) => !step.sha) ?? null,
    gates: run.steps.length > 0 ? gateStatus(ctx, run) : [],
    decisions: run.decisions,
    mismatches: [...new Set(mismatches)],
  };
}

export function prBody(ctx, run, template) {
  const icon = { passed: 'passed', user_reported: 'reported by user', failed: 'FAILED' };
  const gates = gateStatus(ctx, run);
  const verified = gates.filter((gate) => icon[gate.status]);
  const notRun = gates.filter((gate) => !icon[gate.status]);
  const verification = verified.length === 0
    ? 'None.'
    : verified.map((gate) => `- \`${gate.repo}\` ${gate.name}: ${icon[gate.status]} at ${gate.sha.slice(0, 8)}`).join('\n');
  const skipped = notRun.length === 0
    ? 'Nothing.'
    : notRun.map((gate) => `- \`${gate.repo}\` ${gate.name} (${gate.status}): \`${gate.command}\``).join('\n');
  const decisions = run.decisions.length === 0 ? 'None.' : run.decisions.map((item) => `- ${item.text}`).join('\n');
  return template
    .replaceAll('{{ticket}}', `${run.ticket.title} (${run.ticket.url || run.ticket.id})`)
    .replaceAll('{{acceptance}}', run.ticket.acceptance.join(', ') || 'None.')
    .replaceAll('{{verification}}', verification)
    .replaceAll('{{not_run}}', skipped)
    .replaceAll('{{decisions}}', decisions);
}

export const prTemplate = () => readFileSync(new URL('../templates/pr-body.md', import.meta.url), 'utf8');
