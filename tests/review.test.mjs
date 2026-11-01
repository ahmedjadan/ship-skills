import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { reviewScope } from '../lib/review.mjs';
import { commit, errorCode, git, planned, project, ship, shipOk } from './helpers.mjs';

function bareRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ship-review-')));
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'README.md', 'x');
  git(dir, 'checkout', '-qb', 'feature/a');
  commit(dir, 'a.txt', '1', 'add a');
  return dir;
}

test('reviews the current branch with no config and writes nothing', () => {
  const dir = bareRepo();
  const scope = shipOk(dir, ['review', 'scope']);
  assert.equal(scope.base, 'main');
  assert.equal(scope.diffCommand, 'git diff main...feature/a');
  assert.deepEqual(scope.files, ['a.txt']);
  assert.equal(scope.commits.length, 1);
  assert.equal(existsSync(join(dir, '.ship')), false);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('reviews a named branch and honours --base', () => {
  const dir = bareRepo();
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'branch', 'release');
  const scope = shipOk(dir, ['review', 'scope', 'feature/a', '--base', 'release']);
  assert.equal(scope.diffCommand, 'git diff release...feature/a');
});

test('an empty diff, a missing ref and an unsafe ref are refused', () => {
  const dir = bareRepo();
  git(dir, 'checkout', '-q', 'main');
  assert.equal(errorCode(ship(dir, ['review', 'scope'])), 'EMPTY_DIFF');
  assert.equal(errorCode(ship(dir, ['review', 'scope', 'nope'])), 'NOT_FOUND');
  assert.equal(errorCode(ship(dir, ['review', 'scope', 'x;rm'])), 'INVALID_ARGUMENT');
});

test('uncommitted work is called out', () => {
  const dir = bareRepo();
  writeFileSync(join(dir, 'loose.txt'), 'x');
  assert.match(shipOk(dir, ['review', 'scope']).warnings[0], /Uncommitted/);
});

test('outside a repo, and with no commits, the error says so', () => {
  const empty = mkdtempSync(join(tmpdir(), 'ship-empty-'));
  assert.equal(errorCode(ship(empty, ['review', 'scope'])), 'NOT_A_REPO');
  git(empty, 'init', '-q', '-b', 'main');
  assert.equal(errorCode(ship(empty, ['review', 'scope'])), 'NO_COMMITS');
});

test('a PR number or URL resolves through gh', () => {
  const dir = bareRepo();
  const calls = [];
  const exec = (args) => {
    calls.push(args);
    return JSON.stringify({ number: 7, url: 'u', title: 't', body: 'Must do X', baseRefName: 'main', headRefName: 'x' });
  };
  const scope = reviewScope({ cwd: dir, target: '7', exec });
  assert.equal(scope.diffCommand, 'gh pr diff 7');
  assert.equal(scope.pr.body, 'Must do X');
  const url = 'https://github.com/o/r/pull/7';
  assert.equal(reviewScope({ cwd: dir, target: url, exec }).kind, 'pr');
  assert.equal(calls.length, 2);
});

test('a PR that cannot be read is NOT_FOUND', () => {
  const exec = () => {
    throw Object.assign(new Error('x'), { stderr: 'no pull requests found' });
  };
  assert.throws(() => reviewScope({ cwd: bareRepo(), target: '9', exec }), { code: 'NOT_FOUND' });
});

test('with a multi-repo config, it asks which repo and uses its base', () => {
  const root = project();
  assert.equal(errorCode(ship(root, ['review', 'scope'])), 'INVALID_ARGUMENT');
  commit(join(root, 'api'), 'a.txt', '1');
  const scope = shipOk(root, ['review', 'scope', '--repo', 'api']);
  assert.equal(scope.repo, 'api');
  assert.equal(scope.base, 'main');
  assert.equal(shipOk(join(root, 'api'), ['review', 'scope']).repo, 'api');
});

test('a standalone review leaves a ticket run untouched', () => {
  const root = project();
  const { id } = planned(root);
  const before = shipOk(root, ['run', 'show', id]);
  commit(join(root, 'api'), 'a.txt', '1');
  shipOk(root, ['review', 'scope', '--repo', 'api']);
  assert.deepEqual(shipOk(root, ['run', 'show', id]), before);
});

test('config warns about a repo with no commits and no gates', () => {
  const root = project({ gates: '  []' });
  const fresh = join(root, 'web');
  git(fresh, 'update-ref', '-d', 'HEAD');
  const { warnings } = shipOk(root, ['config']);
  assert.ok(warnings.includes('web: no commits yet'));
  assert.ok(warnings.includes('api: no gates, so nothing will be verified'));
});

test('a run on a repo with no commits gives a clear error', () => {
  const root = project();
  const { id } = planned(root);
  git(join(root, 'api'), 'update-ref', '-d', 'HEAD');
  assert.equal(errorCode(ship(root, ['gate', 'run', id])), 'NO_COMMITS');
});
