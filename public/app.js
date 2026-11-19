"use strict";

const state = {
  competitions: [],
  competitionId: "PL",
  currentSeason: null,
  season: null,
  matches: [],
  forecasts: {},
  status: "upcoming",
  search: "",
  selectedId: "",
  analysis: new Map(),
  standings: new Map(),
  backtest: new Map(),
  history: new Map(),
  view: "matches",
  backtestRows: 60,
  backtestFilter: "all",
  loadToken: 0,
};

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const RESULT_ZH = { home: "主胜", draw: "平局", away: "客胜" };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  try {
    const payload = await fetchJson("/api/competitions");
    state.competitions = payload.competitions || [];
    state.currentSeason = payload.currentSeason;
    state.season = payload.currentSeason;
    const saved = safeStorage("league");
    if (saved && state.competitions.some((c) => c.id === saved)) state.competitionId = saved;
    renderLeagueTabs();
    renderSeasonOptions();
    renderBacktestSeasons();
    setConnection("online");
    await loadLeague();
    loadHitRateStrip();
  } catch (error) {
    setConnection("error");
    $("matchList").innerHTML = `<div class="rail-empty">无法连接本地分析服务：${esc(error.message)}</div>`;
  }
}

function bindEvents() {
  $("refreshBtn").addEventListener("click", () => refreshAll());
  $("seasonSelect").addEventListener("change", (event) => {
    state.season = Number(event.target.value);
    state.selectedId = "";
    loadLeague();
    loadHitRateStrip();
  });
  $("matchFilter").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderMatchList();
  });
  $("statusFilter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) return;
    state.status = button.dataset.status;
    [...$("statusFilter").children].forEach((child) => child.classList.toggle("active", child === button));
    renderMatchList();
  });
  document.querySelectorAll(".view-tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  $("backtestScope").addEventListener("change", () => loadBacktest());
  $("backtestSeason").addEventListener("change", () => loadBacktest());
  $("historyScope").addEventListener("change", () => loadHistory());
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((section) => section.classList.toggle("active", section.id === `${view}View`));
  if (view === "standings") loadStandings();
  if (view === "backtest") loadBacktest();
  if (view === "history") loadHistory();
}

async function refreshAll() {
  const button = $("refreshBtn");
  button.classList.add("spinning");
  state.analysis.clear();
  state.standings.clear();
  state.history.clear();
  try {
    await loadLeague({ force: true });
    loadHitRateStrip();
    if (state.view !== "matches") switchView(state.view);
    toast("数据已刷新");
  } finally {
    button.classList.remove("spinning");
  }
}

function renderLeagueTabs() {
  $("leagueTabs").innerHTML = state.competitions
    .map((c) => `<button class="league-tab ${c.id === state.competitionId ? "active" : ""}" data-id="${c.id}">${esc(c.nameZh)}</button>`)
    .join("");
  $("leagueTabs").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.id === state.competitionId) return;
    state.competitionId = button.dataset.id;
    safeStorage("league", state.competitionId);
    state.selectedId = "";
    renderLeagueTabs();
    loadLeague();
    if (state.view !== "matches") switchView(state.view);
  }));
}

function renderSeasonOptions() {
  const seasons = Array.from({ length: 5 }, (_, i) => state.currentSeason - i);
  $("seasonSelect").innerHTML = seasons.map((s) => `<option value="${s}" ${s === state.season ? "selected" : ""}>${seasonLabel(s)}</option>`).join("");
}

function renderBacktestSeasons() {
  const seasons = Array.from({ length: 4 }, (_, i) => state.currentSeason - i);
  $("backtestSeason").innerHTML = seasons.map((s, i) => `<option value="${s}" ${i === 1 ? "selected" : ""}>${seasonLabel(s)}${s === state.currentSeason ? "（进行中）" : ""}</option>`).join("");
}

// ---------------- matches ----------------

async function loadLeague({ force = false } = {}) {
  const token = ++state.loadToken;
  $("matchList").innerHTML = `<div class="rail-empty"><div class="loading-bar"></div><p>正在加载赛程…</p></div>`;
  const query = `competition=${state.competitionId}&season=${state.season}${force ? "&force=1" : ""}`;
  try {
    const payload = await fetchJson(`/api/matches?${query}`);
    if (token !== state.loadToken) return;
    state.matches = payload.matches || [];
    state.forecasts = {};
    setConnection(payload.warning ? "online" : "online");
    if (state.season !== state.currentSeason && state.status === "upcoming") setStatus("finished");
    renderMatchList();
    autoSelect();
    fetchJson(`/api/forecasts?competition=${state.competitionId}&season=${state.season}`)
      .then((result) => {
        if (token !== state.loadToken) return;
        state.forecasts = result.items || {};
        renderMatchList();
      })
      .catch(() => {});
  } catch (error) {
    if (token !== state.loadToken) return;
    setConnection("error");
    $("matchList").innerHTML = `<div class="rail-empty">赛程加载失败：${esc(error.message)}</div>`;
  }
}

function setStatus(status) {
  state.status = status;
  [...$("statusFilter").children].forEach((child) => child.classList.toggle("active", child.dataset.status === status));
}

function filteredMatches() {
  let list = state.matches;
  if (state.status === "upcoming") list = list.filter((m) => !m.finished && m.status !== "CANCELLED");
  if (state.status === "finished") list = list.filter((m) => m.finished).slice().reverse();
  if (state.search) {
    list = list.filter((m) => [m.home?.displayName, m.home?.name, m.away?.displayName, m.away?.name, m.dateInfo?.date]
      .some((value) => String(value || "").toLowerCase().includes(state.search)));
  }
  return list;
}

function renderMatchList() {
  const list = filteredMatches();
  if (!list.length) {
    $("matchList").innerHTML = `<div class="rail-empty">${state.matches.length ? "没有符合条件的比赛" : "暂无赛程"}</div>`;
    return;
  }
  const limited = list.slice(0, 160);
  let lastDay = "";
  const html = [];
  for (const match of limited) {
    const day = beijingDate(match);
    if (day !== lastDay) {
      html.push(`<div class="day-head">${esc(dayLabel(day))}</div>`);
      lastDay = day;
    }
    html.push(matchItem(match));
  }
  if (list.length > limited.length) html.push(`<div class="rail-empty">还有 ${list.length - limited.length} 场，请用搜索缩小范围</div>`);
  $("matchList").innerHTML = html.join("");
  $("matchList").querySelectorAll(".match-item").forEach((item) => item.addEventListener("click", () => selectMatch(item.dataset.id)));
}

