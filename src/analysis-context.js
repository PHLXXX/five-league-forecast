export function buildLeagueContext({ match, standings, matches = [] } = {}) {
  if (!match?.home || !match?.away) throw new Error("比赛双方不能为空");
  const targetTime = Date.parse(match.kickoffUtc || match.kickoffBeijing || "") || Number.POSITIVE_INFINITY;
  const completed = arrayFrom(matches)
    .filter((item) => item?.id !== match.id)
    .filter((item) => item?.competitionId === match.competitionId)
    .filter((item) => item?.status === "FINISHED" || item?.finished === true)
    .filter((item) => Number.isFinite(scoreNumber(item?.score?.home)) && Number.isFinite(scoreNumber(item?.score?.away)))
    .filter((item) => {
      const kickoff = Date.parse(item.kickoffUtc || item.kickoffBeijing || "");
      return Number.isFinite(kickoff) && kickoff < targetTime;
    })
    .sort((left, right) => Date.parse(right.kickoffUtc) - Date.parse(left.kickoffUtc));

  const totalTable = arrayFrom(standings?.tables?.total);
  const homeTable = arrayFrom(standings?.tables?.home);
  const awayTable = arrayFrom(standings?.tables?.away);
  const homeMatches = completed.filter((item) => includesTeam(item, match.home)).slice(0, 10);
  const awayMatches = completed.filter((item) => includesTeam(item, match.away)).slice(0, 10);
  const headToHeadMatches = completed
    .filter((item) => includesTeam(item, match.home) && includesTeam(item, match.away))
    .slice(0, 10);

  return {
    competitionId: match.competitionId,
    season: match.season,
    home: {
      team: match.home,
      standing: summarizeStanding(findStanding(totalTable, match.home)),
      venueStanding: summarizeStanding(findStanding(homeTable, match.home)),
      form: summarizeForm(homeMatches, match.home),
    },
    away: {
      team: match.away,
      standing: summarizeStanding(findStanding(totalTable, match.away)),
      venueStanding: summarizeStanding(findStanding(awayTable, match.away)),
      form: summarizeForm(awayMatches, match.away),
    },
    headToHead: {
      played: headToHeadMatches.length,
      matches: headToHeadMatches.map(publicMatch),
      homeTeamView: summarizeForm(headToHeadMatches, match.home),
      awayTeamView: summarizeForm(headToHeadMatches, match.away),
    },
    sample: {
      completedBeforeKickoff: completed.length,
      homeRecent: homeMatches.length,
      awayRecent: awayMatches.length,
      headToHead: headToHeadMatches.length,
    },
  };
}

