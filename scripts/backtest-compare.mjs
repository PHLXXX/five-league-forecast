// Compare the old heuristic model with the new ratings model on past seasons.
// Usage: node scripts/backtest-compare.mjs [seasons=2023,2024,2025] [key=value model options...]
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCompetition } from "../src/competitions.js";
import { createHistoryStore } from "../src/history-data.js";
import { replayLeagueSeason } from "../src/league-backtest.js";
import {
  fitRatings, forecastMatch, headlineScore, impliedOverUnder, impliedProbabilities, resultPick, scoreMatrix, summarizeMatrix,
} from "../src/ratings-model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const seasons = (args.find((arg) => /^\d{4}(,\d{4})*$/.test(arg)) || "2023,2024,2025").split(",").map(Number);
const options = Object.fromEntries(args.filter((arg) => arg.includes("=")).map((arg) => {
  const [key, value] = arg.split("=");
  return [key, Number(value)];
}));
const quiet = args.includes("--quiet");
const store = createHistoryStore({ seedDir: join(root, "data", "history") });
const leagues = ["PL", "BL1", "PD", "SA", "FL1"];

function newStats() {
  return { n: 0, acc: 0, ll: 0, rps: 0, brier: 0, ouN: 0, ouAcc: 0, exact: 0, top3: 0 };
}
function add(stats, probs, actual, extra = {}) {
  const p = { home: probs.home, draw: probs.draw, away: probs.away };
  const pick = Object.entries(p).sort((l, r) => r[1] - l[1])[0][0];
  stats.n += 1;
  stats.acc += pick === actual ? 1 : 0;
  stats.ll += -Math.log(Math.max(1e-9, p[actual]));
  const o = { home: actual === "home" ? 1 : 0, draw: actual === "draw" ? 1 : 0, away: actual === "away" ? 1 : 0 };
  const c1 = p.home - o.home;
  const c2 = p.home + p.draw - o.home - o.draw;
  stats.rps += (c1 * c1 + c2 * c2) / 2;
  stats.brier += (p.home - o.home) ** 2 + (p.draw - o.draw) ** 2 + (p.away - o.away) ** 2;
  if (Number.isFinite(extra.over25)) {
    stats.ouN += 1;
    stats.ouAcc += (extra.over25 >= 0.5) === extra.actualOver ? 1 : 0;
  }
  if (extra.exact !== undefined) stats.exact += extra.exact ? 1 : 0;
  if (extra.top3 !== undefined) stats.top3 += extra.top3 ? 1 : 0;
}
function fmt(name, s) {
  const pct = (v) => `${(100 * v / s.n).toFixed(1)}%`.padStart(6);
  return `${name.padEnd(22)} n=${String(s.n).padStart(5)}  胜平负命中 ${pct(s.acc)}  logloss ${(s.ll / s.n).toFixed(4)}  RPS ${(s.rps / s.n).toFixed(4)}  大小2.5 ${s.ouN ? `${(100 * s.ouAcc / s.ouN).toFixed(1)}%` : "  -  "}  比分 ${pct(s.exact)}  Top3 ${pct(s.top3)}`;
}
const resultOf = (h, a) => (h > a ? "home" : h < a ? "away" : "draw");

const total = { old: newStats(), model: newStats(), blend: newStats(), market: newStats() };
for (const league of leagues) {
  const competition = getCompetition(league);
  const all = await store.getMatches(league, Math.max(...seasons), { seasonsBack: Math.max(...seasons) - 2021 });
  const per = { old: newStats(), model: newStats(), blend: newStats(), market: newStats() };
  for (const season of seasons) {
    const seasonMatches = all.filter((match) => match.season === season && Number.isFinite(match.hg));
    // old model: in-season replay exactly as the app's backtest does it
    const oldInput = seasonMatches.map((match, index) => ({
      id: `${league}:${season}:${index}`,
      competitionId: league,
      season,
      status: "FINISHED",
      kickoffUtc: match.date,
      home: { id: match.home, name: match.home },
      away: { id: match.away, name: match.away },
      score: { home: match.hg, away: match.ag },
    }));
    const report = replayLeagueSeason({ matches: oldInput, competition });
    const oldByKey = new Map(report.records.map((record) => [`${record.home}|${record.away}|${record.kickoffBeijing}`, record]));

    let ratings = null;
    let ratingsDay = "";
    for (const match of seasonMatches) {
      const actual = resultOf(match.hg, match.ag);
      const actualScore = `${match.hg}-${match.ag}`;
      const actualOver = match.hg + match.ag > 2.5;
      const record = oldByKey.get(`${match.home}|${match.away}|${match.date}`);
      if (record) {
        const sm = summarizeMatrix(scoreMatrix(record.modelInput.homeXg, record.modelInput.awayXg, { rho: 0, maxGoals: 7 }));
        for (const target of [per.old, total.old]) {
          add(target, sm, actual, { over25: sm.over25, actualOver, exact: record.predictedScore === actualScore, top3: record.top3Scores.includes(actualScore) });
        }
      }
      const day = match.date.slice(0, 10);
      if (day !== ratingsDay) {
        ratings = fitRatings(all, { asOf: Date.parse(`${day}T00:00:00Z`), options });
        ratingsDay = day;
      }
      const plain = forecastMatch(ratings, match.home, match.away);
      const plainPick = resultPick(plain.summary);
      const plainScore = headlineScore(plain.summary, plainPick).score;
      for (const target of [per.model, total.model]) {
        add(target, plain.summary, actual, {
          over25: plain.summary.over25, actualOver, exact: plainScore === actualScore,
          top3: plain.summary.scores.slice(0, 3).some((s) => s.score === actualScore),
        });
      }
      const oneXTwo = match.odds ? impliedProbabilities(match.odds.home, match.odds.draw, match.odds.away) : null;
      if (oneXTwo) {
        const overUnder25 = match.ouOdds ? impliedOverUnder(match.ouOdds.over, match.ouOdds.under) : null;
        const blended = forecastMatch(ratings, match.home, match.away, { market: { oneXTwo, overUnder25 } });
        const pick = resultPick(blended.summary);
        const score = headlineScore(blended.summary, pick).score;
        for (const target of [per.blend, total.blend]) {
          add(target, blended.summary, actual, {
            over25: blended.summary.over25, actualOver, exact: score === actualScore,
            top3: blended.summary.scores.slice(0, 3).some((s) => s.score === actualScore),
          });
        }
        for (const target of [per.market, total.market]) {
          add(target, oneXTwo, actual, { over25: overUnder25?.over, actualOver });
        }
      }
    }
  }
  if (!quiet) {
    console.log(`\n== ${competition.nameZh} ${seasons.join("/")}`);
    console.log(fmt("旧模型(启发式)", per.old));
    console.log(fmt("新模型(无赔率)", per.model));
    console.log(fmt("新模型+赔率融合", per.blend));
    console.log(fmt("纯赔率参考", per.market));
  }
}
console.log(`\n== 五大联赛合计 ${seasons.join("/")} ${JSON.stringify(options)}`);
console.log(fmt("旧模型(启发式)", total.old));
console.log(fmt("新模型(无赔率)", total.model));
console.log(fmt("新模型+赔率融合", total.blend));
console.log(fmt("纯赔率参考", total.market));
