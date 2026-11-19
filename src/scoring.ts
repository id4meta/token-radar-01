// Token Radar 01 — scoring engine.
//
// The model ranks pre-token protocols by an implied airdrop-pool value derived
// only from the sealed snapshot's own figures. Nothing here names a protocol:
// every weight is computed from the snapshot at run time, so the same program
// scores a future snapshot's new protocols without any change.
//
//   implied_value_usd = round(0.08 * TVL_eff * M_cat * W_cat * W_growth
//                             * W_age * W_chain * W_wl * W_sib)
//
//   TVL_eff   sub-linear scale: 50M * (tvl / 50M) ^ 0.65, anchored at the
//             watchlist floor so multi-billion passive pools do not drown
//             out $30M-$300M early protocols.
//   M_cat     empirical market multiple: the median mcap/TVL of the
//             snapshot's own tokenized peers in the category (each ratio
//             capped at 1.20), shrunk toward the global median with a
//             prior weight of 8, clamped to [0.10, 0.55].
//   W_cat     structural airdrop propensity of the category (native DeFi
//             primitives launch tokens far more often than bridges do).
//   W_growth  momentum relative to the pre-token median 7-day change,
//             winsorized so one +4000% week cannot dominate the board.
//   W_age     where the protocol sits in its pre-token life: the farming
//             window peaks 1-12 months after listing and fades past 900 days.
//   W_chain   the best chain the protocol runs on: how fresh and deep that
//             chain's pre-token ecosystem is, plus a small multi-chain bonus.
//   W_wl      1.35 when the snapshot's own watchlist names the protocol.
//   W_sib     0.35 when the protocol looks like a sibling product of a
//             tokenized protocol (same slug prefix), unless watchlisted.
//   0.08      the assumed community/airdrop share of the implied token
//             market cap at launch.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The eight multipliers behind one protocol's implied value, for the drawer. */
export interface ValueFactors {
  tvl_eff_usd: number;
  m_cat: number;
  w_cat: number;
  w_growth: number;
  w_age: number;
  w_chain: number;
  w_wl: number;
  w_sib: number;
  airdrop_alloc: number;
}

/** One scored board row, before farm steps are attached. */
export interface ScoredRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  primary_chain: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  in_watchlist: boolean;
  sibling_token_risk: boolean;
  implied_mcap_usd: number;
  implied_value_usd: number;
  factors: ValueFactors;
  reasoning: string;
}

export interface ScoreResult {
  global_mcap_tvl_median: number;
  median_change_7d: number;
  rows: ScoredRow[];
}

/** Airdrop propensity by category: native DeFi first, passive custody last. */
const CATEGORY_WEIGHT: Record<string, number> = {
  'Derivatives': 1.4,
  'Prediction Market': 1.4,
  'Lending': 1.35,
  'Uncollateralized Lending': 1.35,
  'Collateral Markets': 1.35,
  'Dexs': 1.3,
  'Yield': 1.3,
  'Basis Trading': 1.3,
  'Restaking': 1.3,
  'Liquid Restaking': 1.3,
  'Interest Rate Derivatives': 1.3,
  'Options Vault': 1.25,
  'Onchain Capital Allocator': 1.2,
  'Yield Aggregator': 1.2,
  'CDP': 1.2,
  'Leveraged Farming': 1.2,
  'Dual-Token Stablecoin': 1.2,
  'Privacy': 1.2,
  'Liquidity Manager': 1.15,
  'Farm': 1.15,
  'CDP Manager': 1.1,
  'Chain': 1.1,
  'RWA': 1.05,
  'Insurance': 1.0,
  'Governance Incentives': 1.0,
  'Stablecoin Wrapper': 0.95,
  'OTC Marketplace': 0.95,
  'Crypto Card Issuer': 0.95,
  'Indexes': 0.95,
  'Liquid Staking': 0.85,
  'CeDeFi': 0.85,
  'Anchor BTC': 0.85,
  'Restaked BTC': 0.85,
  'Decentralized BTC': 0.85,
  'Risk Curators': 0.8,
  'Staking Pool': 0.8,
  'Cross Chain Bridge': 0.45,
  'Payments': 0.4,
  'Canonical Bridge': 0.1,
  'Bridge': 0.08,
};

