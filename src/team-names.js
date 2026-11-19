const TEAM_NAMES_ZH = Object.freeze({
  "PL:ARS": "阿森纳", "PL:AVL": "阿斯顿维拉", "PL:BHA": "布莱顿", "PL:BOU": "伯恩茅斯",
  "PL:BRE": "布伦特福德", "PL:CHE": "切尔西", "PL:COV": "考文垂", "PL:CRY": "水晶宫",
  "PL:EVE": "埃弗顿", "PL:FUL": "富勒姆", "PL:HUL": "赫尔城", "PL:IPS": "伊普斯维奇",
  "PL:LEE": "利兹联", "PL:LIV": "利物浦", "PL:MCI": "曼城", "PL:MUN": "曼联",
  "PL:NEW": "纽卡斯尔联", "PL:NOT": "诺丁汉森林", "PL:SUN": "桑德兰", "PL:TOT": "托特纳姆热刺",
  "PL:BUR": "伯恩利", "PL:LEI": "莱斯特城", "PL:LUT": "卢顿", "PL:SHE": "谢菲尔德联",
  "PL:SOU": "南安普敦", "PL:WHU": "西汉姆联", "PL:WOL": "狼队",
  "PL:LTN": "卢顿", "PL:MAN": "曼联", "PL:MNC": "曼城", "PL:NFO": "诺丁汉森林",
  "PL:SHU": "谢菲尔德联",

  "FL1:AJA": "欧塞尔", "FL1:ANG": "昂热", "FL1:ASM": "摩纳哥", "FL1:BRE": "布雷斯特",
  "FL1:ETR": "特鲁瓦", "FL1:FCL": "洛里昂", "FL1:HAC": "勒阿弗尔", "FL1:LIL": "里尔",
  "FL1:LMF": "勒芒", "FL1:LYO": "里昂", "FL1:MAR": "马赛", "FL1:NIC": "尼斯",
  "FL1:PFC": "巴黎足球会", "FL1:PSG": "巴黎圣日耳曼", "FL1:RC": "斯特拉斯堡", "FL1:RCL": "朗斯",
  "FL1:REN": "雷恩", "FL1:TOU": "图卢兹",
  "FL1:ASS": "圣埃蒂安", "FL1:CLF": "克莱蒙", "FL1:FCM": "梅斯", "FL1:MON": "蒙彼利埃",
  "FL1:NAN": "南特", "FL1:SDR": "兰斯",
  "FL1:ACA": "阿雅克肖", "FL1:ASSE": "圣埃蒂安", "FL1:AUX": "欧塞尔", "FL1:CLE": "克莱蒙",
  "FL1:LILL": "里尔", "FL1:LOR": "洛里昂", "FL1:LYON": "里昂", "FL1:METZ": "梅斯",
  "FL1:MNS": "勒芒", "FL1:NICE": "尼斯", "FL1:OLM": "马赛", "FL1:PAR": "巴黎足球会",
  "FL1:REIM": "兰斯", "FL1:STR": "斯特拉斯堡", "FL1:TRY": "特鲁瓦",

  "BL1:B04": "勒沃库森", "BL1:BMG": "门兴格拉德巴赫", "BL1:BVB": "多特蒙德", "BL1:ELV": "埃弗斯堡",
  "BL1:FCA": "奥格斯堡", "BL1:FCB": "拜仁慕尼黑", "BL1:HSV": "汉堡", "BL1:KOE": "科隆",
  "BL1:M05": "美因茨", "BL1:RBL": "莱比锡", "BL1:S04": "沙尔克04", "BL1:SCF": "弗赖堡",
  "BL1:SCP": "帕德博恩", "BL1:SGE": "法兰克福", "BL1:SVW": "云达不莱梅", "BL1:TSG": "霍芬海姆",
  "BL1:UNB": "柏林联合", "BL1:VFB": "斯图加特",
  "BL1:BOC": "波鸿", "BL1:HEI": "海登海姆", "BL1:KSV": "荷尔斯泰因基尔", "BL1:STP": "圣保利",
  "BL1:SVD": "达姆施塔特", "BL1:WOB": "沃尔夫斯堡",
  "BL1:BSC": "柏林赫塔", "BL1:DOR": "多特蒙德", "BL1:FCU": "柏林联合",
  "BL1:HDH": "海登海姆", "BL1:MUN": "拜仁慕尼黑",

  "PD:ALA": "阿拉维斯", "PD:ATH": "毕尔巴鄂竞技", "PD:ATL": "马德里竞技", "PD:BET": "皇家贝蒂斯",
  "PD:CEL": "塞尔塔", "PD:DEP": "拉科鲁尼亚", "PD:ELC": "埃尔切", "PD:ESP": "西班牙人",
  "PD:FCB": "巴塞罗那", "PD:GET": "赫塔费", "PD:LEV": "莱万特", "PD:MAL": "马拉加",
  "PD:OSA": "奥萨苏纳", "PD:RAY": "巴列卡诺", "PD:RMA": "皇家马德里", "PD:RSO": "皇家社会",
  "PD:SAN": "桑坦德竞技", "PD:SEV": "塞维利亚", "PD:VAL": "瓦伦西亚", "PD:VIL": "比利亚雷亚尔",
  "PD:ALM": "阿尔梅里亚", "PD:ATM": "马德里竞技", "PD:BAR": "巴塞罗那", "PD:CAD": "加的斯",
  "PD:GIR": "赫罗纳", "PD:GRA": "格拉纳达", "PD:LEG": "莱加内斯", "PD:LPA": "拉斯帕尔马斯",
  "PD:MCF": "马拉加", "PD:MLL": "马略卡", "PD:OVI": "皇家奥维耶多", "PD:RAC": "桑坦德竞技",
  "PD:VLL": "巴拉多利德",

  "SA:ATA": "亚特兰大", "SA:BOL": "博洛尼亚", "SA:CAG": "卡利亚里", "SA:COM": "科莫",
  "SA:FIO": "佛罗伦萨", "SA:FRO": "弗罗西诺内", "SA:GEN": "热那亚", "SA:INT": "国际米兰",
  "SA:JUV": "尤文图斯", "SA:LAZ": "拉齐奥", "SA:MIL": "AC米兰", "SA:MON": "蒙扎",
  "SA:NAP": "那不勒斯", "SA:PAR": "帕尔马", "SA:ROM": "罗马", "SA:SAS": "萨索洛",
  "SA:TOR": "都灵", "SA:UDI": "乌迪内斯", "SA:USL": "莱切", "SA:VEN": "威尼斯",
  "SA:COMO": "科莫", "SA:CRE": "克雷莫内塞", "SA:EMP": "恩波利", "SA:LEC": "莱切",
  "SA:PIS": "比萨", "SA:ROMA": "罗马", "SA:SAL": "萨勒尼塔纳", "SA:SAM": "桑普多利亚",
  "SA:SPE": "斯佩齐亚", "SA:VER": "维罗纳",
});

export function localizeTeamName(competitionId, team = {}) {
  const code = String(team.tla || team.code || "").trim().toUpperCase();
  return TEAM_NAMES_ZH[`${String(competitionId || "").toUpperCase()}:${code}`]
    || team.nameZh
    || team.shortName
    || team.name
    || "待定";
}

export function teamNameCoverage(competitionId, teams = []) {
  const entries = Array.isArray(teams) ? teams : [];
  const localized = entries.filter((team) => {
    const code = String(team?.tla || team?.code || "").trim().toUpperCase();
    return Boolean(TEAM_NAMES_ZH[`${String(competitionId || "").toUpperCase()}:${code}`]);
  }).length;
  return { total: entries.length, localized, rate: entries.length ? localized / entries.length : 1 };
}
