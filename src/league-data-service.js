import {
  buildMatchId,
  getCompetition,
  listCompetitions as listCompetitionConfigs,
  parseMatchId,
} from "./competitions.js";
import { localizeTeamName } from "./team-names.js";

const DEFAULT_API_BASE = "https://api.football-data.org/v4";
const DEFAULT_ESPN_API_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const DEFAULT_ESPN_STANDINGS_API_BASE = "https://site.api.espn.com/apis/v2/sports/soccer";
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

export function currentEuropeanSeason(now = new Date()) {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? year : year - 1;
}

export function toBeijingIso(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().replace(/\.000Z$/, "Z").replace(/Z$/, "+08:00");
}

export function createLeagueDataService({
  fetchJson,
  apiBase = DEFAULT_API_BASE,
  espnApiBase = DEFAULT_ESPN_API_BASE,
  espnStandingsApiBase = DEFAULT_ESPN_STANDINGS_API_BASE,
  espnCoreApiBase = "https://sports.core.api.espn.com/v2/sports/soccer/leagues",
  apiKey = "",
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = () => new Date(),
} = {}) {
  if (typeof fetchJson !== "function") throw new Error("fetchJson 依赖不能为空");
  const memoryCache = new Map();

  async function loadCached(key, force, loader) {
    const timestamp = now().getTime();
    const cached = memoryCache.get(key);
    if (!force && cached && cached.expiresAt > timestamp) return cached.value;
    const value = await loader();
    memoryCache.set(key, { value, expiresAt: timestamp + cacheTtlMs });
    return value;
  }

  function requestOptions() {
    return {
      headers: apiKey ? { "X-Auth-Token": apiKey } : {},
      timeout: 15000,
    };
  }

  function requireCompetition(value) {
    const competition = getCompetition(value);
    if (!competition) throw new Error(`不支持的联赛: ${value}`);
    return competition;
  }

  async function getMatches({ competitionId, season = currentEuropeanSeason(now()), status = "all", force = false } = {}) {
    const competition = requireCompetition(competitionId);
    const seasonNumber = Number.parseInt(String(season), 10);
    if (!Number.isFinite(seasonNumber)) throw new Error(`无效赛季: ${season}`);
    const cacheKey = `matches:${competition.id}:${seasonNumber}`;
    const result = await loadCached(cacheKey, force, async () => {
      let primaryError = null;
      if (apiKey) {
        try {
          return await loadFootballDataMatches(competition, seasonNumber);
        } catch (error) {
          primaryError = error;
        }
      }
      try {
        return await loadEspnMatches(competition, seasonNumber, primaryError);
      } catch (espnError) {
        if (primaryError) {
          throw new Error(`football-data 与 ESPN 赛程均不可用：${primaryError.message}; ${espnError.message}`);
        }
        throw espnError;
      }
    });
    const normalizedStatus = String(status || "all").toUpperCase();
    if (normalizedStatus === "ALL") return result;
    return {
      ...result,
      matches: result.matches.filter((match) => match.status === normalizedStatus),
    };
  }

  async function loadFootballDataMatches(competition, seasonNumber) {
    const url = `${apiBase}/competitions/${competition.footballDataCode}/matches?season=${seasonNumber}`;
    const payload = await fetchJson(url, requestOptions());
    const matches = arrayFrom(payload?.matches)
      .map((match) => normalizeMatch(match, competition, seasonNumber))
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    return {
      refreshedAt: now().toISOString(),
      competition: publicCompetition(competition),
      season: seasonNumber,
      matches,
      source: url,
      sourceLabel: "football-data.org",
    };
  }

  async function loadEspnMatches(competition, seasonNumber, primaryError = null) {
    const dateFrom = `${seasonNumber}0701`;
    const dateTo = `${seasonNumber + 1}0630`;
    let url = `${espnApiBase}/${competition.espnSlug}/scoreboard?limit=1000&dates=${dateFrom}-${dateTo}`;
    let events = [];
    try {
      const payload = await fetchJson(url, { timeout: 15000 });
      events = arrayFrom(payload?.events);
    } catch {
      events = [];
    }
    if (!events.length) {
      // ESPN stopped serving date-range scoreboards (HTTP 400). Rebuild the season from
      // every club's schedule: played matches + remaining fixtures, de-duplicated by event id.
      url = `${espnApiBase}/${competition.espnSlug}/teams`;
      events = await loadEspnSeasonFromTeamSchedules(competition, seasonNumber);
    }
    const matches = events
      .map((event) => normalizeEspnMatch(event, competition, seasonNumber))
      .filter(Boolean)
      .filter((match) => {
        const kickoff = match.kickoffUtc.slice(0, 10).replace(/-/g, "");
        return kickoff >= dateFrom && kickoff <= dateTo;
      })
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    if (!matches.length) throw new Error(`${competition.nameZh} ESPN 赛程源未返回比赛`);
    return {
      refreshedAt: now().toISOString(),
      competition: publicCompetition(competition),
      season: seasonNumber,
      matches,
      source: url,
      sourceLabel: "ESPN Soccer API",
      fallback: Boolean(primaryError),
      warning: primaryError ? `football-data 暂不可用，已切换 ESPN：${primaryError.message}` : "",
    };
  }

  async function loadEspnSeasonFromTeamSchedules(competition, seasonNumber) {
    const teamsPayload = await fetchJson(`${espnApiBase}/${competition.espnSlug}/teams?season=${seasonNumber}`, { timeout: 15000 });
    const teams = arrayFrom(teamsPayload?.sports?.[0]?.leagues?.[0]?.teams).map((entry) => entry?.team).filter((team) => team?.id);
    if (!teams.length) throw new Error(`${competition.nameZh} ESPN 球队列表为空`);
    const byId = new Map();
    const failed = [];
    const queue = teams.flatMap((team) => [
      `${espnApiBase}/${competition.espnSlug}/teams/${team.id}/schedule?season=${seasonNumber}`,
      `${espnApiBase}/${competition.espnSlug}/teams/${team.id}/schedule?season=${seasonNumber}&fixture=true`,
    ]);
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const scheduleUrl = queue.shift();
        try {
          const payload = await fetchWithRetry(scheduleUrl);
          for (const event of arrayFrom(payload?.events)) {
            // team schedules mix in cup games; keep only this league
            const slug = event?.league?.slug || payload?.requestedSeason?.league?.slug || "";
            if (slug && slug !== competition.espnSlug) continue;
            if (event?.id && !byId.has(event.id)) byId.set(event.id, event);
          }
        } catch {
          failed.push(scheduleUrl);
        }
      }
    });
    await Promise.all(workers);
    await completeFromSeasonEventList(competition, seasonNumber, byId);
    const expected = teams.length * (teams.length - 1);
    if (byId.size < expected && failed.length) {
      throw new Error(`${competition.nameZh} ESPN 赛程不完整（${byId.size}/${expected}），${failed.length} 个球队赛程请求失败`);
    }
    return [...byId.values()];
  }

  async function fetchWithRetry(url, attempts = 3) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fetchJson(url, { timeout: 15000 });
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  // Team schedules leave out suspended/postponed games that have no future date.
  // The core API lists every event id of the season; fetch the few that are missing.
  async function completeFromSeasonEventList(competition, seasonNumber, byId) {
    let ids = [];
    try {
      const list = await fetchWithRetry(`${espnCoreApiBase}/${competition.espnSlug}/seasons/${seasonNumber}/types/1/events?limit=1000`);
      ids = arrayFrom(list?.items).map((item) => String(item?.$ref || "").match(/events\/(\d+)/)?.[1]).filter(Boolean);
    } catch {
      return;
    }
    const missing = ids.filter((id) => !byId.has(id)).slice(0, 40);
    for (const id of missing) {
      try {
        const summary = await fetchWithRetry(`${espnApiBase}/${competition.espnSlug}/summary?event=${id}`);
        const contest = summary?.header?.competitions?.[0];
        if (!contest) continue;
        byId.set(id, {
          id,
          date: contest.date,
          league: { slug: competition.espnSlug },
          competitions: [{ ...contest, venue: contest.venue || summary?.gameInfo?.venue }],
        });
      } catch {
        // leave it out; the completeness check below reports it
      }
    }
  }

  async function getStandings({ competitionId, season = currentEuropeanSeason(now()), force = false } = {}) {
    const competition = requireCompetition(competitionId);
    const seasonNumber = Number.parseInt(String(season), 10);
    if (!Number.isFinite(seasonNumber)) throw new Error(`无效赛季: ${season}`);
    const cacheKey = `standings:${competition.id}:${seasonNumber}`;
    return loadCached(cacheKey, force, async () => {
      let primaryError = null;
      if (apiKey) {
        try {
          return await loadFootballDataStandings(competition, seasonNumber);
        } catch (error) {
          primaryError = error;
        }
      }
      try {
        return await loadEspnStandings(competition, seasonNumber, primaryError);
      } catch (espnError) {
        if (primaryError) {
          throw new Error(`football-data 与 ESPN 积分榜均不可用：${primaryError.message}; ${espnError.message}`);
        }
        throw espnError;
      }
    });
  }

  async function loadFootballDataStandings(competition, seasonNumber) {
    const url = `${apiBase}/competitions/${competition.footballDataCode}/standings?season=${seasonNumber}`;
    const payload = await fetchJson(url, requestOptions());
    const tables = { total: [], home: [], away: [] };
    for (const standing of arrayFrom(payload?.standings)) {
      const key = String(standing?.type || "").toLowerCase();
      if (Object.hasOwn(tables, key)) tables[key] = arrayFrom(standing?.table).map((row) => normalizeStandingRow(row, competition.id));
    }
    return {
      refreshedAt: now().toISOString(),
      competition: publicCompetition(competition),
      season: seasonNumber,
      currentMatchday: Number(payload?.season?.currentMatchday || 0),
      startDate: payload?.season?.startDate || "",
      endDate: payload?.season?.endDate || "",
      tables,
      source: url,
      sourceLabel: "football-data.org",
    };
  }

  async function loadEspnStandings(competition, seasonNumber, primaryError = null) {
    const url = `${espnStandingsApiBase}/${competition.espnSlug}/standings?season=${seasonNumber}`;
    const payload = await fetchJson(url, { timeout: 15000 });
    const entries = arrayFrom(payload?.children).flatMap((child) => arrayFrom(child?.standings?.entries));
    const total = entries.map((entry) => normalizeEspnStandingRow(entry, competition.id));
    if (!total.length) throw new Error(`${competition.nameZh} ESPN 积分榜源未返回球队`);
    return {
      refreshedAt: now().toISOString(),
      competition: publicCompetition(competition),
      season: seasonNumber,
      currentMatchday: Math.max(...total.map((row) => row.playedGames), 0),
      startDate: "",
      endDate: "",
      tables: { total, home: [], away: [] },
      source: url,
      sourceLabel: "ESPN Soccer API",
      fallback: Boolean(primaryError),
      warning: primaryError ? `football-data 积分榜暂不可用，已切换 ESPN：${primaryError.message}` : "",
    };
  }

  async function findMatch(matchId, { force = false } = {}) {
    const parsed = parseMatchId(matchId);
    if (!parsed) return null;
    const competition = requireCompetition(parsed.competitionId);
    const cacheKey = `match:${matchId}`;
    return loadCached(cacheKey, force, async () => {
      const url = `${apiBase}/matches/${encodeURIComponent(parsed.sourceId)}`;
      const payload = await fetchJson(url, requestOptions());
      const rawMatch = payload?.match || payload;
      if (!rawMatch?.id) return null;
      return normalizeMatch(rawMatch, competition, parsed.season);
    });
  }

  async function getTeamRecentMatches({ competitionId, teamId, before, limit = 10, force = false } = {}) {
    const competition = requireCompetition(competitionId);
    const normalizedTeamId = String(teamId || "").trim();
    if (!normalizedTeamId) throw new Error("球队 ID 不能为空");
    const beforeDate = new Date(before || now());
    if (Number.isNaN(beforeDate.getTime())) throw new Error(`无效开球时间: ${before}`);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 20));
    const currentDate = now();
    const cutoff = new Date(Math.min(beforeDate.getTime() - 24 * 60 * 60 * 1000, currentDate.getTime()));
    const dateTo = cutoff.toISOString().slice(0, 10);
    const dateFrom = new Date(cutoff.getTime() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const cacheKey = `recent:${competition.id}:${normalizedTeamId}:${dateFrom}:${dateTo}:${safeLimit}`;
    return loadCached(cacheKey, force, async () => {
      const url = `${apiBase}/teams/${encodeURIComponent(normalizedTeamId)}/matches?status=FINISHED&dateFrom=${dateFrom}&dateTo=${dateTo}&limit=${safeLimit}`;
      const payload = await fetchJson(url, requestOptions());
      const season = currentEuropeanSeason(beforeDate);
      const matches = arrayFrom(payload?.matches)
        .filter((match) => Date.parse(match?.utcDate || "") < beforeDate.getTime())
        .map((match) => normalizeRecentMatch(match, competition, season))
        .sort((left, right) => right.sortKey.localeCompare(left.sortKey))
        .slice(0, safeLimit);
      return { refreshedAt: now().toISOString(), competition: publicCompetition(competition), teamId: normalizedTeamId, before: beforeDate.toISOString(), matches, source: url };
    });
  }

  function listCompetitions() {
    const season = currentEuropeanSeason(now());
    return {
      refreshedAt: now().toISOString(),
      currentSeason: season,
      competitions: listCompetitionConfigs().map((competition) => ({
        ...publicCompetition(competition),
        seasons: Array.from({ length: 5 }, (_, index) => season - index),
      })),
    };
  }

  return { listCompetitions, getMatches, getStandings, findMatch, getTeamRecentMatches };
}

