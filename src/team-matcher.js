// Map team names between sources (ESPN / football-data.org / football-data.co.uk CSV).

const ALIASES = {
  // England
  "man united": "manchester united", "man utd": "manchester united", "man city": "manchester city",
  "nott'm forest": "nottingham forest", "nottm forest": "nottingham forest", "wolves": "wolverhampton wanderers",
  "spurs": "tottenham hotspur", "tottenham": "tottenham hotspur", "newcastle": "newcastle united", "west ham": "west ham united",
  "brighton": "brighton hove albion", "leeds": "leeds united", "leicester": "leicester city", "ipswich": "ipswich town",
  "luton": "luton town", "sheffield united": "sheffield united", "sheffield weds": "sheffield wednesday", "hull": "hull city",
  "coventry": "coventry city", "norwich": "norwich city", "stoke": "stoke city", "cardiff": "cardiff city", "swansea": "swansea city",
  "birmingham": "birmingham city", "west brom": "west bromwich albion", "qpr": "queens park rangers",
  // Spain
  "ath madrid": "atletico madrid", "ath bilbao": "athletic club", "athletic bilbao": "athletic club", "sociedad": "real sociedad",
  "betis": "real betis", "vallecano": "rayo vallecano", "celta": "celta vigo", "espanol": "espanyol", "alaves": "alaves",
  "la coruna": "deportivo la coruna", "deportivo": "deportivo la coruna", "racing santander": "santander", "sp gijon": "sporting gijon", "oviedo": "real oviedo", "valladolid": "real valladolid",
  "cadiz": "cadiz", "almeria": "almeria", "granada": "granada", "leganes": "leganes", "mallorca": "mallorca", "las palmas": "las palmas",
  // Germany
  "m'gladbach": "borussia monchengladbach", "mgladbach": "borussia monchengladbach", "ein frankfurt": "eintracht frankfurt",
  "fc koln": "fc cologne", "koln": "fc cologne", "cologne": "fc cologne", "leverkusen": "bayer leverkusen", "dortmund": "borussia dortmund",
  "bayern munich": "bayern munich", "hertha": "hertha berlin", "stuttgart": "vfb stuttgart", "wolfsburg": "vfl wolfsburg",
  "hoffenheim": "tsg hoffenheim", "mainz": "mainz", "augsburg": "augsburg", "freiburg": "sc freiburg", "bochum": "vfl bochum",
  "union berlin": "union berlin", "werder bremen": "werder bremen", "heidenheim": "heidenheim", "darmstadt": "darmstadt",
  "st pauli": "st pauli", "holstein kiel": "holstein kiel", "hamburg": "hamburg", "schalke 04": "schalke", "fortuna dusseldorf": "fortuna dusseldorf",
  "greuther furth": "greuther furth", "paderborn": "paderborn", "elversberg": "elversberg", "hannover": "hannover",
  // Italy
  "inter": "internazionale", "milan": "ac milan", "roma": "as roma", "verona": "hellas verona", "spal": "spal",
  "parma": "parma", "como": "como", "pisa": "pisa", "sassuolo": "sassuolo", "cremonese": "cremonese", "palermo": "palermo",
  // France
  "paris sg": "paris saint germain", "psg": "paris saint germain", "st etienne": "saint etienne", "marseille": "marseille",
  "lyon": "lyon", "monaco": "monaco", "lille": "lille", "nice": "nice", "rennes": "rennes", "lens": "lens", "brest": "brest",
  "nantes": "nantes", "strasbourg": "strasbourg", "toulouse": "toulouse", "auxerre": "auxerre", "angers": "angers", "le havre": "le havre",
  "clermont": "clermont foot", "ajaccio": "ajaccio", "troyes": "troyes", "lorient": "lorient", "metz": "metz", "paris fc": "paris fc",
};

const STOP_WORDS = new Set(["fc", "cf", "afc", "ac", "sc", "ssc", "as", "us", "ss", "cd", "ud", "rc", "rcd", "sd", "sv", "vfl", "vfb", "tsg", "1", "club", "de", "calcio", "1899", "1846", "04", "05", "07", "og", "le", "la", "el", "real", "hsc", "osc", "sco", "stade", "olympique"]);

export function normalizeTeamName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value) {
  const normalized = normalizeTeamName(value);
  return ALIASES[normalized] || normalized;
}

function tokens(value) {
  return canonical(value).replace(/'/g, "").split(" ").filter((token) => token && !STOP_WORDS.has(token));
}

function similarity(left, right) {
  const a = canonical(left);
  const b = canonical(right);
  if (a === b) return 1;
  const ta = tokens(left);
  const tb = tokens(right);
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let shared = 0;
  for (const token of sa) if (sb.has(token)) shared += 1;
  // prefix matches ("wolverhampton" vs "wolves" already aliased; "monchengladbach" vs "gladbach")
  let partial = 0;
  for (const x of sa) {
    if (sb.has(x)) continue;
    for (const y of sb) {
      if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x) || x.includes(y) || y.includes(x))) {
        partial += 0.7;
        break;
      }
    }
  }
  return (shared + partial) / Math.max(sa.size, sb.size);
}

// Given candidate names from one source, returns the best match for `name`, or "" if none is close.
export function matchTeamName(name, candidates, { threshold = 0.6 } = {}) {
  let best = "";
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = similarity(name, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore >= threshold ? best : "";
}

export function teamNamesOf(team) {
  if (!team) return [];
  if (typeof team === "string") return [team];
  return [team.name, team.shortName, team.displayNameEn, team.code].filter(Boolean);
}

// Resolve a fixture team object against CSV team names, trying each of its name variants.
export function resolveTeam(team, candidates) {
  for (const name of teamNamesOf(team)) {
    const hit = matchTeamName(name, candidates);
    if (hit) return hit;
  }
  return "";
}
