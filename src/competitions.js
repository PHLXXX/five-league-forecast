const competitionEntries = [
  ["PL", {
    id: "PL",
    nameZh: "英超",
    nameEn: "Premier League",
    footballDataCode: "PL",
    espnSlug: "eng.1",
    countryCode: "GB-ENG",
    countryZh: "英格兰",
    modelProfile: { goalMean: 2.85, homeAdvantage: 0.19, cornerMean: 10.4, cardMean: 4.2 },
  }],
  ["FL1", {
    id: "FL1",
    nameZh: "法甲",
    nameEn: "Ligue 1",
    footballDataCode: "FL1",
    espnSlug: "fra.1",
    countryCode: "FR",
    countryZh: "法国",
    modelProfile: { goalMean: 2.65, homeAdvantage: 0.17, cornerMean: 9.7, cardMean: 4.5 },
  }],
  ["BL1", {
    id: "BL1",
    nameZh: "德甲",
    nameEn: "Bundesliga",
    footballDataCode: "BL1",
    espnSlug: "ger.1",
    countryCode: "DE",
    countryZh: "德国",
    modelProfile: { goalMean: 3.05, homeAdvantage: 0.18, cornerMean: 10.1, cardMean: 4.0 },
  }],
  ["PD", {
    id: "PD",
    nameZh: "西甲",
    nameEn: "La Liga",
    footballDataCode: "PD",
    espnSlug: "esp.1",
    countryCode: "ES",
    countryZh: "西班牙",
    modelProfile: { goalMean: 2.55, homeAdvantage: 0.18, cornerMean: 9.5, cardMean: 5.1 },
  }],
  ["SA", {
    id: "SA",
    nameZh: "意甲",
    nameEn: "Serie A",
    footballDataCode: "SA",
    espnSlug: "ita.1",
    countryCode: "IT",
    countryZh: "意大利",
    modelProfile: { goalMean: 2.65, homeAdvantage: 0.16, cornerMean: 9.6, cardMean: 4.8 },
  }],
];

export const COMPETITIONS = Object.freeze(Object.fromEntries(
  competitionEntries.map(([id, config]) => [id, Object.freeze(config)])
));

const competitionAliases = new Map();
for (const competition of Object.values(COMPETITIONS)) {
  for (const alias of [
    competition.id,
    competition.nameZh,
    competition.nameEn,
    competition.footballDataCode,
    competition.espnSlug,
  ]) {
    competitionAliases.set(String(alias).trim().toLowerCase(), competition.id);
  }
}

export function normalizeCompetitionId(value) {
  if (value == null) return "";
  return competitionAliases.get(String(value).trim().toLowerCase()) || "";
}

export function getCompetition(value) {
  const id = normalizeCompetitionId(value);
  return id ? COMPETITIONS[id] : null;
}

export function listCompetitions() {
  return Object.values(COMPETITIONS).map((competition) => ({
    ...competition,
    modelProfile: { ...competition.modelProfile },
  }));
}

export function buildMatchId(competitionValue, season, sourceId) {
  const competition = getCompetition(competitionValue);
  if (!competition) throw new Error(`不支持的联赛: ${competitionValue}`);
  const normalizedSeason = Number.parseInt(String(season), 10);
  if (!Number.isFinite(normalizedSeason)) throw new Error(`无效赛季: ${season}`);
  const normalizedSourceId = String(sourceId ?? "").trim();
  if (!normalizedSourceId) throw new Error("比赛来源 ID 不能为空");
  return `${competition.id}:${normalizedSeason}:${normalizedSourceId}`;
}

export function parseMatchId(matchId) {
  const [competitionValue, seasonValue, ...sourceParts] = String(matchId || "").split(":");
  const competition = getCompetition(competitionValue);
  const season = Number.parseInt(seasonValue, 10);
  const sourceId = sourceParts.join(":");
  if (!competition || !Number.isFinite(season) || !sourceId) return null;
  return { competitionId: competition.id, season, sourceId };
}
