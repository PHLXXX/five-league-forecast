export function validateCoreRecommendationConsistency({
  primaryScore,
  totalSummary,
  spreadSummary,
  spreadLine,
  recommendations = [],
} = {}) {
  const issues = [];
  const homeGoals = finiteNumber(primaryScore?.homeGoals);
  const awayGoals = finiteNumber(primaryScore?.awayGoals);
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) {
    return { ok: false, issues: ["最高概率比分缺失，无法完成推荐一致性校验"] };
  }
  const score = primaryScore?.score || `${homeGoals}-${awayGoals}`;
  const scoreDirection = homeGoals > awayGoals ? "home" : homeGoals < awayGoals ? "away" : "draw";
  const resultRecommendation = arrayFrom(recommendations).find((item) => /赛果|胜平负/.test(String(item?.market || "")));
  const recommendedDirection = resultDirection(`${resultRecommendation?.pick || ""} ${resultRecommendation?.reason || ""}`);
  if (recommendedDirection && recommendedDirection !== scoreDirection) {
    issues.push(`赛果推荐为${directionLabel(recommendedDirection)}，与最高概率比分 ${score} 的${directionLabel(scoreDirection)}方向冲突`);
  }

  const totalLine = finiteNumber(totalSummary?.line);
  const scoreTotal = homeGoals + awayGoals;
  if (Number.isFinite(totalLine) && totalSummary?.side === "over" && scoreTotal <= totalLine) {
    issues.push(`大球 ${totalLine} 推荐与最高概率比分 ${score} 的总进球 ${scoreTotal} 冲突`);
  }
  if (Number.isFinite(totalLine) && totalSummary?.side === "under" && scoreTotal >= totalLine) {
    issues.push(`小球 ${totalLine} 推荐与最高概率比分 ${score} 的总进球 ${scoreTotal} 冲突`);
  }

  const spread = finiteNumber(spreadSummary?.line);
  if (Number.isFinite(spread) && spreadSummary?.side === "favorite") {
    const favoriteMargin = spreadLine?.favoriteSide === "away" ? awayGoals - homeGoals : homeGoals - awayGoals;
    if (favoriteMargin <= spread) {
      issues.push(`让球方需要净胜超过 ${spread} 球，但最高概率比分 ${score} 的净胜差只有 ${favoriteMargin} 球`);
    }
  }
  if (Number.isFinite(spread) && spreadSummary?.side === "underdog") {
    const favoriteMargin = spreadLine?.favoriteSide === "away" ? awayGoals - homeGoals : homeGoals - awayGoals;
    if (favoriteMargin > spread) {
      issues.push(`受让方推荐与最高概率比分 ${score} 的让球方净胜差 ${favoriteMargin} 球冲突`);
    }
  }

  return { ok: issues.length === 0, issues };
}

function resultDirection(text) {
  const value = String(text || "");
  if (/客胜/.test(value)) return "away";
  if (/平局|平手|\bdraw\b/i.test(value)) return "draw";
  if (/主胜/.test(value)) return "home";
  return "";
}

function directionLabel(direction) {
  return direction === "home" ? "主胜" : direction === "away" ? "客胜" : "平局";
}

function finiteNumber(value) {
  const parsed = Number(value);
  return value == null || !Number.isFinite(parsed) ? Number.NaN : parsed;
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}
