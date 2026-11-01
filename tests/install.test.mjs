import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const INSTALL = fileURLToPath(new URL('../bin/install.mjs', import.meta.url));

// A fake `claude` holding plugin state in files.
function fakeClaude({ installed = null, latest = '0.2.0', marketplace = Boolean(installed), failOn = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ship-install-'));
  if (installed) writeFileSync(join(dir, 'version'), installed);
  if (marketplace) writeFileSync(join(dir, 'marketplace'), '');
  const script = join(dir, 'claude');
  writeFileSync(script, `#!/bin/sh
echo "$*" >> "${dir}/calls"
${failOn ? `case "$*" in "${failOn}"*) echo "network down" >&2; exit 1;; esac` : ''}
case "$*" in
  "plugin list --json")
    if [ -f "${dir}/version" ]; then echo "[{\\"id\\":\\"ship@ship-skills\\",\\"version\\":\\"$(cat "${dir}/version")\\"}]"; else echo "[]"; fi ;;
  "plugin marketplace list") [ -f "${dir}/marketplace" ] && echo "ship-skills" ;;
  "plugin marketplace add"*) : > "${dir}/marketplace" ;;
  "plugin marketplace remove"*) rm "${dir}/marketplace" ;;
  "plugin install"*|"plugin update"*) echo "${latest}" > "${dir}/version" ;;
  "plugin uninstall"*) rm "${dir}/version" ;;
esac
exit 0
`);
  chmodSync(script, 0o755);
  return dir;
}

// /bin gives the fake its cat and rm; Claude Code is never installed there.
const run = (path, ...args) => spawnSync(process.execPath, [INSTALL, ...args], { encoding: 'utf8', env: { PATH: `${path}:/bin` } });
const calls = (dir) => readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');

test('a first install adds the marketplace, installs and shows next steps', () => {
  const dir = fakeClaude();
  const result = run(dir);
  assert.equal(result.status, 0);
  assert.ok(calls(dir).includes('plugin marketplace add ahmedjadan/ship-skills'));
  assert.ok(calls(dir).includes('plugin install ship@ship-skills'));
  assert.match(result.stdout, /Installed \(0\.2\.0\)/);
  assert.match(result.stdout, /\/ship:setup/);
});

test('installing over an old version updates it and says so', () => {
  const dir = fakeClaude({ installed: '0.1.0' });
  const result = run(dir);
  assert.ok(calls(dir).includes('plugin marketplace update ship-skills'));
  assert.ok(calls(dir).includes('plugin update ship@ship-skills'));
  assert.ok(!calls(dir).some((call) => call.startsWith('plugin install')));
  assert.match(result.stdout, /Updated 0\.1\.0 → 0\.2\.0/);
});

test('installing the current version says it is up to date', () => {
  const result = run(fakeClaude({ installed: '0.2.0' }));
  assert.match(result.stdout, /Already up to date \(0\.2\.0\)/);
  assert.doesNotMatch(result.stdout, /Installed/);
});

test('update refuses when Ship is not installed', () => {
  const result = run(fakeClaude(), 'update');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not installed/);
});

test('status reports the version', () => {
  assert.match(run(fakeClaude({ installed: '0.1.0' }), 'status').stdout, /Ship 0\.1\.0 is installed/);
  assert.match(run(fakeClaude(), 'status').stdout, /not installed/);
});

test('uninstall removes the plugin and marketplace', () => {
  const dir = fakeClaude({ installed: '0.1.0' });
  assert.equal(run(dir, 'uninstall').status, 0);
  assert.ok(calls(dir).includes('plugin uninstall ship@ship-skills'));
  assert.ok(calls(dir).includes('plugin marketplace remove ship-skills'));
  assert.equal(run(dir, 'uninstall').status, 0);
});

test('a failure stops with its output and no success message', () => {
  const result = run(fakeClaude({ failOn: 'plugin install' }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not install Ship[\s\S]*network down/);
  assert.doesNotMatch(result.stdout, /Installed|Next/);
});

test('missing Claude Code gets a clear message', () => {
  const result = run(mkdtempSync(join(tmpdir(), 'ship-empty-path-')));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Claude Code was not found/);
});

test('help, version and unknown commands', () => {
  const dir = fakeClaude();
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(run(dir, '--help').stdout, /uninstall/);
  assert.equal(run(dir, '--version').stdout.trim(), version);
  const unknown = run(dir, 'nope');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown command "nope"/);
  assert.equal(existsSync(join(dir, 'calls')), false);
});

test('output has no colour codes when not a terminal', () => {
  assert.doesNotMatch(run(fakeClaude()).stdout, /\x1b\[/);
});

test('package and plugin versions match, and only the installer is published', () => {
  const root = join(dirname(INSTALL), '..');
  const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  assert.equal(read('package.json').version, read('.claude-plugin/plugin.json').version);
  assert.equal(read('package.json').bin['ship-skills'], 'bin/install.mjs');
  assert.ok(existsSync(join(root, read('package.json').files[0])));
});
