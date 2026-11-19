// Season replay for the ratings model: every match is forecast with only the data
// that existed the day before kickoff. Also scores the bookmaker odds as a yardstick.

import { csvTeamZh } from "./csv-team-names.js";
import {
  fitRatings, forecastMatch, headlineScore, impliedOverUnder, impliedProbabilities, resultPick,
} from "./ratings-model.js";

export function backtestSeason({ matches, season, competition }) {
  const seasonMatches = matches.filter((match) => match.season === season && Number.isFinite(match.hg) && Number.isFinite(match.ag));
  const records = [];
  let ratings = null;
  let ratingsDay = "";
  for (const match of seasonMatches) {
    const day = new Date(match.time).toISOString().slice(0, 10);
    if (day !== ratingsDay) {
      ratings = fitRatings(matches, { asOf: Date.parse(`${day}T00:00:00Z`) });
      ratingsDay = day;
    }
    const oneXTwo = match.odds ? impliedProbabilities(match.odds.home, match.odds.draw, match.odds.away) : null;
    const overUnder25 = match.ouOdds ? impliedOverUnder(match.ouOdds.over, match.ouOdds.under) : null;
    const result = forecastMatch(ratings, match.home, match.away, { market: oneXTwo ? { oneXTwo, overUnder25 } : null });
    const pick = resultPick(result.summary);
    const headline = headlineScore(result.summary, pick);
    const actual = match.hg > match.ag ? "home" : match.hg < match.ag ? "away" : "draw";
    const actualScore = `${match.hg}-${match.ag}`;
    const top3 = result.summary.scores.slice(0, 3).map((score) => score.score);
    const marketPick = oneXTwo ? Object.entries({ home: oneXTwo.home, draw: oneXTwo.draw, away: oneXTwo.away }).sort((l, r) => r[1] - l[1])[0][0] : null;
    records.push({
      competitionId: competition.id,
      competitionName: competition.nameZh,
      date: new Date(match.time).toISOString().slice(0, 10),
      home: csvTeamZh(match.home),
      away: csvTeamZh(match.away),
      probabilities: {
        home: round4(result.summary.home), draw: round4(result.summary.draw), away: round4(result.summary.away), over25: round4(result.summary.over25),
      },
      expectedGoals: { home: round2(result.homeXg), away: round2(result.awayXg) },
      pick,
      predictedScore: headline.score,
      top3,
      actualScore,
      actual,
      usedOdds: Boolean(oneXTwo),
      market: oneXTwo ? { home: round4(oneXTwo.home), draw: round4(oneXTwo.draw), away: round4(oneXTwo.away) } : null,
      hits: {
        result: pick === actual,
        total25: (result.summary.over25 >= 0.5) === (match.hg + match.ag > 2.5),
        exactScore: headline.score === actualScore,
        top3Score: top3.includes(actualScore),
        marketResult: marketPick ? marketPick === actual : null,
      },
      logLoss: -Math.log(Math.max(1e-9, result.summary[actual])),
      rps: rps(result.summary, actual),
      marketLogLoss: oneXTwo ? -Math.log(Math.max(1e-9, oneXTwo[actual])) : null,
    });
  }
  return summarize(records, { season, competition });
}

export function summarize(records, { season, competition }) {
  const n = records.length;
  const rate = (key) => {
    const hits = records.filter((record) => record.hits[key]).length;
    return { sample: n, hits, rate: n ? round4(hits / n) : 0 };
  };
  const withMarket = records.filter((record) => record.hits.marketResult !== null);
  const avg = (list, key) => (list.length ? round4(list.reduce((sum, record) => sum + record[key], 0) / list.length) : null);
  // confidence buckets: how often the pick lands when the model is X% sure
  const buckets = [[0, 0.45], [0.45, 0.55], [0.55, 0.65], [0.65, 1.01]].map(([low, high]) => {
    const group = records.filter((record) => {
      const p = record.probabilities[record.pick];
      return p >= low && p < high;
    });
    const hits = group.filter((record) => record.hits.result).length;
    const expected = group.reduce((sum, record) => sum + record.probabilities[record.pick], 0);
    return {
      label: `${Math.round(low * 100)}–${Math.min(100, Math.round(high * 100))}%`,
      sample: group.length,
      hitRate: group.length ? round4(hits / group.length) : null,
      expected: group.length ? round4(expected / group.length) : null,
    };
  });
  return {
    refreshedAt: new Date().toISOString(),
    competition: competition ? { id: competition.id, nameZh: competition.nameZh } : null,
    season,
    sample: n,
    metrics: {
      result: rate("result"),
      total25: rate("total25"),
      exactScore: rate("exactScore"),
      top3Score: rate("top3Score"),
      logLoss: avg(records, "logLoss"),
      rps: avg(records, "rps"),
    },
    market: withMarket.length ? {
      sample: withMarket.length,
      result: round4(withMarket.filter((record) => record.hits.marketResult).length / withMarket.length),
      logLoss: avg(withMarket, "marketLogLoss"),
    } : null,
    calibration: buckets,
    records: [...records].reverse(),
    methodology: "逐场只用开赛前一天之前的赛果、xG 与赛前赔率重新拟合球队攻防评级再预测，不读取任何赛后数据。",
  };
}

export function mergeBacktests(reports, { season }) {
  const records = reports.flatMap((report) => report.records).sort((left, right) => right.date.localeCompare(left.date));
  const merged = summarize([...records].reverse(), { season, competition: { id: "ALL", nameZh: "五大联赛" } });
  merged.leagues = reports.map((report) => ({
    competition: report.competition, sample: report.sample, metrics: report.metrics, market: report.market,
  }));
  return merged;
}

function rps(p, actual) {
  const o = { home: actual === "home" ? 1 : 0, draw: actual === "draw" ? 1 : 0 };
  const c1 = p.home - o.home;
  const c2 = p.home + p.draw - o.home - o.draw;
  return (c1 * c1 + c2 * c2) / 2;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
