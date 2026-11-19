# 五大联赛分析平台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将世界杯专用工具升级为覆盖英超、法甲、德甲、西甲、意甲整季赛程、积分榜、分析推荐和完整回测的统一中文平台。

**Architecture:** 新增赛事配置和联赛数据服务，把 football-data 与 ESPN 的五个联赛端点标准化为统一比赛对象；现有分析引擎继续作为兼容层，但所有世界杯常量改由当前比赛的赛事上下文提供。前端新增联赛、赛季、状态和日期筛选，并把积分榜与历史回测纳入同一工作台。

**Tech Stack:** Node.js 22、Express 4、原生浏览器 JavaScript、CSS、Node 内置测试运行器。

## Global Constraints

- 产品只显示英超、法甲、德甲、西甲、意甲，不显示世界杯。
- 所有比赛时间面向用户统一为北京时间，数据对象保留 UTC 原值。
- 保留胜平负、比分、让球、大小球、角球、罚牌、体彩推荐和比赛模拟。
- 所有推荐从统一比分与事件模拟锚点派生，冲突时降级为观望。
- 只有完场且赛果已核验的比赛进入正式命中率。
- 历史回放与真实赛前推荐必须分开统计。

---

### Task 1: 赛事配置与标准比赛标识

**Files:**
- Create: `src/competitions.js`
- Create: `test/competitions.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `COMPETITIONS`、`getCompetition(id)`、`normalizeCompetitionId(value)`、`buildMatchId(competitionId, season, sourceId)`。

- [ ] **Step 1: 写失败测试**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { COMPETITIONS, buildMatchId, getCompetition } from "../src/competitions.js";

test("只暴露五大联赛并生成带联赛命名空间的比赛 ID", () => {
  assert.deepEqual(Object.keys(COMPETITIONS), ["PL", "FL1", "BL1", "PD", "SA"]);
  assert.equal(getCompetition("eng.1").id, "PL");
  assert.equal(buildMatchId("PL", 2026, 12345), "PL:2026:12345");
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test test/competitions.test.js`

- [ ] **Step 3: 实现赛事配置**

```js
export const COMPETITIONS = Object.freeze({
  PL: { id: "PL", nameZh: "英超", nameEn: "Premier League", footballDataCode: "PL", espnSlug: "eng.1", countryCode: "GB-ENG", modelProfile: { goalMean: 2.85, homeAdvantage: 0.19, cornerMean: 10.4, cardMean: 4.2 } },
  FL1: { id: "FL1", nameZh: "法甲", nameEn: "Ligue 1", footballDataCode: "FL1", espnSlug: "fra.1", countryCode: "FR", modelProfile: { goalMean: 2.65, homeAdvantage: 0.17, cornerMean: 9.7, cardMean: 4.5 } },
  BL1: { id: "BL1", nameZh: "德甲", nameEn: "Bundesliga", footballDataCode: "BL1", espnSlug: "ger.1", countryCode: "DE", modelProfile: { goalMean: 3.05, homeAdvantage: 0.18, cornerMean: 10.1, cardMean: 4.0 } },
  PD: { id: "PD", nameZh: "西甲", nameEn: "La Liga", footballDataCode: "PD", espnSlug: "esp.1", countryCode: "ES", modelProfile: { goalMean: 2.55, homeAdvantage: 0.18, cornerMean: 9.5, cardMean: 5.1 } },
  SA: { id: "SA", nameZh: "意甲", nameEn: "Serie A", footballDataCode: "SA", espnSlug: "ita.1", countryCode: "IT", modelProfile: { goalMean: 2.65, homeAdvantage: 0.16, cornerMean: 9.6, cardMean: 4.8 } }
});
```

- [ ] **Step 4: 增加 `npm test` 并确认通过**

Run: `npm.cmd test`

### Task 2: 整季赛程、赛果与积分榜服务

