import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/ship.mjs', import.meta.url));

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export function commit(cwd, file, content, message = 'change') {
  writeFileSync(join(cwd, file), content);
  git(cwd, 'add', '.');
  git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message);
}

// A root with two repos, like a monorepo root that is not itself a repo.
export function project({ gates, tracker = 'kind: files' } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ship-test-')));
  for (const name of ['api', 'web']) {
    const dir = join(root, name);
    mkdirSync(dir);
    git(dir, 'init', '-q', '-b', 'main');
    commit(dir, 'README.md', name);
    git(dir, 'checkout', '-qb', 'feature/one');
  }
  mkdirSync(join(root, '.ship'));
  mkdirSync(join(root, 'specs'));
  writeFileSync(join(root, 'specs', 'demo.md'), '# Demo spec\n');
  writeFileSync(join(root, '.ship', 'config.md'), `---
version: 1
repos:
  - name: api
    path: api
    base: main
  - name: web
    path: web
    base: main
tracker:
  ${tracker}
specs:
  path: specs
gates:
${gates ?? `  - repo: api
    name: check
    command: node -e "process.exit(0)"
    agent_may_run: true
  - repo: api
    name: test
    command: pnpm test
    agent_may_run: false`}
branch: feature/{ticket}
permissions:
  custom:
    - name: reset_db
      pattern: migrate reset
      policy: deny
---
Project notes.
`);
  return root;
}

export function ship(cwd, args, input) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', input });
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return { status: result.status, out: parse(result.stdout), err: parse(result.stderr) };
}

export function shipOk(cwd, args, input) {
  const result = ship(cwd, args, input);
  if (result.status !== 0) throw new Error(`ship ${args.join(' ')}: ${JSON.stringify(result.err)}`);
  return result.out;
}

export const errorCode = (result) => result.err?.error?.code;

// Runs a fresh project up to an approved plan on one api step.
export function planned(root) {
  const tickets = join(root, 'tickets.json');
  writeFileSync(tickets, JSON.stringify([
    { number: 1, title: 'First', body: 'Do it', acceptance: ['AC-1'] },
    { number: 2, title: 'Second', body: 'Then this', blockedBy: [1] },
  ]));
  const yes = ['--by', 'user', '--quote', 'yes'];
  shipOk(root, ['approve', 'spec', 'demo', ...yes]);
  shipOk(root, ['approve', 'tickets', 'demo', '--file', tickets, ...yes]);
  shipOk(root, ['tickets', 'publish', '--spec', 'demo', '--file', tickets]);
  shipOk(root, ['run', 'start', 'demo-01']);
  const plan = join(root, 'plan.json');
  writeFileSync(plan, JSON.stringify({ steps: [{ id: 's1', title: 'Build', repo: 'api' }] }));
  shipOk(root, ['run', 'plan', 'demo-01', '--file', plan]);
  shipOk(root, ['approve', 'plan', 'demo-01', ...yes]);
  return { yes, id: 'demo-01' };
}
