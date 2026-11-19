import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, rowsToMatches, seasonCode } from "../src/history-data.js";
import { createLeagueDataService } from "../src/league-data-service.js";
import {
  asianHandicap, fitRatings, forecastMatch, headlineScore, impliedProbabilities, resultPick, scoreMatrix, summarizeMatrix,
} from "../src/ratings-model.js";
import { matchTeamName, resolveTeam } from "../src/team-matcher.js";

const DAY = 24 * 60 * 60 * 1000;

function syntheticLeague() {
  // Strong beats everyone 3-0, Weak loses everything, the rest draw 1-1.
  const teams = ["Strong", "Mid A", "Mid B", "Mid C", "Weak"];
  const matches = [];
  let time = Date.UTC(2025, 7, 1);
  for (let round = 0; round < 4; round += 1) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        let hg = 1;
        let ag = 1;
        if (home === "Strong") { hg = 3; ag = 0; }
        if (away === "Strong") { hg = 0; ag = 2; }
        if (home === "Weak" && away !== "Strong") { hg = 0; ag = 2; }
        if (away === "Weak" && home !== "Strong") { hg = 2; ag = 0; }
        matches.push({ time, home, away, hg, ag, hxg: Number.NaN, axg: Number.NaN });
        time += DAY;
      }
    }
  }
  return { matches, end: time };
}

test("ratings separate strong and weak teams and only use past matches", () => {
  const { matches, end } = syntheticLeague();
  const ratings = fitRatings(matches, { asOf: end });
  assert.ok(ratings.attack.get("Strong") > ratings.attack.get("Mid A"));
  assert.ok(ratings.defence.get("Strong") < ratings.defence.get("Weak"));
  const early = fitRatings(matches, { asOf: matches[0].time });
  assert.equal(early.sample, 0, "no match before the first kickoff may be used");
});

test("forecast favours the strong side and probabilities sum to one", () => {
  const { matches, end } = syntheticLeague();
  const ratings = fitRatings(matches, { asOf: end });
  const result = forecastMatch(ratings, "Strong", "Weak");
  const s = result.summary;
  assert.ok(Math.abs(s.home + s.draw + s.away - 1) < 1e-9);
  assert.ok(s.home > 0.7);
  assert.equal(resultPick(s), "home");
  const headline = headlineScore(s);
  assert.ok(headline.homeGoals > headline.awayGoals, "headline score must agree with the 1X2 pick");
});

test("unknown (promoted) teams get a conservative prior", () => {
  const { matches, end } = syntheticLeague();
  const ratings = fitRatings(matches, { asOf: end });
  const result = forecastMatch(ratings, "Mid A", "Brand New FC");
  assert.ok(result.ratings.away.promoted);
  assert.ok(result.summary.home > result.summary.away);
});

test("market blend moves probabilities toward the bookmaker and keeps the total without a totals market", () => {
  const { matches, end } = syntheticLeague();
  const ratings = fitRatings(matches, { asOf: end });
  const plain = forecastMatch(ratings, "Mid A", "Mid B");
  const oneXTwo = impliedProbabilities(1.6, 4.0, 6.0);
  const blended = forecastMatch(ratings, "Mid A", "Mid B", { market: { oneXTwo } });
  assert.ok(blended.summary.home > plain.summary.home + 0.1);
  assert.ok(Math.abs(blended.summary.over25 - plain.summary.over25) < 0.06);
});

test("score matrix and asian handicap are proper distributions", () => {
  const matrix = scoreMatrix(1.6, 1.1);
  const total = matrix.flat().reduce((sum, p) => sum + p, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const ah = asianHandicap(matrix, -0.25);
  assert.ok(Math.abs(ah.win + ah.push + ah.lose - 1) < 1e-9);
  const summary = summarizeMatrix(matrix);
  assert.ok(summary.over25 > 0 && summary.over25 < 1);
});

test("implied probabilities strip the bookmaker margin", () => {
  const p = impliedProbabilities(2.0, 3.4, 3.8);
  assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-12);
  assert.ok(p.margin > 0);
  assert.equal(impliedProbabilities(0, 3, 3), null);
});

