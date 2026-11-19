import test from "node:test";
import assert from "node:assert/strict";

import { aggregateBacktestReports, replayLeagueSeason } from "../src/league-backtest.js";

const team = (id, name) => ({ id, name, displayName: name, code: id });
const a = team("A", "甲队");
const b = team("B", "乙队");
const c = team("C", "丙队");
const d = team("D", "D Team");
const match = (id, kickoffUtc, home, away, homeGoals, awayGoals, status = "FINISHED") => ({
  id: `PL:2026:${id}`,
  competitionId: "PL",
  season: 2026,
  kickoffUtc,
  kickoffBeijing: kickoffUtc,
  status,
  finished: status === "FINISHED",
  home,
  away,
  score: { home: homeGoals, away: awayGoals },
});

const seasonMatches = [
  match("1", "2026-08-01T12:00:00Z", a, b, 2, 0),
  match("2", "2026-08-08T12:00:00Z", c, a, 1, 1),
  match("3", "2026-08-15T12:00:00Z", b, c, 0, 1),
  match("4", "2026-08-22T12:00:00Z", a, c, null, null, "SCHEDULED"),
];

test("回测只统计完场比赛并输出核心市场命中率", () => {
  const report = replayLeagueSeason({
    matches: seasonMatches,
    competition: { id: "PL", nameZh: "英超", modelProfile: { goalMean: 2.85, homeAdvantage: 0.19 } },
  });
  assert.equal(report.sample, 3);
  assert.equal(report.records.length, 3);
  assert.ok(report.metrics.result.sample === 3);
  assert.ok(report.metrics.exactScore.sample === 3);
  assert.ok(report.metrics.top3Score.sample === 3);
  assert.ok(report.metrics.total25.sample === 3);
  assert.ok(report.records.every((record) => record.actualScore && record.predictedScore));
});

test("未来比赛结果不会改变较早场次的回测预测", () => {
  const base = replayLeagueSeason({
    matches: seasonMatches,
    competition: { id: "PL", nameZh: "英超", modelProfile: { goalMean: 2.85, homeAdvantage: 0.19 } },
  });
  const withFuture = replayLeagueSeason({
    matches: [...seasonMatches, match("5", "2026-09-01T12:00:00Z", b, a, 9, 0)],
    competition: { id: "PL", nameZh: "英超", modelProfile: { goalMean: 2.85, homeAdvantage: 0.19 } },
  });
  const withFutureById = new Map(withFuture.records.map((record) => [record.matchId, record.predictedScore]));
  assert.deepEqual(base.records.map((record) => withFutureById.get(record.matchId)), base.records.map((record) => record.predictedScore));
});

test("未完场比赛不会进入命中统计", () => {
  const report = replayLeagueSeason({
    matches: [seasonMatches[3]],
    competition: { id: "PL", nameZh: "英超", modelProfile: { goalMean: 2.85, homeAdvantage: 0.19 } },
  });
  assert.equal(report.sample, 0);
  assert.deepEqual(report.records, []);
});

test("合并多联赛回测时按样本加权命中率", () => {
  const first = replayLeagueSeason({
    matches: seasonMatches,
    competition: { id: "PL", nameZh: "英超", modelProfile: { goalMean: 2.85, homeAdvantage: 0.19 } },
  });
  const second = { ...first, competition: { id: "PD", nameZh: "西甲" } };
  const combined = aggregateBacktestReports([first, second]);
  assert.equal(combined.sample, 6);
  assert.equal(combined.records.length, 6);
  assert.equal(combined.metrics.result.hits, first.metrics.result.hits * 2);
  assert.equal(combined.metrics.result.rate, first.metrics.result.rate);
});

test("finished matches with null scores are excluded from backtest", () => {
  const report = replayLeagueSeason({
    matches: [match("null-score", "2026-08-29T12:00:00Z", a, b, null, null, "FINISHED")],
    competition: { id: "PL", nameZh: "Premier League", modelProfile: { goalMean: 2.85, homeAdvantage: 0.19 } },
  });
  assert.equal(report.sample, 0);
  assert.deepEqual(report.records, []);
});

test("backtest preserves decisive expected-goal gaps instead of applying the legacy cap", () => {
  const dominantSeason = [
    match("d1", "2026-08-01T12:00:00Z", a, b, 4, 0),
    match("d2", "2026-08-02T12:00:00Z", c, d, 3, 0),
    match("d3", "2026-08-08T12:00:00Z", c, a, 0, 3),
    match("d4", "2026-08-09T12:00:00Z", d, b, 0, 2),
    match("d5", "2026-08-15T12:00:00Z", a, c, 4, 0),
    match("d6", "2026-08-16T12:00:00Z", b, d, 3, 0),
    match("d7", "2026-08-23T12:00:00Z", a, d, 3, 0),
  ];
  const report = replayLeagueSeason({
    matches: dominantSeason,
    competition: { id: "PL", nameZh: "Premier League", modelProfile: { goalMean: 2.85, homeAdvantage: 0.19 } },
  });
  const targetRecord = report.records.find((record) => record.matchId.endsWith(":d7"));

  assert.ok(targetRecord.modelInput.leagueAdjustment.goalDiff > 1.5);
  assert.ok(targetRecord.modelInput.homeXg - targetRecord.modelInput.awayXg > 1.8);
  assert.ok(!["1-1", "2-1"].includes(targetRecord.predictedScore));
});