function matchItem(match) {
  const f = state.forecasts[match.id];
  const finished = match.finished;
  const live = match.status === "LIVE";
  const hs = match.score?.home;
  const as = match.score?.away;
  const homeWin = finished && hs > as;
  const awayWin = finished && as > hs;
  let side = "";
  if (finished || live) {
    side = `<span class="match-score">${hs ?? "-"} : ${as ?? "-"}</span>`;
    if (f) {
      const actual = hs > as ? "home" : hs < as ? "away" : "draw";
      side += `<span class="chip ${f.pick === actual ? "good" : ""}" title="赛前首选：${RESULT_ZH[f.pick]}">${f.pick === actual ? "命中" : RESULT_ZH[f.pick]}</span>`;
    }
  } else if (f) {
    const p = f.probabilities;
    side = `<div class="mini-bar" title="主胜 ${pct(p.home)} / 平 ${pct(p.draw)} / 客胜 ${pct(p.away)}"><i style="width:${p.home * 100}%;background:var(--home)"></i><i style="width:${p.draw * 100}%;background:var(--draw)"></i><i style="width:${p.away * 100}%;background:var(--away)"></i></div>
      <span class="mini-pick"><b>${esc(f.score)}</b> · ${RESULT_ZH[f.pick]} ${pct(f.probabilities[f.pick], 0)}</span>`;
  } else {
    side = `<span class="mini-pick">${esc(statusZh(match.status))}</span>`;
  }
  return `<button class="match-item ${match.id === state.selectedId ? "active" : ""}" data-id="${esc(match.id)}">
    <span class="match-time ${live ? "live" : ""}">${live ? "进行中" : esc(beijingTime(match))}</span>
    <span class="match-teams">
      <span class="team-line ${homeWin ? "winner" : ""}">${crest(match.home)}<span>${esc(teamName(match.home))}</span>${f?.ranks?.home ? `<small>#${f.ranks.home}</small>` : ""}</span>
      <span class="team-line ${awayWin ? "winner" : ""}">${crest(match.away)}<span>${esc(teamName(match.away))}</span>${f?.ranks?.away ? `<small>#${f.ranks.away}</small>` : ""}</span>
    </span>
    <span class="match-side">${side}</span>
  </button>`;
}

function autoSelect() {
  if (state.selectedId && state.matches.some((m) => m.id === state.selectedId)) return;
  const list = filteredMatches();
  if (list[0]) selectMatch(list[0].id);
  else $("detail").innerHTML = `<div class="empty-detail">选择左侧一场比赛查看预测</div>`;
}

async function selectMatch(id) {
  state.selectedId = id;
  document.querySelectorAll(".match-item").forEach((item) => item.classList.toggle("active", item.dataset.id === id));
  const match = state.matches.find((m) => m.id === id);
  if (!match) return;
  const cached = state.analysis.get(id);
  if (cached) {
    renderDetail(cached.payload, { deepLoading: !cached.deep });
    if (!cached.deep && !cached.deepPending) loadDeep(match);
    return;
  }
  renderDetailLoading(match);
  const base = `competition=${match.competitionId}&season=${match.season}&matchId=${encodeURIComponent(id)}`;
  try {
    const payload = await fetchJson(`/api/analyze?${base}&quick=1`);
    state.analysis.set(id, { payload, deep: false });
    if (state.selectedId === id) renderDetail(payload, { deepLoading: !match.finished });
    if (!match.finished) loadDeep(match);
  } catch (error) {
    if (state.selectedId === id) $("detail").innerHTML = `<div class="card state-box">分析失败：${esc(error.message)}</div>`;
  }
}

async function loadDeep(match) {
  const entry = state.analysis.get(match.id);
  if (entry) entry.deepPending = true;
  const base = `competition=${match.competitionId}&season=${match.season}&matchId=${encodeURIComponent(match.id)}`;
  try {
    const payload = await fetchJson(`/api/analyze?${base}&depth=balanced`);
    state.analysis.set(match.id, { payload, deep: true });
    if (state.selectedId === match.id) renderDetail(payload, { deepLoading: false });
  } catch {
    if (entry) entry.deepPending = false;
    if (state.selectedId === match.id && entry) renderDetail(entry.payload, { deepLoading: false });
  }
}

function renderDetailLoading(match) {
  $("detail").innerHTML = `${heroCard(match, null)}
    <div class="card"><div class="loading-bar"></div><p class="muted" style="margin:12px 0 0">正在拟合球队评级并计算概率…</p></div>
    <div class="grid-3"><div class="card skeleton" style="height:220px"></div><div class="card skeleton" style="height:220px"></div><div class="card skeleton" style="height:220px"></div></div>`;
}

function renderDetail(payload, { deepLoading = false } = {}) {
  const match = payload.match;
  const f = payload.forecast;
  if (!f) {
    $("detail").innerHTML = `${heroCard(match, null)}<div class="card state-box">这场比赛暂时无法生成模型预测（缺少历史数据）。</div>`;
    return;
  }
  const parts = [
    heroCard(match, f),
    verdictCard(match, f, deepLoading),
    `<div class="grid-3">${goalsCard(f)}${matrixCard(match, f)}${handicapCard(match, f)}</div>`,
    `<div class="grid-2">${strengthCard(match, f)}${compareCard(match, f)}</div>`,
    sportteryCard(payload, deepLoading),
    factorsCard(payload.prediction),
    moreSection(payload),
  ];
  $("detail").innerHTML = parts.join("");
}

function heroCard(match, f) {
  const finished = match.finished;
  const center = finished || match.status === "LIVE"
    ? `<div class="hero-score">${match.score?.home ?? "-"} : ${match.score?.away ?? "-"}</div><div class="hero-kick">${finished ? "完场" : "进行中"}</div>`
    : `<div class="hero-vs">VS</div><div class="hero-kick">${esc(dayLabel(beijingDate(match)))} ${esc(beijingTime(match))}</div>`;
  const rank = (side) => {
    const r = f?.ratings?.[side];
    if (!r) return "";
    return r.promoted ? "升班马 · 样本少" : `实力评级 第 ${r.rank} / ${r.of}`;
  };
  return `<section class="card hero">
    <div class="hero-meta"><span>${esc(match.competition?.nameZh || "")}</span>${match.matchday ? `<span>第 ${match.matchday} 轮</span>` : ""}<span>北京时间 ${esc(beijingDate(match))} ${esc(beijingTime(match))}</span>${match.stadium?.name ? `<span>${esc(match.stadium.name)}</span>` : ""}</div>
    <div class="hero-main">
      <div class="hero-team">${crest(match.home, 64)}<div><h2>${esc(teamName(match.home))}</h2><p>主队 · ${rank("home")}</p></div></div>
      <div class="hero-center">${center}</div>
      <div class="hero-team away">${crest(match.away, 64)}<div><h2>${esc(teamName(match.away))}</h2><p>客队 · ${rank("away")}</p></div></div>
    </div>
  </section>`;
}

function verdictCard(match, f, deepLoading) {
  const p = f.probabilities;
  const finished = match.finished;
  const actual = finished ? (match.score.home > match.score.away ? "home" : match.score.home < match.score.away ? "away" : "draw") : null;
  const actualScore = finished ? `${match.score.home}-${match.score.away}` : null;
  const conf = f.confidence || { level: "low", label: "低" };
  const confClass = conf.level === "high" ? "good" : conf.level === "medium" ? "accent" : "warn";
  let resultChips = "";
  if (finished) {
    const hit1 = f.pick === actual;
    const hitScore = f.headlineScore.score === actualScore;
    const hitTop = f.topScores.slice(0, 3).some((s) => s.score === actualScore);
    const hitOu = (p.over25 >= 0.5) === (match.score.home + match.score.away > 2.5);
    resultChips = `<div class="score-chips">
      <span class="chip ${hit1 ? "good" : "bad"}">胜平负 ${hit1 ? "命中" : "未中"}</span>
      <span class="chip ${hitOu ? "good" : "bad"}">大小 2.5 ${hitOu ? "命中" : "未中"}</span>
      <span class="chip ${hitScore ? "good" : hitTop ? "accent" : ""}">${hitScore ? "比分命中" : hitTop ? "比分在 Top3 内" : "比分未中"}</span>
    </div>`;
  }
  const label = (key, name) => `<div class="prob-label ${key} ${f.pick === key ? "picked" : ""}"><span>${name}</span><strong>${pct(p[key])}</strong></div>`;
  return `<section class="card">
    <div class="card-head"><h3>${finished ? "赛前预测 vs 实际" : "模型结论"}</h3>
      <div style="display:flex;gap:6px;align-items:center">${deepLoading ? `<span class="hint">正在补充情报与盘口…</span>` : ""}<span class="chip ${confClass}">信心 ${conf.label}</span>${f.market ? `<span class="chip accent">已融合赔率</span>` : `<span class="chip">纯模型</span>`}</div>
    </div>
    <div class="verdict">
      <div class="prob-big">
        <div class="prob-labels">${label("home", `${esc(teamName(match.home))} 胜`)}${label("draw", "平局")}${label("away", `${esc(teamName(match.away))} 胜`)}</div>
        <div class="stack-bar"><i style="width:${p.home * 100}%;background:var(--home)"></i><i style="width:${p.draw * 100}%;background:var(--draw)"></i><i style="width:${p.away * 100}%;background:var(--away)"></i></div>
        ${resultChips}
      </div>
      <div class="verdict-side">
        <div class="kv"><span>${finished ? "赛前首选比分" : "首选比分"}</span><strong class="big">${esc(f.headlineScore.score.replace("-", " : "))}</strong></div>
        <div class="kv"><span>预期进球 xG</span><strong>${f.expectedGoals.home.toFixed(2)} : ${f.expectedGoals.away.toFixed(2)}</strong></div>
        <div class="kv"><span>大 2.5 球 / 双方进球</span><strong>${pct(p.over25)} / ${pct(p.btts)}</strong></div>
      </div>
    </div>
    <p class="verdict-note">首选比分取“与胜平负首选一致的最高概率比分”，单个比分的概率通常只有 8–13%，请把比分当作参考、以胜平负和进球数概率为主。</p>
  </section>`;
}

function goalsCard(f) {
  const p = f.probabilities;
  const totals = p.totals || [];
  const max = Math.max(...totals, 0.01);
  const row = (name, value) => `<div class="bar-row"><span>${name}</span><div class="bar"><i style="width:${value * 100}%"></i></div><span>${pct(value, 0)}</span></div>`;
  return `<section class="card">
    <div class="card-head"><h3>进球数</h3><span class="hint">总 xG ${f.expectedGoals.total.toFixed(2)}</span></div>
    ${row("大 1.5", p.over15)}${row("大 2.5", p.over25)}${row("大 3.5", p.over35)}${row("双方进球", p.btts)}
    <div class="dist">${totals.slice(0, 8).map((value, goals) => `<div><b>${Math.round(value * 100)}%</b><i style="height:${(value / max) * 64}px"></i><span>${goals === 7 ? "7+" : goals}球</span></div>`).join("")}</div>
  </section>`;
}

function matrixCard(match, f) {
  const matrix = f.matrix || [];
  const size = 6;
  const max = Math.max(...matrix.slice(0, size).flatMap((row) => row.slice(0, size)), 0.01);
  const top = f.headlineScore.score;
  const actual = match.finished ? `${match.score.home}-${match.score.away}` : "";
  const cells = [`<span class="axis"></span>`];
  for (let a = 0; a < size; a += 1) cells.push(`<span class="axis">${a}</span>`);
  for (let h = 0; h < size; h += 1) {
    cells.push(`<span class="axis">${h}</span>`);
    for (let a = 0; a < size; a += 1) {
      const value = matrix[h]?.[a] || 0;
      const alpha = 0.06 + 0.8 * (value / max);
      const color = h > a ? "10,108,255" : h < a ? "255,122,26" : "140,148,160";
      const score = `${h}-${a}`;
      cells.push(`<span class="cell ${score === top ? "top" : ""} ${score === actual ? "actual" : ""}" style="background:rgba(${color},${alpha.toFixed(3)})" title="${score} · ${pct(value)}">${value >= 0.005 ? (value * 100).toFixed(1) : ""}</span>`);
    }
  }
  return `<section class="card">
    <div class="card-head"><h3>比分概率</h3><span class="hint">%</span></div>
    <div class="matrix">${cells.join("")}</div>
    <div class="matrix-caption"><span>纵轴 ${esc(teamName(match.home))} 进球</span><span>横轴 ${esc(teamName(match.away))} 进球</span></div>
    <div class="score-chips">${f.topScores.slice(0, 5).map((s) => `<span class="score-chip ${s.score === actual ? "hit" : ""}"><b>${esc(s.score)}</b>${pct(s.probability)}</span>`).join("")}</div>
  </section>`;
}

function handicapCard(match, f) {
  const ah = f.asianHandicap;
  const homeName = teamName(match.home);
  const awayName = teamName(match.away);
  const lineText = (line) => (line === 0 ? "平手" : line < 0 ? `${homeName} 让 ${fmtLine(-line)}` : `${homeName} 受让 ${fmtLine(line)}`);
  const p = f.probabilities;
  const dnbHome = p.home / Math.max(0.0001, p.home + p.away);
  const row = (name, value) => `<div class="bar-row"><span>${name}</span><div class="bar"><i style="width:${value * 100}%"></i></div><span>${pct(value, 0)}</span></div>`;
  const sp = f.market?.spread;
  const market = sp ? `<div class="market-line">
      <div class="kv"><span>市场让球（${esc(f.market.provider || "")}）</span><strong>${esc(lineText(sp.homeLine))}</strong></div>
      <div class="kv"><span>赔率 主 / 客</span><strong>${num(sp.homeDecimal)} / ${num(sp.awayDecimal)}</strong></div>
      ${row(`${esc(homeName)} 赢盘`, sp.finalHome)}${row(`${esc(awayName)} 赢盘`, 1 - sp.finalHome)}
      <p class="muted" style="font-size:12px;margin:4px 0 0">市场隐含主队赢盘 ${pct(sp.marketHome)}${sp.push >= 0.01 ? `，走水 ${pct(sp.push)}` : ""}</p>
    </div>` : `<p class="muted" style="font-size:12px;margin:0 0 8px">暂未取到市场让球盘。</p>`;
  return `<section class="card">
    <div class="card-head"><h3>让球盘</h3><span class="hint">模型公平盘 ${esc(lineText(ah.line))}</span></div>
    ${market}
    <div style="height:10px"></div>
    ${row("主 平局退款", dnbHome)}${row("客 平局退款", 1 - dnbHome)}
    ${row("主 双重机会", p.home + p.draw)}${row("客 双重机会", p.away + p.draw)}
  </section>`;
}

function strengthCard(match, f) {
  const h = f.ratings.home;
  const a = f.ratings.away;
  const scale = (v) => Math.min(100, Math.max(4, (v / 2) * 100));
  const row = (label, hv, av, invert) => {
    const hBetter = invert ? hv < av : hv > av;
    return `<div class="strength-row">
      <span class="val">${hv.toFixed(2)}</span>
      <div class="half-bar left"><i style="width:${scale(hv)}%;background:${hBetter ? "var(--home)" : "var(--line-strong)"}"></i></div>
      <span class="label">${label}</span>
      <div class="half-bar"><i style="width:${scale(av)}%;background:${!hBetter ? "var(--away)" : "var(--line-strong)"}"></i></div>
      <span class="val right">${av.toFixed(2)}</span>
    </div>`;
  };
  const form = (list, name) => {
    const items = (list || []).slice(0, 6);
    if (!items.length) return `<div class="form-block"><h4>${esc(name)}</h4><p class="muted">暂无近期顶级联赛记录</p></div>`;
    return `<div class="form-block">
      <h4><span>${esc(name)} 近 ${items.length} 场</span><span class="form-pills">${items.map((m) => `<span class="form-pill ${m.result}">${{ W: "胜", D: "平", L: "负" }[m.result]}</span>`).join("")}</span></h4>
      <div class="form-list">${items.map((m) => `<div><span>${esc(m.date.slice(5))}</span><span>${m.venue}</span><span>${esc(m.opponent)}</span><b>${esc(m.score)}</b><small>${m.xgFor !== null ? `xG ${m.xgFor.toFixed(1)}-${m.xgAgainst.toFixed(1)}` : ""}</small></div>`).join("")}</div>
    </div>`;
  };
  return `<section class="card">
    <div class="card-head"><h3>球队实力</h3><span class="hint">1.00 = 联赛平均</span></div>
    <div class="team-compare">
      ${row("进攻", h.attack, a.attack, false)}
      ${row("防守(失球)", h.defence, a.defence, true)}
      <p class="muted" style="margin:0;font-size:12px">进攻越高越好；防守失球越低越好。由近三季联赛进球与 xG 时间加权拟合。</p>
      ${form(f.form.home, teamName(match.home))}
      ${form(f.form.away, teamName(match.away))}
    </div>
  </section>`;
}

function compareCard(match, f) {
  const m = f.model;
  const k = f.market;
  const p = f.probabilities;
  const cell = (v) => (v === null || v === undefined ? "—" : pct(v));
  const dec = k?.decimal || {};
  const t = k?.total;
  const totalRow = t
    ? `<tr><td>大 ${t.line}</td><td class="num">${num(t.overDecimal)}</td><td class="num">—</td><td class="num">${cell(t.marketOver)}</td><td class="num"><b>${pct(t.finalOver)}</b></td></tr>`
    : `<tr><td>大 2.5</td><td class="num">—</td><td class="num">${cell(m.over25)}</td><td class="num">—</td><td class="num"><b>${pct(p.over25)}</b></td></tr>`;
  const moved = k?.openDecimal?.home && dec.home && Math.abs(k.openDecimal.home - dec.home) >= 0.05
    ? `<p class="muted" style="font-size:12px;margin:10px 0 0">初盘 ${num(k.openDecimal.home)} / ${num(k.openDecimal.draw)} / ${num(k.openDecimal.away)} → 现在 ${num(dec.home)} / ${num(dec.draw)} / ${num(dec.away)}</p>` : "";
  return `<section class="card">
    <div class="card-head"><h3>模型 vs 市场</h3><span class="hint">${k ? esc(k.source) : "暂未获取赔率"}</span></div>
    <div class="table-wrap"><table class="cmp-table">
      <thead><tr><th></th><th class="num">赔率</th><th class="num">纯模型</th><th class="num">市场</th><th class="num">最终</th></tr></thead>
      <tbody>
        <tr><td>主胜</td><td class="num">${num(dec.home)}</td><td class="num">${cell(m.home)}</td><td class="num">${cell(k?.home)}</td><td class="num"><b>${pct(p.home)}</b></td></tr>
        <tr><td>平局</td><td class="num">${num(dec.draw)}</td><td class="num">${cell(m.draw)}</td><td class="num">${cell(k?.draw)}</td><td class="num"><b>${pct(p.draw)}</b></td></tr>
        <tr><td>客胜</td><td class="num">${num(dec.away)}</td><td class="num">${cell(m.away)}</td><td class="num">${cell(k?.away)}</td><td class="num"><b>${pct(p.away)}</b></td></tr>
        ${totalRow}
      </tbody>
    </table></div>
    ${k ? `<p class="muted" style="font-size:12px;margin:10px 0 0">赔率为欧洲小数赔率；市场概率已去除抽水 ${pct(k.margin)}。</p>` : ""}
    ${moved}
    ${k ? valueNotes(match, f) : ""}
    <p class="muted" style="font-size:12px;margin:10px 0 0;line-height:1.55">${k ? `最终概率 = 市场 ${Math.round(k.weight * 100)}% + 模型 ${Math.round((1 - k.weight) * 100)}%。列表页和比赛页使用同一份盘口，数字一致。` : "临近开赛（约 2–3 天内）通常能取到赔率，届时会自动融合。"}</p>
  </section>`;
}

function valueNotes(match, f) {
  const m = f.model;
  const k = f.market;
  const diffs = [["home", `${teamName(match.home)} 胜`], ["draw", "平局"], ["away", `${teamName(match.away)} 胜`]]
    .map(([key, name]) => ({ name, diff: m[key] - k[key] }))
    .filter((item) => Math.abs(item.diff) >= 0.05);
  if (!diffs.length) return `<p style="font-size:12.5px;margin:10px 0 0">模型与市场基本一致（差距都小于 5 个百分点）。</p>`;
  return `<p style="font-size:12.5px;margin:10px 0 0">分歧：${diffs.map((d) => `模型对<b>${esc(d.name)}</b>${d.diff > 0 ? "比市场更看好" : "比市场更不看好"} ${Math.abs(d.diff * 100).toFixed(1)} 个百分点`).join("；")}。</p>`;
}

function sportteryCard(payload, deepLoading) {
  const match = payload.match;
  if (match.finished) return "";
  const rec = payload.prediction?.sportteryRecommendation;
  const official = rec && !rec.modelFallback && rec.officialMatchId;
  const status = payload.sporttery?.message || rec?.message || "";
  if (!rec?.items?.length) {
    return `<section class="card"><div class="card-head"><h3>体彩竞彩</h3><span class="chip">${deepLoading ? "加载中" : "无数据"}</span></div><p class="muted" style="margin:0;font-size:12.5px">${esc(deepLoading ? "正在查询体彩官方受注…" : status)}</p></section>`;
  }
  const head = official
    ? `<span class="chip good">官方受注 ${esc(rec.matchNum || "")}</span>`
    : `<span class="chip warn">模型推导</span>`;
  const items = rec.items.map((item) => `<div class="rec">
      <span>${esc(item.market || "")}${Number.isFinite(item.line) ? `（${item.line > 0 ? "+" : ""}${item.line}）` : ""}</span>
      <strong>${esc(item.pick || "")}</strong>
      <p>${Number.isFinite(item.probability) ? `模型概率 ${pct(item.probability)}` : ""}${Number.isFinite(item.odds) ? ` · 官方奖金 ${num(item.odds)}` : ""}${Number.isFinite(item.valueIndex) ? ` · 期望值 ${item.valueIndex.toFixed(2)}` : ""}</p>
    </div>`).join("");
  const aligned = rec.alignment?.ok
    ? `<span class="chip good">四项口径一致</span>`
    : `<span class="chip bad">需复核</span>`;
  return `<section class="card">
    <div class="card-head"><h3>体彩竞彩</h3><div style="display:flex;gap:6px">${head}${aligned}</div></div>
    <div class="rec-grid">${items}</div>
    <p class="muted" style="font-size:12px;margin:12px 0 0;line-height:1.55">${official
      ? `已与体彩官方 ${esc(rec.officialMatch?.home || "")} vs ${esc(rec.officialMatch?.away || "")}（${esc(rec.officialMatch?.matchDate || "")} ${esc(rec.officialMatch?.matchTime || "")}）对上；四项推荐都由上方同一套概率和首选比分 ${esc(f2score(payload))} 推出。`
      : `${esc(status)}。以下四项由上方同一套概率和首选比分 ${esc(f2score(payload))} 推出，与主预测一致，但没有官方固定奖金。`}</p>
  </section>`;
}

function f2score(payload) {
  return payload.forecast?.headlineScore?.score || payload.prediction?.primaryScore?.score || "";
}

function factorsCard(prediction) {
  const factors = (prediction?.factors || []).filter((f) => !["比分校准", "外部比分共识"].includes(f.name));
  if (!factors.length) return "";
  return `<section class="card">
    <div class="card-head"><h3>预测依据</h3><span class="hint">${esc(prediction.model || "")}</span></div>
    <div class="factor-list">${factors.map((f) => `<div class="factor"><strong>${esc(f.name)}</strong><span class="impact">${esc(f.impact)}</span><p>${esc(f.detail)}</p></div>`).join("")}</div>
  </section>`;
}

function moreSection(payload) {
  const prediction = payload.prediction || {};
  const sections = [];
  const intel = prediction.intelligence24h;
  if (intel?.keyPoints?.length || intel?.summary?.length) {
    sections.push(`<div class="more-section"><h4>情报摘要（网页抓取，仅参考，不参与概率计算）</h4><ul>${(intel.keyPoints || intel.summary || []).slice(0, 6).map((line) => `<li>${esc(line)}</li>`).join("")}</ul></div>`);
  }
  const weather = payload.weather;
  if (weather?.available) {
    const c = weather.current || {};
    sections.push(`<div class="more-section"><h4>比赛天气</h4><ul><li>${esc(c.condition || "")} · ${esc(c.temperature ?? "-")}°C · 湿度 ${esc(c.humidity ?? "-")}% · 风速 ${esc(c.windSpeed ?? "-")} km/h · 降水概率 ${esc(c.precipitationProbability ?? "-")}%</li></ul></div>`);
  }
  const derivative = (prediction.recommendations || []).filter((r) => /角球|罚牌/.test(r.market || ""));
  if (derivative.length) {
    sections.push(`<div class="more-section"><h4>角球与罚牌（无稳定盘口源，仅为基准）</h4><div class="rec-grid">${derivative.slice(0, 4).map((r) => `<div class="rec"><span>${esc(r.market)}</span><strong>${esc(r.pick)}</strong><p>${esc(r.reason || "")}</p></div>`).join("")}</div></div>`);
  }
  if (!sections.length) return "";
  return `<details class="more"><summary>更多参考：情报 · 天气 · 角球罚牌</summary><div class="more-body">${sections.join("")}</div></details>`;
}

// ---------------- standings ----------------

async function loadStandings() {
  const key = `${state.competitionId}:${state.season}`;
  const competition = state.competitions.find((c) => c.id === state.competitionId);
  $("standingsTitle").textContent = `${competition?.nameZh || ""} ${seasonLabel(state.season)} 积分榜`;
  if (!state.standings.has(key)) {
    $("standingsTable").innerHTML = `<div class="loading-bar"></div>`;
    try {
      state.standings.set(key, await fetchJson(`/api/standings?competition=${state.competitionId}&season=${state.season}`));
    } catch (error) {
      $("standingsTable").innerHTML = `<div class="state-box">积分榜加载失败：${esc(error.message)}</div>`;
      return;
    }
  }
  const data = state.standings.get(key);
  const rows = data.tables?.total || [];
  $("standingsMeta").textContent = `${data.sourceLabel || ""} · 已赛 ${data.currentMatchday || "-"} 轮 · 更新 ${fmtTime(data.refreshedAt)}`;
  const size = rows.length;
  const zone = (pos) => {
    if (state.competitionId === "BL1" || state.competitionId === "FL1") {
      if (pos <= 4) return "ucl";
      if (pos <= 6) return "uel";
      if (pos >= size - 1) return "rel";
      return "";
    }
    if (pos <= 4) return "ucl";
    if (pos <= 6) return "uel";
    if (pos >= size - 2) return "rel";
    return "";
  };
  $("standingsTable").innerHTML = rows.length ? `<div class="table-wrap"><table>
    <thead><tr><th>排名</th><th>球队</th><th class="num">赛</th><th class="num">胜</th><th class="num">平</th><th class="num">负</th><th class="num">进/失</th><th class="num">净胜</th><th class="num">积分</th><th class="num">场均分</th></tr></thead>
    <tbody>${rows.map((row) => `<tr>
      <td><span class="pos-num ${zone(row.position)}">${row.position}</span></td>
      <td><span class="team-cell">${crest(row.team, 20)}<b>${esc(teamName(row.team))}</b></span></td>
      <td class="num">${row.playedGames}</td><td class="num">${row.won}</td><td class="num">${row.draw}</td><td class="num">${row.lost}</td>
      <td class="num">${row.goalsFor}:${row.goalsAgainst}</td><td class="num">${row.goalDifference > 0 ? "+" : ""}${row.goalDifference}</td>
      <td class="num"><b>${row.points}</b></td><td class="num">${row.playedGames ? (row.points / row.playedGames).toFixed(2) : "-"}</td>
    </tr>`).join("")}</tbody></table></div>
    <div class="legend"><span><i style="background:var(--accent)"></i>欧冠区</span><span><i style="background:var(--warn)"></i>欧联区</span><span><i style="background:var(--bad)"></i>降级区</span></div>`
    : `<div class="state-box">暂无积分榜数据</div>`;
}

// ---------------- backtest ----------------

async function loadBacktest() {
  const scope = $("backtestScope").value;
  const season = Number($("backtestSeason").value || state.currentSeason - 1);
  const competition = scope === "ALL" ? "" : state.competitionId;
  const key = `${competition || "ALL"}:${season}`;
  state.backtestRows = 60;
  state.backtestFilter = "all";
  if (!state.backtest.has(key)) {
    $("backtestBody").innerHTML = `<div class="card"><div class="loading-bar"></div><p class="muted" style="margin:12px 0 0">正在逐场重放整个赛季（每个比赛日重新拟合一次），首次约需 10–40 秒…</p></div>`;
    try {
      state.backtest.set(key, await fetchJson(`/api/backtest?competition=${competition}&season=${season}`));
    } catch (error) {
      $("backtestBody").innerHTML = `<div class="card state-box">回测失败：${esc(error.message)}</div>`;
      return;
    }
  }
  renderBacktest(state.backtest.get(key));
}

function renderBacktest(report) {
  const m = report.metrics || {};
  if (!report.sample) {
    $("backtestBody").innerHTML = `<div class="card state-box">该赛季暂无可回测的完场比赛。</div>`;
    return;
  }
  $("backtestMethod").textContent = report.methodology || "";
  const market = report.market;
  const diff = market ? m.result.rate - market.result : null;
  const metric = (label, value, note) => `<div class="metric"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</div>`;
  const metrics = `<div class="metric-grid">
    ${metric("胜平负命中率", pct(m.result.rate), market ? `市场赔率首选 ${pct(market.result)}（<b class="${diff < 0 ? "neg" : ""}">${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}</b>）` : `${m.result.hits}/${m.result.sample}`)}
    ${metric("大小 2.5 命中率", pct(m.total25.rate), `${m.total25.hits}/${m.total25.sample} 场`)}
    ${metric("首选比分命中", pct(m.exactScore.rate), `Top3 比分 ${pct(m.top3Score.rate)}`)}
    ${metric("对数损失 Log loss", (m.logLoss ?? 0).toFixed(3), market ? `市场 ${market.logLoss.toFixed(3)} · 越低越好` : "越低越好")}
    ${metric("RPS", (m.rps ?? 0).toFixed(4), "排序概率分，越低越好")}
    ${metric("样本", report.sample, `${report.competition?.nameZh || ""} ${seasonLabel(report.season)}`)}
  </div>`;
  const calibration = `<section class="card"><div class="card-head"><h3>概率是否靠谱</h3><span class="hint">竖线 = 模型给出的平均概率，蓝条 = 实际命中率</span></div>
    <div class="calib">${(report.calibration || []).filter((b) => b.sample).map((b) => `<div class="calib-row"><span>首选 ${b.label}</span><div class="track"><i style="width:${b.hitRate * 100}%"></i><em style="left:${b.expected * 100}%"></em></div><small>${pct(b.hitRate)} 实际 · ${b.sample} 场</small></div>`).join("")}</div>
    <p class="muted" style="font-size:12px;margin:12px 0 0">蓝条末端越贴近竖线，说明“模型说 60% 的比赛确实大约六成会赢”，概率可以直接当真。</p></section>`;
  const leagues = report.leagues?.length ? `<section class="card"><div class="card-head"><h3>分联赛表现</h3></div><div class="table-wrap"><table>
    <thead><tr><th>联赛</th><th class="num">样本</th><th class="num">胜平负</th><th class="num">市场</th><th class="num">大小2.5</th><th class="num">比分</th><th class="num">Top3</th><th class="num">Log loss</th></tr></thead>
    <tbody>${report.leagues.map((l) => `<tr><td>${esc(l.competition?.nameZh || "")}</td><td class="num">${l.sample}</td><td class="num"><b>${pct(l.metrics.result.rate)}</b></td><td class="num">${l.market ? pct(l.market.result) : "—"}</td><td class="num">${pct(l.metrics.total25.rate)}</td><td class="num">${pct(l.metrics.exactScore.rate)}</td><td class="num">${pct(l.metrics.top3Score.rate)}</td><td class="num">${(l.metrics.logLoss ?? 0).toFixed(3)}</td></tr>`).join("")}</tbody></table></div></section>` : "";
  $("backtestBody").innerHTML = `${metrics}${calibration}${leagues}<section class="card" id="backtestRecords"></section>`;
  renderBacktestRecords(report);
}

function renderBacktestRecords(report) {
  let records = report.records || [];
  if (state.backtestFilter === "hit") records = records.filter((r) => r.hits.result);
  if (state.backtestFilter === "miss") records = records.filter((r) => !r.hits.result);
  const shown = records.slice(0, state.backtestRows);
  const yes = (v) => `<span class="${v ? "hit-yes" : "hit-no"}">${v ? "✓" : "×"}</span>`;
  $("backtestRecords").innerHTML = `<div class="filter-row"><h3 style="margin:0;font-size:15px">逐场记录</h3>
      <div class="segmented" id="btFilter" style="width:240px"><button data-f="all" class="${state.backtestFilter === "all" ? "active" : ""}">全部</button><button data-f="hit" class="${state.backtestFilter === "hit" ? "active" : ""}">命中</button><button data-f="miss" class="${state.backtestFilter === "miss" ? "active" : ""}">未中</button></div></div>
    <div class="table-wrap"><table>
      <thead><tr><th>日期</th>${report.leagues ? "<th>联赛</th>" : ""}<th>比赛</th><th class="num">主/平/客</th><th>首选</th><th class="num">预测比分</th><th class="num">实际</th><th class="num">胜平负</th><th class="num">大小</th><th class="num">比分</th></tr></thead>
      <tbody>${shown.map((r) => `<tr><td>${esc(r.date)}</td>${report.leagues ? `<td>${esc(r.competitionName)}</td>` : ""}<td>${esc(r.home)} vs ${esc(r.away)}</td><td class="num">${pct(r.probabilities.home, 0)} / ${pct(r.probabilities.draw, 0)} / ${pct(r.probabilities.away, 0)}</td><td>${RESULT_ZH[r.pick]}</td><td class="num">${esc(r.predictedScore)}</td><td class="num"><b>${esc(r.actualScore)}</b></td><td class="num">${yes(r.hits.result)}</td><td class="num">${yes(r.hits.total25)}</td><td class="num">${r.hits.exactScore ? yes(true) : r.hits.top3Score ? `<span class="hit-yes">Top3</span>` : yes(false)}</td></tr>`).join("")}</tbody>
    </table></div>
    ${records.length > shown.length ? `<div style="text-align:center;margin-top:12px"><button class="pill-select" id="btMore">再显示 100 场（共 ${records.length}）</button></div>` : ""}`;
  $("btFilter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-f]");
    if (!button) return;
    state.backtestFilter = button.dataset.f;
    state.backtestRows = 60;
    renderBacktestRecords(report);
  });
  $("btMore")?.addEventListener("click", () => {
    state.backtestRows += 100;
    renderBacktestRecords(report);
  });
}

// ---------------- history ----------------

function historyScope() {
  return $("historyScope")?.value || "league";
}

function historyUrl(scope) {
  if (scope === "worldcup") return "/api/history-fast?scope=worldcup";
  if (scope === "ALL") return `/api/history-fast?competition=&season=${state.season}`;
  return `/api/history-fast?competition=${state.competitionId}&season=${state.season}`;
}

async function fetchHistory(scope) {
  const key = scope === "worldcup" ? "worldcup" : scope === "ALL" ? `ALL:${state.season}` : `${state.competitionId}:${state.season}`;
  if (!state.history.has(key)) state.history.set(key, fetchJson(historyUrl(scope)));
  try {
    return await state.history.get(key);
  } catch (error) {
    state.history.delete(key);
    throw error;
  }
}

function rateCell(rate, hits) {
  if (rate === null || rate === undefined) return "—";
  return `${pct(rate)}${Number.isFinite(hits) ? `<small> · ${hits} 中</small>` : ""}`;
}

// 赛程页顶部的「推荐命中率统计」条
async function loadHitRateStrip() {
  const box = $("hitRateStrip");
  if (!box) return;
  box.innerHTML = `<span class="muted">正在统计推荐命中率…</span>`;
  const [leagues, worldcup] = await Promise.allSettled([fetchHistory("ALL"), fetchHistory("worldcup")]);
  const part = (label, result) => {
    if (result.status !== "fulfilled") return `<div class="hr-group"><b>${label}</b><span class="muted">暂不可用</span></div>`;
    const s = result.value.summary || {};
    const sp = result.value.sportterySummary || {};
    if (!s.evaluatedMatches) return `<div class="hr-group"><b>${label}</b><span class="muted">还没有已完场的赛前留档</span></div>`;
    return `<div class="hr-group"><b>${label}</b><span>已核验 <strong>${s.evaluatedMatches}</strong> 场</span>
      <span>胜平负 <strong>${pct(s.resultDirectionAccuracy, 0)}</strong></span>
      <span>大小2.5 <strong>${pct(s.over25Accuracy, 0)}</strong></span>
      <span>比分 <strong>${pct(s.exactScoreAccuracy, 0)}</strong></span>
      ${sp.result?.evaluated ? `<span>体彩胜平负 <strong>${pct(sp.result.accuracy, 0)}</strong></span>` : ""}</div>`;
  };
  box.innerHTML = `<span class="hr-title">推荐命中率统计</span>${part(`本赛季五大联赛`, leagues)}${part("世界杯留档", worldcup)}<button class="hr-link" id="hitRateMore">查看明细</button>`;
  $("hitRateMore").addEventListener("click", () => switchView("history"));
}

async function loadHistory() {
  const scope = historyScope();
  $("historyBody").innerHTML = `<div class="card"><div class="loading-bar"></div><p class="muted" style="margin:12px 0 0">正在核验赛前留档${scope === "worldcup" ? "（首次需要从 ESPN 补抓世界杯赛果，约 10–30 秒）" : ""}…</p></div>`;
  let data;
  try {
    data = await fetchHistory(scope);
  } catch (error) {
    $("historyBody").innerHTML = `<div class="card state-box">留档加载失败：${esc(error.message)}</div>`;
    return;
  }
  if (scope !== historyScope()) return;
  const s = data.summary || {};
  const sp = data.sportterySummary || {};
  const settled = (data.rows || []).filter((r) => r.settled !== false && !r.noPrematch);
  const pending = data.pendingRows || [];
  const metric = (label, value, note) => `<div class="metric"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ""}</div>`;
  const spMetric = (label, part) => metric(label, part?.evaluated ? pct(part.accuracy) : "—", part?.evaluated ? `${part.hits}/${part.evaluated}` : "暂无样本");
  const scopeLabel = scope === "worldcup" ? "2026 世界杯期间" : scope === "ALL" ? `${seasonLabel(state.season)} 五大联赛` : `${state.competitions.find((c) => c.id === state.competitionId)?.nameZh || ""} ${seasonLabel(state.season)}`;
  const yes = (v) => `<span class="${v ? "hit-yes" : "hit-no"}">${v ? "✓" : "×"}</span>`;
  const spHits = (row) => {
    const items = (row.sporttery || []).filter((x) => x.settled);
    if (!items.length) return "—";
    return `${items.filter((x) => x.hit).length}/${items.length}`;
  };
  $("historyBody").innerHTML = `
    <div class="metric-grid">
      ${metric("已核验场次", s.evaluatedMatches ?? 0, `${scopeLabel}${pending.length ? ` · 待开赛 ${pending.length} 场` : ""}`)}
      ${metric("胜平负命中", pct(s.resultDirectionAccuracy || 0), `${s.resultDirectionHits ?? 0}/${s.evaluatedMatches ?? 0}`)}
      ${metric("大小 2.5 命中", pct(s.over25Accuracy || 0), `${s.over25Hits ?? 0}/${s.evaluatedMatches ?? 0}`)}
      ${metric("比分命中", pct(s.exactScoreAccuracy || 0), `${s.exactScoreHits ?? 0}/${s.evaluatedMatches ?? 0}`)}
      ${metric("Top3 比分命中", pct(s.top3ScoreAccuracy || 0), `${s.top3ScoreHits ?? 0}/${s.evaluatedMatches ?? 0}`)}
      ${metric("总进球数命中", pct(s.totalGoalsAccuracy || 0), "推荐比分的进球总数猜中")}
    </div>
    <section class="card">
      <div class="card-head"><h3>体彩推荐命中率</h3><span class="hint">${sp.evaluated ? `共 ${sp.evaluated} 项推荐，命中 ${sp.hits} 项（${pct(sp.accuracy)}）` : "暂无已完场的体彩推荐"}</span></div>
      <div class="metric-grid">
        ${spMetric("胜平负", sp.result)}${spMetric("让球胜平负", sp.handicap)}${spMetric("总进球数", sp.totalGoals)}${spMetric("比分", sp.score)}
      </div>
    </section>
    <section class="card">${settled.length || pending.length ? `<div class="table-wrap"><table>
      <thead><tr><th>日期</th><th>比赛</th><th class="num">赛前推荐</th><th class="num">实际</th><th class="num">胜平负</th><th class="num">大小2.5</th><th class="num">比分</th><th class="num">体彩</th><th>备注</th></tr></thead>
      <tbody>
        ${pending.map((r) => `<tr><td>${esc(r.matchDate || "")}</td><td>${esc(r.match || "")}</td><td class="num">${esc(r.recommendedScore || "")}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td>${esc(r.status || "待开赛")}</td></tr>`).join("")}
        ${settled.map((r) => `<tr><td>${esc(r.matchDate || "")}</td><td>${esc(r.match || "")}</td><td class="num">${esc(r.recommendedScore || "")}</td><td class="num"><b>${esc(r.resultScore || "")}</b></td>
          <td class="num">${yes(r.resultDirectionHit)}</td><td class="num">${yes(r.over25Hit)}</td><td class="num">${r.exactScoreHit ? yes(true) : r.top3ScoreHit ? `<span class="hit-yes">Top3</span>` : yes(false)}</td><td class="num">${spHits(r)}</td>
          <td>${esc(r.status && r.status !== "完场" ? r.status : "")}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="state-box">这里还没有赛前留档。在“赛程预测”里打开未开赛的比赛，就会自动保存当时的推荐，完场后自动核验。</div>`}
      ${scope === "worldcup" ? `<p class="muted" style="font-size:12px;margin:12px 0 0">这些是世界杯期间旧模型保存的推荐；淘汰赛打了加时的按 90 分钟比分核验（竞彩同样按 90 分钟结算）。</p>` : ""}
    </section>`;
}

