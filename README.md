# 喷火龙五大联赛分析平台

英超、德甲、西甲、意甲、法甲的赛程、积分榜和比赛预测工具，Windows / macOS 桌面版（Electron），分析服务只在本机运行。

当前版本：**1.2.2**

## 功能

- **赛程预测**：整季赛程（北京时间），每场显示胜平负概率与首选比分；比赛页有比分概率矩阵、进球数分布、让球盘、模型与博彩市场对比、球队攻防评级与近况（含 xG）、体彩竞彩推荐。
- **积分榜**：总榜，含欧冠 / 欧联 / 降级区标识。
- **模型回测**：逐场只用开赛前的数据重放整个赛季，和博彩赔率对比，并检查概率是否校准。
- **推荐命中率**：每次打开未开赛的比赛自动保存当时的推荐，完场后用真实比分核验胜平负、大小 2.5、比分、Top3 和体彩各玩法的命中率。

## 预测模型

- 时间加权的 Dixon-Coles 攻防评级：用近三个赛季的联赛进球和 xG 拟合，越近的比赛权重越高（半衰期一年），升班马使用保守基线。
- 有博彩赔率时，把去除抽水后的市场概率按 85% 权重与模型融合；没有时只用模型。
- 首选比分始终与胜平负首选一致。

2023/24–2025/26 五大联赛 5,256 场逐场回测：

| | 旧模型 (1.1.0) | 当前模型 | 只看博彩赔率 |
|---|---|---|---|
| 胜平负命中率 | 50.2% | 53.7% | 54.0% |
| 对数损失（越低越好） | 1.038 | 0.971 | 0.966 |
| 大小 2.5 命中率 | 56.5% | 58.3% | 59.2% |
| 实际比分落在 Top3 | 30.7% | 33.6% | — |

自己复现：

```bash
node scripts/backtest-compare.mjs 2023,2024,2025
```

## 数据来源

| 数据 | 来源 | 说明 |
|---|---|---|
| 赛程、比分、积分榜、队徽 | ESPN | 免费；按球队赛程合并整季，再用整季比赛清单补齐延期/中断场次 |
| 历史赛果、xG、赛前平均赔率 | [football-data.co.uk](https://www.football-data.co.uk/) | 免费、无需密钥；`data/history/` 自带种子数据，运行时自动更新 |
| 实时盘口 | DraftKings（经 ESPN） | 按比赛编号匹配：胜平负、大小球、让球 |
| 体彩竞彩 | 中国体彩网 | 官网目前对程序请求启用了防爬验证（返回 567），取不到时显示与主预测同口径的模型推导 |
| 赛程（可选） | football-data.org | 配置 `FOOTBALL_DATA_API_KEY` 后优先使用 |
| 赔率（可选） | The Odds API | 配置 `ODDS_API_KEY` 后优先使用 |

可选密钥写在 `.env`（参考 `.env.example`），桌面版读取 `%APPDATA%\喷火龙五大联赛分析平台\.env`。不要把密钥提交到仓库。

## 开发

需要 Node.js 22 或更高版本。

```bash
npm install
npm start                 # 本地服务，默认 http://127.0.0.1:5177
npm test                  # 全部测试
npm run desktop           # 以桌面窗口运行
npm run desktop:dist:win  # 打包 Windows 安装版 + 便携版
```

macOS 安装包需要在 macOS 上构建，仓库自带 GitHub Actions 工作流 `.github/workflows/build-macos.yml`（在 Actions 页手动运行）。

常用脚本：

- `scripts/backtest-compare.mjs`：新旧模型与博彩赔率的回测对比
- `scripts/audit-schedule.mjs <赛季>`：逐场核对 ESPN 赛程与 football-data.co.uk 赛果
- `scripts/check-team-mapping.mjs`：检查各数据源之间的球队名对应

## 主要代码

| 文件 | 作用 |
|---|---|
| `src/ratings-model.js` | Dixon-Coles 评级、比分矩阵、赔率融合 |
| `src/forecast-service.js` | 把模型、历史数据和实时盘口串起来 |
| `src/history-data.js` | football-data.co.uk CSV 读取与更新 |
| `src/espn-odds.js` | 按比赛编号获取 DraftKings 盘口 |
| `src/league-data-service.js` | 赛程、积分榜 |
| `src/sporttery-matcher.js` | 体彩竞彩对阵匹配 |
| `src/model-backtest.js` | 赛季回测 |
| `server.js` | 本地 HTTP 服务（Express） |
| `public/` | 前端界面 |
| `desktop/` | Electron 主进程 |

## 免责声明

足球比赛随机性很高。本工具仅用于信息研究，预测结果不保证准确，也不构成任何投注建议。
