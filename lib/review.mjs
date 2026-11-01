// Resolves what a standalone review covers. Read-only: it needs no config and
// writes no run, approval or tracker state, so it works on any existing repo.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { currentBranch, git, gitOk, isDirty, ShipError } from './util.mjs';

const PR_TARGET = /^(\d+|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\/?)$/;
const SAFE_REF = /^[\w@][\w./~^@-]*$/;
const PR_FIELDS = 'number,url,title,body,baseRefName,headRefName';

const execGh = (args, cwd) => execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function safeRef(ref, label) {
  if (!SAFE_REF.test(ref)) throw new ShipError('INVALID_ARGUMENT', `Unsafe ${label} "${ref}"`);
  return ref;
}

function repoFor(cwd, ctx, repo) {
  if (repo && !ctx) throw new ShipError('INVALID_ARGUMENT', '--repo needs a Ship config');
  if (repo) return { name: repo, path: ctx.repoPath(repo) };
  if (ctx?.config.repos.length === 1) {
    const { name } = ctx.config.repos[0];
    return { name, path: ctx.repoPath(name) };
  }
  if (ctx) {
    const inside = ctx.config.repos.find((item) => ctx.repoPath(item.name) === resolve(cwd));
    if (inside) return { name: inside.name, path: resolve(cwd) };
    const names = ctx.config.repos.map((item) => item.name).join(', ');
    throw new ShipError('INVALID_ARGUMENT', `Pick a repo with --repo: ${names}`);
  }
  return { name: null, path: cwd };
}

function defaultBase(cwd, ctx, repoName) {
  const configured = ctx?.config.repos.find((item) => item.name === repoName)?.base;
  if (configured) return configured;
  if (gitOk(cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD')) {
    return git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  }
  const found = ['main', 'master', 'develop'].find((name) => gitOk(cwd, 'rev-parse', '--verify', '-q', name));
  if (found) return found;
  throw new ShipError('NOT_FOUND', 'No base branch found; pass --base');
}

function prScope(target, repo, exec) {
  let pr;
  try {
    pr = JSON.parse(exec(['pr', 'view', target, '--json', PR_FIELDS], repo.path));
  } catch (error) {
    throw new ShipError('NOT_FOUND', `Could not read PR ${target}: ${error.stderr ?? error.message}`);
  }
  return {
    mode: 'standalone',
    kind: 'pr',
    repo: repo.name,
    cwd: repo.path,
    target,
    base: pr.baseRefName,
    head: pr.headRefName,
    diffCommand: `gh pr diff ${target}`,
    pr: { number: pr.number, url: pr.url, title: pr.title, body: pr.body },
    warnings: [],
  };
}

function branchScope(target, base, repo, ctx) {
  const cwd = repo.path;
  const head = safeRef(target ?? currentBranch(cwd), 'target');
  const against = safeRef(base ?? defaultBase(cwd, ctx, repo.name), 'base');
  for (const ref of [head, against]) {
    if (!gitOk(cwd, 'rev-parse', '--verify', '-q', `${ref}^{commit}`)) {
      throw new ShipError('NOT_FOUND', `No such ref "${ref}"`);
    }
  }
  const range = `${against}...${head}`;
  const files = git(cwd, 'diff', '--name-only', range);
  if (files === '') throw new ShipError('EMPTY_DIFF', `Nothing to review between ${against} and ${head}`);
  return {
    mode: 'standalone',
    kind: 'branch',
    repo: repo.name,
    cwd,
    target: head,
    base: against,
    head,
    diffCommand: `git diff ${range}`,
    commits: git(cwd, 'log', '--oneline', `${against}..${head}`).split('\n').filter(Boolean),
    files: files.split('\n'),
    warnings: isDirty(cwd) ? ['Uncommitted changes are not part of this review'] : [],
  };
}

export function reviewScope({ cwd, ctx, target, repo, base, exec = execGh }) {
  const chosen = repoFor(cwd, ctx, repo);
  if (!gitOk(chosen.path, 'rev-parse', '--git-dir')) {
    throw new ShipError('NOT_A_REPO', `${chosen.path} is not a git repo`);
  }
  if (!gitOk(chosen.path, 'rev-parse', '--verify', '-q', 'HEAD')) {
    throw new ShipError('NO_COMMITS', `${chosen.path} has no commits yet`);
  }
  return target && PR_TARGET.test(target) ? prScope(target, chosen, exec) : branchScope(target, base, chosen, ctx);
}
