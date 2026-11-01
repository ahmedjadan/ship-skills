import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { commit, errorCode, git, planned, project, ship, shipOk } from './helpers.mjs';

function toReviewing(root, id) {
  shipOk(root, ['run', 'transition', id, 'building']);
  commit(join(root, 'api'), 'demo.test.js', '// AC-1\n');
  shipOk(root, ['run', 'step', id, 's1']);
  shipOk(root, ['run', 'transition', id, 'verifying']);
  shipOk(root, ['gate', 'run', id]);
  shipOk(root, ['run', 'transition', id, 'reviewing']);
}

test('spec must be approved before tickets publish, and an edit voids it', () => {
  const root = project();
  const file = join(root, 'tickets.json');
  writeFileSync(file, JSON.stringify([{ number: 1, title: 'One' }]));
  const yes = ['--by', 'user', '--quote', 'yes'];
  assert.equal(errorCode(ship(root, ['tickets', 'publish', '--spec', 'demo', '--file', file])), 'APPROVAL_REQUIRED');
  shipOk(root, ['approve', 'spec', 'demo', ...yes]);
  assert.equal(shipOk(root, ['spec', 'status', 'demo']).status, 'approved');
  writeFileSync(join(root, 'specs', 'demo.md'), '# Changed\n');
  assert.equal(shipOk(root, ['spec', 'status', 'demo']).status, 'draft');
  assert.equal(errorCode(ship(root, ['tickets', 'publish', '--spec', 'demo', '--file', file])), 'APPROVAL_VOID');
});

test('approval needs a quote', () => {
  const root = project();
  assert.equal(errorCode(ship(root, ['approve', 'spec', 'demo', '--by', 'user'])), 'APPROVAL_NEEDS_QUOTE');
});

test('a blocked ticket cannot start', () => {
  const root = project();
  planned(root);
  assert.equal(errorCode(ship(root, ['run', 'start', 'demo-02'])), 'TICKET_BLOCKED');
});

test('illegal transitions are refused', () => {
  const root = project();
  const { id } = planned(root);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'reviewing'])), 'ILLEGAL_TRANSITION');
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'done'])), 'ILLEGAL_TRANSITION');
});

test('changing the plan voids its approval', () => {
  const root = project();
  const { id } = planned(root);
  const plan = join(root, 'plan.json');
  writeFileSync(plan, JSON.stringify({ steps: [{ id: 's2', title: 'Other', repo: 'api' }] }));
  shipOk(root, ['run', 'plan', id, '--file', plan]);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'building'])), 'APPROVAL_VOID');
});

test('verifying needs every step done', () => {
  const root = project();
  const { id } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'verifying'])), 'STEPS_INCOMPLETE');
});

test('a step needs a clean worktree', () => {
  const root = project();
  const { id } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  writeFileSync(join(root, 'api', 'loose.txt'), 'x');
  assert.equal(errorCode(ship(root, ['run', 'step', id, 's1'])), 'DIRTY_WORKTREE');
});

test('a new commit makes evidence stale, and blocks review', () => {
  const root = project();
  const { id } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  commit(join(root, 'api'), 'a.txt', '1');
  shipOk(root, ['run', 'step', id, 's1']);
  shipOk(root, ['run', 'transition', id, 'verifying']);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'reviewing'])), 'EVIDENCE_REQUIRED');
  shipOk(root, ['gate', 'run', id]);
  commit(join(root, 'api'), 'b.txt', '2');
  const status = shipOk(root, ['gate', 'status', id]);
  assert.equal(status.find((gate) => gate.name === 'check').status, 'stale');
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'reviewing'])), 'EVIDENCE_REQUIRED');
});

test('a failing gate exits non-zero and blocks review', () => {
  const root = project({ gates: `  - repo: api
    name: check
    command: node -e "process.exit(3)"
    agent_may_run: true` });
  const { id } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  commit(join(root, 'api'), 'a.txt', '1');
  shipOk(root, ['run', 'step', id, 's1']);
  shipOk(root, ['run', 'transition', id, 'verifying']);
  assert.equal(ship(root, ['gate', 'run', id]).status, 1);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'reviewing'])), 'EVIDENCE_REQUIRED');
});

test('a user-run gate is handed over and listed under Not run', () => {
  const root = project();
  const { id } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  commit(join(root, 'api'), 'a.txt', '1');
  shipOk(root, ['run', 'step', id, 's1']);
  shipOk(root, ['run', 'transition', id, 'verifying']);
  const result = shipOk(root, ['gate', 'run', id]);
  assert.deepEqual(result.handoff.map((gate) => gate.command), ['pnpm test']);
  shipOk(root, ['run', 'transition', id, 'reviewing']);
  const body = shipOk(root, ['pr', 'body', id]);
  assert.match(body.split('## Not run')[1].split('##')[0], /pnpm test/);
  assert.doesNotMatch(body.split('## Verification')[1].split('##')[0], /pnpm test/);
});