const TVL_ANCHOR = 50_000_000;
const TVL_EXPONENT = 0.65;
const RATIO_CAP = 1.2;
const SHRINK_PRIOR = 8;
const MULTIPLE_LOW = 0.1;
const MULTIPLE_HIGH = 0.55;
const AIRDROP_SHARE = 0.08;
const WATCHLIST_BOOST = 1.35;
const SIBLING_DISCOUNT = 0.35;
const DAY_MS = 86_400_000;

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[mid - 1]! + ordered[mid]!) / 2
    : ordered[mid]!;
}

function clampTo(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, v));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/** Days between two YYYY-MM-DD dates, at least 1; null when either is unusable. */
function daysBetween(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const end = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(1, Math.round((start - end) / DAY_MS));
}

/** A token field counts as absent when null, empty, or DefiLlama's "-" placeholder. */
function tokenFieldAbsent(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const t = value.trim();
  return t === '' || t === '-';
}

/** A protocol records no token: no symbol, no CoinGecko id, no market cap. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return tokenFieldAbsent(p.symbol) && tokenFieldAbsent(p.gecko_id) &&
    (p.mcap_usd === null || p.mcap_usd === undefined);
}

/** The age weight: the pre-token farming window peaks early and fades. */
function ageWeight(age: number | null): number {
  if (age === null) return 0.78;
  if (age <= 30) return 1.25;
  if (age <= 365) return 1.3;
  if (age <= 540) return 1.15;
  if (age <= 900) return 0.95;
  return 0.7;
}

/** Human-readable age for the row's reasoning line. */
function ageLabel(age: number | null): string {
  return age === null ? 'no listing date' : `${age}d since listing`;
}