// ---------------- helpers ----------------

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(payload.detail || payload.message || `HTTP ${response.status}`);
  return payload;
}

function teamName(team) {
  return team?.displayName || team?.shortName || team?.name || "待定";
}

function crest(team, size = 18) {
  const src = team?.crest || team?.flag || "";
  if (!src) return `<span class="crest-fallback" style="width:${size}px;height:${size}px"></span>`;
  return `<img src="${esc(src)}" alt="" width="${size}" height="${size}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'crest-fallback'}))" />`;
}

function beijingDate(match) {
  return String(match.kickoffBeijing || match.dateInfo?.date || "").slice(0, 10);
}

function beijingTime(match) {
  return String(match.kickoffBeijing || "").slice(11, 16) || match.dateInfo?.time || "--:--";
}

function dayLabel(date) {
  if (!date) return "日期待定";
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 32 * 3600 * 1000).toISOString().slice(0, 10);
  const prefix = date === today ? "今天 · " : date === tomorrow ? "明天 · " : "";
  return `${prefix}${m}月${d}日 ${weekday}`;
}

function seasonLabel(season) {
  return `${season}/${String((season + 1) % 100).padStart(2, "0")}`;
}

function statusZh(status) {
  return { SCHEDULED: "未开赛", POSTPONED: "延期", CANCELLED: "取消", SUSPENDED: "中断", LIVE: "进行中" }[status] || "未开赛";
}

function pct(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function fmtLine(line) {
  const whole = Math.floor(line);
  const frac = line - whole;
  if (Math.abs(frac - 0.25) < 0.01) return `${whole}/${whole + 0.5}`;
  if (Math.abs(frac - 0.75) < 0.01) return `${whole + 0.5}/${whole + 1}`;
  return String(line);
}

function fmtTime(iso) {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function setConnection(status) {
  const dot = $("connectionState");
  dot.className = `status-dot ${status}`;
  dot.title = status === "online" ? "已连接" : status === "error" ? "连接失败" : "连接中";
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

function safeStorage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(`fla:${key}`);
    localStorage.setItem(`fla:${key}`, value);
  } catch {
    return null;
  }
  return null;
}
