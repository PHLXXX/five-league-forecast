import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPETITIONS,
  buildMatchId,
  getCompetition,
  listCompetitions,
  normalizeCompetitionId,
} from "../src/competitions.js";

test("只暴露五大联赛", () => {
  assert.deepEqual(Object.keys(COMPETITIONS), ["PL", "FL1", "BL1", "PD", "SA"]);
  assert.deepEqual(listCompetitions().map((item) => item.nameZh), ["英超", "法甲", "德甲", "西甲", "意甲"]);
});

test("识别 football-data、ESPN 和中文联赛别名", () => {
  assert.equal(getCompetition("eng.1").id, "PL");
  assert.equal(getCompetition("西甲").id, "PD");
  assert.equal(normalizeCompetitionId("Serie A"), "SA");
  assert.equal(getCompetition("WC"), null);
});

test("比赛 ID 包含联赛和赛季命名空间", () => {
  assert.equal(buildMatchId("PL", 2026, 12345), "PL:2026:12345");
  assert.throws(() => buildMatchId("WC", 2026, 1), /不支持的联赛/);
});
