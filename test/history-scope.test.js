import test from "node:test";
import assert from "node:assert/strict";

import { filterHistoryRecordsForScope, findDateBoundHistoryMatch } from "../src/history-scope.js";

const matches = [
  { id: "PL:2025:1", competitionId: "PL", season: 2025 },
  { id: "PL:2025:2", competitionId: "PL", season: 2025 },
];

test("历史留档只保留当前联赛和赛季能匹配的比赛", () => {
  const records = [
    { matchId: "PL:2025:1", competitionId: "PL", season: 2025 },
    { matchId: "WC:2026:1" },
    { matchId: "PL:2025:2", competitionId: "SA", season: 2025 },
    { matchId: "PL:2025:2", competitionId: "PL", season: 2024 },
  ];

  assert.deepEqual(
    filterHistoryRecordsForScope(records, matches).map((record) => record.matchId),
    ["PL:2025:1"],
  );
});

test("旧留档可通过调用方的别名解析器归入正确赛季", () => {
  const legacy = [{ matchId: "legacy-1", home: "利物浦", away: "阿森纳" }];
  const scoped = filterHistoryRecordsForScope(legacy, matches, (_items, record) =>
    record.matchId === "legacy-1" ? matches[1] : null
  );
  assert.equal(scoped.length, 1);
});

test("旧留档不能仅凭相同主客队跨日期或跨赛季匹配", () => {
  const candidates = [
    { date: "2026-09-01", home: { name: "利物浦" }, away: { name: "阿森纳" } },
  ];
  const helpers = {
    normalizeDate: (value) => String(value || "").slice(0, 10),
    normalizeTeam: (value) => String(value || "").toLowerCase(),
    teamName: (team) => team?.name || "",
    dateMatches: (date, match) => date === match.date,
  };
  assert.equal(findDateBoundHistoryMatch(candidates, { date: "2025-09-01", home: "利物浦", away: "阿森纳" }, helpers), null);
  assert.equal(findDateBoundHistoryMatch(candidates, { date: "2026-09-01", home: "利物浦", away: "阿森纳" }, helpers), candidates[0]);
  assert.equal(findDateBoundHistoryMatch(candidates, { home: "利物浦", away: "阿森纳" }, helpers), null);
});
