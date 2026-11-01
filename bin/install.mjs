#!/usr/bin/env node
// Manages the plugin through Claude Code. It never copies files into
// ~/.claude/skills: outside the plugin system the hook would not register.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = 'ahmedjadan/ship-skills';
const MARKETPLACE = 'ship-skills';
const PLUGIN = 'ship@ship-skills';
const MIN_NODE = 20;
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = paint(1);
const dim = paint(2);
const green = paint(32);
const red = paint(31);

const say = (text = '') => process.stdout.write(`${text}\n`);
const done = (text) => say(`  ${green('✓')} ${text}`);

const HELP = `${bold('Ship')} ${version}: spec to pull request in Claude Code

${bold('Usage')}
  npx @ahmedjadan/ship-skills [command]

${bold('Commands')}
  install     Install Ship, or update it if it's already installed (default)
  update      Update Ship to the latest version
  status      Show the installed version
  uninstall   Remove Ship. Your projects' .ship folders are kept

${bold('Options')}
  -h, --help     Show this help
  -v, --version  Show this version
`;

const NEXT_STEPS = `${bold('Next')}
  1. Start a new Claude Code session
  2. Run ${bold('/ship:setup')} in your project

${dim('To review an existing change with no setup: /ship:review <branch or PR>')}`;

function claude(...args) {
  // On Windows, claude is a .cmd shim that needs a shell. The arguments are constants.
  const result = spawnSync('claude', args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return {
    missing: result.error?.code === 'ENOENT',
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function stop(message) {
  process.stderr.write(`  ${red('✗')} ${message}\n`);
  process.exit(1);
}

function run(failure, ...args) {
  const result = claude(...args);
  if (!result.ok) stop(`${failure}\n\n${result.output}`);
}

function requireClaude() {
  if (Number(process.versions.node.split('.')[0]) < MIN_NODE) {
    stop(`Ship needs Node ${MIN_NODE} or later; this is ${process.versions.node}.`);
  }
  if (claude('--version').missing) {
    stop('Claude Code was not found. Install it from https://code.claude.com, then run this again.');
  }
}

function installedVersion() {
  const result = claude('plugin', 'list', '--json');
  if (!result.ok) stop(`Could not read your plugins.\n\n${result.output}`);
  return JSON.parse(result.stdout).find((plugin) => plugin.id === PLUGIN)?.version ?? null;
}

const hasMarketplace = () => claude('plugin', 'marketplace', 'list').output.includes(MARKETPLACE);

function ensureMarketplace() {
  if (hasMarketplace()) {
    run('Could not refresh the Ship marketplace.', 'plugin', 'marketplace', 'update', MARKETPLACE);
  } else {
    run('Could not add the Ship marketplace.', 'plugin', 'marketplace', 'add', REPO);
  }
}

function update(before) {
  ensureMarketplace();
  run('Could not update Ship.', 'plugin', 'update', PLUGIN);
  const after = installedVersion();
  if (after === before) {
    done(`Already up to date (${after})`);
    return false;
  }
  done(`Updated ${before} → ${after}`);
  return true;
}

function install() {
  say(bold(`Ship ${version}\n`));
  requireClaude();
  const before = installedVersion();
  if (before) {
    if (update(before)) say(`\n${bold('Next')}\n  Start a new Claude Code session to use it.`);
    return;
  }
  ensureMarketplace();
  run('Could not install Ship.', 'plugin', 'install', PLUGIN);
  done(`Installed (${installedVersion()})`);
  say(`\n${NEXT_STEPS}`);
}

function updateCommand() {
  say(bold(`Ship ${version}\n`));
  requireClaude();
  const before = installedVersion();
  if (!before) stop('Ship is not installed. Run: npx @ahmedjadan/ship-skills');
  if (update(before)) say(`\n${bold('Next')}\n  Start a new Claude Code session to use it.`);
}

function status() {
  requireClaude();
  const installed = installedVersion();
  say(installed ? `Ship ${installed} is installed.` : 'Ship is not installed.');
}

function uninstall() {
  requireClaude();
  if (installedVersion()) {
    run('Could not remove Ship.', 'plugin', 'uninstall', PLUGIN);
    done('Plugin removed');
  }
  if (hasMarketplace()) {
    run('Could not remove the Ship marketplace.', 'plugin', 'marketplace', 'remove', MARKETPLACE);
    done('Marketplace removed');
  }
  say(`\n${dim("Ship is gone. Your projects' .ship folders were left in place.")}`);
}

const COMMANDS = { install, update: updateCommand, status, uninstall };
const [command = 'install'] = process.argv.slice(2);

if (command === '-h' || command === '--help' || command === 'help') {
  say(HELP.trimEnd());
} else if (command === '-v' || command === '--version') {
  say(version);
} else if (COMMANDS[command]) {
  COMMANDS[command]();
} else {
  say(HELP.trimEnd());
  stop(`Unknown command "${command}"`);
}