function normalizeEspnMatch(event, competition, season) {
  const contest = arrayFrom(event?.competitions)[0];
  const eventId = String(event?.id || contest?.id || "").trim();
  if (!eventId) return null;
  const kickoffUtc = event?.date || contest?.date || "";
  const kickoffBeijing = toBeijingIso(kickoffUtc);
  const dateInfo = {
    date: kickoffBeijing.slice(0, 10),
    time: kickoffBeijing.slice(11, 16),
    iso: kickoffBeijing,
    label: "北京时间",
  };
  const status = normalizeEspnStatus(contest?.status || event?.status);
  const competitors = arrayFrom(contest?.competitors);
  const homeEntry = competitors.find((entry) => entry?.homeAway === "home") || competitors[0];
  const awayEntry = competitors.find((entry) => entry?.homeAway === "away") || competitors[1];
  if (!homeEntry?.team || !awayEntry?.team) return null;
  const venue = contest?.venue || event?.venue || {};

  return {
    id: buildMatchId(competition.id, season, `espn-${eventId}`),
    competitionId: competition.id,
    competition: publicCompetition(competition),
    season,
    sourceIds: { footballData: "", espn: eventId },
    matchday: Number(event?.week?.number || contest?.week?.number || 0),
    stage: "REGULAR_SEASON",
    type: "league",
    group: competition.nameZh,
    status,
    finished: status === "FINISHED",
    kickoffUtc,
    kickoffBeijing,
    localDateRaw: kickoffBeijing,
    dateInfo,
    venueDateInfo: dateInfo,
    sortKey: `${kickoffUtc || "9999-99-99"}:espn-${eventId}`,
    home: normalizeEspnTeam(homeEntry, competition.id),
    away: normalizeEspnTeam(awayEntry, competition.id),
    score: {
      home: status === "SCHEDULED" ? null : nullableNumber(espnScore(homeEntry?.score)),
      away: status === "SCHEDULED" ? null : nullableNumber(espnScore(awayEntry?.score)),
    },
    stadium: {
      id: String(venue?.id || ""),
      name: venue?.fullName || venue?.displayName || "",
      fifaName: venue?.fullName || venue?.displayName || "",
      city: venue?.address?.city || "",
      country: venue?.address?.country || "",
      capacity: Number(venue?.capacity || 0),
      region: venue?.address?.state || "",
    },
    footballData: { id: "", utcDate: kickoffUtc, status: "", stage: "", lastUpdated: "" },
    espn: { id: eventId, status: contest?.status?.type?.name || event?.status?.type?.name || "" },
  };
}

