import { buildLeagueContext, deriveLeagueModelAdjustment } from "./analysis-context.js";

export function replayLeagueSeason({ matches = [], competition } = {}) {
  if (!competition?.id) throw new Error("回测必须提供联赛配置");
  const completed = arrayFrom(matches)
    .filter(hasFinalScore)
    .sort((left, right) => Date.parse(left.kickoffUtc || "") - Date.parse(right.kickoffUtc || ""));
  const priorMatches = [];
  const records = [];

  for (const match of completed) {
    const standings = buildReplayStandings(priorMatches, [match.home, match.away]);
    const context = buildLeagueContext({ match, standings, matches: priorMatches });
    const adjustment = deriveLeagueModelAdjustment(context, competition.modelProfile);
    const prediction = predictFromAdjustment(adjustment, competition.modelProfile);
    const actualHome = Number(match.score.home);
    const actualAway = Number(match.score.away);
    const actualScore = `${actualHome}-${actualAway}`;
    const actualResult = resultSide(actualHome, actualAway);
    const totalGoals = actualHome + actualAway;
    const favoriteMargin = prediction.favoriteSide === "home" ? actualHome - actualAway : actualAway - actualHome;
    const handicapHit = prediction.handicapSide === "favorite"
      ? favoriteMargin > prediction.handicapLine
      : favoriteMargin <= prediction.handicapLine;
    records.push({
      matchId: match.id,
      competitionId: competition.id,
      competitionName: competition.nameZh,
      season: match.season,
      kickoffBeijing: match.kickoffBeijing || match.kickoffUtc,
      home: teamName(match.home),
      away: teamName(match.away),
      predictedScore: prediction.primaryScore,
      top3Scores: prediction.top3Scores,
      actualScore,
      resultPick: prediction.resultPick,
      total25Pick: prediction.total25Pick,
      handicapPick: `${prediction.handicapSide === "favorite" ? "让球方" : "受让方"} ${prediction.handicapLine}`,
      hits: {
        exactScore: prediction.primaryScore === actualScore,
        top3Score: prediction.top3Scores.includes(actualScore),
        result: prediction.resultPick === actualResult,
        total25: prediction.total25Pick === (totalGoals > 2.5 ? "over" : "under"),
        handicap: handicapHit,
      },
      modelInput: {
        priorMatches: priorMatches.length,
        homeXg: prediction.homeXg,
        awayXg: prediction.awayXg,
        leagueAdjustment: adjustment,
      },
    });
    priorMatches.push(match);
  }

  return {
    refreshedAt: new Date().toISOString(),
    competition: { id: competition.id, nameZh: competition.nameZh },
    season: completed[0]?.season ?? null,
    sample: records.length,
    metrics: {
      exactScore: metric(records, "exactScore"),
      top3Score: metric(records, "top3Score"),
      result: metric(records, "result"),
      total25: metric(records, "total25"),
      handicap: metric(records, "handicap"),
    },
    marketCoverage: {
      verified: ["胜平负", "比分", "Top3 比分", "大小球 2.5", "模型让球"],
      unavailable: ["角球", "罚牌", "体彩固定奖金"],
      note: "没有可核验的历史实盘或官方赛果字段时不生成虚假命中率",
    },
    records: records.reverse(),
    methodology: "逐场使用开赛前已完场数据重放；不读取未来赛果或赛季末积分榜。",
  };
}

export function replayMatchBeforeKickoff({ matches = [], match, competition } = {}) {
  if (!match || !competition?.id) throw new Error("match and competition are required for replay");
  const kickoff = Date.parse(match.kickoffUtc || match.kickoffBeijing || "");
  const priorMatches = arrayFrom(matches)
    .filter((candidate) => candidate?.id !== match.id && hasFinalScore(candidate))
    .filter((candidate) => {
      const candidateKickoff = Date.parse(candidate.kickoffUtc || candidate.kickoffBeijing || "");
      return Number.isFinite(kickoff) && Number.isFinite(candidateKickoff) && candidateKickoff < kickoff;
    })
    .sort((left, right) => Date.parse(left.kickoffUtc || "") - Date.parse(right.kickoffUtc || ""));
  const standings = buildReplayStandings(priorMatches, [match.home, match.away]);
  const context = buildLeagueContext({ match, standings, matches: priorMatches });
  const adjustment = deriveLeagueModelAdjustment(context, competition.modelProfile);
  return {
    asOf: match.kickoffBeijing || match.kickoffUtc || "",
    priorMatches: priorMatches.length,
    standings,
    context,
    adjustment,
    prediction: predictFromAdjustment(adjustment, competition.modelProfile),
  };
}

export function aggregateBacktestReports(reports = []) {
  const validReports = arrayFrom(reports).filter((report) => report && Array.isArray(report.records));
  const metricKeys = ["exactScore", "top3Score", "result", "total25", "handicap"];
  const metrics = Object.fromEntries(metricKeys.map((key) => {
    const sample = validReports.reduce((sum, report) => sum + Number(report.metrics?.[key]?.sample || 0), 0);
    const hits = validReports.reduce((sum, report) => sum + Number(report.metrics?.[key]?.hits || 0), 0);
    return [key, { sample, hits, rate: sample ? round(hits / sample) : 0 }];
  }));
  const records = validReports
    .flatMap((report) => report.records)
    .sort((left, right) => Date.parse(right.kickoffBeijing || "") - Date.parse(left.kickoffBeijing || ""));
  return {
    refreshedAt: new Date().toISOString(),
    competition: { id: "ALL", nameZh: "欧洲五大联赛" },
    season: validReports[0]?.season ?? null,
    sample: records.length,
    metrics,
    marketCoverage: {
      verified: ["胜平负", "比分", "Top3 比分", "大小球 2.5", "模型让球"],
      unavailable: ["角球", "罚牌", "体彩固定奖金"],
      note: "没有可核验的历史实盘或官方赛果字段时不生成虚假命中率",
    },
    records,
    reports: validReports.map((report) => ({
      competition: report.competition,
      season: report.season,
      sample: report.sample,
      metrics: report.metrics,
    })),
    methodology: "各联赛逐场使用开赛前已完场数据重放，再按样本数加权汇总。",
  };
}

