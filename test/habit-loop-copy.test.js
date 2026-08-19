const assert = require('node:assert/strict');
const test = require('node:test');

const { formatHabitLoopCopy } = require('../dist/habit-loop-copy.js');

test('pretty-prints habit-loop copy without inventing savings', () => {
  const copy = formatHabitLoopCopy({
    habit_loop: {
      contract: 'marrow.habit-loop.v1',
      headline: 'Marrow is on and quiet.',
      exact_next_action: 'Stay quiet unless this is a deploy.',
      avoid: ['Do not invent a workflow id from raw required_steps JSON.'],
      session_savings: { tokens: 0, evidence_backed: false, message: 'No reuse yet. Empty savings are honest.' },
    },
  });

  assert.equal(copy.contract, 'marrow.habit-loop.v1');
  assert.match(copy.text, /Marrow is on and quiet/);
  assert.match(copy.text, /Next: Stay quiet unless this is a deploy/);
  assert.match(copy.text, /Savings: No reuse yet/);
  assert.equal(copy.avoid[0].includes('workflow id'), true);
});

test('returns null when habit-loop contract is absent', () => {
  assert.equal(formatHabitLoopCopy({ health: 'healthy' }), null);
});

test('pretty-prints nested habit-loop payloads without inventing savings numbers', () => {
  const copy = formatHabitLoopCopy({
    data: {
      habit_loop: {
        contract: 'marrow.habit-loop.v1',
        headline: 'Marrow is on.',
        exact_next_action: 'Stay quiet unless this is a deploy.',
        session_savings: { tokens: 0, evidence_backed: false },
      },
    },
  });
  assert.ok(copy);
  assert.match(copy.savings, /Empty savings are honest/);
  assert.doesNotMatch(copy.text, /[1-9]\d* tokens/);
});
