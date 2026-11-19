import test from "node:test";
import assert from "node:assert/strict";

import { buildLeagueContext, deriveLeagueModelAdjustment } from "../src/analysis-context.js";

const teams = {
  arsenal: { id: "1", name: "Arsenal", displayName: "阿森纳", code: "ARS" },
  chelsea: { id: "2", name: "Chelsea", displayName: "切尔西", code: "CHE" },
  liverpool: { id: "3", name: "Liverpool", displayName: "利物浦", code: "LIV" },
};

const target = {
  id: "PL:2026:99",
  competitionId: "PL",
  kickoffUtc: "2026-10-10T15:00:00Z",
  home: teams.arsenal,
  away: teams.chelsea,
};

const standings = {
  tables: {
    total: [
      { position: 1, team: teams.arsenal, playedGames: 7, won: 6, draw: 1, lost: 0, points: 19, goalsFor: 18, goalsAgainst: 5 },
      { position: 5, team: teams.chelsea, playedGames: 7, won: 3, draw: 2, lost: 2, points: 11, goalsFor: 12, goalsAgainst: 9 },
    ],
    home: [{ position: 1, team: teams.arsenal, playedGames: 4, won: 4, draw: 0, lost: 0, points: 12, goalsFor: 11, goalsAgainst: 2 }],
    away: [{ position: 7, team: teams.chelsea, playedGames: 4, won: 1, draw: 1, lost: 2, points: 4, goalsFor: 5, goalsAgainst: 7 }],
  },
};

const completedMatches = [
  { id: "m1", competitionId: "PL", status: "FINISHED", kickoffUtc: "2026-10-01T15:00:00Z", home: teams.arsenal, away: teams.liverpool, score: { home: 3, away: 1 } },
  { id: "m2", competitionId: "PL", status: "FINISHED", kickoffUtc: "2026-09-25T15:00:00Z", home: teams.chelsea, away: teams.arsenal, score: { home: 0, away: 2 } },
  { id: "m3", competitionId: "PL", status: "FINISHED", kickoffUtc: "2026-09-18T15:00:00Z", home: teams.liverpool, away: teams.chelsea, score: { home: 1, away: 1 } },
];

test("构建排名、主客场和近期状态上下文", () => {
  const context = buildLeagueContext({ match: target, standings, matches: completedMatches });
  assert.equal(context.home.standing.position, 1);
  assert.equal(context.away.standing.position, 5);
  assert.equal(context.home.venueStanding.pointsPerGame, 3);
  assert.equal(context.away.venueStanding.pointsPerGame, 1);
  assert.equal(context.home.form.played, 2);
  assert.equal(context.home.form.points, 6);
  assert.equal(context.away.form.played, 2);
  assert.equal(context.away.form.points, 1);
});

test("只使用目标比赛开球前的数据并生成交锋记录", () => {
  const futureMatch = { id: "future", competitionId: "PL", status: "FINISHED", kickoffUtc: "2026-11-01T15:00:00Z", home: teams.chelsea, away: teams.arsenal, score: { home: 9, away: 0 } };
  const context = buildLeagueContext({ match: target, standings, matches: [...completedMatches, futureMatch] });
  assert.equal(context.home.form.played, 2);
  assert.equal(context.headToHead.played, 1);
  assert.equal(context.headToHead.matches[0].score, "0-2");
});

test("排名、近况与主客场优势共同形成模型修正", () => {
  const context = buildLeagueContext({ match: target, standings, matches: completedMatches });
  const adjustment = deriveLeagueModelAdjustment(context, { goalMean: 2.85, homeAdvantage: 0.19 });
  assert.ok(adjustment.goalDiff > 0.5);
  assert.ok(adjustment.goalDiff <= 2.4);
  assert.ok(adjustment.totalGoals >= 2.2 && adjustment.totalGoals <= 3.5);
  assert.match(adjustment.detail, /积分榜|近10场|主客场/);
});

