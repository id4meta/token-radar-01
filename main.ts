// Token Radar 01 — entry point.
//
// Reads the sealed snapshot at /input/snapshot.json (or --input <file|dir>),
// scores every pre-token protocol with src/scoring.ts, attaches a farm plan
// to each row with src/farm.ts, and writes the entry's outputs:
//
//   /output/board.json     the ranked board (300 rows on this snapshot)
//   /output/data.js        the dashboard's dataset, beside the page
//   /output/dashboard/    a copy of this repository's dashboard/
//   /output/screenshots/  a copy of this repository's screenshots/
//   /output/dossier.json  what the judge reads, built only by the kit's
//                          vendor/makefun-board.ts buildDossier()
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Standard library only. Two runs on the same snapshot write the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, recordsNoToken, scoreSnapshot } from './src/scoring.ts';
import type { ScoredRow, SnapshotDoc } from './src/scoring.ts';
import { farmPlanFor } from './src/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** The snapshot out of a file's text, refused unless it is the shape we score. */
function parseSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const scored = scoreSnapshot(snapshot);

/** A board row: the scored row plus its farm plan. */
interface BoardRow extends ScoredRow {
  farm_steps: string[];
  risk_warning: string;
}

const board: BoardRow[] = scored.rows.map((row) => {
  const plan = farmPlanFor(row);
  return { ...row, farm_steps: plan.farm_steps, risk_warning: plan.risk_warning };
});

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
for (const row of board) {
  const steps = row.farm_steps;
  if (steps.length < 3 || steps.length > 12) {
    process.stderr.write(`token radar: ${row.slug} has ${steps.length} farm steps\n`);
    process.exit(1);
  }
  for (const s of steps) {
    if (s.trim().length < 20 || s.trim().length > 600) {
      process.stderr.write(`token radar: ${row.slug} has a farm step of ${s.trim().length} characters\n`);
      process.exit(1);
    }
    if (/https?:\/\//.test(s)) {
      process.stderr.write(`token radar: ${row.slug} has a farm step carrying a URL\n`);
      process.exit(1);
    }
  }
}

const preTokenCount = snapshot.protocols.filter((p) => recordsNoToken(p) && p.category !== 'CEX').length;
const totalPool = board.reduce((sum, r) => sum + r.implied_value_usd, 0);

const boardDoc = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  total_protocols: snapshot.protocols.length,
  pre_token_count: preTokenCount,
  watchlist_size: snapshot.watchlist.length,
  median_change_7d: scored.median_change_7d,
  global_mcap_tvl_median: scored.global_mcap_tvl_median,
  total_implied_pool_usd: totalPool,
  rows: board,
};

const radarData = {
  meta: {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: 'radar-2',
    model_note: 'Implied value = 0.08 * TVL_eff * M_cat * W_cat * W_growth * W_age * W_chain * W_wl * W_sib, all computed from this snapshot. TVL_eff = 50M * (tvl/50M)^0.65. M_cat is the median mcap/TVL of the snapshot\'s own tokenized peers per category, shrunk toward the global median. No protocol name is special-cased.',
    global_mcap_tvl_median: scored.global_mcap_tvl_median,
    median_change_7d: scored.median_change_7d,
    total_protocols: snapshot.protocols.length,
    pre_token_count: preTokenCount,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    total_implied_pool_usd: totalPool,
  },
  rows: board,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify(boardDoc)}\n`);
writeFileSync(join(out, 'data.js'), `window.__RADAR_DATA__ = ${JSON.stringify(radarData)};\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored\n` +
    `token radar: top row ${board[0]!.slug} at $${board[0]!.implied_value_usd.toLocaleString('en-US')}, total implied pool $${totalPool.toLocaleString('en-US')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
