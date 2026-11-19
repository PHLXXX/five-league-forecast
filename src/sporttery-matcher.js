// Match 中国体彩 竞彩 fixtures (Chinese short names) to our fixtures.
// A pair only matches when BOTH teams agree, the Beijing date is within one day,
// and the league (if given) is the same, so a loose name rule cannot pair the wrong game.

import { matchTeamName } from "./team-matcher.js";

const LEAGUE_ZH = {
  PL: ["英超", "英格兰超级"], BL1: ["德甲", "德国甲级"], PD: ["西甲", "西班牙甲级"], SA: ["意甲", "意大利甲级"], FL1: ["法甲", "法国甲级"],
};

// 竞彩常用简称 → 标准名（与球队中文名一致的写法）
const ZH_ALIASES = {
  "国米": "国际米兰", "国际米兰": "国际米兰", "AC米兰": "AC米兰", "米兰": "AC米兰", "尤文": "尤文图斯", "罗马": "罗马",
  "皇马": "皇家马德里", "巴萨": "巴塞罗那", "马竞": "马德里竞技", "马德里竞技": "马德里竞技", "皇社": "皇家社会", "毕巴": "毕尔巴鄂竞技",
  "毕尔巴鄂": "毕尔巴鄂竞技", "贝蒂斯": "皇家贝蒂斯", "比利亚雷": "比利亚雷亚尔", "黄潜": "比利亚雷亚尔", "西班牙人": "西班牙人",
  "皇家奥维": "皇家奥维耶多", "奥维耶多": "皇家奥维耶多", "拉科": "拉科鲁尼亚", "桑坦德": "桑坦德竞技",
  "拜仁": "拜仁慕尼黑", "多特": "多特蒙德", "门兴": "门兴格拉德巴赫", "勒沃": "勒沃库森", "药厂": "勒沃库森", "法兰克福": "法兰克福",
  "莱比锡": "莱比锡", "云达": "云达不莱梅", "不莱梅": "云达不莱梅", "柏林联": "柏林联合", "沙尔克": "沙尔克04", "汉堡": "汉堡",
  "巴黎": "巴黎圣日耳曼", "巴黎圣曼": "巴黎圣日耳曼", "大巴黎": "巴黎圣日耳曼", "巴黎FC": "巴黎足球会", "巴黎足球": "巴黎足球会",
  "斯特拉斯": "斯特拉斯堡", "勒阿弗尔": "勒阿弗尔", "圣埃蒂安": "圣埃蒂安",
  "热刺": "托特纳姆热刺", "维拉": "阿斯顿维拉", "纽卡斯尔": "纽卡斯尔联", "纽卡": "纽卡斯尔联", "诺丁汉": "诺丁汉森林", "诺丁森林": "诺丁汉森林",
  "西汉姆": "西汉姆联", "布伦特": "布伦特福德", "伊普斯": "伊普斯维奇", "莱斯特": "莱斯特城", "利兹": "利兹联", "赫尔": "赫尔城",
  "南安普顿": "南安普敦", "水晶宫": "水晶宫", "曼城": "曼城", "曼联": "曼联",
};

function cleanZh(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/(足球俱乐部|俱乐部|FC|CF)$/i, "")
    .trim();
}

function canonicalZh(value) {
  const cleaned = cleanZh(value);
  return ZH_ALIASES[cleaned] || cleaned;
}

function bigrams(text) {
  const grams = new Set();
  for (let i = 0; i < text.length - 1; i += 1) grams.add(text.slice(i, i + 2));
  return grams;
}

// 1 = same club, 0 = different. Chinese names: alias, containment, then bigram overlap.
export function zhTeamSimilarity(left, right) {
  const a = canonicalZh(left);
  const b = canonicalZh(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // 曼城/曼联, 巴黎圣日耳曼/巴黎足球会 etc. must never merge through a shared prefix
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 2 && longer.includes(shorter) && !conflicting(a, b)) return 0.9;
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (!ga.size || !gb.size) return 0;
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared += 1;
  const score = shared / Math.min(ga.size, gb.size);
  return conflicting(a, b) ? 0 : score >= 0.67 ? 0.7 : 0;
}

const CONFLICT_GROUPS = [
  ["曼城", "曼联"],
  ["巴黎圣日耳曼", "巴黎足球会"],
  ["皇家马德里", "马德里竞技"],
  ["国际米兰", "AC米兰"],
  ["柏林联合", "柏林赫塔"],
  ["皇家社会", "皇家贝蒂斯", "皇家马德里", "皇家奥维耶多"],
];

function conflicting(a, b) {
  return CONFLICT_GROUPS.some((group) => {
    const ia = group.findIndex((name) => a === name || a.includes(name));
    const ib = group.findIndex((name) => b === name || b.includes(name));
    return ia >= 0 && ib >= 0 && ia !== ib;
  });
}

function teamMatches(ourTeam, sportteryTeam) {
  const ourZh = [ourTeam?.displayName, ourTeam?.shortName].filter(Boolean);
  const theirZh = [sportteryTeam?.name, sportteryTeam?.abbr].filter(Boolean);
  let best = 0;
  for (const x of ourZh) for (const y of theirZh) best = Math.max(best, zhTeamSimilarity(x, y));
  if (best >= 0.7) return best;
  // English fallback (homeTeamAbbEnName etc.)
  const english = [sportteryTeam?.en].filter(Boolean);
  const ours = [ourTeam?.name, ourTeam?.shortName].filter(Boolean);
  for (const en of english) if (matchTeamName(en, ours, { threshold: 0.6 })) return 0.75;
  return 0;
}

function dayDiff(a, b) {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.round(Math.abs(ta - tb) / 86400000);
}

export function findSportteryFixture(match, officialMatches) {
  const ourDate = String(match?.kickoffBeijing || match?.dateInfo?.date || "").slice(0, 10);
  const leagueNames = LEAGUE_ZH[match?.competitionId] || [];
  let best = null;
  for (const item of officialMatches || []) {
    const league = String(item.leagueName || "");
    if (league && leagueNames.length && !leagueNames.some((name) => league.includes(name))) continue;
    const diff = dayDiff(ourDate, String(item.matchDate || item.businessDate || "").slice(0, 10));
    if (diff > 1) continue;
    const home = teamMatches(match.home, item.home);
    const away = teamMatches(match.away, item.away);
    if (!home || !away) continue;
    const score = home + away + (diff === 0 ? 0.5 : 0);
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item || null;
}
