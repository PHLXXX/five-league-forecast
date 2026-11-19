// Team-strength model: time-weighted Dixon-Coles Poisson ratings,
// optionally fitted on a goals/xG blend, optionally blended with bookmaker odds.
//
// Every function here is pure: give it the matches that were known before kickoff
// and it returns a forecast. The backtest uses exactly the same code path.

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MODEL_OPTIONS = Object.freeze({
  halfLifeDays: 365,       // older matches count less; weight halves every N days
  lookbackDays: 1100,      // ignore matches older than this
  xgWeight: 0.5,           // fit target = (1-w)*goals + w*xG when xG is known
  priorMatches: 3,         // shrink ratings toward the prior by N matches' worth
  promotedAttack: -0.28,   // prior for teams with no top-flight history in the window
  promotedDefence: 0.22,
  rho: -0.06,              // Dixon-Coles low-score correction
  marketWeight: 0.85,      // weight of bookmaker 1X2 when odds are available
  maxGoals: 10,
  iterations: 60,
});

// ---------- fitting ----------

export function fitRatings(matches, { asOf, options = {} } = {}) {
  const opt = { ...DEFAULT_MODEL_OPTIONS, ...options };
  const cutoff = Number.isFinite(asOf) ? asOf : Date.now();
  const decay = Math.log(2) / opt.halfLifeDays;
  const rows = [];
  for (const match of matches) {
    const time = match.time;
    if (!Number.isFinite(time) || time >= cutoff) continue;
    const ageDays = (cutoff - time) / DAY_MS;
    if (ageDays > opt.lookbackDays) continue;
    if (!Number.isFinite(match.hg) || !Number.isFinite(match.ag)) continue;
    const weight = Math.exp(-decay * ageDays);
    const hy = blendTarget(match.hg, match.hxg, opt.xgWeight);
    const ay = blendTarget(match.ag, match.axg, opt.xgWeight);
    rows.push({ home: match.home, away: match.away, hy, ay, weight });
  }

  const teams = new Set();
  for (const row of rows) {
    teams.add(row.home);
    teams.add(row.away);
  }
  const attack = new Map();
  const defence = new Map();
  for (const team of teams) {
    attack.set(team, 0);
    defence.set(team, 0);
  }

  let weightSum = 0;
  let homeGoals = 0;
  let awayGoals = 0;
  for (const row of rows) {
    weightSum += row.weight;
    homeGoals += row.weight * row.hy;
    awayGoals += row.weight * row.ay;
  }
  const meanHome = weightSum ? homeGoals / weightSum : 1.5;
  const meanAway = weightSum ? awayGoals / weightSum : 1.2;
  let base = Math.log(Math.max(0.2, (meanHome + meanAway) / 2));
  let homeAdv = Math.log(Math.max(0.5, meanHome / Math.max(0.2, meanAway))) / 2;

  const k = opt.priorMatches;
  for (let iteration = 0; iteration < opt.iterations; iteration += 1) {
    // attack
    const scored = new Map();
    const expectedA = new Map();
    for (const team of teams) {
      scored.set(team, 0);
      expectedA.set(team, 0);
    }
    for (const row of rows) {
      scored.set(row.home, scored.get(row.home) + row.weight * row.hy);
      scored.set(row.away, scored.get(row.away) + row.weight * row.ay);
      expectedA.set(row.home, expectedA.get(row.home) + row.weight * Math.exp(base + homeAdv + defence.get(row.away)));
      expectedA.set(row.away, expectedA.get(row.away) + row.weight * Math.exp(base - homeAdv + defence.get(row.home)));
    }
    for (const team of teams) {
      attack.set(team, Math.log((scored.get(team) + k * Math.exp(0)) / (expectedA.get(team) + k)));
    }
    // defence
    const conceded = new Map();
    const expectedD = new Map();
    for (const team of teams) {
      conceded.set(team, 0);
      expectedD.set(team, 0);
    }
    for (const row of rows) {
      conceded.set(row.home, conceded.get(row.home) + row.weight * row.ay);
      conceded.set(row.away, conceded.get(row.away) + row.weight * row.hy);
      expectedD.set(row.home, expectedD.get(row.home) + row.weight * Math.exp(base - homeAdv + attack.get(row.away)));
      expectedD.set(row.away, expectedD.get(row.away) + row.weight * Math.exp(base + homeAdv + attack.get(row.home)));
    }
    for (const team of teams) {
      defence.set(team, Math.log((conceded.get(team) + k) / (expectedD.get(team) + k)));
    }
    // centre ratings so base carries the league scoring level
    centre(attack);
    centre(defence);
    // base + home advantage
    let homeObs = 0;
    let homeExp = 0;
    let awayObs = 0;
    let awayExp = 0;
    for (const row of rows) {
      homeObs += row.weight * row.hy;
      awayObs += row.weight * row.ay;
      homeExp += row.weight * Math.exp(attack.get(row.home) + defence.get(row.away));
      awayExp += row.weight * Math.exp(attack.get(row.away) + defence.get(row.home));
    }
    if (homeExp > 0 && awayExp > 0 && homeObs > 0 && awayObs > 0) {
      const logHome = Math.log(homeObs / homeExp);
      const logAway = Math.log(awayObs / awayExp);
      base = (logHome + logAway) / 2;
      homeAdv = (logHome - logAway) / 2;
    }
  }

  const teamWeight = new Map();
  for (const row of rows) {
    teamWeight.set(row.home, (teamWeight.get(row.home) || 0) + row.weight);
    teamWeight.set(row.away, (teamWeight.get(row.away) || 0) + row.weight);
  }

  return {
    asOf: cutoff,
    base,
    homeAdv,
    attack,
    defence,
    teamWeight,
    sample: rows.length,
    options: opt,
  };
}

