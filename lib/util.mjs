import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class ShipError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const sha256 = (value) =>
  createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export const safeName = (value) => String(value).replace(/[^\w.-]/g, '_');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Write then rename, so a killed session never leaves half a state file behind.
export function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

export const writeJson = (path, value) => writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function gitOk(cwd, ...args) {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
}

export function head(cwd) {
  if (!gitOk(cwd, 'rev-parse', '--verify', '-q', 'HEAD')) {
    throw new ShipError('NO_COMMITS', `${cwd} has no commits yet; make a first commit`);
  }
  return git(cwd, 'rev-parse', 'HEAD');
}

export const currentBranch = (cwd) => git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
export const isDirty = (cwd) => git(cwd, 'status', '--porcelain') !== '';
