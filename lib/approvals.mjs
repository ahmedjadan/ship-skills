import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, safeName, ShipError, writeJson } from './util.mjs';

export const KINDS = ['spec', 'tickets', 'plan', 'review', 'pr'];

const pathFor = (stateDir, kind, ref) => join(stateDir, 'approvals', `${kind}-${safeName(ref)}.json`);

export function recordApproval(stateDir, { kind, ref, hash, by, quote }) {
  if (!KINDS.includes(kind)) throw new ShipError('INVALID_ARGUMENT', `Unknown approval kind "${kind}"`);
  if (!quote?.trim()) throw new ShipError('APPROVAL_NEEDS_QUOTE', "Approval needs --quote with the user's own reply");
  if (!by?.trim()) throw new ShipError('APPROVAL_NEEDS_QUOTE', 'Approval needs --by with who approved');
  const approval = { kind, ref, hash, by, quote, at: new Date().toISOString() };
  writeJson(pathFor(stateDir, kind, ref), approval);
  return approval;
}

// An approval covers exact content: if the hash moved, it no longer counts.
export function approvalStatus(stateDir, kind, ref, hash) {
  const path = pathFor(stateDir, kind, ref);
  if (!existsSync(path)) return 'missing';
  return readJson(path).hash === hash ? 'valid' : 'void';
}

export function requireApproval(stateDir, kind, ref, hash) {
  const status = approvalStatus(stateDir, kind, ref, hash);
  if (status === 'missing') throw new ShipError('APPROVAL_REQUIRED', `${kind} ${ref} has no approval`);
  if (status === 'void') {
    throw new ShipError('APPROVAL_VOID', `${kind} ${ref} changed after it was approved; ask again`);
  }
}