function predictFromAdjustment(adjustment, modelProfile = {}) {
  const total = clamp(Number(adjustment?.totalGoals) || Number(modelProfile.goalMean) || 2.65, 1.5, 4.2);
  const adjustmentDiff = Number(adjustment?.goalDiff);
  const diff = clamp(
    Number.isFinite(adjustmentDiff) ? adjustmentDiff : Number(modelProfile.homeAdvantage) || 0.16,
    -2.4,
    2.4,
  );
  const homeXg = clamp(total / 2 + diff / 2, 0.15, 3.8);
  const awayXg = clamp(total / 2 - diff / 2, 0.15, 3.8);
  const cells = [];
  const resultProbabilities = { home: 0, draw: 0, away: 0 };
  let over25 = 0;
  let btts = 0;
  for (let homeGoals = 0; homeGoals <= 7; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= 7; awayGoals += 1) {
      const probability = poisson(homeGoals, homeXg) * poisson(awayGoals, awayXg);
      cells.push({ score: `${homeGoals}-${awayGoals}`, homeGoals, awayGoals, probability });
      resultProbabilities[resultSide(homeGoals, awayGoals)] += probability;
      if (homeGoals + awayGoals > 2.5) over25 += probability;
      if (homeGoals > 0 && awayGoals > 0) btts += probability;
    }
  }
  cells.sort((left, right) => right.probability - left.probability);
  const resultPick = Object.entries(resultProbabilities).sort((left, right) => right[1] - left[1])[0][0];
  const favoriteSide = homeXg >= awayXg ? "home" : "away";
  const favoriteWinProbability = favoriteSide === "home" ? resultProbabilities.home : resultProbabilities.away;
  return {
    homeXg: round(homeXg),
    awayXg: round(awayXg),
    primaryScore: cells[0].score,
    top3Scores: cells.slice(0, 3).map((cell) => cell.score),
    scorePortfolio: cells.slice(0, 8).map((cell) => ({ ...cell, probability: round(cell.probability) })),
    probabilities: {
      homeWin: round(resultProbabilities.home),
      draw: round(resultProbabilities.draw),
      awayWin: round(resultProbabilities.away),
      over25: round(over25),
      under25: round(1 - over25),
      btts: round(btts),
    },
    resultPick,
    total25Pick: over25 >= 0.5 ? "over" : "under",
    favoriteSide,
    handicapLine: 0.5,
    handicapSide: favoriteWinProbability >= 0.55 ? "favorite" : "underdog",
  };
}

function buildReplayStandings(matches, extraTeams = []) {
  return {
    tables: {
      total: buildTable(matches, "total", extraTeams),
      home: buildTable(matches, "home", extraTeams),
      away: buildTable(matches, "away", extraTeams),
    },
  };
}

function buildTable(matches, scope, extraTeams) {
  const rows = new Map();
  const ensure = (team) => {
    const key = teamKey(team);
    if (!rows.has(key)) rows.set(key, { team, playedGames: 0, won: 0, draw: 0, lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0 });
    return rows.get(key);
  };
  extraTeams.forEach(ensure);
  for (const match of matches) {
    if (!hasFinalScore(match)) continue;
    const homeRow = ensure(match.home);
    const awayRow = ensure(match.away);
    if (scope !== "away") applyResult(homeRow, Number(match.score.home), Number(match.score.away));
    if (scope !== "home") applyResult(awayRow, Number(match.score.away), Number(match.score.home));
  }
  return [...rows.values()]
    .sort((left, right) => right.points - left.points || right.goalDifference - left.goalDifference || right.goalsFor - left.goalsFor)
    .map((row, index) => ({ ...row, position: index + 1 }));
}

function applyResult(row, goalsFor, goalsAgainst) {
  row.playedGames += 1;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  row.goalDifference = row.goalsFor - row.goalsAgainst;
  if (goalsFor > goalsAgainst) {
    row.won += 1;
    row.points += 3;
  } else if (goalsFor === goalsAgainst) {
    row.draw += 1;
    row.points += 1;
  } else {
    row.lost += 1;
  }
}

function metric(records, key) {
  const sample = records.length;
  const hits = records.filter((record) => record.hits[key]).length;
  return { sample, hits, rate: sample ? round(hits / sample) : 0 };
}

function hasFinalScore(match) {
  return (match?.status === "FINISHED" || match?.finished === true)
    && isFiniteScore(match?.score?.home)
    && isFiniteScore(match?.score?.away);
}

function isFiniteScore(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function resultSide(homeGoals, awayGoals) {
  return homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw";
}

function teamKey(team) {
  return String(team?.id || team?.code || team?.name || "");
}

function teamName(team) {
  return team?.displayName || team?.name || "待定";
}

function poisson(goals, lambda) {
  return Math.exp(-lambda) * lambda ** goals / factorial(goals);
}

function factorial(value) {
  let result = 1;
  for (let number = 2; number <= value; number += 1) result *= number;
  return result;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}