function normalizeEspnTeam(entry, competitionId) {
  const team = entry?.team || {};
  const sourceId = String(team.id || entry?.id || "");
  const name = team.displayName || team.shortDisplayName || team.name || "待定";
  const shortName = team.shortDisplayName || team.name || name;
  const crest = team.logo || arrayFrom(team.logos)[0]?.href || "";
  return {
    id: `espn:${sourceId}`,
    footballDataId: "",
    espnId: sourceId,
    name,
    displayName: localizeTeamName(competitionId, {
      name,
      shortName,
      tla: team.abbreviation || "",
    }),
    shortName,
    code: team.abbreviation || "",
    flag: crest,
    crest,
  };
}

function normalizeEspnStatus(status) {
  const type = status?.type || {};
  const name = String(type.name || "").toUpperCase();
  const state = String(type.state || "").toLowerCase();
  // Check interrupted states first: ESPN marks suspended/abandoned games as state "post"
  // with completed=false, which must not be read as a 0-0 full time.
  if (name.includes("POSTPONED")) return "POSTPONED";
  if (name.includes("CANCELED") || name.includes("CANCELLED")) return "CANCELLED";
  if (name.includes("SUSPENDED") || name.includes("ABANDONED")) return "SUSPENDED";
  if (type.completed || name.includes("FULL_TIME") || name.includes("FINAL")) return "FINISHED";
  if (state === "in" || name.includes("IN_PROGRESS") || name.includes("HALFTIME") || name.includes("FIRST_HALF") || name.includes("SECOND_HALF")) return "LIVE";
  if (state === "post") return "FINISHED";
  return "SCHEDULED";
}

