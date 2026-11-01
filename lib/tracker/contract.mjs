import { execFileSync } from 'node:child_process';
import { loadSchema, validate } from '../schema.mjs';
import { ShipError } from '../util.mjs';
import { createFilesTracker } from './files.mjs';
import { createGithubTracker } from './github.mjs';

export const ERROR_CODES = ['NOT_FOUND', 'CONFLICT', 'UNAUTHORIZED', 'UNAVAILABLE'];
const OPERATIONS = ['create', 'get', 'list', 'next', 'transition'];

export function checkTicket(ticket) {
  const errors = validate(ticket, loadSchema('ticket'));
  if (errors.length > 0) throw new ShipError('CONTRACT_VIOLATION', 'Ticket breaks the tracker contract', errors);
  return ticket;
}

// Validates a result an agent-run adapter produced, so Linear and custom
// trackers are held to the same contract as the ones the CLI drives.
export function checkResult(operation, result) {
  if (!OPERATIONS.includes(operation)) throw new ShipError('INVALID_ARGUMENT', `Unknown operation "${operation}"`);
  if (operation === 'create') {
    if (typeof result?.id !== 'string' || typeof result?.url !== 'string') {
      throw new ShipError('CONTRACT_VIOLATION', 'create must return {id, url}');
    }
  } else if (operation === 'list') {
    if (!Array.isArray(result)) throw new ShipError('CONTRACT_VIOLATION', 'list must return an array');
    result.forEach(checkTicket);
  } else if (operation !== 'next' || result !== null) {
    checkTicket(result);
  }
  return { valid: true };
}

export function nextTicket(tickets) {
  const status = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
  return tickets.find(
    (ticket) => ticket.status === 'ready' && ticket.blockedBy.every((id) => status.get(id) === 'done'),
  ) ?? null;
}

const execGh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Returns null for agent-run adapters: the agent performs those operations.
export function createTracker(ctx, overrides = {}) {
  const { tracker } = ctx.config;
  if (tracker.kind === 'files') return createFilesTracker(ctx.root, tracker.path ?? '.ship/work');
  if (tracker.kind === 'github') return createGithubTracker(tracker.repo, overrides.exec ?? execGh);
  return null;
}

// Creates the tickets in dependency order; numbers in blockedBy become real ids.
export async function publishBreakdown(tracker, spec, tickets) {
  validateBreakdown(tickets);
  const ids = new Map();
  const created = [];
  for (const ticket of tickets) {
    const blockedBy = (ticket.blockedBy ?? []).map((number) => ids.get(number));
    const result = await tracker.create({ ...ticket, spec, blockedBy });
    ids.set(ticket.number, result.id);
    created.push(result);
  }
  return created;
}

export function validateBreakdown(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) throw new ShipError('INVALID_ARGUMENT', 'No tickets');
  const seen = new Set();
  for (const ticket of tickets) {
    if (!Number.isInteger(ticket.number) || !ticket.title) {
      throw new ShipError('INVALID_ARGUMENT', 'Each ticket needs number and title');
    }
    for (const blocker of ticket.blockedBy ?? []) {
      // Requiring blockers to come first also rules out cycles.
      if (!seen.has(blocker)) {
        throw new ShipError('INVALID_ARGUMENT', `Ticket ${ticket.number}: blocker ${blocker} must come earlier`);
      }
    }
    if (seen.has(ticket.number)) throw new ShipError('INVALID_ARGUMENT', `Duplicate ticket ${ticket.number}`);
    seen.add(ticket.number);
  }
}