export function deriveLeagueModelAdjustment(context, modelProfile = {}) {
  const home = context?.home || {};
  const away = context?.away || {};
  const baselineGoals = clamp(number(modelProfile.goalMean) || 2.65, 2.1, 3.4);
  const homeAdvantage = clamp(number(modelProfile.homeAdvantage) || 0.16, 0, 0.35);
  const homePromoted = Boolean(context?.crossSeasonForm && !home.standing?.available && away.standing?.available);
  const awayPromoted = Boolean(context?.crossSeasonForm && !away.standing?.available && home.standing?.available);
  const homeStanding = homePromoted ? promotedStandingBaseline("home", "total") : home.standing;
  const awayStanding = awayPromoted ? promotedStandingBaseline("away", "total") : away.standing;
  const homeVenueStanding = homePromoted ? promotedStandingBaseline("home", "venue") : home.venueStanding;
  const awayVenueStanding = awayPromoted ? promotedStandingBaseline("away", "venue") : away.venueStanding;
  const hasStandingPair = Boolean(homeStanding?.available && awayStanding?.available);
  const hasVenuePair = Boolean(homeVenueStanding?.available && awayVenueStanding?.available);
  const hasFormPair = number(home.form?.played) > 0 && number(away.form?.played) > 0;
  const overallPpgEdge = hasStandingPair
    ? number(homeStanding?.pointsPerGame) - number(awayStanding?.pointsPerGame)
    : 0;
  const venuePpgEdge = hasVenuePair
    ? number(homeVenueStanding?.pointsPerGame) - number(awayVenueStanding?.pointsPerGame)
    : 0;
  const formPpgEdge = hasFormPair
    ? number(home.form?.pointsPerGame) - number(away.form?.pointsPerGame)
    : 0;
  const goalDifferenceEdge = hasStandingPair
    ? normalizeGoalDifference(homeStanding) - normalizeGoalDifference(awayStanding)
    : 0;
  const attackEdge = hasStandingPair
    ? number(homeStanding?.goalsForPerGame) - number(awayStanding?.goalsForPerGame)
    : 0;
  const defenseEdge = hasStandingPair
    ? number(awayStanding?.goalsAgainstPerGame) - number(homeStanding?.goalsAgainstPerGame)
    : 0;
  const rankEdge = hasStandingPair && number(homeStanding?.position) && number(awayStanding?.position)
    ? clamp((number(awayStanding.position) - number(homeStanding.position)) / 18, -1, 1)
    : 0;
  const evidence = [
    overallPpgEdge * 0.3,
    venuePpgEdge * 0.16,
    formPpgEdge * 0.2,
    goalDifferenceEdge * 0.18,
    attackEdge * 0.1,
    defenseEdge * 0.1,
    rankEdge * 0.32,
  ];
  const rawGoalDiff = homeAdvantage + evidence.reduce((sum, value) => sum + value, 0);
  const directionalEvidence = evidence.filter((value) => Math.abs(value) >= 0.04);
  const rawDirection = Math.sign(rawGoalDiff);
  const agreement = rawDirection && directionalEvidence.length
    ? directionalEvidence.filter((value) => Math.sign(value) === rawDirection).length / directionalEvidence.length
    : 0;
  const alignedBoost = Math.abs(rawGoalDiff) >= 0.65 && agreement >= 0.72
    ? Math.sign(rawGoalDiff) * clamp((Math.abs(rawGoalDiff) - 0.55) * 0.28 + (agreement - 0.7) * 0.35, 0, 0.45)
    : 0;
  const goalDiff = clamp(rawGoalDiff + alignedBoost, -2.4, 2.4);

  const recentTotal = weightedRecentTotal(home.form, away.form);
  const seasonTotal = weightedSeasonTotal(homeStanding, awayStanding);
  const observedTotal = baselineGoals * 0.5 + recentTotal * 0.3 + seasonTotal * 0.2;
  const mismatchFloor = baselineGoals - 0.15 + Math.max(0, Math.abs(goalDiff) - 0.75) * 0.24;
  const totalGoals = clamp(
    Math.max(observedTotal, Math.abs(goalDiff) + 0.55, mismatchFloor),
    1.75,
    4.35,
  );

  return {
    available: Boolean(home.standing?.available || away.standing?.available || home.form?.played || away.form?.played),
    goalDiff: round(goalDiff),
    totalGoals: round(totalGoals),
    components: {
      homeAdvantage: round(homeAdvantage),
      overallPpgEdge: round(overallPpgEdge),
      venuePpgEdge: round(venuePpgEdge),
      formPpgEdge: round(formPpgEdge),
      goalDifferenceEdge: round(goalDifferenceEdge),
      attackEdge: round(attackEdge),
      defenseEdge: round(defenseEdge),
      rankEdge: round(rankEdge),
      signalAgreement: round(agreement),
      alignedBoost: round(alignedBoost),
      homeBaseline: homePromoted ? "promoted" : "observed",
      awayBaseline: awayPromoted ? "promoted" : "observed",
    },
    detail: `积分榜场均分差 ${signed(overallPpgEdge)}，近10场场均分差 ${signed(formPpgEdge)}，主客场场均分差 ${signed(venuePpgEdge)}；联赛基准总进球 ${baselineGoals.toFixed(2)}。`,
  };
}

function promotedStandingBaseline(side, scope) {
  const isVenue = scope === "venue";
  const isHome = side === "home";
  const playedGames = isVenue ? 10 : 20;
  const goalsForPerGame = isVenue ? (isHome ? 1.25 : 0.9) : 1.1;
  const goalsAgainstPerGame = isVenue ? (isHome ? 1.45 : 1.75) : 1.6;
  return {
    available: true,
    position: 18,
    playedGames,
    pointsPerGame: isVenue ? (isHome ? 1.15 : 0.85) : 1.05,
    goalsForPerGame,
    goalsAgainstPerGame,
    goalsFor: goalsForPerGame * playedGames,
    goalsAgainst: goalsAgainstPerGame * playedGames,
    goalDifference: (goalsForPerGame - goalsAgainstPerGame) * playedGames,
    estimated: true,
  };
}

