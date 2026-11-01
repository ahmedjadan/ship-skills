import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const INSTALL = fileURLToPath(new URL('../bin/install.mjs', import.meta.url));

// A fake `claude` on an otherwise empty PATH, logging every call.
function fakeClaude(body = '') {
  const dir = mkdtempSync(join(tmpdir(), 'ship-install-'));
  const script = join(dir, 'claude');
  writeFileSync(script, `#!/bin/sh\necho "$*" >> "${dir}/calls"\n${body}\nexit 0\n`);
  chmodSync(script, 0o755);
  return dir;
}

const run = (path) => spawnSync(process.execPath, [INSTALL], { encoding: 'utf8', env: { PATH: path } });
const calls = (dir) => readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');

test('adds the marketplace, then installs the plugin', () => {
  const dir = fakeClaude();
  const result = run(dir);
  assert.equal(result.status, 0);
  assert.deepEqual(calls(dir), [
    '--version',
    'plugin marketplace add ahmedjadan/ship-skills',
    'plugin install ship@ship-skills',
  ]);
  assert.match(result.stdout, /\/ship:setup/);
});

test('running it twice is fine', () => {
  const dir = fakeClaude('case "$*" in plugin*) echo "already added" >&2; exit 1;; esac');
  assert.equal(run(dir).status, 0);
});

test('a real failure stops with its output', () => {
  const dir = fakeClaude('case "$*" in "plugin install"*) echo "network down" >&2; exit 1;; esac');
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not install the plugin[\s\S]*network down/);
});

test('missing Claude Code gets a clear message', () => {
  const result = run(mkdtempSync(join(tmpdir(), 'ship-empty-path-')));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs Claude Code/);
});

test('package and plugin versions match, and only the installer is published', () => {
  const root = join(dirname(INSTALL), '..');
  const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  assert.equal(read('package.json').version, read('.claude-plugin/plugin.json').version);
  assert.equal(read('package.json').bin['ship-skills'], 'bin/install.mjs');
  assert.ok(existsSync(join(root, read('package.json').files[0])));
});