function blendTarget(goals, xg, weight) {
  if (!Number.isFinite(xg) || weight <= 0) return goals;
  return (1 - weight) * goals + weight * xg;
}

function centre(map) {
  if (!map.size) return;
  let sum = 0;
  for (const value of map.values()) sum += value;
  const mean = sum / map.size;
  for (const [key, value] of map) map.set(key, value - mean);
}

// ---------- forecasting ----------

export function teamRating(ratings, team) {
  const opt = ratings.options;
  if (ratings.attack.has(team)) {
    return {
      attack: ratings.attack.get(team),
      defence: ratings.defence.get(team),
      weight: ratings.teamWeight.get(team) || 0,
      promoted: false,
    };
  }
  return { attack: opt.promotedAttack, defence: opt.promotedDefence, weight: 0, promoted: true };
}

export function expectedGoals(ratings, home, away) {
  const h = teamRating(ratings, home);
  const a = teamRating(ratings, away);
  const homeXg = Math.exp(ratings.base + ratings.homeAdv + h.attack + a.defence);
  const awayXg = Math.exp(ratings.base - ratings.homeAdv + a.attack + h.defence);
  return { homeXg, awayXg, home: h, away: a };
}

export function scoreMatrix(homeXg, awayXg, { rho = DEFAULT_MODEL_OPTIONS.rho, maxGoals = DEFAULT_MODEL_OPTIONS.maxGoals } = {}) {
  const homeP = poissonRow(homeXg, maxGoals);
  const awayP = poissonRow(awayXg, maxGoals);
  const matrix = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h += 1) {
    const row = [];
    for (let a = 0; a <= maxGoals; a += 1) {
      const value = Math.max(0, homeP[h] * awayP[a] * tau(h, a, homeXg, awayXg, rho));
      row.push(value);
      total += value;
    }
    matrix.push(row);
  }
  for (const row of matrix) for (let a = 0; a < row.length; a += 1) row[a] /= total;
  return matrix;
}

function tau(h, a, lh, la, rho) {
  if (h === 0 && a === 0) return 1 - lh * la * rho;
  if (h === 0 && a === 1) return 1 + lh * rho;
  if (h === 1 && a === 0) return 1 + la * rho;
  if (h === 1 && a === 1) return 1 - rho;
  return 1;
}

