// Bookmaker lines (DraftKings via ESPN) matched to a fixture by ESPN event id,
// so the list, the match page and the model all read the same numbers.

const DEFAULT_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const CACHE_MS = 15 * 60 * 1000;

export function americanToDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().toUpperCase();
  if (text === "EVEN" || text === "EV") return 2;
  const number = Number(text.replace("+", ""));
  if (!Number.isFinite(number) || number === 0) return null;
  return number > 0 ? 1 + number / 100 : 1 + 100 / Math.abs(number);
}

function pick(side) {
  return side?.close?.odds ?? side?.open?.odds ?? null;
}

function parseLine(text) {
  const match = String(text ?? "").match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalizePair(a, b) {
  if (!(a > 1 && b > 1)) return null;
  const sum = 1 / a + 1 / b;
  return { first: 1 / a / sum, second: 1 / b / sum };
}

export function parseEspnOdds(raw) {
  if (!raw) return null;
  const ml = raw.moneyline || {};
  const home = americanToDecimal(pick(ml.home) ?? raw.homeTeamOdds?.moneyLine);
  const draw = americanToDecimal(pick(ml.draw) ?? raw.drawOdds?.moneyLine);
  const away = americanToDecimal(pick(ml.away) ?? raw.awayTeamOdds?.moneyLine);
  let oneXTwo = null;
  if (home > 1 && draw > 1 && away > 1) {
    const sum = 1 / home + 1 / draw + 1 / away;
    oneXTwo = { home: 1 / home / sum, draw: 1 / draw / sum, away: 1 / away / sum, margin: sum - 1 };
  }
  const totalLine = parseLine(raw.total?.over?.close?.line ?? raw.total?.over?.open?.line) ?? (Number.isFinite(Number(raw.overUnder)) ? Number(raw.overUnder) : null);
  const overDecimal = americanToDecimal(pick(raw.total?.over));
  const underDecimal = americanToDecimal(pick(raw.total?.under));
  const totalPair = normalizePair(overDecimal, underDecimal);
  const spreadHomeLine = parseLine(raw.pointSpread?.home?.close?.line ?? raw.pointSpread?.home?.open?.line);
  const spreadHome = americanToDecimal(pick(raw.pointSpread?.home));
  const spreadAway = americanToDecimal(pick(raw.pointSpread?.away));
  const spreadPair = normalizePair(spreadHome, spreadAway);
  if (!oneXTwo && !totalPair && !spreadPair) return null;
  return {
    provider: raw.provider?.name || "ESPN",
    decimal: oneXTwo ? { home: round2(home), draw: round2(draw), away: round2(away) } : null,
    openDecimal: {
      home: round2(americanToDecimal(ml.home?.open?.odds)),
      draw: round2(americanToDecimal(ml.draw?.open?.odds)),
      away: round2(americanToDecimal(ml.away?.open?.odds)),
    },
    oneXTwo,
    total: Number.isFinite(totalLine) && totalPair
      ? { line: totalLine, overDecimal: round2(overDecimal), underDecimal: round2(underDecimal), over: totalPair.first, under: totalPair.second }
      : null,
    spread: Number.isFinite(spreadHomeLine) && spreadPair
      ? { homeLine: spreadHomeLine, homeDecimal: round2(spreadHome), awayDecimal: round2(spreadAway), home: spreadPair.first, away: spreadPair.second }
      : null,
  };
}

// Candidate scoreboard dates: ESPN groups soccer days by US Eastern time.
function candidateDates(kickoffUtc) {
  const time = Date.parse(kickoffUtc || "");
  if (!Number.isFinite(time)) return [];
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  return [...new Set([fmt(time - 5 * 3600 * 1000), fmt(time), fmt(time - 29 * 3600 * 1000)])];
}

export function createEspnOddsService({ fetchJson, base = DEFAULT_BASE, now = () => Date.now() } = {}) {
  const cache = new Map();

  async function scoreboard(slug, date) {
    const key = `${slug}:${date}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;
    if (hit?.pending) return hit.pending;
    const pending = fetchJson(`${base}/${slug}/scoreboard?dates=${date}`, { timeout: 15000 })
      .then((payload) => {
        const byId = new Map();
        for (const event of Array.isArray(payload?.events) ? payload.events : []) {
          const raw = (event?.competitions?.[0]?.odds || []).filter(Boolean)[0];
          byId.set(String(event.id), parseEspnOdds(raw));
        }
        cache.set(key, { at: now(), value: byId });
        return byId;
      })
      .catch((error) => {
        cache.delete(key);
        throw error;
      });
    cache.set(key, { at: hit?.at || 0, value: hit?.value, pending });
    return pending;
  }

  async function oddsForMatch(match) {
    const eventId = String(match?.sourceIds?.espn || match?.espn?.id || "");
    const slug = match?.competition?.espnSlug;
    if (!eventId || !slug) return null;
    for (const date of candidateDates(match.kickoffUtc)) {
      try {
        const byId = await scoreboard(slug, date);
        if (byId.has(eventId)) return byId.get(eventId);
      } catch {
        // try the next date
      }
    }
    return null;
  }

  return { oddsForMatch };
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}
