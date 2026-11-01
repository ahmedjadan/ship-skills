import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { git, project, ship } from './helpers.mjs';

const root = project();
const api = join(root, 'api');

const bash = (command, cwd = api) => {
  const { out } = ship(cwd, ['guard'], JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }));
  return out === '' ? 'allow' : out.hookSpecificOutput.permissionDecision;
};

const cases = [
  ['allow', 'git status'],
  ['allow', 'git commit -m "x"'],
  ['allow', 'ls && echo hi'],
  ['ask', 'git push origin feature/one'],
  ['ask', 'git push'],
  ['ask', 'gh pr create --title x'],
  ['ask', 'gh issue create --title x'],
  ['deny', 'git push origin main'],
  ['deny', 'git push origin HEAD:main'],
  ['deny', 'git push origin HEAD:refs/heads/main'],
  ['deny', 'git push --force origin feature/one'],
  ['deny', 'git push -f'],
  ['deny', 'git push origin +feature/one'],
  ['deny', 'gh pr merge 3'],
  ['deny', 'git reset --hard HEAD~1'],
  ['deny', 'git clean -fd'],
  ['deny', 'git branch -D old'],
  ['deny', 'echo ok && git push origin main'],
  ['deny', 'pnpm test'],
  ['deny', 'cd api && pnpm test'],
  ['deny', 'pnpm prisma migrate reset'],
  ['deny', 'echo {} > .ship/runs/x.json'],
];

for (const [expected, command] of cases) {
  test(`${expected}: ${command}`, () => assert.equal(bash(command), expected));
}

test('a bare push from the base branch is denied', () => {
  git(api, 'checkout', '-q', 'main');
  assert.equal(bash('git push'), 'deny');
  assert.equal(bash('git merge feature/one'), 'deny');
  git(api, 'checkout', '-q', 'feature/one');
  assert.equal(bash('git merge main'), 'allow');
});

test('git -C is honoured', () => {
  git(api, 'checkout', '-q', 'main');
  assert.equal(bash('git -C api push', root), 'deny');
  git(api, 'checkout', '-q', 'feature/one');
});

test('editing run state directly is denied', () => {
  const input = { tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, '.ship/approvals/spec-x.json') } };
  assert.equal(ship(root, ['guard'], JSON.stringify(input)).out.hookSpecificOutput.permissionDecision, 'deny');
});

test('projects without a config are left alone', () => {
  const empty = mkdtempSync(join(tmpdir(), 'ship-none-'));
  assert.equal(bash('git push origin main', empty), 'allow');
  rmSync(empty, { recursive: true });
});

test('unreadable config asks rather than allows', () => {
  const broken = project();
  writeFileSync(join(broken, '.ship/config.md'), '---\nversion: 1\n---\n');
  assert.equal(bash('git status', broken), 'ask');
});