/** Human-readable 7-day change for the row's reasoning line. */
function changeLabel(change: number | null): string {
  if (typeof change !== 'number' || !Number.isFinite(change)) return '7d change unreported';
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% over 7d`;
}

/**
 * Score the whole snapshot. The empirical multiples, the chain scores, the
 * sibling prefixes and the market median are all computed here, from this
 * snapshot's own rows, before any protocol is scored.
 */
export function scoreSnapshot(snapshot: SnapshotDoc): ScoreResult {
  const asOfTs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const watchlist = new Set(snapshot.watchlist ?? []);
  const protocols = snapshot.protocols;

  // --- Empirical category multiples from the snapshot's tokenized protocols.
  const allRatios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (typeof p.mcap_usd !== 'number' || !Number.isFinite(p.mcap_usd) || p.mcap_usd <= 0) continue;
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) continue;
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, RATIO_CAP);
    allRatios.push(ratio);
    const list = byCategory.get(p.category ?? '') ?? [];
    list.push(ratio);
    byCategory.set(p.category ?? '', list);
  }
  const globalMedian = allRatios.length > 0 ? medianOf(allRatios) : 0.2138;
  const categoryMultiple = new Map<string, number>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length < 3) {
      categoryMultiple.set(category, globalMedian);
    } else {
      const shrunk = (ratios.length * medianOf(ratios) + SHRINK_PRIOR * globalMedian) / (ratios.length + SHRINK_PRIOR);
      categoryMultiple.set(category, clampTo(shrunk, MULTIPLE_LOW, MULTIPLE_HIGH));
    }
  }

  // --- Chain ecosystem scores, from non-exchange protocols.
  // Each protocol's TVL is split evenly across its chains, so a 10-chain
  // protocol does not count its whole TVL ten times over.
  const chainProtocols = new Map<string, number>();
  const chainFreshPre = new Map<string, number>();
  const chainTvl = new Map<string, number>();
  for (const p of protocols) {
    if (p.category === 'CEX') continue;
    const chains = p.chains.length > 0 ? p.chains : ['Unknown'];
    const share = Math.max(0, Number.isFinite(p.tvl_usd) ? p.tvl_usd : 0) / chains.length;
    const age = daysBetween(snapshot.as_of, p.listed_at);
    const fresh = recordsNoToken(p) && age !== null && age <= 540;
    for (const chain of chains) {
      chainProtocols.set(chain, (chainProtocols.get(chain) ?? 0) + 1);
      chainTvl.set(chain, (chainTvl.get(chain) ?? 0) + share);
      if (fresh) chainFreshPre.set(chain, (chainFreshPre.get(chain) ?? 0) + 1);
    }
  }
  const chainScore = new Map<string, number>();
  for (const [chain, total] of chainProtocols) {
    const freshRate = ((chainFreshPre.get(chain) ?? 0) + 0.5) / (total + 3.0);
    const depth = clampTo((Math.log10(Math.max(chainTvl.get(chain) ?? 1e6, 1e6)) - 6.0) / 4.5, 0, 1);
    chainScore.set(chain, 0.85 + 0.35 * freshRate + 0.15 * depth);
  }

  // --- Sibling-token prefixes from the snapshot's own tokenized protocols.
  const tokenPrefixes = new Set<string>();
  for (const p of protocols) {
    if (tokenFieldAbsent(p.symbol)) continue;
    const prefix = p.slug.split('-')[0]!;
    if (prefix.length >= 3) tokenPrefixes.add(prefix);
  }

  // --- The farmable set: pre-token, not an exchange, positive TVL.
  const candidates = protocols.filter((p) =>
    recordsNoToken(p) && p.category !== 'CEX' &&
    typeof p.tvl_usd === 'number' && Number.isFinite(p.tvl_usd) && p.tvl_usd > 0,
  );
  const marketMedian = medianOf(
    candidates
      .map((p) => p.change_7d)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
  );

  const rows: ScoredRow[] = candidates.map((p) => {
    const chains = p.chains.length > 0 ? p.chains : ['Unknown'];
    const tvlEff = TVL_ANCHOR * Math.pow(p.tvl_usd / TVL_ANCHOR, TVL_EXPONENT);
    const mCat = categoryMultiple.get(p.category ?? '') ?? globalMedian;
    const wCat = CATEGORY_WEIGHT[p.category ?? ''] ?? 1.0;

    let wGrowth = 1.0;
    if (typeof p.change_7d === 'number' && Number.isFinite(p.change_7d)) {
      const relative = clampTo(p.change_7d - marketMedian, -40, 100);
      wGrowth = 1.0 + 0.35 * Math.tanh(relative / 25);
    }

    const age = daysBetween(snapshot.as_of, p.listed_at);
    const wAge = ageWeight(age);

    const bestChain = Math.max(...chains.map((c) => chainScore.get(c) ?? 1.0));
    const breadth = 1 + 0.03 * Math.min(chains.length - 1, 8);
    const wChain = bestChain * breadth;

    const onWatchlist = watchlist.has(p.slug);
    const wWl = onWatchlist ? WATCHLIST_BOOST : 1.0;

    const prefix = p.slug.split('-')[0]!;
    const sibling = tokenPrefixes.has(prefix) && !onWatchlist;
    const wSib = sibling ? SIBLING_DISCOUNT : 1.0;

    const impliedMcap = tvlEff * mCat * wCat * wGrowth * wAge * wChain * wWl * wSib;
    const impliedValue = Math.round(impliedMcap * AIRDROP_SHARE);

    const flags = [onWatchlist ? 'Watchlist' : null, sibling ? 'sibling-token discount' : null]
      .filter((f): f is string => f !== null)
      .join('; ');
    const reasoning = `${flags ? `${flags}; ` : ''}$${(p.tvl_usd / 1e6).toFixed(1)}M TVL on ${chains.length} chain${chains.length > 1 ? 's' : ''} (first ${chains[0]}), ${changeLabel(p.change_7d)}, ${ageLabel(age)}.`;

    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      primary_chain: chains[0]!,
      chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      in_watchlist: onWatchlist,
      sibling_token_risk: sibling,
      implied_mcap_usd: Math.round(impliedMcap),
      implied_value_usd: impliedValue,
      factors: {
        tvl_eff_usd: Math.round(tvlEff),
        m_cat: round4(mCat),
        w_cat: wCat,
        w_growth: round4(wGrowth),
        w_age: wAge,
        w_chain: round4(wChain),
        w_wl: wWl,
        w_sib: wSib,
        airdrop_alloc: AIRDROP_SHARE,
      },
      reasoning,
    };
  });

  rows.sort((a, b) =>
    b.implied_value_usd - a.implied_value_usd ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((row, i) => { row.rank = i + 1; });

  return {
    global_mcap_tvl_median: round4(globalMedian),
    median_change_7d: round4(marketMedian),
    rows,
  };
}

/** Why a board is not one the gate will take, or null when it is clean. */
export function boardIssue(rows: ScoredRow[], snapshot: SnapshotDoc): string | null {
  const seen = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) {
    return `all ${rows.length} rows share implied value $${rows[0]!.implied_value_usd}`;
  }
  for (const r of rows) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}
