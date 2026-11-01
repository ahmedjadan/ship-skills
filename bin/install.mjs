#!/usr/bin/env node
// Runs the plugin install for the user. It never copies files into
// ~/.claude/skills: outside the plugin system the hook would not register.
import { spawnSync } from 'node:child_process';

const MARKETPLACE = 'ahmedjadan/ship-skills';
const PLUGIN = 'ship@ship-skills';
const MIN_NODE = 20;
const ALREADY = /already/i;

function claude(...args) {
  // On Windows, claude is a .cmd shim that needs a shell. The arguments are constants.
  const result = spawnSync('claude', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return { missing: result.error?.code === 'ENOENT', ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

function stop(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function step(label, ...args) {
  const result = claude(...args);
  if (!result.ok && !ALREADY.test(result.output)) stop(`Ship: could not ${label}.\n${result.output}`);
}

if (Number(process.versions.node.split('.')[0]) < MIN_NODE) {
  stop(`Ship needs Node ${MIN_NODE} or later; this is ${process.versions.node}.`);
}
if (claude('--version').missing) {
  stop('Ship needs Claude Code, and "claude" was not found. Install it from https://code.claude.com, then run this again.');
}

step('add the marketplace', 'plugin', 'marketplace', 'add', MARKETPLACE);
step('install the plugin', 'plugin', 'install', PLUGIN);

process.stdout.write('Ship is installed. Start a new Claude Code session and run /ship:setup.\n');
