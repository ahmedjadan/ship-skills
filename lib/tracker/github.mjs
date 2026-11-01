import { assertTicketTransition } from '../lifecycle.mjs';
import { ShipError } from '../util.mjs';
import { nextTicket } from './contract.mjs';

const LABEL = 'ship';
const STATUS_PREFIX = 'ship:';
const META = /<!-- ship (\{.*?\}) -->/;
const FIELDS = 'number,title,body,labels,state,url';

function fail(error) {
  const text = `${error.stderr ?? ''}${error.message ?? ''}`;
  if (/could not resolve|not found/i.test(text)) throw new ShipError('NOT_FOUND', text.trim());
  if (/auth|forbidden|401|403/i.test(text)) throw new ShipError('UNAUTHORIZED', text.trim());
  throw new ShipError('UNAVAILABLE', text.trim());
}

function toTicket(issue) {
  const meta = JSON.parse(issue.body?.match(META)?.[1] ?? '{}');
  const label = issue.labels.map((item) => item.name).find((name) => name.startsWith(STATUS_PREFIX));
  const open = issue.state === 'OPEN' || issue.state === 'open';
  return {
    id: String(issue.number),
    title: issue.title,
    body: (issue.body ?? '').replace(META, '').trim(),
    status: open ? (label?.slice(STATUS_PREFIX.length) ?? 'ready') : 'done',
    blockedBy: meta.blockedBy ?? [],
    acceptance: meta.acceptance ?? [],
    spec: meta.spec,
    key: meta.key,
    url: issue.url,
  };
}

export function createGithubTracker(repo, exec) {
  const gh = (...args) => {
    try {
      return exec([...args, '-R', repo]);
    } catch (error) {
      return fail(error);
    }
  };
  const all = () =>
    JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '1000', '--json', FIELDS)).map(toTicket);
  const get = (id) => toTicket(JSON.parse(gh('issue', 'view', id, '--json', FIELDS)));

  return {
    async create(ticket) {
      const key = `${ticket.spec}#${ticket.number}`;
      const existing = all().find((candidate) => candidate.key === key);
      if (existing) return { id: existing.id, url: existing.url };
      const meta = { key, spec: ticket.spec, blockedBy: ticket.blockedBy ?? [], acceptance: ticket.acceptance ?? [] };
      for (const name of [LABEL, `${STATUS_PREFIX}ready`]) gh('label', 'create', name, '--force');
      const url = gh(
        'issue', 'create', '--title', ticket.title, '--label', LABEL, '--label', `${STATUS_PREFIX}ready`,
        '--body', `${ticket.body ?? ''}\n\n<!-- ship ${JSON.stringify(meta)} -->`,
      ).trim();
      return { id: url.split('/').pop(), url };
    },
    async get(id) {
      return get(id);
    },
    async list({ spec, status } = {}) {
      return all().filter(
        (ticket) => (!spec || ticket.spec === spec) && (!status || ticket.status === status),
      );
    },
    async next({ spec } = {}) {
      return nextTicket(all().filter((ticket) => !spec || ticket.spec === spec).sort((a, b) => a.id - b.id));
    },
    async transition(id, status, note) {
      const ticket = get(id);
      assertTicketTransition(ticket.status, status);
      if (status === 'done') {
        if (note) gh('issue', 'comment', id, '--body', note);
        gh('issue', 'close', id);
      } else {
        gh('label', 'create', `${STATUS_PREFIX}${status}`, '--force');
        gh('issue', 'edit', id, '--remove-label', `${STATUS_PREFIX}${ticket.status}`, '--add-label', `${STATUS_PREFIX}${status}`);
        if (note) gh('issue', 'comment', id, '--body', note);
      }
      return get(id);
    },
  };
}
