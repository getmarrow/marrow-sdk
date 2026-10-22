'use strict';

// Test-only virtual clock for the in-process SDK tests. It replaces globalThis.setTimeout and
// clearTimeout while installed, so a test can
//   - freeze time and prove a call returns without waiting on any timer (a wait on a timer that
//     never fires leaves the call pending), and
//   - read the exact sleeps the product requested and advance virtual time without a real sleep.
// Nothing under src/ or dist/ reads this file or a switch for it; it lives under test/ and is not
// packed.

const realSetImmediate = globalThis.setImmediate;

function turn() {
  return new Promise((resolve) => realSetImmediate(resolve));
}

// Counted event-loop turns, not time: a call that has everything it needs settles in a few turns
// however slow the machine is, and a call that waits on something held back never does.
async function outcomeWithin(promise, maxTurns = 100) {
  const outcome = { state: 'pending', value: undefined, error: undefined };
  promise.then(
    (value) => { outcome.state = 'fulfilled'; outcome.value = value; },
    (error) => { outcome.state = 'rejected'; outcome.error = error; },
  );
  for (let i = 0; i < maxTurns && outcome.state === 'pending'; i += 1) await turn();
  return outcome;
}

async function untilTrue(predicate, maxTurns = 1_000) {
  for (let i = 0; i < maxTurns; i += 1) {
    if (predicate()) return;
    await turn();
  }
  throw new Error('condition never became true within the turn budget');
}

function installFakeClock() {
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const timers = new Map();
  const requested = [];
  let now = 0;
  let sequence = 0;

  class FakeTimeout {
    constructor(id) { this.id = id; }
    unref() { return this; }
    ref() { return this; }
    hasRef() { return true; }
    refresh() { return this; }
    [Symbol.toPrimitive]() { return this.id; }
  }

  globalThis.setTimeout = function fakeSetTimeout(callback, delay, ...args) {
    const ms = Number.isFinite(Number(delay)) && Number(delay) >= 1 ? Number(delay) : 1;
    sequence += 1;
    const handle = new FakeTimeout(sequence);
    timers.set(handle, { at: now + ms, sequence, callback, args });
    requested.push(ms);
    return handle;
  };
  globalThis.clearTimeout = function fakeClearTimeout(handle) {
    if (handle instanceof FakeTimeout) timers.delete(handle);
    else real.clearTimeout(handle);
  };

  function nextDue(limit) {
    let best = null;
    for (const [handle, timer] of timers) {
      if (timer.at > limit) continue;
      if (!best || timer.at < best.timer.at || (timer.at === best.timer.at && timer.sequence < best.timer.sequence)) {
        best = { handle, timer };
      }
    }
    return best;
  }

  return {
    // Every sleep the code under test asked for, in order, in ms.
    requested,
    get pending() { return timers.size; },
    get now() { return now; },
    // Move virtual time forward; fires due timers in order, letting each one's consequences settle.
    async advance(ms) {
      const limit = now + ms;
      for (let due = nextDue(limit); due; due = nextDue(limit)) {
        now = due.timer.at;
        timers.delete(due.handle);
        due.timer.callback(...due.timer.args);
        await turn();
      }
      now = limit;
      await turn();
    },
    restore() {
      globalThis.setTimeout = real.setTimeout;
      globalThis.clearTimeout = real.clearTimeout;
    },
  };
}

module.exports = { installFakeClock, outcomeWithin, untilTrue, turn };
