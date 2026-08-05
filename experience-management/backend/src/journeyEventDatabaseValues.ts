export type JourneyEventDatabaseProvider = 'sqlite' | 'postgres';

/** PostgreSQL has a native BOOLEAN type; SQLite persists the same contract as
 * an INTEGER constrained to 0/1. Keep the conversion explicit at bindings so
 * a SQLite-only test run cannot hide an invalid PostgreSQL integer literal. */
export function journeyEventReplayEligibilityValue(
  provider: JourneyEventDatabaseProvider,
  eligible: boolean
): boolean | 0 | 1 {
  return provider === 'postgres' ? eligible : eligible ? 1 : 0;
}
