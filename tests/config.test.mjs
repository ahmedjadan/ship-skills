import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../lib/config.mjs';
import { parseFrontMatter, parseYaml, stringifyFrontMatter } from '../lib/yaml.mjs';

const valid = `---
version: 1
repos:
  - name: app
    path: .
    base: main
tracker:
  kind: files
specs:
  path: docs/specs   # a comment
gates:
  - repo: app
    name: test
    command: "npm test # not a comment"
    agent_may_run: true
branch: feature/{ticket}
hard_rules:
  - never do this
build_order: [schema, api, ui]
---
Free text.
`;

test('parses the config subset', () => {
  const config = parseConfig(valid);
  assert.equal(config.specs.path, 'docs/specs');
  assert.equal(config.gates[0].command, 'npm test # not a comment');
  assert.equal(config.gates[0].agent_may_run, true);
  assert.deepEqual(config.build_order, ['schema', 'api', 'ui']);
  assert.deepEqual(config.hard_rules, ['never do this']);
  assert.equal(config.notes, 'Free text.');
});

test('defaults keep protected operations denied', () => {
  const config = parseConfig(valid);
  assert.equal(config.permissions.push_base, 'deny');
  assert.equal(config.permissions.open_pr, 'ask');
});

test('rejects a config missing required fields', () => {
  assert.throws(() => parseConfig('---\nversion: 1\n---\n'), (error) => {
    assert.equal(error.code, 'CONFIG_INVALID');
    assert.ok(error.details.includes('$.repos: required'));
    return true;
  });
});

test('rejects a gate on an unknown repo, an unknown policy and a github tracker without a repo', () => {
  const broken = valid
    .replace('repo: app\n    name: test', 'repo: nope\n    name: test')
    .replace('kind: files', 'kind: github')
    .replace('hard_rules:', 'permissions:\n  merge: maybe\nhard_rules:');
  assert.throws(() => parseConfig(broken), (error) => {
    assert.equal(error.details.length, 3);
    return true;
  });
});

test('nested lists at the parent indent parse', () => {
  assert.deepEqual(parseYaml('a:\n- 1\n- 2\nb: x'), { a: [1, 2], b: 'x' });
});

test('front matter round-trips awkward strings', () => {
  const data = { title: 'Has: colon and "quotes" # hash', list: ['a', 'b'], empty: [] };
  assert.deepEqual(parseFrontMatter(stringifyFrontMatter(data, '\nbody\n')).data, data);
});