function normalizeRecentMatch(match, requestedCompetition, season) {
  const normalized = normalizeMatch(match, requestedCompetition, season);
  const sourceCode = String(match?.competition?.code || requestedCompetition.id || "").toUpperCase();
  const sourceName = match?.competition?.name || requestedCompetition.nameEn || sourceCode;
  return {
    ...normalized,
    id: `RECENT:${sourceCode}:${String(match?.id || "")}`,
    competitionId: sourceCode,
    competition: {
      id: sourceCode,
      nameZh: sourceName,
      nameEn: sourceName,
      countryCode: "",
      countryZh: "",
      espnSlug: "",
      modelProfile: {},
    },
    group: sourceName,
  };
}

function normalizeMatch(match, competition, season) {
  const kickoffUtc = match?.utcDate || "";
  const kickoffBeijing = toBeijingIso(kickoffUtc);
  const dateInfo = {
    date: kickoffBeijing.slice(0, 10),
    time: kickoffBeijing.slice(11, 16),
    iso: kickoffBeijing,
    label: "北京时间",
  };
  const status = normalizeStatus(match?.status);
  const homeScore = nullableNumber(match?.score?.fullTime?.home);
  const awayScore = nullableNumber(match?.score?.fullTime?.away);
  return {
    id: buildMatchId(competition.id, season, match?.id),
    competitionId: competition.id,
    competition: publicCompetition(competition),
    season,
    sourceIds: { footballData: String(match?.id || "") },
    matchday: Number(match?.matchday || 0),
    stage: match?.stage || "REGULAR_SEASON",
    type: "league",
    group: competition.nameZh,
    status,
    finished: status === "FINISHED",
    kickoffUtc,
    kickoffBeijing,
    localDateRaw: kickoffBeijing,
    dateInfo,
    venueDateInfo: dateInfo,
    sortKey: `${kickoffUtc || "9999-99-99"}:${String(match?.id || "")}`,
    home: normalizeTeam(match?.homeTeam, competition.id),
    away: normalizeTeam(match?.awayTeam, competition.id),
    score: { home: homeScore, away: awayScore },
    stadium: normalizeVenue(match?.venue),
    footballData: {
      id: String(match?.id || ""),
      utcDate: kickoffUtc,
      status: match?.status || "",
      stage: match?.stage || "",
      lastUpdated: match?.lastUpdated || "",
    },
  };
}

