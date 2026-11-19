// Token Radar 01 — farm-plan generator.
//
// Every board row gets a concrete plan built only from its own snapshot
// record: category, chains, TVL, 7-day change and listing age. No protocol
// name is ever special-cased, so a future snapshot's new protocols get plans
// from the same code. Each step states what it costs and how long it takes;
// every step is kept inside the gate's 20..600 characters and carries no URL.

import type { ScoredRow } from './scoring.ts';

/** Chains where a small transaction costs cents rather than dollars. */
const CHEAP_CHAINS = new Set([
  'Base', 'Arbitrum', 'Optimism', 'Solana', 'Polygon', 'Monad', 'Ink',
  'Hyperliquid L1', 'Avalanche', 'Binance', 'Sui', 'Aptos', 'Tron',
  'Stellar', 'Sonic', 'Plasma', 'Arc', 'Robinhood Chain',
]);

/** The cheapest chains a protocol runs on, for the setup step's wording. */
function cheapChainsText(chains: string[]): string {
  const cheap = chains.filter((c) => CHEAP_CHAINS.has(c));
  if (cheap.length >= 2) return `${cheap[0]} or ${cheap[1]}`;
  if (cheap.length === 1) return cheap[0]!;
  return chains.slice(0, 2).join(' or ');
}

/** Position size from the protocol's own TVL: bigger pools take bigger tickets. */
function ticketFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 250_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger listings need longer proof. */
function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 30;
  if (ageDays < 90) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

function tvlLabel(tvlUsd: number): string {
  return tvlUsd >= 1e9
    ? `$${(tvlUsd / 1e9).toFixed(2)}B`
    : `$${(tvlUsd / 1e6).toFixed(1)}M`;
}

function changeText(change7d: number | null): string {
  if (typeof change7d !== 'number' || !Number.isFinite(change7d)) return '7d change unreported';
  return `${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}% over 7d`;
}

/** The core action for the protocol's category, in the farmer's own words. */
function coreAction(row: ScoredRow, ticket: number, cheapChain: string): string {
  const category = (row.category ?? '').toLowerCase();
  const name = row.name;
  const tvl = tvlLabel(row.tvl_usd);
  if (category.includes('dex') || category.includes('swap')) {
    return `Run repeat spot swaps on ${name} (${tvl} TVL) and add $${ticket} of paired liquidity to its busiest pool, keeping the position open for weeks so trade count and LP tenure both build. Cost: $${ticket} of capital plus about $5 of gas. Time: 20 minutes to set up.`;
  }
  if (category.includes('lend') || category.includes('collateral')) {
    return `Supply $${ticket} of stablecoin collateral into ${name}'s lending markets (${tvl} TVL, ${changeText(row.change_7d)}) and, if borrowing is open, take a small loan well below the liquidation line so both sides of the book are recorded. Cost: $${ticket} of capital plus about $6 of gas. Time: 20 minutes to set up.`;
  }
  if (category.includes('cdp')) {
    return `Open an overcollateralized vault on ${name} (${tvl} TVL) with $${ticket} of collateral and mint debt at a conservative ratio, then put the minted asset to work in a pool on ${cheapChain} instead of leaving it idle. Cost: $${ticket} of capital plus about $6 of gas. Time: 20 minutes to set up.`;
  }
  if (category.includes('deriv') || category.includes('perpetual') || category.includes('options vault')) {
    return `Post $${ticket} of USDC as margin on ${name} (${tvl} TVL) and place small hedged trades across several sessions, rather than one large trade, so volume accrues steadily. Cost: $${ticket} of margin plus about $5 of gas. Time: 15 minutes a session.`;
  }
  if (category.includes('basis')) {
    return `Deposit $${ticket} into ${name}'s delta-neutral basis vault (${tvl} TVL) to earn funding-rate yield while the deposit's age accrues, and leave it through several funding cycles. Cost: $${ticket} of capital plus about $5 of gas. Time: 15 minutes to set up.`;
  }
  if (category.includes('rwa')) {
    return `Finish any onboarding or eligibility check ${name} requires, then deposit $${ticket} into its real-world-asset vault (${tvl} TVL, ${changeText(row.change_7d)}) and hold through full accrual periods. Cost: $${ticket} of capital plus about $5 of gas. Time: 30 minutes including checks.`;
  }
  if (category.includes('bridge')) {
    return `Move $${ticket} through ${name} only when you already need assets on the destination chain (${tvl} TVL), then deploy the bridged funds into a live pre-token app there instead of leaving them idle. Cost: $${ticket} moved plus bridge and gas fees of about $8. Time: 15 minutes.`;
  }
  if (category.includes('curator') || category.includes('allocator')) {
    return `Deposit $${ticket} into an active ${name} curated vault on ${cheapChain} (${tvl} TVL, ${changeText(row.change_7d)}) and keep the vault shares across several epochs so duration-weighted activity builds. Cost: $${ticket} of capital plus about $4 of gas. Time: 15 minutes to set up.`;
  }
  if (category.includes('restak') || category.includes('staking')) {
    return `Stake $${ticket} of the chain's staking asset through ${name} (${tvl} TVL) and keep the receipt token, checking unbonding times before you commit. Cost: $${ticket} staked plus about $4 of gas. Time: 15 minutes to set up.`;
  }
  if (category.includes('stable')) {
    return `Mint or wrap $${ticket} of the stable asset through ${name} on ${cheapChain} (${tvl} TVL) and hold it, or supply it to a lending market on the same chain. Cost: $${ticket} of capital plus about $4 of gas. Time: 15 minutes to set up.`;
  }
  if (category.includes('yield') || category.includes('farm') || category.includes('leveraged')) {
    return `Deposit $${ticket} into an automated ${name} yield vault (${tvl} TVL, ${changeText(row.change_7d)}) and let it compound for weeks instead of reallocating, so time-weighted TVL does the work. Cost: $${ticket} of capital plus about $4 of gas. Time: 15 minutes to set up.`;
  }
  if (category.includes('prediction')) {
    return `Fund $${ticket} on ${name} (${tvl} TVL) and take small positions across several markets over a few weeks, keeping stakes modest and varied. Cost: $${ticket} of capital plus about $4 of gas. Time: 10 minutes a market.`;
  }
  if (category.includes('insurance')) {
    return `Buy $${ticket} of cover from ${name} on ${cheapChain} (${tvl} TVL) and keep the policy live for the full term, so the position is a real one rather than a flash deposit. Cost: $${ticket} of premium plus about $4 of gas. Time: 15 minutes to set up.`;
  }
  return `Deposit $${ticket} into an active ${name} ${row.category ?? 'protocol'} vault or pool on ${cheapChain} (${tvl} TVL, ${changeText(row.change_7d)}) and hold the receipt across several epochs. Cost: $${ticket} of capital plus about $4 of gas. Time: 15 minutes to set up.`;
}

