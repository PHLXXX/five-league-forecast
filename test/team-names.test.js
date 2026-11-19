import test from "node:test";
import assert from "node:assert/strict";

import { localizeTeamName } from "../src/team-names.js";

test("按联赛和球队代码返回中文俱乐部名", () => {
  assert.equal(localizeTeamName("PL", { tla: "ARS", name: "Arsenal FC" }), "阿森纳");
  assert.equal(localizeTeamName("PD", { tla: "FCB", name: "FC Barcelona" }), "巴塞罗那");
  assert.equal(localizeTeamName("BL1", { tla: "FCB", name: "FC Bayern München" }), "拜仁慕尼黑");
});

test("同一代码在不同联赛不会串队", () => {
  assert.equal(localizeTeamName("FL1", { tla: "BRE", name: "Stade Brestois 29" }), "布雷斯特");
  assert.equal(localizeTeamName("PL", { tla: "BRE", name: "Brentford FC" }), "布伦特福德");
});

test("未知球队保留上游短名称", () => {
  assert.equal(localizeTeamName("PL", { shortName: "Example City", name: "Example City FC" }), "Example City");
});

test("覆盖近五个赛季已降级球队", () => {
  assert.equal(localizeTeamName("PL", { tla: "WHU", shortName: "West Ham" }), "西汉姆联");
  assert.equal(localizeTeamName("BL1", { tla: "WOB", shortName: "Wolfsburg" }), "沃尔夫斯堡");
  assert.equal(localizeTeamName("FL1", { tla: "NAN", shortName: "Nantes" }), "南特");
});

test("覆盖 ESPN 当前赛季使用的不同球队缩写", () => {
  const cases = [
    ["PL", "MAN", "曼联"], ["PL", "MNC", "曼城"], ["PL", "NFO", "诺丁汉森林"],
    ["FL1", "AUX", "欧塞尔"], ["FL1", "LILL", "里尔"], ["FL1", "LOR", "洛里昂"],
    ["FL1", "LYON", "里昂"], ["FL1", "MNS", "勒芒"], ["FL1", "NICE", "尼斯"],
    ["FL1", "OLM", "马赛"], ["FL1", "PAR", "巴黎足球会"], ["FL1", "STR", "斯特拉斯堡"],
    ["FL1", "TRY", "特鲁瓦"],
    ["BL1", "DOR", "多特蒙德"], ["BL1", "MUN", "拜仁慕尼黑"], ["BL1", "FCU", "柏林联合"],
    ["PD", "ATM", "马德里竞技"], ["PD", "BAR", "巴塞罗那"], ["PD", "MCF", "马拉加"],
    ["PD", "RAC", "桑坦德竞技"],
    ["SA", "COMO", "科莫"], ["SA", "LEC", "莱切"], ["SA", "ROMA", "罗马"],
  ];
  for (const [league, code, expected] of cases) {
    assert.equal(localizeTeamName(league, { tla: code, shortName: code }), expected, `${league}:${code}`);
  }
});

test("覆盖近五赛季 ESPN 升降级球队缩写", () => {
  const cases = [
    ["BL1", "BSC", "柏林赫塔"], ["BL1", "HDH", "海登海姆"],
    ["FL1", "ACA", "阿雅克肖"], ["FL1", "ASSE", "圣埃蒂安"], ["FL1", "CLE", "克莱蒙"],
    ["FL1", "METZ", "梅斯"], ["FL1", "REIM", "兰斯"],
    ["PD", "ALM", "阿尔梅里亚"], ["PD", "CAD", "加的斯"], ["PD", "GIR", "赫罗纳"],
    ["PD", "GRA", "格拉纳达"], ["PD", "LEG", "莱加内斯"], ["PD", "LPA", "拉斯帕尔马斯"],
    ["PD", "MLL", "马略卡"], ["PD", "OVI", "皇家奥维耶多"], ["PD", "VLL", "巴拉多利德"],
    ["PL", "LTN", "卢顿"], ["PL", "SHU", "谢菲尔德联"],
    ["SA", "CRE", "克雷莫内塞"], ["SA", "EMP", "恩波利"], ["SA", "PIS", "比萨"],
    ["SA", "SAL", "萨勒尼塔纳"], ["SA", "SAM", "桑普多利亚"], ["SA", "SPE", "斯佩齐亚"],
    ["SA", "VER", "维罗纳"],
  ];
  for (const [league, code, expected] of cases) {
    assert.equal(localizeTeamName(league, { tla: code, shortName: code }), expected, `${league}:${code}`);
  }
});
