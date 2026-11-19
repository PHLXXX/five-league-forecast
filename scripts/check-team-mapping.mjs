// Checks that every current ESPN team resolves to a CSV team name.
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/history-data.js";
import { resolveTeam } from "../src/team-matcher.js";
const leagues = { PL: ["eng.1", "E0"], BL1: ["ger.1", "D1"], PD: ["esp.1", "SP1"], SA: ["ita.1", "I1"], FL1: ["fra.1", "F1"] };
let bad = 0;
for (const [id, [slug, div]] of Object.entries(leagues)) {
  const names = new Set();
  for (const s of ["2425", "2526", "2627"]) {
    try { parseCsv(readFileSync(`data/history/${div}_${s}.csv`, "utf8")).forEach((r) => { names.add(r.HomeTeam); names.add(r.AwayTeam); }); } catch {}
  }
  names.delete(undefined); names.delete("");
  const json = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams`)).json();
  const teams = json.sports[0].leagues[0].teams.map((t) => t.team);
  const out = teams.map((t) => {
    const hit = resolveTeam({ name: t.displayName, shortName: t.shortDisplayName, code: t.abbreviation }, [...names]);
    if (!hit) bad += 1;
    return `${t.displayName}→${hit || "??"}`;
  });
  console.log(id, out.join(" | "));
}
console.log("unmatched", bad);