test("aligned strength signals are not compressed into a generic one-goal edge", () => {
  const context = {
    home: {
      standing: { available: true, position: 1, playedGames: 20, pointsPerGame: 2.55, goalsForPerGame: 2.45, goalsAgainstPerGame: 0.7, goalDifference: 35 },
      venueStanding: { available: true, position: 1, playedGames: 10, pointsPerGame: 2.8, goalsForPerGame: 2.7, goalsAgainstPerGame: 0.5, goalDifference: 22 },
      form: { played: 10, pointsPerGame: 2.7, goalsForPerGame: 2.6, goalsAgainstPerGame: 0.6 },
    },
    away: {
      standing: { available: true, position: 19, playedGames: 20, pointsPerGame: 0.65, goalsForPerGame: 0.75, goalsAgainstPerGame: 2.1, goalDifference: -27 },
      venueStanding: { available: true, position: 19, playedGames: 10, pointsPerGame: 0.4, goalsForPerGame: 0.6, goalsAgainstPerGame: 2.4, goalDifference: -18 },
      form: { played: 10, pointsPerGame: 0.5, goalsForPerGame: 0.7, goalsAgainstPerGame: 2.2 },
    },
  };

  const adjustment = deriveLeagueModelAdjustment(context, { goalMean: 2.85, homeAdvantage: 0.19 });

  assert.ok(adjustment.goalDiff >= 1.75, `expected a decisive gap, received ${adjustment.goalDiff}`);
  assert.ok(adjustment.totalGoals >= 2.75, `expected room for a multi-goal favorite, received ${adjustment.totalGoals}`);
});

test("balanced teams remain close after nonlinear strength calibration", () => {
  const context = {
    home: {
      standing: { available: true, position: 8, playedGames: 20, pointsPerGame: 1.45, goalsForPerGame: 1.35, goalsAgainstPerGame: 1.25, goalDifference: 2 },
      venueStanding: { available: true, position: 7, playedGames: 10, pointsPerGame: 1.5, goalsForPerGame: 1.4, goalsAgainstPerGame: 1.2, goalDifference: 2 },
      form: { played: 10, pointsPerGame: 1.4, goalsForPerGame: 1.3, goalsAgainstPerGame: 1.2 },
    },
    away: {
      standing: { available: true, position: 9, playedGames: 20, pointsPerGame: 1.4, goalsForPerGame: 1.3, goalsAgainstPerGame: 1.25, goalDifference: 1 },
      venueStanding: { available: true, position: 9, playedGames: 10, pointsPerGame: 1.4, goalsForPerGame: 1.25, goalsAgainstPerGame: 1.25, goalDifference: 0 },
      form: { played: 10, pointsPerGame: 1.5, goalsForPerGame: 1.4, goalsAgainstPerGame: 1.2 },
    },
  };

  const adjustment = deriveLeagueModelAdjustment(context, { goalMean: 2.85, homeAdvantage: 0.19 });

  assert.ok(Math.abs(adjustment.goalDiff) <= 0.4, `balanced matchup was overstated: ${adjustment.goalDiff}`);
});

test("a promoted team missing from previous-season standings receives a conservative promoted baseline", () => {
  const context = {
    crossSeasonForm: true,
    home: {
      standing: { available: true, position: 2, playedGames: 38, pointsPerGame: 2.21, goalsForPerGame: 2.05, goalsAgainstPerGame: 0.84, goalDifference: 46 },
      venueStanding: { available: true, position: 2, playedGames: 19, pointsPerGame: 2.42, goalsForPerGame: 2.21, goalsAgainstPerGame: 0.68, goalDifference: 29 },
      form: { played: 10, pointsPerGame: 2.3, goalsForPerGame: 2.1, goalsAgainstPerGame: 0.8 },
    },
    away: {
      standing: { available: false, position: null, playedGames: 0, pointsPerGame: 0, goalsForPerGame: 0, goalsAgainstPerGame: 0, goalDifference: 0 },
      venueStanding: { available: false, position: null, playedGames: 0, pointsPerGame: 0, goalsForPerGame: 0, goalsAgainstPerGame: 0, goalDifference: 0 },
      form: { played: 0, pointsPerGame: 0, goalsForPerGame: 0, goalsAgainstPerGame: 0 },
    },
  };

  const adjustment = deriveLeagueModelAdjustment(context, { goalMean: 2.85, homeAdvantage: 0.19 });

  assert.ok(adjustment.goalDiff >= 1.15, `promoted-team gap collapsed to ${adjustment.goalDiff}`);
  assert.equal(adjustment.components.awayBaseline, "promoted");
});
