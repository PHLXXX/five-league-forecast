import assert from "node:assert/strict";
import test from "node:test";
import { americanToDecimal, createEspnOddsService, parseEspnOdds } from "../src/espn-odds.js";
import { findSportteryFixture, zhTeamSimilarity } from "../src/sporttery-matcher.js";

const rawOdds = {
  provider: { name: "DraftKings" },
  moneyline: { home: { close: { odds: "-105" } }, draw: { close: { odds: "+265" } }, away: { open: { odds: "+260" }, close: { odds: "+290" } } },
  total: { over: { close: { line: "o2.5", odds: "-120" } }, under: { close: { line: "u2.5", odds: "-105" } } },
  pointSpread: { home: { close: { line: "-0.5", odds: "-115" } }, away: { close: { line: "+0.5", odds: "-120" } } },
};

test("american odds convert to decimal", () => {
  assert.equal(americanToDecimal("+150"), 2.5);
  assert.equal(americanToDecimal("-200"), 1.5);
  assert.equal(americanToDecimal("EVEN"), 2);
  assert.equal(americanToDecimal(""), null);
});

test("ESPN odds parse into 1X2, total and spread with margin removed", () => {
  const odds = parseEspnOdds(rawOdds);
  assert.equal(odds.provider, "DraftKings");
  assert.equal(odds.decimal.away, 3.9);
  assert.ok(Math.abs(odds.oneXTwo.home + odds.oneXTwo.draw + odds.oneXTwo.away - 1) < 1e-12);
  assert.equal(odds.total.line, 2.5);
  assert.ok(odds.total.over > 0.5);
  assert.equal(odds.spread.homeLine, -0.5);
});

test("ESPN odds are matched by event id, never by name", async () => {
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    return { events: [{ id: "111", competitions: [{ odds: [rawOdds] }] }, { id: "222", competitions: [{ odds: [] }] }] };
  };
  const service = createEspnOddsService({ fetchJson });
  const match = { sourceIds: { espn: "111" }, competition: { espnSlug: "eng.1" }, kickoffUtc: "2026-11-21T15:00Z" };
  const odds = await service.oddsForMatch(match);
  assert.equal(odds.decimal.home, 1.95);
  assert.equal(await service.oddsForMatch({ ...match, sourceIds: { espn: "999" } }), null);
  await service.oddsForMatch(match);
  assert.ok(calls <= 3, "scoreboard responses are cached");
});

test("Chinese short names used by 竞彩 match our team names", () => {
  assert.ok(zhTeamSimilarity("热刺", "托特纳姆热刺") >= 0.7);
  assert.ok(zhTeamSimilarity("国米", "国际米兰") >= 0.7);
  assert.ok(zhTeamSimilarity("皇马", "皇家马德里") >= 0.7);
  assert.ok(zhTeamSimilarity("马竞", "马德里竞技") >= 0.7);
  assert.ok(zhTeamSimilarity("门兴", "门兴格拉德巴赫") >= 0.7);
  assert.equal(zhTeamSimilarity("曼城", "曼联"), 0);
  assert.equal(zhTeamSimilarity("巴黎圣日耳曼", "巴黎足球会"), 0);
  assert.equal(zhTeamSimilarity("皇家马德里", "马德里竞技"), 0);
  assert.equal(zhTeamSimilarity("国际米兰", "AC米兰"), 0);
});

test("竞彩 fixture needs both teams, the date and the league to agree", () => {
  const match = {
    competitionId: "PL",
    kickoffBeijing: "2026-11-21T20:30:00+08:00",
    home: { displayName: "曼城", name: "Manchester City" },
    away: { displayName: "富勒姆", name: "Fulham" },
  };
  const official = [
    { leagueName: "英超", matchDate: "2026-11-21", home: { name: "曼联" }, away: { name: "富勒姆" } },
    { leagueName: "英超", matchDate: "2026-11-28", home: { name: "曼城" }, away: { name: "富勒姆" } },
    { leagueName: "英超", matchDate: "2026-11-21", home: { name: "曼城" }, away: { name: "富勒姆" }, matchId: "ok" },
  ];
  assert.equal(findSportteryFixture(match, official)?.matchId, "ok");
  assert.equal(findSportteryFixture(match, official.slice(0, 2)), null);
  const wrongLeague = [{ leagueName: "德甲", matchDate: "2026-11-21", home: { name: "曼城" }, away: { name: "富勒姆" } }];
  assert.equal(findSportteryFixture(match, wrongLeague), null);
});
