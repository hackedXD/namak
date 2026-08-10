// Dependencies injected into the app, so handlers are pure of environment concerns
// and fully testable (tests pass fakes / a local SQLite-backed repo).
import type { FormulationRepo, MetaRepo } from '@salt/db';

export interface Deps {
  formulationRepo: FormulationRepo;
  metaRepo: MetaRepo;
  /** Ranking prior per channel (1 = cheapest expected). */
  channelTier: Record<string, number>;
  /** Injected clock → ISO string. Deterministic in tests. */
  now: () => string;
}

export const DEFAULT_CHANNEL_TIER: Record<string, number> = {
  jan_aushadhi: 1,
  unbranded: 2,
  branded: 3,
  epharmacy: 4,
};
