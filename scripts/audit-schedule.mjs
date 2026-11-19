// Audits the ESPN-rebuilt season against football-data.co.uk results.
import { readFileSync } from "node:fs";
import { createLeagueDataService } from "../src/league-data-service.js";
import { parseCsv, rowsToMatches, csvFileName } from "../src/history-data.js";
import { resolveTeam } from "../src/team-matcher.js";
const fetchJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
const svc = createLeagueDataService({ fetchJson });
const season = Number(process.argv[2] || 2026);
for (const id of ["PL", "BL1", "PD", "SA", "FL1"]) {
  const res = await svc.getMatches({ competitionId: id, season });
  const ms = res.matches;
  const teams = new Set(ms.flatMap((m) => [m.home.name, m.away.name]));
  const n = teams.size;
  const perTeam = {};
  ms.forEach((m) => { perTeam[m.home.name] = (perTeam[m.home.name] || 0) + 1; perTeam[m.away.name] = (perTeam[m.away.name] || 0) + 1; });
  const badTeams = Object.entries(perTeam).filter(([, c]) => c !== 2 * (n - 1));
  const pairs = new Map();
  ms.forEach((m) => { const k = `${m.home.name}|${m.away.name}`; pairs.set(k, (pairs.get(k) || 0) + 1); });
  const dupPairs = [...pairs].filter(([, c]) => c > 1);
  const csv = rowsToMatches(parseCsv(readFileSync(`data/history/${csvFileName(id, season)}`, "utf8")), { competitionId: id, season });
  const names = [...new Set(csv.flatMap((m) => [m.home, m.away]))];
  const byPair = new Map(csv.map((m) => [`${m.home}|${m.away}`, m]));
  let checked = 0, scoreBad = [], dateBad = [], missing = [];
  for (const m of ms.filter((x) => x.finished)) {
    const h = resolveTeam(m.home, names), a = resolveTeam(m.away, names);
    const c = byPair.get(`${h}|${a}`);
    if (!c) { missing.push(`${m.home.name}-${m.away.name} ${m.kickoffUtc.slice(0,10)}`); continue; }
    checked++;
    if (c.hg !== m.score.home || c.ag !== m.score.away) scoreBad.push(`${m.home.name}-${m.away.name} ESPN ${m.score.home}-${m.score.away} CSV ${c.hg}-${c.ag}`);
    if (Math.abs(c.time - Date.parse(m.kickoffUtc)) > 36 * 3600e3) dateBad.push(`${m.home.name}-${m.away.name} ESPN ${m.kickoffUtc} CSV ${new Date(c.time).toISOString()}`);
  }
  const csvNotInEspn = csv.filter((c) => !ms.some((m) => m.finished && resolveTeam(m.home, names) === c.home && resolveTeam(m.away, names) === c.away));
  const statuses = {}; ms.forEach((m) => statuses[m.status] = (statuses[m.status] || 0) + 1);
  console.log(`\n== ${id} teams=${n} matches=${ms.length} expected=${n * (n - 1)} status=${JSON.stringify(statuses)}`);
  console.log(` 球队场次异常: ${badTeams.map(([t, c]) => `${t}:${c}`).join(", ") || "无"}  重复对阵: ${dupPairs.length}`);
  console.log(` 完场核对 ${checked} 场；比分不一致 ${scoreBad.length}；日期偏差 ${dateBad.length}；CSV无此场 ${missing.length}；CSV有而ESPN未完场 ${csvNotInEspn.length}`);
  [...scoreBad, ...dateBad, ...missing.map((x) => "CSV缺: " + x), ...csvNotInEspn.map((c) => `ESPN缺: ${c.home}-${c.away} ${c.date.slice(0,10)}`)].slice(0, 8).forEach((x) => console.log("   " + x));
}
