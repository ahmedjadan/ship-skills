import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkResult } from '../lib/tracker/contract.mjs';
import { runConformance } from '../lib/tracker/conformance.mjs';
import { createFilesTracker } from '../lib/tracker/files.mjs';
import { createGithubTracker } from '../lib/tracker/github.mjs';
import { errorCode, project, ship } from './helpers.mjs';

function assertAllPass(results) {
  assert.deepEqual(results.filter((result) => !result.ok), []);
  assert.equal(results.length, 8);
}

// Behaves like the parts of `gh` the adapter uses, so conformance runs offline.
function fakeGh() {
  const issues = [];
  return (args) => {
    const [area, verb, ...rest] = args;
    const flag = (name) => rest[rest.indexOf(name) + 1];
    const issue = () => issues.find((item) => String(item.number) === rest[0]);
    if (area === 'label') return '';
    if (verb === 'list') return JSON.stringify(issues);
    if (verb === 'create') {
      const number = issues.length + 1;
      const labels = rest.flatMap((arg, i) => (rest[i - 1] === '--label' ? [{ name: arg }] : []));
      const url = `https://github.com/o/r/issues/${number}`;
      issues.push({ number, title: flag('--title'), body: flag('--body'), labels, state: 'OPEN', url });
      return `${url}\n`;
    }
    if (!issue()) throw Object.assign(new Error('failed'), { stderr: 'Could not resolve to an issue' });
    if (verb === 'view') return JSON.stringify(issue());
    if (verb === 'close') issue().state = 'CLOSED';
    if (verb === 'edit') {
      issue().labels = issue().labels.filter((label) => label.name !== flag('--remove-label'));
      issue().labels.push({ name: flag('--add-label') });
    }
    return '';
  };
}

test('files adapter conforms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-files-'));
  assertAllPass(await runConformance(createFilesTracker(dir, 'work'), 'spec'));
});

test('github adapter conforms against a fake gh', async () => {
  assertAllPass(await runConformance(createGithubTracker('o/r', fakeGh()), 'spec'));
});

test('github auth failures map to UNAUTHORIZED', async () => {
  const exec = () => {
    throw Object.assign(new Error('failed'), { stderr: 'HTTP 401: auth required' });
  };
  await assert.rejects(createGithubTracker('o/r', exec).get('1'), { code: 'UNAUTHORIZED' });
});

test('github outages map to UNAVAILABLE', async () => {
  const exec = () => {
    throw Object.assign(new Error('failed'), { stderr: 'connection reset' });
  };
  await assert.rejects(createGithubTracker('o/r', exec).get('1'), { code: 'UNAVAILABLE' });
});

test('checkResult holds agent-run adapters to the contract', () => {
  const good = { id: 'E-1', title: 't', body: '', status: 'ready', blockedBy: [], acceptance: [], url: 'u' };
  assert.deepEqual(checkResult('get', good), { valid: true });
  assert.deepEqual(checkResult('next', null), { valid: true });
  assert.throws(() => checkResult('get', { ...good, status: 'Todo' }), { code: 'CONTRACT_VIOLATION' });
  assert.throws(() => checkResult('create', { id: 1 }), { code: 'CONTRACT_VIOLATION' });
  assert.throws(() => checkResult('list', [{}]), { code: 'CONTRACT_VIOLATION' });
});

test('agent-run trackers use a checked ticket file and report the tracker action', () => {
  const root = project({ tracker: 'kind: linear' });
  assert.equal(errorCode(ship(root, ['tracker', 'next'])), 'AGENT_ADAPTER');
  assert.equal(ship(root, ['tracker', 'check', 'get'], '{"id":"E-1"}').status, 1);
});
