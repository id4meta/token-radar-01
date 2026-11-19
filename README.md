# Token Radar 01

Which protocol with no token yet is worth farming next — and what to do about it.

The program reads a frozen DefiLlama snapshot (`/input/snapshot.json`), scores
every protocol that records no token, and writes a dashboard that ranks them by
an implied airdrop-pool value, each with a concrete farm plan.

## The model

```
implied value = 8% × TVL_eff × M_cat × W_cat × W_growth × W_age × W_chain × W_wl × W_sib
```

- **TVL_eff** — TVL compressed sub-linearly, `50M × (TVL / 50M)^0.65`, anchored
  at the watchlist floor so multi-billion passive pools do not drown out
  early protocols.
- **M_cat** — the median market-cap/TVL of the snapshot's own tokenized
  protocols in the same category, shrunk toward the global median.
- **W_cat** — how often the category launches a token: native DeFi first,
  bridges and wrapped products last.
- **W_growth** — 7-day TVL change measured against the pre-token median,
  winsorized.
- **W_age** — the farming window peaks 1–12 months after listing and fades
  past 900 days with no token.
- **W_chain** — freshness and depth of the protocol's best chain, plus a
  small multi-chain bonus.
- **W_wl / W_sib** — 1.35× when the snapshot's watchlist names the protocol;
  0.35× when it looks like a sibling product of a protocol whose token
  already trades.

Nothing here names a protocol: every weight is computed from the snapshot at
run time, so the same program scores a future snapshot's new protocols
without any change. A protocol "records no token" in the snapshot — that is
the record, not proof it has none.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Node 22 or later, standard library only. Writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` (built by the kit's
`vendor/makefun-board.ts`) into the output directory. Two runs on the same
snapshot write the same bytes.

## Layout

- `main.ts` — entry point: reads the snapshot, writes the outputs.
- `src/scoring.ts` — the scoring engine.
- `src/farm.ts` — the farm-plan generator (one plan per row, from the row's
  own record).
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`. No
  network at runtime; the data arrives as `data.js` beside the page.
- `screenshots/` — the board, a protocol detail view, and a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library, copied byte for byte.

## License

MIT — see `LICENSE`.