test("team names map between ESPN and CSV spellings", () => {
  const csv = ["Man United", "Man City", "Nott'm Forest", "Ath Madrid", "Ath Bilbao", "Betis", "Real Madrid", "Sociedad", "M'gladbach", "Paris SG", "Le Havre", "Le Mans", "Inter", "Milan"];
  assert.equal(matchTeamName("Manchester United", csv), "Man United");
  assert.equal(matchTeamName("Nottingham Forest", csv), "Nott'm Forest");
  assert.equal(matchTeamName("Atlético Madrid", csv), "Ath Madrid");
  assert.equal(matchTeamName("Athletic Club", csv), "Ath Bilbao");
  assert.equal(matchTeamName("Real Betis", csv), "Betis");
  assert.equal(matchTeamName("Borussia Mönchengladbach", csv), "M'gladbach");
  assert.equal(matchTeamName("Paris Saint-Germain", csv), "Paris SG");
  assert.equal(matchTeamName("Le Mans", csv), "Le Mans");
  assert.equal(matchTeamName("Internazionale", csv), "Inter");
  assert.equal(resolveTeam({ name: "AC Milan" }, csv), "Milan");
  assert.equal(matchTeamName("Totally Unknown", csv), "");
});

test("football-data.co.uk CSV rows parse into matches with odds and xG", () => {
  const csv = "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,HxG,AxG,AvgH,AvgD,AvgA,Avg>2.5,Avg<2.5\nE0,08/11/2026,16:30,Man United,Aston Villa,4,4,2.1,1.3,2.1,3.5,3.4,1.7,2.2\n";
  const [match] = rowsToMatches(parseCsv(csv), { competitionId: "PL", season: 2026 });
  assert.equal(match.home, "Man United");
  assert.equal(match.hg, 4);
  assert.equal(match.hxg, 2.1);
  assert.equal(match.odds.draw, 3.5);
  assert.equal(match.ouOdds.over, 1.7);
  assert.equal(new Date(match.time).toISOString(), "2026-11-08T16:30:00.000Z");
  assert.equal(seasonCode(2026), "2627");
});

test("ESPN schedule falls back to team schedules when the date-range scoreboard fails", async () => {
  const event = (id, home, away, date, score) => ({
    id,
    date,
    league: { slug: "eng.1" },
    competitions: [{
      status: { type: { name: score ? "STATUS_FULL_TIME" : "STATUS_SCHEDULED", completed: Boolean(score), state: score ? "post" : "pre" } },
      competitors: [
        { homeAway: "home", score: score ? { value: score[0], displayValue: String(score[0]) } : undefined, team: { id: home, displayName: home, logos: [{ href: `${home}.png` }] } },
        { homeAway: "away", score: score ? { value: score[1], displayValue: String(score[1]) } : undefined, team: { id: away, displayName: away } },
      ],
    }],
  });
  const fetchJson = async (url) => {
    if (url.includes("/scoreboard")) throw new Error("400 Bad Request");
    if (/\/teams\?season=/.test(url)) return { sports: [{ leagues: [{ teams: [{ team: { id: "1" } }, { team: { id: "2" } }] }] }] };
    if (url.includes("fixture=true")) return { events: [event("e2", "2", "1", "2026-12-01T15:00Z")] };
    return { events: [event("e1", "1", "2", "2026-09-01T15:00Z", [2, 1]), { ...event("cup", "1", "9", "2026-09-10T15:00Z", [1, 0]), league: { slug: "eng.league_cup" } }] };
  };
  const service = createLeagueDataService({ fetchJson });
  const result = await service.getMatches({ competitionId: "PL", season: 2026 });
  assert.equal(result.matches.length, 2, "cup games are dropped and duplicates merged");
  const played = result.matches.find((m) => m.finished);
  assert.deepEqual(played.score, { home: 2, away: 1 });
  assert.equal(played.home.crest, "1.png");
});
