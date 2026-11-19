/* Token Radar 01 — dashboard logic. No network: the data arrives in data.js
   as window.__RADAR_DATA__, and every view here is computed from it. */

(function () {
  'use strict';

  var DATA = window.__RADAR_DATA__ || { meta: {}, rows: [] };
  var META = DATA.meta || {};
  var ROWS = DATA.rows || [];
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });

  /* ---------- small helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function moneyShort(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(n / 1e3) + 'K';
  }

  function signedPct(v) {
    if (typeof v !== 'number' || !isFinite(v)) return 'N/A';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function ageText(days) {
    if (days === null || days === undefined) return 'N/A';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function medianOf(values) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }

  /* ---------- state ---------- */

  var state = {
    q: '',
    chain: '',
    category: '',
    minTvl: null,
    maxTvl: null,
    watchlistOnly: false,
    hideSib: false,
    sortKey: 'implied_value_usd',
    sortDir: -1,
    selected: null,
  };

  var params = new URLSearchParams(window.location.search || '');
  if (params.get('wl') === '1') state.watchlistOnly = true;
  if (params.get('chain')) state.chain = params.get('chain');
  if (params.get('category')) state.category = params.get('category');
  if (params.get('q')) state.q = params.get('q');

  /* ---------- filtering and sorting ---------- */

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return ROWS.filter(function (r) {
      if (state.watchlistOnly && !r.in_watchlist) return false;
      if (state.hideSib && r.sibling_token_risk) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.category && (r.category || '') !== state.category) return false;
      if (state.minTvl !== null && r.tvl_usd < state.minTvl) return false;
      if (state.maxTvl !== null && r.tvl_usd > state.maxTvl) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function cmpValue(a, b, key) {
    var va = a[key];
    var vb = b[key];
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'string') return va < vb ? -1 : va > vb ? 1 : 0;
    return va - vb;
  }

  function sortedRows(rows) {
    var dir = state.sortDir;
    var key = state.sortKey;
    return rows.slice().sort(function (a, b) {
      var c = cmpValue(a, b, key);
      if (c === 0) c = a.slug < b.slug ? -1 : 1;
      return c * dir;
    });
  }

  /* ---------- rendering ---------- */

  function renderKpis(rows) {
    var pool = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var wl = rows.filter(function (r) { return r.in_watchlist; }).length;
    var ch7 = medianOf(rows.map(function (r) { return r.change_7d; }).filter(function (v) { return typeof v === 'number'; }));
    $('kpi-count').textContent = rows.length + ' / ' + ROWS.length;
    $('kpi-count-sub').textContent = ROWS.length + ' pre-token protocols on the board';
    $('kpi-pool').textContent = money(pool);
    $('kpi-wl').textContent = wl + ' / ' + (META.watchlist_size || 0);
    $('kpi-wl-sub').textContent = (META.watchlist_size || 0) + ' on the snapshot watchlist';
    $('kpi-ch7').textContent = ch7 === null ? 'N/A' : signedPct(ch7);
    $('row-count').textContent = rows.length + ' protocol' + (rows.length === 1 ? '' : 's') +
      ' · sorted by ' + sortLabel() + ' · click a row for its detail and farm plan';
  }

  function sortLabel() {
    var labels = {
      rank: 'rank', name: 'name', primary_chain: 'chain', category: 'category',
      tvl_usd: 'TVL', change_7d: '7d change', age_days: 'age',
      implied_value_usd: 'implied value',
    };
    return (labels[state.sortKey] || state.sortKey) + (state.sortDir < 0 ? ' ↓' : ' ↑');
  }

  function renderTable(rows) {
    var maxValue = ROWS.length ? ROWS[0].implied_value_usd : 1;
    var html = rows.map(function (r) {
      var ch7 = signedPct(r.change_7d);
      var ch7Class = typeof r.change_7d === 'number' ? (r.change_7d > 0 ? 'pos' : (r.change_7d < -5.5 ? 'neg' : '')) : '';
      var chainHtml = '<span class="chain-pill">' + esc(r.primary_chain) + '</span>' +
        (r.chains.length > 1 ? '<span class="chain-pill">+' + (r.chains.length - 1) + '</span>' : '');
      var badges = (r.in_watchlist ? '<span class="badge-wl" title="On the snapshot watchlist">WL</span>' : '') +
        (r.sibling_token_risk ? '<span class="badge-sib" title="Looks like a sibling product of a token that already trades">SIB</span>' : '');
      var width = Math.max(2, Math.round((r.implied_value_usd / maxValue) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" class="' + (state.selected === r.slug ? 'selected' : '') + '">' +
        '<td class="rank">#' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badges +
        '<span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td title="' + esc(r.chains.join(', ')) + '">' + chainHtml + '</td>' +
        '<td class="cat-tag">' + esc(r.category || '—') + '</td>' +
        '<td>' + moneyShort(r.tvl_usd) + '</td>' +
        '<td class="' + ch7Class + '">' + ch7 + '</td>' +
        '<td>' + ageText(r.age_days) + '</td>' +
        '<td class="value">' + money(r.implied_value_usd) +
        '<span class="value-bar"><i style="width:' + width + '%"></i></span></td>' +
        '</tr>';
    }).join('');
    $('rows').innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
  }

  function renderChips() {
    var chips = [];
    if (state.q) chips.push(['Search: ' + state.q, 'q']);
    if (state.chain) chips.push(['Chain: ' + state.chain, 'chain']);
    if (state.category) chips.push(['Category: ' + state.category, 'category']);
    if (state.minTvl !== null) chips.push(['TVL ≥ ' + moneyShort(state.minTvl), 'minTvl']);
    if (state.maxTvl !== null) chips.push(['TVL ≤ ' + moneyShort(state.maxTvl), 'maxTvl']);
    if (state.watchlistOnly) chips.push(['Watchlist only', 'watchlistOnly']);
    if (state.hideSib) chips.push(['Sibling flags hidden', 'hideSib']);
    $('chips').innerHTML = chips.map(function (c) {
      return '<span class="chip">' + esc(c[0]) + '<button type="button" data-clear="' + c[1] + '" aria-label="Clear ' + esc(c[0]) + '">×</button></span>';
    }).join('');
  }

  function render() {
    var rows = sortedRows(filteredRows());
    renderKpis(rows);
    renderTable(rows);
    renderChips();
    document.querySelectorAll('#board thead th').forEach(function (th) {
      var key = th.getAttribute('data-sort');
      th.setAttribute('aria-sort', key === state.sortKey ? (state.sortDir < 0 ? 'descending' : 'ascending') : 'none');
    });
  }

  /* ---------- detail drawer ---------- */

  var FACTOR_ROWS = [
    ['TVL_eff', 'tvl_eff_usd', 'Sub-linear TVL: 50M × (TVL / 50M)^0.65, in USD.'],
    ['M_cat', 'm_cat', 'Median market-cap / TVL of the snapshot\u2019s own tokenized peers in this category.'],
    ['W_cat', 'w_cat', 'How often this category launches a token.'],
    ['W_growth', 'w_growth', '7-day TVL change vs the pre-token median of ' + signedPct(META.median_change_7d) + '.'],
    ['W_age', 'w_age', 'Where the protocol sits in its pre-token life.'],
    ['W_chain', 'w_chain', 'Freshness and depth of its best chain, plus a multi-chain bonus.'],
    ['W_wl', 'w_wl', '1.35 when the snapshot\u2019s watchlist names it, else 1.00.'],
    ['W_sib', 'w_sib', '0.35 when it looks like a sibling of a token that already trades.'],
  ];

  function factorBar(value, max) {
    var pct = Math.max(2, Math.min(100, Math.round((value / max) * 100)));
    return '<span class="fbar"><i style="width:' + pct + '%"></i></span>';
  }

  function openDetail(slug) {
    var r = BY_SLUG[slug];
    if (!r) return;
    state.selected = slug;
    var f = r.factors;
    var factorHtml = FACTOR_ROWS.map(function (row) {
      var key = row[1];
      var value = key === 'tvl_eff_usd' ? f.tvl_eff_usd : f[key];
      var display = key === 'tvl_eff_usd' ? moneyShort(value) : Number(value).toFixed(2);
      var max = key === 'tvl_eff_usd' ? 1500000000 : (key === 'm_cat' ? 0.55 : 1.4);
      return '<div class="factor"><span class="fname">' + row[0] + '</span>' +
        factorBar(value, max) + '<span class="fval">' + display + '</span>' +
        '<span class="fdesc">' + esc(row[2]) + '</span></div>';
    }).join('');
    var stepsHtml = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('drawer-body').innerHTML =
      '<h2 id="d-name">' + esc(r.name) + '</h2>' +
      '<div class="dslug">' + esc(r.slug) + ' · rank #' + r.rank +
      (r.in_watchlist ? ' <span class="badge-wl">WL</span>' : '') +
      (r.sibling_token_risk ? ' <span class="badge-sib">SIB</span>' : '') + '</div>' +
      '<p class="reasoning">' + esc(r.reasoning) + ' Implied airdrop pool: <strong>' + money(r.implied_value_usd) +
      '</strong> (implied token market cap ' + money(r.implied_mcap_usd) + ' at an 8% airdrop share).</p>' +
      '<div class="dstats">' +
      '<div class="dstat"><span>Category</span><b>' + esc(r.category || '—') + '</b></div>' +
      '<div class="dstat"><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div class="dstat"><span>7d change</span><b>' + signedPct(r.change_7d) + '</b></div>' +
      '<div class="dstat"><span>Age</span><b>' + ageText(r.age_days) + '</b></div>' +
      '</div>' +
      '<div class="dsection"><h3>Chains</h3><p>' +
      r.chains.map(function (c) { return '<span class="chain-pill">' + esc(c) + '</span>'; }).join(' ') + '</p></div>' +
      '<div class="dsection"><h3>Why this value — the eight multipliers</h3>' + factorHtml + '</div>' +
      '<div class="dsection"><h3>How to farm it</h3><ol class="steps">' + stepsHtml + '</ol></div>' +
      '<div class="dsection"><div class="risk">' + esc(r.risk_warning) + '</div></div>';
    $('drawer').hidden = false;
    renderTable(sortedRows(filteredRows()));
  }

  function closeDetail() {
    state.selected = null;
    $('drawer').hidden = true;
    renderTable(sortedRows(filteredRows()));
  }

  /* ---------- wiring ---------- */

  function fillSelects() {
    var chainCounts = {};
    var categories = {};
    ROWS.forEach(function (r) {
      r.chains.forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; });
      categories[r.category || '—'] = true;
    });
    var chainSel = $('f-chain');
    Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c + ' (' + chainCounts[c] + ')';
      chainSel.appendChild(o);
    });
    var catSel = $('f-category');
    Object.keys(categories).sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c === '—' ? '' : c; o.textContent = c;
      catSel.appendChild(o);
    });
  }

  function readControls() {
    state.q = $('f-search').value;
    state.chain = $('f-chain').value;
    state.category = $('f-category').value;
    state.minTvl = $('f-min-tvl').value ? Number($('f-min-tvl').value) : null;
    state.maxTvl = $('f-max-tvl').value ? Number($('f-max-tvl').value) : null;
    state.watchlistOnly = $('f-watchlist').checked;
    state.hideSib = $('f-hide-sib').checked;
  }

  function syncControls() {
    $('f-search').value = state.q;
    $('f-chain').value = state.chain;
    $('f-category').value = state.category;
    $('f-min-tvl').value = state.minTvl === null ? '' : String(state.minTvl);
    $('f-max-tvl').value = state.maxTvl === null ? '' : String(state.maxTvl);
    $('f-watchlist').checked = state.watchlistOnly;
    $('f-hide-sib').checked = state.hideSib;
  }

  ['f-search', 'f-chain', 'f-category', 'f-min-tvl', 'f-max-tvl', 'f-watchlist', 'f-hide-sib'].forEach(function (id) {
    $(id).addEventListener('input', function () { readControls(); render(); });
    $(id).addEventListener('change', function () { readControls(); render(); });
  });

  $('f-reset').addEventListener('click', function () {
    state.q = ''; state.chain = ''; state.category = '';
    state.minTvl = null; state.maxTvl = null;
    state.watchlistOnly = false; state.hideSib = false;
    syncControls(); render();
  });

  $('chips').addEventListener('click', function (e) {
    var key = e.target && e.target.getAttribute ? e.target.getAttribute('data-clear') : null;
    if (!key) return;
    if (key === 'q') state.q = '';
    if (key === 'chain') state.chain = '';
    if (key === 'category') state.category = '';
    if (key === 'minTvl') state.minTvl = null;
    if (key === 'maxTvl') state.maxTvl = null;
    if (key === 'watchlistOnly') state.watchlistOnly = false;
    if (key === 'hideSib') state.hideSib = false;
    syncControls(); render();
  });

  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sortKey === key) { state.sortDir = -state.sortDir; }
      else { state.sortKey = key; state.sortDir = key === 'name' || key === 'category' || key === 'primary_chain' ? 1 : -1; }
      render();
    });
  });

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  $('rows').addEventListener('keydown', function (e) {
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (!tr) return;
    if (e.key === 'Enter') { openDetail(tr.getAttribute('data-slug')); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var next = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
      if (next && next.focus) next.focus();
    }
  });

  $('drawer-close').addEventListener('click', closeDetail);
  $('drawer-backdrop').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('drawer').hidden) closeDetail();
  });

  /* ---------- boot ---------- */

  $('badge-date').textContent = 'Snapshot ' + (META.as_of || '—');
  $('foot-date').textContent = META.as_of || '2026-11-14';
  fillSelects();
  syncControls();
  render();
  var detailSlug = params.get('detail');
  if (detailSlug && BY_SLUG[detailSlug]) openDetail(detailSlug);
})();
