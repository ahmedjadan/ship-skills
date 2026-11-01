import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertTicketTransition } from '../lifecycle.mjs';
import { safeName, ShipError, writeAtomic } from '../util.mjs';
import { parseFrontMatter, stringifyFrontMatter } from '../yaml.mjs';
import { nextTicket } from './contract.mjs';

const pad = (number) => String(number).padStart(2, '0');

export function createFilesTracker(root, base) {
  const dir = join(root, base);
  const specDir = (spec) => join(dir, safeName(spec), 'tickets');

  function read(path) {
    const { data, body } = parseFrontMatter(readFileSync(path, 'utf8'));
    return { ...data, body: body.trim(), url: relative(root, path) };
  }

  function write(path, ticket) {
    const { body, url, ...data } = ticket;
    writeAtomic(path, stringifyFrontMatter(data, `\n${body}\n`));
  }

  function allPaths(spec) {
    const specs = spec ? [safeName(spec)] : existsSync(dir) ? readdirSync(dir) : [];
    return specs.flatMap((name) => {
      const tickets = join(dir, name, 'tickets');
      return existsSync(tickets)
        ? readdirSync(tickets).filter((file) => file.endsWith('.md')).sort().map((file) => join(tickets, file))
        : [];
    });
  }

  function find(id) {
    const path = allPaths().find((candidate) => read(candidate).id === id);
    if (!path) throw new ShipError('NOT_FOUND', `No ticket ${id}`);
    return path;
  }

  return {
    async create(ticket) {
      const id = `${ticket.spec}-${pad(ticket.number)}`;
      const path = join(specDir(ticket.spec), `${pad(ticket.number)}.md`);
      if (existsSync(path)) {
        const existing = read(path);
        if (existing.title !== ticket.title) throw new ShipError('CONFLICT', `${id} exists with another title`);
        return { id, url: existing.url };
      }
      write(path, {
        id,
        title: ticket.title,
        status: 'ready',
        spec: ticket.spec,
        blockedBy: ticket.blockedBy ?? [],
        acceptance: ticket.acceptance ?? [],
        body: ticket.body ?? '',
      });
      return { id, url: relative(root, path) };
    },
    async get(id) {
      return read(find(id));
    },
    async list({ spec, status } = {}) {
      const tickets = allPaths(spec).map(read);
      return status ? tickets.filter((ticket) => ticket.status === status) : tickets;
    },
    async next({ spec } = {}) {
      return nextTicket(allPaths(spec).map(read));
    },
    async transition(id, status, note) {
      const path = find(id);
      const ticket = read(path);
      assertTicketTransition(ticket.status, status);
      const log = note ? `\n\n> ${new Date().toISOString()} ${status}: ${note}` : '';
      const updated = { ...ticket, status, body: `${ticket.body}${log}` };
      write(path, updated);
      return read(path);
    },
  };
}