test('a user report needs their words and is labelled as a report', () => {
  const root = project();
  const { id } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  commit(join(root, 'api'), 'a.txt', '1');
  const report = ['gate', 'report', id, '--repo', 'api', '--name', 'test', '--exit', '0'];
  assert.equal(errorCode(ship(root, report)), 'APPROVAL_NEEDS_QUOTE');
  const status = shipOk(root, [...report, '--quote', 'tests pass']);
  assert.equal(status.find((gate) => gate.name === 'test').status, 'user_reported');
});

test('an uncovered acceptance id becomes a finding that must be decided', () => {
  const root = project();
  const { id, yes } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  commit(join(root, 'api'), 'a.txt', 'AC-1 mentioned outside a test');
  shipOk(root, ['run', 'step', id, 's1']);
  shipOk(root, ['run', 'transition', id, 'verifying']);
  shipOk(root, ['gate', 'run', id]);
  shipOk(root, ['run', 'transition', id, 'reviewing']);
  const file = join(root, 'review.json');
  writeFileSync(file, '[]');
  shipOk(root, ['run', 'review', id, '--file', file]);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'pr_open'])), 'FINDINGS_OPEN');
  writeFileSync(file, JSON.stringify([{ id: 'coverage:AC-1', axis: 'spec', summary: 'x', decision: 'accept' }]));
  shipOk(root, ['run', 'review', id, '--file', file]);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'pr_open'])), 'APPROVAL_REQUIRED');
  shipOk(root, ['approve', 'review', id, ...yes]);
});

test('full path to done, and a commit after approval voids it', () => {
  const root = project();
  const { id, yes } = planned(root);
  toReviewing(root, id);
  const file = join(root, 'review.json');
  writeFileSync(file, '[]');
  shipOk(root, ['run', 'review', id, '--file', file]);
  shipOk(root, ['approve', 'review', id, ...yes]);
  shipOk(root, ['approve', 'pr', id, ...yes]);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'pr_open'])), 'PR_REQUIRED');
  shipOk(root, ['pr', 'record', id, '--repo', 'api', '--url', 'https://example.com/1']);
  commit(join(root, 'api'), 'late.txt', 'x');
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'pr_open'])), 'APPROVAL_VOID');
  shipOk(root, ['approve', 'review', id, ...yes]);
  shipOk(root, ['approve', 'pr', id, ...yes]);
  shipOk(root, ['run', 'transition', id, 'pr_open']);
  assert.equal(shipOk(root, ['tracker', 'get', id]).status, 'in_review');
  shipOk(root, ['run', 'transition', id, 'done']);
  assert.equal(shipOk(root, ['tracker', 'get', id]).status, 'done');
  assert.equal(shipOk(root, ['tracker', 'next', '--spec', 'demo']).id, 'demo-02');
});

test('pause returns only to the state it left', () => {
  const root = project();
  const { id } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  shipOk(root, ['run', 'transition', id, 'paused']);
  assert.equal(errorCode(ship(root, ['run', 'transition', id, 'verifying'])), 'ILLEGAL_TRANSITION');
  assert.equal(shipOk(root, ['run', 'transition', id, 'building']).state, 'building');
});

test('resume finds the next step in a fresh process', () => {
  const root = project();
  const { id } = planned(root);
  const plan = join(root, 'plan.json');
  writeFileSync(plan, JSON.stringify({ steps: [{ id: 's1', title: 'A', repo: 'api' }, { id: 's2', title: 'B', repo: 'web' }] }));
  shipOk(root, ['run', 'plan', id, '--file', plan]);
  shipOk(root, ['approve', 'plan', id, '--by', 'user', '--quote', 'yes']);
  shipOk(root, ['run', 'transition', id, 'building']);
  commit(join(root, 'api'), 'a.txt', '1');
  shipOk(root, ['run', 'step', id, 's1']);
  const report = shipOk(root, ['run', 'resume', id]);
  assert.equal(report.nextStep.id, 's2');
  assert.deepEqual(report.mismatches, []);
});

test('resume reports a moved branch instead of guessing', () => {
  const root = project();
  const { id } = planned(root);
  shipOk(root, ['run', 'transition', id, 'building']);
  const api = join(root, 'api');
  commit(api, 'a.txt', '1');
  shipOk(root, ['run', 'step', id, 's1']);
  git(api, 'reset', '-q', '--hard', 'HEAD~1');
  const result = ship(root, ['run', 'resume', id]);
  assert.equal(result.status, 1);
  assert.match(result.out.mismatches.join(), /not on the current HEAD/);
});

test('resume reports tracker drift', () => {
  const root = project();
  const { id } = planned(root);
  shipOk(root, ['tracker', 'transition', id, 'blocked']);
  const result = ship(root, ['run', 'resume', id]);
  assert.equal(result.status, 1);
  assert.match(result.out.mismatches.join(), /Tracker shows blocked/);
});