/** The risk line for the protocol: what can actually go wrong with this one. */
function riskLine(row: ScoredRow): string {
  const warnings: string[] = [];
  const category = (row.category ?? '').toLowerCase();
  if (category.includes('curator')) {
    warnings.push('Curators earn fees and may never issue their own token, and their vaults inherit bad-debt risk from the lending markets underneath.');
  }
  if (category.includes('rwa')) {
    warnings.push('Real-world-asset products can require KYC, restrict some regions, and settle redemptions slowly off-chain.');
  }
  if (category.includes('bridge')) {
    warnings.push('Bridges are plumbing with low standalone airdrop odds: never pay bridge fees purely to farm one.');
  }
  if (row.sibling_token_risk) {
    warnings.push('A sibling protocol in this snapshot already carries a token, so a standalone launch here is less likely.');
  }
  if (row.age_days !== null && row.age_days < 90) {
    warnings.push(`Listed only ${row.age_days} days ago, so treat the contracts as early-stage and size the position small.`);
  }
  if (typeof row.change_7d === 'number' && row.change_7d <= -10) {
    warnings.push(`TVL fell ${row.change_7d.toFixed(1)}% in the last 7 days: check withdrawal liquidity before adding size.`);
  }
  if (warnings.length === 0) {
    warnings.push('No token launch is guaranteed: size for smart-contract risk, liquidity risk, and the opportunity cost of locked capital.');
  }
  return `Risk: ${warnings.join(' ')}`;
}

export interface FarmPlan {
  farm_steps: string[];
  risk_warning: string;
}

/** Five steps for one row: setup, core action, weekly habit, hold, risk. */
export function farmPlanFor(row: ScoredRow): FarmPlan {
  const cheapChain = cheapChainsText(row.chains);
  const ticket = ticketFor(row.tvl_usd);
  const holdDays = holdDaysFor(row.age_days);
  const gasHint = row.chains.includes('Ethereum') && row.chains.length > 1
    ? `use ${cheapChain} for small tickets to dodge Ethereum mainnet gas, or mainnet for larger ones`
    : `use ${cheapChain}, where gas is cents per transaction`;

  const setup = row.chains.length > 1
    ? `Set up a fresh wallet holding only the funds you plan to farm, fund it on ${cheapChain} (${row.chains.length} chains supported), and keep the seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`
    : `Set up a fresh wallet holding only the funds you plan to farm, fund it with native gas plus deposit assets on ${cheapChain}, and keep the seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`;

  const weekly = row.chains.length >= 2
    ? `Repeat one real action each week — a deposit, a swap, a borrow or a rebalance — and split it across two of ${row.name}'s chains (${row.chains.slice(0, 3).join(', ')}) so activity shows on more than one network. Cost: about $2 of gas a week. Time: 10 minutes a week.`
    : `Repeat one real action each week — a deposit, a swap or a rebalance — rather than parking a single deposit and forgetting it, so the wallet's activity reads as genuine. Cost: about $2 of gas a week. Time: 10 minutes a week.`;

  const hold = `Hold the position for at least ${holdDays} days (${gasHint}) so the activity is counted across more than one snapshot instead of a single week. Cost: the $${ticket} stays locked in the position. Time: ${holdDays} days.`;

  const steps = [
    setup,
    coreAction(row, ticket, cheapChain),
    weekly,
    hold,
    riskLine(row),
  ].map((s) => (s.length > 600 ? `${s.slice(0, 597)}...` : s));

  for (const s of steps) {
    if (s.length < 20 || s.length > 600) {
      throw new Error(`farm step for ${row.slug} is ${s.length} characters`);
    }
    if (/https?:\/\//.test(s)) throw new Error(`farm step for ${row.slug} carries a URL`);
  }
  return { farm_steps: steps, risk_warning: steps[4]! };
}
