/**
 * Exchange rates — the pure core of multi-currency support.
 *
 * Foundry is local-first, so rates are data the operator keeps, not a feed we
 * call: every rate is a pair, a number, and a timestamp. Conversion never
 * guesses — a missing pair returns `undefined` so callers can say "no rate"
 * instead of inventing one.
 *
 * Pure domain: no browser or persistence APIs.
 */

export type FxRate = {
  /** Three-letter currency the rate is quoted against (the "from"). */
  base: string;
  /** Three-letter currency it buys (the "to"). */
  quote: string;
  /** How much `quote` one unit of `base` buys. */
  rate: number;
  /** ISO timestamp of the entry; the latest entry for a pair wins. */
  at: string;
};

/** Latest rate for `from → to`, trying the direct leg then the inverse. */
export function rateFor(
  rates: readonly FxRate[],
  from: string,
  to: string,
): number | undefined {
  if (from === to) return 1;
  const latest = (base: string, quote: string) =>
    rates
      .filter((entry) => entry.base === base && entry.quote === quote && entry.rate > 0)
      .sort((last, next) => last.at.localeCompare(next.at))
      .at(-1);
  const direct = latest(from, to);
  if (direct) return direct.rate;
  const inverse = latest(to, from);
  return inverse ? 1 / inverse.rate : undefined;
}

/** Convert an amount; `undefined` means the pair has no rate. Same currency converts as itself. */
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: readonly FxRate[],
): number | undefined {
  const rate = rateFor(rates, from, to);
  return rate === undefined ? undefined : amount * rate;
}

/** Insert or replace the rate for one pair; the table stays one entry per pair. */
export function putRate(rates: readonly FxRate[], entry: FxRate): FxRate[] {
  const rest = rates.filter(
    (existing) => !(existing.base === entry.base && existing.quote === entry.quote),
  );
  return [...rest, { ...entry, at: entry.at || new Date().toISOString() }];
}
