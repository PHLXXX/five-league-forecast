export function filterHistoryRecordsForScope(records, matches, resolveMatch) {
  const scopedMatches = Array.isArray(matches) ? matches : [];
  const resolver = typeof resolveMatch === "function" ? resolveMatch : defaultResolveMatch;

  return (Array.isArray(records) ? records : []).filter((record) => {
    const match = resolver(scopedMatches, record);
    if (!match) return false;
    if (record?.competitionId && record.competitionId !== match.competitionId) return false;
    if (record?.season != null && Number(record.season) !== Number(match.season)) return false;
    return true;
  });
}

export function findDateBoundHistoryMatch(matches, record, helpers) {
  const recordDate = helpers.normalizeDate(record?.date);
  const homeKey = helpers.normalizeTeam(record?.home);
  const awayKey = helpers.normalizeTeam(record?.away);
  if (!recordDate || !homeKey || !awayKey) return null;

  return (Array.isArray(matches) ? matches : []).find((match) =>
    helpers.dateMatches(recordDate, match) &&
    helpers.normalizeTeam(helpers.teamName(match?.home)) === homeKey &&
    helpers.normalizeTeam(helpers.teamName(match?.away)) === awayKey
  ) || null;
}

function defaultResolveMatch(matches, record) {
  const recordId = String(record?.matchId || "");
  return matches.find((match) => [match?.id, match?.externalId, match?.footballDataId]
    .some((value) => String(value ?? "") === recordId)) || null;
}
