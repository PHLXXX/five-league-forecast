import test from "node:test";
import assert from "node:assert/strict";

import { validateCoreRecommendationConsistency } from "../src/recommendation-consistency.js";

test("识别胜负推荐与最高概率比分方向冲突", () => {
  const result = validateCoreRecommendationConsistency({
    primaryScore: { score: "2-0", homeGoals: 2, awayGoals: 0 },
    recommendations: [{ market: "赛果方向", pick: "客胜方向", reason: "测试" }],
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("；"), /赛果.*客胜.*2-0/);
});

test("识别大小球推荐与最高概率比分冲突", () => {
  const result = validateCoreRecommendationConsistency({
    primaryScore: { score: "1-0", homeGoals: 1, awayGoals: 0 },
    totalSummary: { side: "over", line: 2.5 },
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("；"), /大球.*1-0/);
});

test("识别让球穿盘与比分差不足", () => {
  const result = validateCoreRecommendationConsistency({
    primaryScore: { score: "1-0", homeGoals: 1, awayGoals: 0 },
    spreadSummary: { side: "favorite", line: 1.5 },
    spreadLine: { favoriteSide: "home" },
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("；"), /让球.*1.5.*1-0/);
});

test("一致的胜负、比分、让球和大小球通过校验", () => {
  const result = validateCoreRecommendationConsistency({
    primaryScore: { score: "2-0", homeGoals: 2, awayGoals: 0 },
    totalSummary: { side: "under", line: 2.5 },
    spreadSummary: { side: "favorite", line: 1.5 },
    spreadLine: { favoriteSide: "home" },
    recommendations: [{ market: "赛果方向", pick: "主胜方向", reason: "测试" }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});