function poissonRow(lambda, maxGoals) {
  const row = [Math.exp(-lambda)];
  for (let goals = 1; goals <= maxGoals; goals += 1) row.push(row[goals - 1] * lambda / goals);
  return row;
}

export function summarizeMatrix(matrix) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let btts = 0;
  const totals = [];
  const scores = [];
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      const p = matrix[h][a];
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
      if (h > 0 && a > 0) btts += p;
      totals[h + a] = (totals[h + a] || 0) + p;
      scores.push({ score: `${h}-${a}`, homeGoals: h, awayGoals: a, probability: p });
    }
  }
  scores.sort((left, right) => right.probability - left.probability);
  const overLine = (line) => totals.reduce((sum, p, goals) => (goals > line ? sum + (p || 0) : sum), 0);
  return {
    home,
    draw,
    away,
    btts,
    over15: overLine(1.5),
    over25: overLine(2.5),
    over35: overLine(3.5),
    totals: totals.map((p) => p || 0),
    scores,
  };
}

// Asian handicap for the home side at a quarter/half/whole line.
// Returns expected win/push/lose shares from the home team's point of view.
export function asianHandicap(matrix, line) {
  const parts = Number.isInteger(line * 2) ? [line] : [line - 0.25, line + 0.25];
  let win = 0;
  let push = 0;
  let lose = 0;
  for (const part of parts) {
    for (let h = 0; h < matrix.length; h += 1) {
      for (let a = 0; a < matrix[h].length; a += 1) {
        const margin = h - a + part;
        const p = matrix[h][a] / parts.length;
        if (Math.abs(margin) < 1e-9) push += p;
        else if (margin > 0) win += p;
        else lose += p;
      }
    }
  }
  return { line, win, push, lose };
}

// Remove the bookmaker margin from decimal odds.
export function impliedProbabilities(oddsHome, oddsDraw, oddsAway) {
  const values = [oddsHome, oddsDraw, oddsAway].map(Number);
  if (!values.every((value) => Number.isFinite(value) && value > 1)) return null;
  const raw = values.map((value) => 1 / value);
  const sum = raw[0] + raw[1] + raw[2];
  return { home: raw[0] / sum, draw: raw[1] / sum, away: raw[2] / sum, margin: sum - 1 };
}

export function impliedOverUnder(oddsOver, oddsUnder) {
  const over = Number(oddsOver);
  const under = Number(oddsUnder);
  if (!(over > 1 && under > 1)) return null;
  const sum = 1 / over + 1 / under;
  return { over: 1 / over / sum, under: 1 / under / sum };
}

// Probability of going over a goal line, ignoring pushes (works for .5, whole and quarter lines).
export function overProbability(totals, line) {
  const parts = Number.isInteger(line * 2) ? [line] : [line - 0.25, line + 0.25];
  let result = 0;
  for (const part of parts) {
    let over = 0;
    let under = 0;
    totals.forEach((p, goals) => {
      if (goals > part + 1e-9) over += p || 0;
      else if (goals < part - 1e-9) under += p || 0;
    });
    result += over + under > 0 ? over / (over + under) / parts.length : 0;
  }
  return result;
}

