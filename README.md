# 传统木偶戏班偶头与巡演装箱API

维护偶头、服装配件、修补流转、巡演装箱、返场缺损追踪和巡演结清。

## 启动

```bash
npm install
npm start
```

默认地址：http://localhost:3914

## 常用接口

- `GET /api/puppetHeads?play=火焰山&status=可演出`
- `POST /api/repairRecords`
- `POST /api/tourBoxes`
- `POST /api/lossReports`
- `GET /api/:collection/:id/timeline`

SQLite数据库文件会在首次启动时创建到`data/app.db`。

## 巡演结清

巡演结束后，场租、运输支出和破损赔偿散在多张单里，用结清单统一对账：

- `POST /api/settlements` 创建结清单，一场装箱只留一份未结清
- `POST /api/settlements/:id/verify` 核对场次、票款、场租、运输费和赔偿，算出应退金额
- `GET /api/settlements/pending` 待核区：凭证缺少、场次与装箱清单不符或破损单未处理的结清单
- `POST /api/settlements/:id/correct` 费用基数更正（已通过的核验随之失效）
- `POST /api/settlements/:id/confirm` 另一位保管员确认后结清入账

应退金额 = 保证金 + 票款 - 场租 - 运输费 - 赔偿；应退低于保证金时只退差额。
原装箱、缺损或费用基数一经更正，核验即失效，旧版留在结清单的`versions`里留查。

业务文件拆分：

- `settlementRoutes.js` 入口（HTTP路由）
- `settlementCalc.js` 计算（核对规则与应退金额）
- `settlementBooks.js` 记账（结清入账、核验失效与旧版留查）
