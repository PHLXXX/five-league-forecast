import { createLeagueDataService } from "../src/league-data-service.js";
const fetchJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); };
const svc = createLeagueDataService({ fetchJson });
for (const id of (process.argv[2] || "PL").split(",")) {
  const t = Date.now();
  const res = await svc.getMatches({ competitionId: id, season: 2026 });
  const fin = res.matches.filter((m) => m.finished);
  console.log(id, res.sourceLabel, res.matches.length, "finished", fin.length, `${Date.now() - t}ms`, JSON.stringify(fin.at(-1)?.score), fin.at(-1)?.home.displayName, fin.at(-1)?.away.displayName, res.matches.find(m=>!m.finished)?.kickoffBeijing);
}