// Find (homeXg, awayXg) whose Dixon-Coles matrix reproduces target 1X2 and over-2.5 probabilities.
export function solveExpectedGoals(target, start, { rho = DEFAULT_MODEL_OPTIONS.rho } = {}) {
  let lh = Math.log(Math.max(0.15, start.homeXg));
  let la = Math.log(Math.max(0.15, start.awayXg));
  const loss = (x, y) => {
    const summary = summarizeMatrix(scoreMatrix(Math.exp(x), Math.exp(y), { rho, maxGoals: 8 }));
    let value = (summary.home - target.home) ** 2 + (summary.away - target.away) ** 2 + (summary.draw - target.draw) ** 2;
    if (target.total) value += 0.6 * (overProbability(summary.totals, target.total.line) - target.total.over) ** 2;
    else if (Number.isFinite(target.over25)) value += 0.6 * (summary.over25 - target.over25) ** 2;
    return value;
  };
  let step = 0.25;
  let current = loss(lh, la);
  for (let iteration = 0; iteration < 80 && step > 0.002; iteration += 1) {
    let improved = false;
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) {
      const candidate = loss(lh + dx, la + dy);
      if (candidate < current) {
        current = candidate;
        lh += dx;
        la += dy;
        improved = true;
        break;
      }
    }
    if (!improved) step /= 2;
  }
  return { homeXg: Math.exp(lh), awayXg: Math.exp(la) };
}

// Full forecast for one fixture.
export function forecastMatch(ratings, home, away, { market = null, options = {} } = {}) {
  const opt = { ...ratings.options, ...options };
  const model = expectedGoals(ratings, home, away);
  const modelMatrix = scoreMatrix(model.homeXg, model.awayXg, { rho: opt.rho, maxGoals: opt.maxGoals });
  const modelSummary = summarizeMatrix(modelMatrix);

  let homeXg = model.homeXg;
  let awayXg = model.awayXg;
  let blend = null;
  const oneXTwo = market?.oneXTwo || null;
  if (oneXTwo) {
    const w = opt.marketWeight;
    const target = {
      home: w * oneXTwo.home + (1 - w) * modelSummary.home,
      draw: w * oneXTwo.draw + (1 - w) * modelSummary.draw,
      away: w * oneXTwo.away + (1 - w) * modelSummary.away,
    };
    // Without a totals market, anchor the goal total to the model so fitting 1X2 alone
    // does not drift it.
    const total = market.total || (market.overUnder25 ? { line: 2.5, over: market.overUnder25.over } : null);
    if (total) {
      target.total = { line: total.line, over: w * total.over + (1 - w) * overProbability(modelSummary.totals, total.line) };
    } else {
      target.over25 = modelSummary.over25;
    }
    const solved = solveExpectedGoals(target, model, { rho: opt.rho });
    homeXg = solved.homeXg;
    awayXg = solved.awayXg;
    blend = { weight: w, target };
  }

  const matrix = blend ? scoreMatrix(homeXg, awayXg, { rho: opt.rho, maxGoals: opt.maxGoals }) : modelMatrix;
  const summary = blend ? summarizeMatrix(matrix) : modelSummary;
  return {
    homeXg,
    awayXg,
    matrix,
    summary,
    model: {
      homeXg: model.homeXg,
      awayXg: model.awayXg,
      home: modelSummary.home,
      draw: modelSummary.draw,
      away: modelSummary.away,
      over25: modelSummary.over25,
    },
    market: oneXTwo ? { ...oneXTwo, over25: market.overUnder25?.over ?? (market.total?.line === 2.5 ? market.total.over : null) } : null,
    blend,
    ratings: {
      home: model.home,
      away: model.away,
      homeAdvantage: Math.exp(2 * ratings.homeAdv),
      leagueGoals: Math.exp(ratings.base) * 2,
    },
  };
}

// Pick the result to show. With a strong draw probability and a near-even match the draw is
// the honest call; otherwise the side with the highest probability.
export function resultPick(summary) {
  const entries = [["home", summary.home], ["draw", summary.draw], ["away", summary.away]];
  entries.sort((left, right) => right[1] - left[1]);
  return entries[0][0];
}

// Most likely score that agrees with the predicted result, so the headline score never
// contradicts the 1X2 pick (e.g. showing 1-1 while calling a home win).
export function headlineScore(summary, pick = resultPick(summary)) {
  const agrees = (score) => (pick === "home" ? score.homeGoals > score.awayGoals
    : pick === "away" ? score.homeGoals < score.awayGoals
      : score.homeGoals === score.awayGoals);
  return summary.scores.find(agrees) || summary.scores[0];
}
