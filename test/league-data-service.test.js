import test from "node:test";
import assert from "node:assert/strict";

import { createLeagueDataService, toBeijingIso } from "../src/league-data-service.js";

const matchPayload = {
  competition: { code: "PL", name: "Premier League" },
  filters: { season: "2026" },
  matches: [{
    id: 1001,
    utcDate: "2026-08-15T14:00:00Z",
    status: "SCHEDULED",
    matchday: 1,
    stage: "REGULAR_SEASON",
    homeTeam: { id: 10, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS", crest: "arsenal.svg" },
    awayTeam: { id: 20, name: "Chelsea FC", shortName: "Chelsea", tla: "CHE", crest: "chelsea.svg" },
    score: { fullTime: { home: null, away: null } },
  }],
};

const standingsPayload = {
  competition: { code: "PL", name: "Premier League" },
  season: { startDate: "2026-08-01", endDate: "2027-05-31", currentMatchday: 1 },
  standings: [{
    type: "TOTAL",
    table: [{ position: 1, team: { id: 10, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS", crest: "arsenal.svg" }, playedGames: 1, won: 1, draw: 0, lost: 0, points: 3, goalsFor: 2, goalsAgainst: 0, goalDifference: 2 }],
  }],
};

const espnSchedulePayload = {
  events: [{
    id: "401879301",
    date: "2026-08-21T19:00:00Z",
    season: { year: 2026 },
    status: { type: { name: "STATUS_SCHEDULED", state: "pre", completed: false } },
    competitions: [{
      id: "401879301",
      date: "2026-08-21T19:00:00Z",
      status: { type: { name: "STATUS_SCHEDULED", state: "pre", completed: false } },
      venue: { id: "2267", fullName: "Emirates Stadium", address: { city: "London", country: "England" } },
      competitors: [
        { id: "359", homeAway: "home", score: "0", team: { id: "359", displayName: "Arsenal", shortDisplayName: "Arsenal", abbreviation: "ARS", logo: "arsenal.png" } },
        { id: "388", homeAway: "away", score: "0", team: { id: "388", displayName: "Coventry City", shortDisplayName: "Coventry", abbreviation: "COV", logo: "coventry.png" } },
      ],
    }],
  }],
};

const espnStandingsPayload = {
  children: [{
    standings: {
      entries: [{
        team: { id: "359", displayName: "Arsenal", shortDisplayName: "Arsenal", abbreviation: "ARS", logos: [{ href: "arsenal.png" }] },
        stats: [
          { name: "gamesPlayed", value: 38 },
          { name: "wins", value: 26 },
          { name: "ties", value: 7 },
          { name: "losses", value: 5 },
          { name: "points", value: 85 },
          { name: "pointsFor", value: 71 },
          { name: "pointsAgainst", value: 27 },
          { name: "pointDifferential", value: 44 },
          { name: "rank", value: 1 },
        ],
      }],
    },
  }],
};

test("将 football-data 比赛标准化为带联赛命名空间的对象", async () => {
  const service = createLeagueDataService({
    apiKey: "test-key",
    fetchJson: async (url) => url.includes("standings") ? standingsPayload : matchPayload,
  });
  const result = await service.getMatches({ competitionId: "PL", season: 2026 });
  assert.equal(result.matches[0].id, "PL:2026:1001");
  assert.equal(result.matches[0].competitionId, "PL");
  assert.equal(result.matches[0].kickoffBeijing, "2026-08-15T22:00:00+08:00");
  assert.equal(result.matches[0].home.name, "Arsenal FC");
});

test("标准化总积分榜", async () => {
  const service = createLeagueDataService({
    apiKey: "test-key",
    fetchJson: async () => standingsPayload,
  });
  const result = await service.getStandings({ competitionId: "PL", season: 2026 });
  assert.equal(result.competition.id, "PL");
  assert.equal(result.tables.total[0].position, 1);
  assert.equal(result.tables.total[0].points, 3);
});

test("football-data 无权限时自动使用 ESPN 完整赛程", async () => {
  const requestedUrls = [];
  const service = createLeagueDataService({
    apiKey: "restricted-key",
    fetchJson: async (url) => {
      requestedUrls.push(url);
      if (url.includes("api.football-data.org")) throw new Error("403 restricted");
      if (url.includes("site.api.espn.com")) return espnSchedulePayload;
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  const result = await service.getMatches({ competitionId: "PL", season: 2026 });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, "PL:2026:espn-401879301");
  assert.equal(result.matches[0].home.displayName, "阿森纳");
  assert.equal(result.matches[0].away.displayName, "考文垂");
  assert.equal(result.matches[0].score.home, null);
  assert.equal(result.matches[0].score.away, null);
  assert.equal(result.sourceLabel, "ESPN Soccer API");
  assert.match(requestedUrls[1], /eng\.1\/scoreboard/);
  assert.match(requestedUrls[1], /dates=20260701-20270630/);
});

test("未配置 football-data 密钥时直接使用 ESPN 避免无效 403 请求", async () => {
  const requestedUrls = [];
  const service = createLeagueDataService({
    fetchJson: async (url) => {
      requestedUrls.push(url);
      return espnSchedulePayload;
    },
  });

  const result = await service.getMatches({ competitionId: "PL", season: 2026 });
  assert.equal(result.matches.length, 1);
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /site\.api\.espn\.com/);
});

test("未配置 football-data 密钥时使用 ESPN 积分榜保留实力数据", async () => {
  const requestedUrls = [];
  const service = createLeagueDataService({
    fetchJson: async (url) => {
      requestedUrls.push(url);
      return espnStandingsPayload;
    },
  });

  const result = await service.getStandings({ competitionId: "PL", season: 2025 });

  assert.equal(result.sourceLabel, "ESPN Soccer API");
  assert.equal(result.tables.total[0].team.displayName, "阿森纳");
  assert.equal(result.tables.total[0].position, 1);
  assert.equal(result.tables.total[0].points, 85);
  assert.equal(result.tables.total[0].goalDifference, 44);
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /apis\/v2\/sports\/soccer\/eng\.1\/standings/);
});

test("北京时间 ISO 转换跨日正确", () => {
  assert.equal(toBeijingIso("2026-12-01T20:30:00Z"), "2026-12-02T04:30:00+08:00");
});

test("拒绝世界杯和未知联赛", async () => {
  const service = createLeagueDataService({ fetchJson: async () => matchPayload });
  await assert.rejects(() => service.getMatches({ competitionId: "WC", season: 2026 }), /不支持的联赛/);
});

test("获取球队开赛前最近完场记录用于跨赛季状态", async () => {
  let requestedUrl = "";
  const recentPayload = {
    matches: [{
      ...matchPayload.matches[0],
      id: 900,
      utcDate: "2026-05-10T14:00:00Z",
      status: "FINISHED",
      score: { fullTime: { home: 3, away: 1 } },
    }],
  };
  const service = createLeagueDataService({
    now: () => new Date("2026-07-20T00:00:00Z"),
    fetchJson: async (url) => { requestedUrl = url; return recentPayload; },
  });
  const result = await service.getTeamRecentMatches({ competitionId: "PL", teamId: 10, before: "2026-08-15T14:00:00Z", limit: 10 });
  assert.match(requestedUrl, /\/teams\/10\/matches/);
  assert.match(requestedUrl, /status=FINISHED/);
  assert.match(requestedUrl, /dateTo=2026-07-20/);
  assert.match(requestedUrl, /dateFrom=/);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].score.home, 3);
  assert.equal(result.matches[0].home.displayName, "阿森纳");
});

test("Beijing ISO conversion preserves milliseconds", () => {
  assert.equal(toBeijingIso("2026-12-01T20:30:00.123Z"), "2026-12-02T04:30:00.123+08:00");
});

test("recent matches retain their source competition instead of being relabelled", async () => {
  const recentPayload = {
    matches: [{
      ...matchPayload.matches[0],
      id: 901,
      utcDate: "2026-05-12T19:00:00Z",
      status: "FINISHED",
      competition: { code: "CL", name: "UEFA Champions League" },
      score: { fullTime: { home: 2, away: 1 } },
    }],
  };
  const service = createLeagueDataService({
    now: () => new Date("2026-07-20T00:00:00Z"),
    fetchJson: async () => recentPayload,
  });
  const result = await service.getTeamRecentMatches({ competitionId: "PL", teamId: 10, before: "2026-08-15T14:00:00Z" });
  assert.equal(result.matches[0].competitionId, "CL");
  assert.equal(result.matches[0].competition.nameEn, "UEFA Champions League");
});

test("competition metadata exposes five selectable seasons", () => {
  const service = createLeagueDataService({
    now: () => new Date("2026-07-20T00:00:00Z"),
    fetchJson: async () => matchPayload,
  });
  const result = service.listCompetitions();
  assert.deepEqual(result.competitions[0].seasons, [2026, 2025, 2024, 2023, 2022]);
});