function normalizeStandingRow(row, competitionId) {
  return {
    position: Number(row?.position || 0),
    team: normalizeTeam(row?.team, competitionId),
    playedGames: Number(row?.playedGames || 0),
    won: Number(row?.won || 0),
    draw: Number(row?.draw || 0),
    lost: Number(row?.lost || 0),
    points: Number(row?.points || 0),
    goalsFor: Number(row?.goalsFor || 0),
    goalsAgainst: Number(row?.goalsAgainst || 0),
    goalDifference: Number(row?.goalDifference || 0),
  };
}

function normalizeEspnStandingRow(entry, competitionId) {
  const stat = (name) => Number(arrayFrom(entry?.stats).find((item) => item?.name === name)?.value || 0);
  const sourceTeam = entry?.team || {};
  const team = normalizeEspnTeam({
    team: {
      ...sourceTeam,
      logo: sourceTeam.logo || arrayFrom(sourceTeam.logos)[0]?.href || "",
    },
  }, competitionId);
  return {
    position: stat("rank"),
    team,
    playedGames: stat("gamesPlayed"),
    won: stat("wins"),
    draw: stat("ties"),
    lost: stat("losses"),
    points: stat("points"),
    goalsFor: stat("pointsFor"),
    goalsAgainst: stat("pointsAgainst"),
    goalDifference: stat("pointDifferential"),
  };
}