**Files:**
- Create: `src/league-data-service.js`
- Create: `test/league-data-service.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `getCompetition()`、`buildMatchId()`。
- Produces: `createLeagueDataService(deps)`，其公开方法为 `listCompetitions()`、`getMatches(options)`、`getStandings(options)`、`findMatch(matchId)`。

- [ ] **Step 1: 写标准化比赛和积分榜失败测试**

```js
test("将 football-data 比赛标准化并转换北京时间", async () => {
  const service = createLeagueDataService({ fetchJson: async () => fixture });
  const result = await service.getMatches({ competitionId: "PL", season: 2026 });
  assert.equal(result.matches[0].id, "PL:2026:1001");
  assert.equal(result.matches[0].competitionId, "PL");
  assert.match(result.matches[0].kickoffBeijing, /\+08:00$/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/league-data-service.test.js`

- [ ] **Step 3: 实现 football-data 整季赛程和积分榜请求**

```js
export function createLeagueDataService({ fetchJson, apiBase, apiKey, cache }) {
  return {
    listCompetitions,
    getMatches: ({ competitionId, season, status = "all", force = false }) => loadMatches({ competitionId, season, status, force }),
    getStandings: ({ competitionId, season, force = false }) => loadStandings({ competitionId, season, force }),
    findMatch: async (matchId) => findNamespacedMatch(matchId)
  };
}
```

- [ ] **Step 4: 新增 API 路由并禁止未知 ID 回退第一场**

```js
app.get("/api/competitions", async (_req, res) => res.json(await leagueDataService.listCompetitions()));
app.get("/api/standings", async (req, res) => res.json(await leagueDataService.getStandings({ competitionId: req.query.competition, season: req.query.season })));
```

- [ ] **Step 5: 运行单元测试与语法检查**

Run: `npm.cmd test && npm.cmd run check`

### Task 3: 联赛通用分析上下文

**Files:**
- Create: `src/analysis-context.js`
- Create: `test/analysis-context.test.js`
- Modify: `server.js`

**Interfaces:**
- Produces: `buildAnalysisContext(match, standings, form)`，返回 `competition`、`searchTerms`、`modelProfile`、`teamStrength`。

- [ ] **Step 1: 写失败测试，确保不再包含世界杯或 FIFA 排名**

```js
test("英超分析上下文使用俱乐部和联赛因子", () => {
  const context = buildAnalysisContext(match, standings, form);
  assert.equal(context.competition.id, "PL");
  assert.doesNotMatch(JSON.stringify(context), /World Cup|世界杯|FIFA 排名/i);
  assert.ok(context.teamStrength.home.tablePointsPerGame > 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/analysis-context.test.js`

- [ ] **Step 3: 实现积分、主客场、近 5 场和近 10 场强度特征**

```js
export function buildAnalysisContext(match, standings, form) {
  const competition = getCompetition(match.competitionId);
  return {
    competition,
    modelProfile: competition.modelProfile,
    teamStrength: buildClubStrength(match, standings, form),
    searchTerms: buildLeagueSearchTerms(match, competition)
  };
}
```

- [ ] **Step 4: 将搜索、ESPN、盘口和天气调用改为读取当前赛事上下文**

Run: `rg -n "World Cup|世界杯|fifa.world|PINNACLE_WORLD_CUP" server.js`

Expected: 运行时代码中无世界杯专用常量，仅迁移注释或备份说明可出现。

- [ ] **Step 5: 运行测试和检查**

Run: `npm.cmd test && npm.cmd run check`

### Task 4: 推荐、盘口和模拟一致性

**Files:**
- Create: `src/recommendation-consistency.js`
- Create: `test/recommendation-consistency.test.js`
- Modify: `server.js`

**Interfaces:**
- Produces: `buildUnifiedRecommendation(anchor, markets, simulation)`、`validateRecommendationConsistency(result)`。

- [ ] **Step 1: 写冲突推荐失败测试**

```js
test("2-0 比分锚点不会推荐双方进球或大于 3.5", () => {
  const output = buildUnifiedRecommendation(anchor, markets, simulation);
  assert.equal(output.score.primary, "2-0");
  assert.notEqual(output.btts.pick, "是");
  assert.notEqual(output.total.pick, "大于 3.5");
  assert.deepEqual(validateRecommendationConsistency(output), []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/recommendation-consistency.test.js`

- [ ] **Step 3: 实现统一推荐派生和冲突降级**

```js
export function validateRecommendationConsistency(result) {
  const issues = [];
  const [home, away] = result.score.primary.split("-").map(Number);
  if (away === 0 && result.btts.pick === "是") issues.push("比分与双方进球冲突");
  if (home + away < result.total.line && result.total.pick.startsWith("大")) issues.push("比分与大小球冲突");
  return issues;
}
```

- [ ] **Step 4: 让角球、罚牌和事件流使用赛事 `modelProfile`**

Run: `node --test test/recommendation-consistency.test.js`

- [ ] **Step 5: 运行完整测试**

Run: `npm.cmd test && npm.cmd run check`

### Task 5: 五大联赛历史记录与完整回测

**Files:**
- Create: `src/history-service.js`
- Create: `test/history-service.test.js`
- Create: `data/league-prediction-history.json`
- Modify: `server.js`

**Interfaces:**
- Produces: `createHistoryService()`，提供 `savePrematch()`、`settleCompleted()`、`getPublishedStats()`、`runReplayBacktest()`。

- [ ] **Step 1: 写失败测试，排除世界杯和未完场比赛**

```js
test("正式命中率只统计五大联赛已完场赛前推荐", () => {
  const stats = service.getPublishedStats(records, matches);
  assert.equal(stats.rows.some((row) => row.competitionId === "WC"), false);
  assert.equal(stats.rows.some((row) => row.status !== "FINISHED"), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/history-service.test.js`

- [ ] **Step 3: 实现正式推荐与模型回放分离**

```js
return {
  published: buildPublishedStats(settledPrematchRecords),
  replay: buildReplayStats(replayedCompletedMatches),
  metadata: { competitionId, season, generatedAt: new Date().toISOString() }
};
```

- [ ] **Step 4: 备份旧世界杯历史并初始化联赛历史文件**

备份文件不进入接口和部署包有效统计；新文件只接受 `PL`、`FL1`、`BL1`、`PD`、`SA`。

- [ ] **Step 5: 新增 `/api/backtest` 并运行测试**

Run: `npm.cmd test && npm.cmd run check`

### Task 6: 五大联赛中文工作台

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Create: `test/frontend-contract.test.js`

**Interfaces:**
- Consumes: `/api/competitions`、`/api/matches`、`/api/standings`、`/api/analyze`、`/api/history`、`/api/backtest`。

- [ ] **Step 1: 写前端契约失败测试**

```js
test("页面具有五大联赛筛选且不显示世界杯", () => {
  const html = readFileSync("public/index.html", "utf8");
  assert.match(html, /英超/);
  assert.match(html, /法甲/);
  assert.match(html, /德甲/);
  assert.match(html, /西甲/);
  assert.match(html, /意甲/);
  assert.doesNotMatch(html, /世界杯/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/frontend-contract.test.js`

- [ ] **Step 3: 增加联赛标签、赛季选择、状态筛选和积分榜面板**

界面默认显示全部五大联赛今日/未来七天比赛；选中单个联赛后加载该联赛整季赛程和积分榜。

- [ ] **Step 4: 增加真实推荐与模型回放两个历史标签**

历史列表保留内部滚动容器，桌面和移动端均可查看完整数据。

- [ ] **Step 5: 运行前端契约与语法检查**

Run: `npm.cmd test && npm.cmd run check`

### Task 7: 端到端验证和部署包

**Files:**
- Modify: `scripts/analyzer-control.ps1`
- Modify: `scripts/build-deploy-bundle.ps1`
- Modify: `scripts/test-deploy-bundle.ps1`
- Modify: `README.md`

**Interfaces:**
- Produces: 本地运行验证、五大联赛 API 验证和最新 Render 部署包。

- [ ] **Step 1: 扩展验证脚本**

检查 `/api/competitions`、五个联赛的 `/api/matches` 和 `/api/standings`、一场未来比赛分析、一场完场比赛、历史和回测。

- [ ] **Step 2: 运行完整自动化检查**

Run: `npm.cmd test && npm.cmd run check`

- [ ] **Step 3: 重启并验证本地服务**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\analyzer-control.ps1 -Action verify`

- [ ] **Step 4: 检查世界杯残留**

Run: `rg -n "世界杯|World Cup|fifa.world|WORLD_CUP" public src server.js`

Expected: 用户界面和运行时路径无世界杯引用。

- [ ] **Step 5: 重建并验证部署包**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-deploy-bundle.ps1`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-deploy-bundle.ps1`

