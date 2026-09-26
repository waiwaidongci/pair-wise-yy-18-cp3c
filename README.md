# 传统木偶戏班偶头与巡演装箱API

维护偶头、服装配件、修补流转、巡演装箱和返场缺损追踪。

## 启动

```bash
npm install
npm start
```

默认地址：http://localhost:3914

> 运行环境若没有 `sqlite3` 命令行，服务会自动使用 `scripts/sqlite3`（Python 垫片），无需额外安装。

## 常用接口

- `GET /api/puppetHeads?play=火焰山&status=可演出`
- `POST /api/repairRecords`
- `POST /api/tourBoxes`
- `POST /api/lossReports`
- `GET /api/:collection/:id/timeline`

## 巡演结清单

巡演结束后，场租、运输费、破损赔偿散在多张凭证里，结清单负责把一场装箱单的
场次票款与各项费用核对清楚，再算出应退金额并记账。

业务拆成三个独立文件：

| 文件 | 职责 |
| --- | --- |
| `src/settlementRoutes.js` | **入口**：开立、核验、第二人确认、结清、待核区查询；依据更正失效钩子 |
| `src/settlementCalc.js` | **计算**：票款/场租/运输费/赔偿汇总、应退金额、核验规则、依据指纹（纯函数，不碰数据库） |
| `src/settlementLedger.js` | **记账**：结清时生成借贷流水，幂等不重复落账 |

### 单据状态

`待核` → `已核验` → `已记账`；核验依据被更正时 `已核验` → `已失效`（退回待核区）。

### 规则

1. **一场装箱只留一份未结清**：同一 `tourBoxId` 同时只能有一份 `待核`/`已核验` 结清单（重复开立返回 409）。
2. **核验项目**：逐场核对装箱清单 `plannedSessions` 与已核场次（缺场、多场都算不符）；票款合计；场租、运输费必须有**已核准**凭证；破损单必须处理到 `已补齐`/`确认为遗失`，且登记了赔偿的破损单要有足额已核赔偿凭证。
3. **待核区**：凭证缺少、场次不符、破损单未处理时，核验只返回问题清单，单据停留在 `待核`，不允许确认或记账。查询：`GET /api/tourSettlements/pending/review`。
4. **应退金额**（金额按分进位）：
   - 净额 = 票款 − 场租 − 运输费 − 破损赔偿
   - 应退金额 = 保证金 + 净额
   - 应退金额 **不低于保证金**：全额退保证金并退回票款结余；
   - 应退金额 **低于保证金（含为负）**：只退差额，费用吃掉的保证金计入 `retainedAmount`，吃穿部分挂 `owedAmount`，并必须由**另一位保管员**确认（不能与经手人相同）。
5. **失效与旧版留查**：原装箱、缺损单、场次或费用基数（凭证）在核验后被更正，系统自动比对 SHA256 依据指纹，不一致即置 `已失效`；每次被替换的已核验快照写入 `settlementVersions` 留查。已记账单据锁定，更正须走红冲，不能重新核验。
6. **记账**：`close` 成功后在 `ledgerEntries` 生成票款、场租、运输费、赔偿、保证金核销与应退/欠款流水；重复结清幂等。

### 接口一览

- `POST /api/tourSettlements` — 开立（body：`tourBoxId`、`custodian`），开立即做一次活核验
- `POST /api/tourSettlements/:id/verify` — 核验；通过进 `已核验`，不通过留 `待核`
- `GET  /api/tourSettlements/:id/check` — 活核验预览，不落库
- `POST /api/tourSettlements/:id/confirm` — 另一位保管员确认（body：`secondKeeper`）
- `POST /api/tourSettlements/:id/close` — 结清记账（body 可选 `actor`）
- `GET  /api/tourSettlements/pending/review` — 待核区（待核 / 已失效 / 待第二人确认 / 可结清 / 已结清）
- `GET  /api/settlementVersions?settlementId=...` — 旧版留查
- `GET  /api/ledgerEntries?settlementId=...` — 记账流水

### 示例

```bash
# 开立并核验
curl -s -XPOST localhost:3914/api/tourSettlements \
  -H 'Content-Type: application/json' \
  -d '{"tourBoxId":"box-seed-1","custodian":"周保管"}'

curl -s -XPOST localhost:3914/api/tourSettlements/settlement-seed-1/verify \
  -H 'Content-Type: application/json' -d '{"actor":"周保管"}'

# 应退低于保证金时，另一位保管员确认差额后再结清
curl -s -XPOST localhost:3914/api/tourSettlements/<id>/confirm \
  -H 'Content-Type: application/json' -d '{"secondKeeper":"郑保管"}'
curl -s -XPOST localhost:3914/api/tourSettlements/<id>/close \
  -H 'Content-Type: application/json' -d '{"actor":"郑保管"}'
```

## 测试

```bash
npm test                 # 计算规则单元测试（核验、应退、指纹）
# 端到端联调可在启动服务后按 README“接口一览”手工核对
```

SQLite数据库文件会在首次启动时创建到`data/app.db`。