function summarizeStanding(row) {
  if (!row) return { available: false, position: null, playedGames: 0, points: 0, pointsPerGame: 0, goalDifference: 0 };
  const playedGames = number(row.playedGames);
  const goalsFor = number(row.goalsFor);
  const goalsAgainst = number(row.goalsAgainst);
  const points = number(row.points);
  return {
    available: true,
    position: number(row.position) || null,
    playedGames,
    won: number(row.won),
    draw: number(row.draw),
    lost: number(row.lost),
    points,
    pointsPerGame: round(playedGames ? points / playedGames : 0),
    goalsFor,
    goalsAgainst,
    goalDifference: Number.isFinite(Number(row.goalDifference)) ? number(row.goalDifference) : goalsFor - goalsAgainst,
    goalsForPerGame: round(playedGames ? goalsFor / playedGames : 0),
    goalsAgainstPerGame: round(playedGames ? goalsAgainst / playedGames : 0),
  };
}

function summarizeForm(matches, team) {
  const summary = { played: 0, won: 0, draw: 0, lost: 0, points: 0, goalsFor: 0, goalsAgainst: 0, sequence: [] };
  for (const match of matches) {
    const isHome = sameTeam(match.home, team);
    const goalsFor = scoreNumber(isHome ? match.score?.home : match.score?.away);
    const goalsAgainst = scoreNumber(isHome ? match.score?.away : match.score?.home);
    if (!Number.isFinite(goalsFor) || !Number.isFinite(goalsAgainst)) continue;
    summary.played += 1;
    summary.goalsFor += goalsFor;
    summary.goalsAgainst += goalsAgainst;
    if (goalsFor > goalsAgainst) {
      summary.won += 1;
      summary.points += 3;
      summary.sequence.push("胜");
    } else if (goalsFor === goalsAgainst) {
      summary.draw += 1;
      summary.points += 1;
      summary.sequence.push("平");
    } else {
      summary.lost += 1;
      summary.sequence.push("负");
    }
  }
  return {
    ...summary,
    pointsPerGame: round(summary.played ? summary.points / summary.played : 0),
    goalsForPerGame: round(summary.played ? summary.goalsFor / summary.played : 0),
    goalsAgainstPerGame: round(summary.played ? summary.goalsAgainst / summary.played : 0),
  };
}

function normalizeGoalDifference(standing) {
  const played = number(standing?.playedGames);
  return played ? number(standing?.goalDifference) / played : 0;
}

function weightedRecentTotal(homeForm, awayForm) {
  const rates = [
    number(homeForm?.goalsForPerGame),
    number(homeForm?.goalsAgainstPerGame),
    number(awayForm?.goalsForPerGame),
    number(awayForm?.goalsAgainstPerGame),
  ].filter((value) => value > 0);
  return rates.length ? rates.reduce((sum, value) => sum + value, 0) / 2 : 2.65;
}

function weightedSeasonTotal(homeStanding, awayStanding) {
  const rates = [
    number(homeStanding?.goalsForPerGame),
    number(homeStanding?.goalsAgainstPerGame),
    number(awayStanding?.goalsForPerGame),
    number(awayStanding?.goalsAgainstPerGame),
  ].filter((value) => value > 0);
  return rates.length ? rates.reduce((sum, value) => sum + value, 0) / 2 : 2.65;
}

function publicMatch(match) {
  return {
    id: match.id,
    kickoffBeijing: match.kickoffBeijing || match.kickoffUtc,
    home: match.home?.displayName || match.home?.name || "",
    away: match.away?.displayName || match.away?.name || "",
    score: `${scoreNumber(match.score?.home)}-${scoreNumber(match.score?.away)}`,
  };
}

function findStanding(table, team) {
  return table.find((row) => sameTeam(row?.team, team));
}

function includesTeam(match, team) {
  return sameTeam(match?.home, team) || sameTeam(match?.away, team);
}

function sameTeam(left, right) {
  const leftKeys = teamKeys(left);
  const rightKeys = new Set(teamKeys(right));
  return leftKeys.some((key) => rightKeys.has(key));
}

function teamKeys(team) {
  return [team?.id, team?.footballDataId, team?.code, team?.name, team?.displayName]
    .map((value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ""))
    .filter(Boolean);
}

function scoreNumber(value) {
  return value == null ? Number.NaN : Number(value);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function signed(value) {
  const rounded = round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(2)}`;
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}
