// @salt/equivalence — §4.3 safety engine. Pure TS; recall injected.
//
// KILL SWITCH (design §4.3): a single KV flag `substitution_engine_enabled` must
// be able to degrade the product to pure price display with NO equivalence claims,
// flippable in <60s without a deploy. That flag lives at the serving layer — the
// caller checks it and skips assessEquivalence entirely. This pure engine makes no
// claims of its own; it only answers when asked.
export { assessEquivalence, allowsSwitchCta } from './assess.js';
export type { EquivalenceResult, EquivalenceContext } from './assess.js';
export { RULES } from './rules.js';
export type { Verdict, Rule, RuleKey } from './rules.js';
