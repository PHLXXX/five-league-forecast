// Historical results + bookmaker odds + xG from football-data.co.uk CSV files.
// Free, no API key, updated twice a week during the season.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CSV_DIVISIONS = Object.freeze({ PL: "E0", BL1: "D1", PD: "SP1", SA: "I1", FL1: "F1" });
const CSV_BASE = "https://www.football-data.co.uk/mmz4281";

export function seasonCode(season) {
  const start = Number(season) % 100;
  const end = (start + 1) % 100;
  return `${String(start).padStart(2, "0")}${String(end).padStart(2, "0")}`;
}

export function csvFileName(competitionId, season) {
  return `${CSV_DIVISIONS[competitionId]}_${seasonCode(season)}.csv`;
}

export function parseCsv(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const header = lines[0].split(",").map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((key, index) => {
      if (key && !(key in row)) row[key] = (cells[index] ?? "").trim();
    });
    return row;
  });
}

function num(value) {
  if (value === undefined || value === null || value === "") return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function firstOdds(row, keys) {
  for (const group of keys) {
    const values = group.map((key) => num(row[key]));
    if (values.every((value) => value > 1)) return values;
  }
  return null;
}

function parseDate(dateText, timeText) {
  const match = String(dateText || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return Number.NaN;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const [hours, minutes] = String(timeText || "15:00").split(":").map(Number);
  // CSV times are UK local time; treat as UTC+0/+1 — one hour does not matter for ordering.
  return Date.UTC(year, Number(match[2]) - 1, Number(match[1]), Number.isFinite(hours) ? hours : 15, Number.isFinite(minutes) ? minutes : 0);
}

export function rowsToMatches(rows, { competitionId, season }) {
  const matches = [];
  for (const row of rows) {
    const home = row.HomeTeam;
    const away = row.AwayTeam;
    const time = parseDate(row.Date, row.Time);
    if (!home || !away || !Number.isFinite(time)) continue;
    const preMatch = firstOdds(row, [["AvgH", "AvgD", "AvgA"], ["BbAvH", "BbAvD", "BbAvA"], ["B365H", "B365D", "B365A"], ["PSH", "PSD", "PSA"]]);
    const closing = firstOdds(row, [["AvgCH", "AvgCD", "AvgCA"], ["PSCH", "PSCD", "PSCA"], ["B365CH", "B365CD", "B365CA"]]);
    const ou = firstOdds(row, [["Avg>2.5", "Avg<2.5"], ["BbAv>2.5", "BbAv<2.5"], ["B365>2.5", "B365<2.5"], ["P>2.5", "P<2.5"]]);
    matches.push({
      competitionId,
      season,
      time,
      date: new Date(time).toISOString(),
      home,
      away,
      hg: num(row.FTHG),
      ag: num(row.FTAG),
      hxg: num(row.HxG),
      axg: num(row.AxG),
      odds: preMatch ? { home: preMatch[0], draw: preMatch[1], away: preMatch[2] } : null,
      closingOdds: closing ? { home: closing[0], draw: closing[1], away: closing[2] } : null,
      ouOdds: ou ? { over: ou[0], under: ou[1] } : null,
      corners: { home: num(row.HC), away: num(row.AC) },
      cards: { home: num(row.HY) + 2 * (num(row.HR) || 0), away: num(row.AY) + 2 * (num(row.AR) || 0) },
      shots: { home: num(row.HS), away: num(row.AS), homeOnTarget: num(row.HST), awayOnTarget: num(row.AST) },
    });
  }
  return matches.sort((left, right) => left.time - right.time);
}

// Loads CSVs for a league from disk (seed + user data dir), refreshing the current
// and previous season from the web when the local copy is older than maxAgeMs.
export function createHistoryStore({ seedDir, dataDir, fetchText, now = () => Date.now(), maxAgeMs = 12 * 60 * 60 * 1000 } = {}) {
  const cacheDir = dataDir ? join(dataDir, "history") : seedDir;
  if (cacheDir && !existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const memory = new Map();
  const inflight = new Map();

  function localPath(name) {
    const cached = cacheDir ? join(cacheDir, name) : "";
    if (cached && existsSync(cached)) return cached;
    const seeded = seedDir ? join(seedDir, name) : "";
    if (seeded && existsSync(seeded)) return seeded;
    return "";
  }

  async function loadSeasonFile(competitionId, season, { refresh = false } = {}) {
    const name = csvFileName(competitionId, season);
    const path = localPath(name);
    const fresh = path && now() - statSync(path).mtimeMs < maxAgeMs;
    if (path && (!refresh || fresh)) return readFileSync(path, "utf8");
    if (typeof fetchText === "function") {
      try {
        const text = await fetchText(`${CSV_BASE}/${seasonCode(season)}/${CSV_DIVISIONS[competitionId]}.csv`);
        if (/HomeTeam/.test(text)) {
          if (cacheDir) writeFileSync(join(cacheDir, name), text);
          return text;
        }
      } catch {
        // fall back to whatever is on disk
      }
    }
    return path ? readFileSync(path, "utf8") : "";
  }

  async function getMatches(competitionId, currentSeason, { seasonsBack = 4, force = false } = {}) {
    if (!CSV_DIVISIONS[competitionId]) return [];
    const key = `${competitionId}:${currentSeason}:${seasonsBack}`;
    const cached = memory.get(key);
    if (!force && cached && now() - cached.at < maxAgeMs) return cached.matches;
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
      const all = [];
      for (let season = currentSeason - seasonsBack; season <= currentSeason; season += 1) {
        const refresh = season >= currentSeason - 1;
        const text = await loadSeasonFile(competitionId, season, { refresh: refresh || force });
        if (text) all.push(...rowsToMatches(parseCsv(text), { competitionId, season }));
      }
      all.sort((left, right) => left.time - right.time);
      memory.set(key, { at: now(), matches: all });
      return all;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  function availableSeasons(competitionId) {
    const prefix = `${CSV_DIVISIONS[competitionId]}_`;
    const names = new Set();
    for (const dir of [seedDir, cacheDir]) {
      if (dir && existsSync(dir)) readdirSync(dir).filter((name) => name.startsWith(prefix)).forEach((name) => names.add(name));
    }
    return [...names].map((name) => 2000 + Number(name.slice(prefix.length, prefix.length + 2))).sort();
  }

  return { getMatches, availableSeasons };
}
