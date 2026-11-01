import { checkResult } from './contract.mjs';
import { ShipError } from '../util.mjs';

// Every CLI-run adapter must pass this. `spec` should be unique to the run.
export async function runConformance(tracker, spec) {
  const results = [];
  const check = async (name, body) => {
    try {
      await body();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    }
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  let first;
  let second;

  await check('create returns {id, url}', async () => {
    first = await tracker.create({ spec, number: 1, title: 'First', body: 'b', acceptance: ['AC-1'], blockedBy: [] });
    checkResult('create', first);
    second = await tracker.create({ spec, number: 2, title: 'Second', body: 'b', acceptance: [], blockedBy: [first.id] });
  });
  await check('create is idempotent', async () => {
    const again = await tracker.create({ spec, number: 1, title: 'First', body: 'b', acceptance: ['AC-1'], blockedBy: [] });
    assert(again.id === first.id, 'retry produced a different id');
    assert((await tracker.list({ spec })).length === 2, 'retry produced a duplicate');
  });
  await check('get returns a valid ticket', async () => {
    const ticket = await tracker.get(first.id);
    checkResult('get', ticket);
    assert(ticket.acceptance.includes('AC-1'), 'acceptance not preserved');
  });
  await check('get on an unknown id is NOT_FOUND', async () => {
    try {
      await tracker.get('999999');
    } catch (error) {
      assert(error instanceof ShipError && error.code === 'NOT_FOUND', `got ${error.code}`);
      return;
    }
    throw new Error('did not fail');
  });
  await check('list filters by status', async () => {
    const list = await tracker.list({ spec, status: 'ready' });
    checkResult('list', list);
    assert(list.length === 2, `got ${list.length}`);
  });
  await check('next skips blocked tickets', async () => {
    const next = await tracker.next({ spec });
    checkResult('next', next);
    assert(next.id === first.id, `got ${next?.id}`);
  });
  await check('illegal transition is refused', async () => {
    try {
      await tracker.transition(first.id, 'done');
    } catch (error) {
      assert(error.code === 'ILLEGAL_TRANSITION', `got ${error.code}`);
      return;
    }
    throw new Error('did not fail');
  });
  await check('done unblocks dependants', async () => {
    await tracker.transition(first.id, 'in_progress', 'start');
    await tracker.transition(first.id, 'in_review');
    const done = await tracker.transition(first.id, 'done', 'merged');
    assert(done.status === 'done', `got ${done.status}`);
    const next = await tracker.next({ spec });
    assert(next?.id === second.id, `got ${next?.id}`);
  });
  return results;
}
