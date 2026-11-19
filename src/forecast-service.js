// Ties the ratings model to live data: historical CSVs, ESPN results that the CSV
// has not picked up yet, and the best available bookmaker odds.

import { csvTeamZh } from "./csv-team-names.js";
import { CSV_DIVISIONS, parseCsv } from "./history-data.js";
import {
  asianHandicap, fitRatings, forecastMatch, headlineScore, impliedOverUnder, impliedProbabilities, overProbability, resultPick, summarizeMatrix,
} from "./ratings-model.js";
import { resolveTeam } from "./team-matcher.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXTURES_URL = "https://www.football-data.co.uk/fixtures.csv";

export function createForecastService({ historyStore, fetchText, espnOdds: espnOddsService = null, now = () => Date.now() } = {}) {
  const ratingsCache = new Map();
  let fixturesCache = { at: 0, rows: [] };

  async function upcomingOddsRows() {
    if (typeof fetchText !== "function") return [];
    if (now() - fixturesCache.at < 60 * 60 * 1000) return fixturesCache.rows;
    try {
      const rows = parseCsv(await fetchText(FIXTURES_URL));
      fixturesCache = { at: now(), rows };
    } catch {
      fixturesCache = { at: now() - 50 * 60 * 1000, rows: fixturesCache.rows };
    }
    return fixturesCache.rows;
  }

  // CSV results + ESPN results newer than the CSV (no xG for those).
  function mergeResults(csvMatches, liveMatches, candidates) {
    const keys = new Set(csvMatches.map((match) => `${match.home}|${match.away}|${match.season}`));
    const extra = [];
    for (const live of liveMatches || []) {
      if (!(live?.finished || live?.status === "FINISHED")) continue;
      const hg = Number(live.score?.home);
      const ag = Number(live.score?.away);
      if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
      const home = resolveTeam(live.home, candidates);
      const away = resolveTeam(live.away, candidates);
      if (!home || !away) continue;
      const key = `${home}|${away}|${live.season}`;
      if (keys.has(key)) continue;
      keys.add(key);
      extra.push({ competitionId: live.competitionId, season: live.season, time: Date.parse(live.kickoffUtc), home, away, hg, ag, hxg: Number.NaN, axg: Number.NaN });
    }
    return [...csvMatches, ...extra].sort((left, right) => left.time - right.time);
  }

  async function leagueData(competitionId, season, liveMatches) {
    const csvMatches = await historyStore.getMatches(competitionId, season, { seasonsBack: 3 });
    const candidates = [...new Set(csvMatches.flatMap((match) => [match.home, match.away]))];
    // Promoted clubs are not in the CSV history yet; let them map to their own name.
    for (const live of liveMatches || []) {
      for (const team of [live?.home, live?.away]) {
        if (team?.name && !resolveTeam(team, candidates)) candidates.push(team.name);
      }
    }
    return { matches: mergeResults(csvMatches, liveMatches, candidates), candidates, csvMatches };
  }

  function ratingsFor(competitionId, season, matches, asOf) {
    const day = new Date(asOf).toISOString().slice(0, 10);
    const key = `${competitionId}:${season}:${day}:${matches.length}`;
    if (!ratingsCache.has(key)) {
      if (ratingsCache.size > 60) ratingsCache.clear();
      ratingsCache.set(key, fitRatings(matches, { asOf: Date.parse(`${day}T00:00:00Z`) }));
    }
    return ratingsCache.get(key);
  }

  // Priority (upcoming): The Odds API (user key) > ESPN/DraftKings matched by event id > fixtures.csv.
  // Finished matches use the pre-match average odds recorded in the results CSV.
  function marketFromSources({ match, home, away, csvMatches, fixtureRows, odds, espnLine }) {
    const h2h = odds?.available ? odds.markets?.find((market) => market.key === "h2h" && market.homeAvg && market.awayAvg && market.drawAvg) : null;
    if (h2h && !match.finished) {
      const totals = odds.markets?.find((market) => market.key === "totals" && Number(market.point) === 2.5 && market.overAvg && market.underAvg);
      const ou = totals ? impliedOverUnder(totals.overAvg, totals.underAvg) : null;
      return {
        source: "The Odds API 平均赔率",
        provider: "The Odds API",
        oneXTwo: impliedProbabilities(h2h.homeAvg, h2h.drawAvg, h2h.awayAvg),
        total: ou ? { line: 2.5, over: ou.over, overDecimal: totals.overAvg, underDecimal: totals.underAvg } : (espnLine?.total || null),
        spread: espnLine?.spread || null,
        decimal: { home: h2h.homeAvg, draw: h2h.drawAvg, away: h2h.awayAvg },
      };
    }
    const kickoff = Date.parse(match.kickoffUtc || "");
    const csvRow = csvMatches.find((row) => row.home === home && row.away === away && Math.abs(row.time - kickoff) < 3 * DAY_MS && row.odds);
    if (match.finished && csvRow) {
      const ou = csvRow.ouOdds ? impliedOverUnder(csvRow.ouOdds.over, csvRow.ouOdds.under) : null;
      return {
        source: "football-data.co.uk 赛前平均赔率",
        provider: "多家平均",
        oneXTwo: impliedProbabilities(csvRow.odds.home, csvRow.odds.draw, csvRow.odds.away),
        total: ou ? { line: 2.5, over: ou.over, overDecimal: csvRow.ouOdds.over, underDecimal: csvRow.ouOdds.under } : null,
        spread: null,
        decimal: csvRow.odds,
      };
    }
    if (espnLine?.oneXTwo && !match.finished) {
      return {
        source: `${espnLine.provider} 实时盘口（ESPN 按比赛编号匹配）`,
        provider: espnLine.provider,
        oneXTwo: espnLine.oneXTwo,
        total: espnLine.total,
        spread: espnLine.spread,
        decimal: espnLine.decimal,
        openDecimal: espnLine.openDecimal,
      };
    }
    const division = CSV_DIVISIONS[match.competitionId];
    const fixture = fixtureRows.find((row) => row.Div === division && row.HomeTeam === home && row.AwayTeam === away);
    if (fixture) {
      const one = impliedProbabilities(fixture.AvgH || fixture.B365H, fixture.AvgD || fixture.B365D, fixture.AvgA || fixture.B365A);
      if (one) {
        const overDec = Number(fixture["Avg>2.5"] || fixture["B365>2.5"]);
        const underDec = Number(fixture["Avg<2.5"] || fixture["B365<2.5"]);
        const ou = impliedOverUnder(overDec, underDec);
        return {
          source: "football-data.co.uk 即将开赛平均赔率",
          provider: "多家平均",
          oneXTwo: one,
          total: ou ? { line: 2.5, over: ou.over, overDecimal: overDec, underDecimal: underDec } : null,
          spread: null,
          decimal: { home: Number(fixture.AvgH || fixture.B365H), draw: Number(fixture.AvgD || fixture.B365D), away: Number(fixture.AvgA || fixture.B365A) },
        };
      }
    }
    if (match.finished && csvRow) return null;
    return null;
  }

  function recentForm(matches, team, beforeTime, limit = 6) {
    return matches
      .filter((row) => row.time < beforeTime && (row.home === team || row.away === team))
      .slice(-limit)
      .reverse()
      .map((row) => {
        const isHome = row.home === team;
        const gf = isHome ? row.hg : row.ag;
        const ga = isHome ? row.ag : row.hg;
        return {
          date: new Date(row.time).toISOString().slice(0, 10),
          opponent: csvTeamZh(isHome ? row.away : row.home),
          venue: isHome ? "主" : "客",
          score: `${gf}-${ga}`,
          result: gf > ga ? "W" : gf < ga ? "L" : "D",
          xgFor: Number.isFinite(isHome ? row.hxg : row.axg) ? round(isHome ? row.hxg : row.axg) : null,
          xgAgainst: Number.isFinite(isHome ? row.axg : row.hxg) ? round(isHome ? row.axg : row.hxg) : null,
        };
      });
  }

  function strengthTable(ratings, currentTeams) {
    const pool = currentTeams.size >= 10 ? [...currentTeams].filter((team) => ratings.attack.has(team)) : [...ratings.attack.keys()];
    return pool
      .map((team) => ({ team, net: ratings.attack.get(team) - ratings.defence.get(team) }))
      .sort((left, right) => right.net - left.net);
  }

  async function forecast({ match, liveMatches = [], odds = null } = {}) {
    if (!match || !CSV_DIVISIONS[match.competitionId]) return null;
    const kickoff = Date.parse(match.kickoffUtc || "") || now();
    const { matches, candidates, csvMatches } = await leagueData(match.competitionId, Number(match.season), liveMatches);
    const home = resolveTeam(match.home, candidates) || match.home?.name;
    const away = resolveTeam(match.away, candidates) || match.away?.name;
    const asOf = Math.min(kickoff, now() + 30 * DAY_MS);
    const ratings = ratingsFor(match.competitionId, match.season, matches, asOf);
    const fixtureRows = match.finished ? [] : await upcomingOddsRows();
    const espnLine = !match.finished && espnOddsService ? await espnOddsService.oddsForMatch(match).catch(() => null) : null;
    const market = marketFromSources({ match, home, away, csvMatches, fixtureRows, odds, espnLine });
    const result = forecastMatch(ratings, home, away, { market });
    const pick = resultPick(result.summary);
    const headline = headlineScore(result.summary, pick);
    const currentTeams = new Set(matches.filter((row) => row.season === Number(match.season)).flatMap((row) => [row.home, row.away]));
    const table = strengthTable(ratings, currentTeams);
    const rankOf = (team) => {
      const index = table.findIndex((row) => row.team === team);
      return index >= 0 ? index + 1 : null;
    };
    const diff = result.homeXg - result.awayXg;
    const ahLine = -Math.round(diff * 4) / 4 || 0;
    const ah = asianHandicap(result.matrix, ahLine);
    const top = result.summary.scores.slice(0, 8);
    const pickProbability = pick === "home" ? result.summary.home : pick === "away" ? result.summary.away : result.summary.draw;
    const agreement = result.market
      ? Math.abs(result.model.home - result.market.home) + Math.abs(result.model.away - result.market.away)
      : null;
    return {
      version: "Dixon-Coles 时间加权评级 v2",
      teams: { home, away },
      expectedGoals: { home: round(result.homeXg), away: round(result.awayXg), total: round(result.homeXg + result.awayXg) },
      probabilities: {
        home: round4(result.summary.home),
        draw: round4(result.summary.draw),
        away: round4(result.summary.away),
        over15: round4(result.summary.over15),
        over25: round4(result.summary.over25),
        over35: round4(result.summary.over35),
        btts: round4(result.summary.btts),
        totals: result.summary.totals.slice(0, 8).map(round4),
      },
      pick,
      pickProbability: round4(pickProbability),
      headlineScore: { score: headline.score, homeGoals: headline.homeGoals, awayGoals: headline.awayGoals, probability: round4(headline.probability) },
      topScores: top.map((score) => ({ score: score.score, homeGoals: score.homeGoals, awayGoals: score.awayGoals, probability: round4(score.probability) })),
      asianHandicap: { line: ahLine, homeWin: round4(ah.win), push: round4(ah.push), homeLose: round4(ah.lose) },
      model: {
        home: round4(result.model.home), draw: round4(result.model.draw), away: round4(result.model.away),
        over25: round4(result.model.over25), homeXg: round(result.model.homeXg), awayXg: round(result.model.awayXg),
      },
      market: market ? describeMarket(market, result) : null,
      agreement: agreement === null ? null : round4(agreement),
      confidence: confidenceLabel(pickProbability, agreement),
      ratings: {
        home: teamCard(result.ratings.home, rankOf(home), table.length),
        away: teamCard(result.ratings.away, rankOf(away), table.length),
        homeAdvantage: round(result.ratings.homeAdvantage),
        leagueGoals: round(result.ratings.leagueGoals),
        sample: ratings.sample,
      },
      form: { home: recentForm(matches, home, kickoff), away: recentForm(matches, away, kickoff) },
      matrix: result.matrix.slice(0, 7).map((row) => row.slice(0, 7).map(round4)),
      rawMatrix: result.matrix,
    };
  }

  return { forecast, leagueData };
}

