// A guardrail against mistakes, not a sandbox: it reads command text, so an
// obfuscated command or a script that shells out will get past it.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { ShipError } from './util.mjs';

const RANK = { allow: 0, ask: 1, deny: 2 };
const STATE_PATH = /\.ship\/(runs|approvals)\//;

const segments = (command) => command.split(/&&|\|\||;|\||\n/).map((part) => part.trim()).filter(Boolean);
const tokens = (segment) => segment.split(/\s+/).map((token) => token.replace(/^["']|["']$/g, ''));

function gitCall(words) {
  const at = words.indexOf('git');
  if (at === -1) return null;
  const rest = words.slice(at + 1);
  const options = { cwd: null };
  while (rest[0]?.startsWith('-')) {
    const flag = rest.shift();
    const value = flag === '-C' || flag === '-c' ? rest.shift() : null;
    if (flag === '-C') options.cwd = value;
  }
  return { sub: rest[0], args: rest.slice(1), ...options };
}

function branchIn(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function classifyGit(call, bases, cwd) {
  const where = call.cwd ? resolve(cwd, call.cwd) : cwd;
  const { sub, args } = call;
  if (sub === 'push') {
    if (args.some((arg) => /^(-f|--force.*|--mirror|-d|--delete)$/.test(arg) || arg.startsWith('+'))) return 'force_push';
    const refs = args.filter((arg) => !arg.startsWith('-')).slice(1);
    const targets = refs.map((ref) => ref.split(':').pop().replace(/^refs\/heads\//, ''));
    const resolved = targets.length === 0 || targets.includes('HEAD') ? [...targets, branchIn(where)] : targets;
    return resolved.some((target) => bases.includes(target)) ? 'push_base' : 'push_ticket_branch';
  }
  if (sub === 'merge' && !args.includes('--abort')) {
    return bases.includes(branchIn(where)) ? 'merge' : null;
  }
  if (sub === 'reset' && args.includes('--hard')) return 'destructive_history';
  if (sub === 'clean' && args.some((arg) => /^-[a-z]*f/.test(arg))) return 'destructive_history';
  if (sub === 'branch' && args.some((arg) => arg === '-D')) return 'destructive_history';
  if (sub === 'filter-branch' || sub === 'filter-repo') return 'destructive_history';
  return null;
}

function classifyGh(words) {
  const at = words.indexOf('gh');
  if (at === -1) return null;
  const [area, verb] = words.slice(at + 1);
  if (area === 'pr' && verb === 'merge') return 'merge';
  if (area === 'pr' && verb === 'create') return 'open_pr';
  if (area === 'issue' && ['create', 'edit', 'close', 'comment', 'reopen', 'delete'].includes(verb)) return 'tracker_write';
  return null;
}

function decideBash(command, config, cwd) {
  const bases = config.repos.map((repo) => repo.base);
  const hits = [];
  if (/>>?\s*\S*\.ship\/(runs|approvals)\//.test(command)) {
    hits.push({ policy: 'deny', reason: 'Run state and approvals are written only by the ship CLI' });
  }
  for (const segment of segments(command)) {
    const words = tokens(segment);
    const call = gitCall(words);
    const operation = (call && classifyGit(call, bases, cwd)) ?? classifyGh(words);
    if (operation) hits.push({ policy: config.permissions[operation], reason: `Ship permission "${operation}"` });
    for (const gate of config.gates) {
      if (!gate.agent_may_run && segment.includes(gate.command)) {
        hits.push({ policy: 'deny', reason: `Gate ${gate.repo}/${gate.name} is run by the user: ${gate.command}` });
      }
    }
    for (const rule of config.permissions.custom) {
      if (new RegExp(rule.pattern).test(segment)) {
        hits.push({ policy: rule.policy, reason: `Ship permission "${rule.name}"` });
      }
    }
  }
  return hits;
}

export function decide(input) {
  const cwd = input.cwd ?? process.cwd();
  let config;
  try {
    ({ config } = loadConfig(cwd));
  } catch (error) {
    if (error instanceof ShipError && error.code === 'CONFIG_MISSING') return { policy: 'allow' };
    // A broken config must not silently switch protection off.
    return { policy: 'ask', reason: `Ship config unreadable: ${error.message}` };
  }
  if (input.tool_name !== 'Bash') {
    const path = input.tool_input?.file_path ?? '';
    return STATE_PATH.test(path)
      ? { policy: 'deny', reason: 'Run state and approvals are written only by the ship CLI' }
      : { policy: 'allow' };
  }
  const hits = decideBash(input.tool_input?.command ?? '', config, cwd);
  return hits.reduce((worst, hit) => (RANK[hit.policy] > RANK[worst.policy] ? hit : worst), { policy: 'allow' });
}

export function hookOutput(decision) {
  if (decision.policy === 'allow') return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision.policy,
      permissionDecisionReason: decision.reason,
    },
  });
}
