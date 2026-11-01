import { ShipError } from './util.mjs';

export const RUN_TRANSITIONS = {
  planned: ['building'],
  building: ['verifying'],
  verifying: ['reviewing', 'building'],
  reviewing: ['pr_open', 'building'],
  pr_open: ['done'],
  done: [],
};

export const TICKET_TRANSITIONS = {
  ready: ['in_progress', 'blocked'],
  in_progress: ['in_review', 'blocked'],
  in_review: ['done', 'in_progress', 'blocked'],
  blocked: ['ready', 'in_progress', 'in_review'],
  done: [],
};

export function assertTicketTransition(from, to) {
  if (!TICKET_TRANSITIONS[from]?.includes(to)) {
    throw new ShipError('ILLEGAL_TRANSITION', `Ticket cannot move from ${from} to ${to}`);
  }
}

export function assertRunTransition(run, to) {
  const { state } = run;
  if (state === 'done') throw new ShipError('ILLEGAL_TRANSITION', 'Run is done');
  if (to === 'paused') return;
  if (state === 'paused') {
    if (to === run.pausedFrom) return;
    throw new ShipError('ILLEGAL_TRANSITION', `Paused run can only return to ${run.pausedFrom}`);
  }
  if (!RUN_TRANSITIONS[state]?.includes(to)) {
    throw new ShipError('ILLEGAL_TRANSITION', `Run cannot move from ${state} to ${to}`);
  }
}

// What the tracker must show for each run state; used on transition and on resume.
export const TICKET_STATUS_FOR_RUN = {
  planned: 'in_progress',
  building: 'in_progress',
  verifying: 'in_progress',
  reviewing: 'in_progress',
  pr_open: 'in_review',
  done: 'done',
};