function describeMarket(market, result) {
  const modelTotals = summarizeMatrix(result.matrix).totals;
  const out = {
    source: market.source,
    provider: market.provider,
    home: round4(market.oneXTwo.home), draw: round4(market.oneXTwo.draw), away: round4(market.oneXTwo.away),
    over25: market.total?.line === 2.5 ? round4(market.total.over) : null,
    margin: round4(market.oneXTwo.margin || 0),
    decimal: market.decimal,
    openDecimal: market.openDecimal || null,
    weight: result.blend?.weight ?? 0,
    total: null,
    spread: null,
  };
  if (market.total) {
    out.total = {
      line: market.total.line,
      overDecimal: market.total.overDecimal ?? null,
      underDecimal: market.total.underDecimal ?? null,
      marketOver: round4(market.total.over),
      finalOver: round4(overProbability(modelTotals, market.total.line)),
    };
  }
  if (market.spread) {
    const ah = asianHandicap(result.matrix, market.spread.homeLine);
    const decided = ah.win + ah.lose || 1;
    out.spread = {
      homeLine: market.spread.homeLine,
      homeDecimal: market.spread.homeDecimal,
      awayDecimal: market.spread.awayDecimal,
      marketHome: round4(market.spread.home),
      finalHome: round4(ah.win / decided),
      push: round4(ah.push),
    };
  }
  return out;
}

function teamCard(rating, rank, size) {
  return {
    attack: round(Math.exp(rating.attack)),
    defence: round(Math.exp(rating.defence)),
    rank,
    of: size,
    promoted: rating.promoted,
    sampleWeight: round(rating.weight),
  };
}

function confidenceLabel(pickProbability, agreement) {
  let score = pickProbability;
  if (agreement !== null && agreement > 0.15) score -= 0.05;
  if (score >= 0.62) return { level: "high", label: "高" };
  if (score >= 0.48) return { level: "medium", label: "中" };
  return { level: "low", label: "低" };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}