function normalizeTeam(team, competitionId) {
  const name = team?.name || team?.shortName || "待定";
  return {
    id: String(team?.id || ""),
    footballDataId: String(team?.id || ""),
    name,
    displayName: localizeTeamName(competitionId, team),
    shortName: team?.shortName || name,
    code: team?.tla || "",
    flag: team?.crest || "",
    crest: team?.crest || "",
  };
}

function normalizeVenue(venue) {
  if (!venue) return { id: "", name: "", fifaName: "", city: "", country: "", capacity: 0, region: "" };
  const name = venue.name || venue.fullName || "";
  return {
    id: String(venue.id || ""),
    name,
    fifaName: name,
    city: venue.city || "",
    country: venue.country || "",
    capacity: Number(venue.capacity || 0),
    region: venue.region || "",
  };
}

function normalizeStatus(status) {
  const value = String(status || "SCHEDULED").toUpperCase();
  if (["FINISHED", "AWARDED"].includes(value)) return "FINISHED";
  if (["IN_PLAY", "PAUSED", "LIVE"].includes(value)) return "LIVE";
  if (["POSTPONED", "SUSPENDED", "CANCELLED"].includes(value)) return value;
  return "SCHEDULED";
}

function publicCompetition(competition) {
  return {
    id: competition.id,
    nameZh: competition.nameZh,
    nameEn: competition.nameEn,
    countryCode: competition.countryCode,
    countryZh: competition.countryZh,
    espnSlug: competition.espnSlug,
    modelProfile: { ...competition.modelProfile },
  };
}

function nullableNumber(value) {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function espnScore(score) {
  if (score && typeof score === "object") return score.value ?? score.displayValue ?? null;
  return score;
}
