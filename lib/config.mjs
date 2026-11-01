import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadSchema, validate } from './schema.mjs';
import { ShipError } from './util.mjs';
import { parseFrontMatter } from './yaml.mjs';

export const DEFAULT_PERMISSIONS = {
  push_ticket_branch: 'ask',
  open_pr: 'ask',
  tracker_write: 'ask',
  push_base: 'deny',
  merge: 'deny',
  force_push: 'deny',
  destructive_history: 'deny',
  custom: [],
};

const CONFIG_PATH = join('.ship', 'config.md');

// Walks up from cwd, then looks one level down so a multi-repo root that is not
// itself a git repo can use a config kept inside one of its repos.
export function findConfig(cwd) {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, CONFIG_PATH))) return join(dir, CONFIG_PATH);
    if (dir === dirname(dir)) break;
  }
  const children = readdirSync(cwd).filter((name) => {
    try {
      return statSync(join(cwd, name)).isDirectory();
    } catch {
      return false;
    }
  });
  const found = children.map((name) => join(cwd, name, CONFIG_PATH)).filter(existsSync);
  if (found.length > 1) {
    throw new ShipError('CONFIG_INVALID', `More than one config found: ${found.join(', ')}`);
  }
  return found[0] ?? null;
}

export function parseConfig(source) {
  const { data, body } = parseFrontMatter(source);
  const errors = validate(data, loadSchema('config'));
  const names = new Set((data.repos ?? []).map((repo) => repo.name));
  for (const gate of data.gates ?? []) {
    if (!names.has(gate.repo)) errors.push(`gates: "${gate.name}" names unknown repo "${gate.repo}"`);
  }
  for (const rule of data.permissions?.custom ?? []) {
    try {
      new RegExp(rule.pattern);
    } catch {
      errors.push(`permissions.custom: "${rule.name}" has an invalid pattern`);
    }
  }
  const kind = data.tracker?.kind;
  if (kind === 'github' && !data.tracker.repo) errors.push('tracker.repo: required for github');
  if (kind === 'custom' && !data.tracker.adapter) errors.push('tracker.adapter: required for custom');
  if (errors.length > 0) throw new ShipError('CONFIG_INVALID', 'Config is invalid', errors);
  return { ...data, permissions: { ...DEFAULT_PERMISSIONS, ...data.permissions }, notes: body.trim() };
}

export function loadConfig(cwd) {
  const path = findConfig(cwd);
  if (!path) throw new ShipError('CONFIG_MISSING', 'No .ship/config.md found. Run /ship:setup first.');
  const config = parseConfig(readFileSync(path, 'utf8'));
  const root = dirname(dirname(path));
  return { config, root, stateDir: join(root, '.ship'), repoPath: (name) => repoPath(config, root, name) };
}

function repoPath(config, root, name) {
  const repo = config.repos.find((candidate) => candidate.name === name);
  if (!repo) throw new ShipError('UNKNOWN_REPO', `Repo "${name}" is not in the config`);
  return resolve(root, repo.path);
}
