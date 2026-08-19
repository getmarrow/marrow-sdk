function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export interface MarrowHabitLoopCopy {
  contract: 'marrow.habit-loop.v1';
  headline: string;
  next: string;
  avoid: string[];
  savings: string;
  text: string;
}

export function formatHabitLoopCopy(source: unknown): MarrowHabitLoopCopy | null {
  const root = asRecord(source);
  if (!root) return null;
  const nestedData = asRecord(root.data);
  const habit = asRecord(root.habit_loop)
    || asRecord(nestedData?.habit_loop)
    || (asString(root.contract) === 'marrow.habit-loop.v1' ? root : null);
  if (!habit || asString(habit.contract) !== 'marrow.habit-loop.v1') return null;

  const headline = asString(habit.headline) || 'Marrow is on.';
  const next = asString(habit.exact_next_action) || 'Stay quiet unless the work is deploy, merge, publish, migration, secrets, or billing.';
  const avoid = Array.isArray(habit.avoid)
    ? habit.avoid.map((item) => asString(item)).filter((item): item is string => Boolean(item)).slice(0, 5)
    : [];
  const savingsRecord = asRecord(habit.session_savings);
  const savings = asString(savingsRecord?.message)
    || (savingsRecord?.evidence_backed === true
      ? 'Reuse produced evidence-backed savings.'
      : 'No reuse yet. Empty savings are honest.');

  const lines = [
    headline,
    `Next: ${next}`,
    ...(avoid.length ? [`Avoid: ${avoid[0]}`] : []),
    `Savings: ${savings}`,
  ];

  return {
    contract: 'marrow.habit-loop.v1',
    headline,
    next,
    avoid,
    savings,
    text: lines.join('\n'),
  };
}
