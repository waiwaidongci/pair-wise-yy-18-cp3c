module.exports = {
  port: 3914,
  title: '传统木偶戏班偶头与巡演装箱API',
  description: '维护偶头、服装配件、修补流转、巡演装箱和返场缺损追踪。',
  collections: {
    puppetHeads: {
      label: '偶头档案',
      defaultStatus: '可演出',
      statuses: ['可演出', '待修补', '修补中', '试演中', '不可演出', '已装箱'],
      required: ['role', 'play', 'paintStatus', 'mechanism', 'boxNo'],
      titleFields: ['role', 'play'],
      defaults: { currentUsable: true }
    },
    accessories: {
      label: '服装配件',
      defaultStatus: '在库',
      statuses: ['在库', '已装箱', '缺损', '遗失'],
      required: ['name', 'role', 'play', 'boxNo'],
      titleFields: ['name', 'role']
    },
    repairRecords: {
      label: '修补记录',
      defaultStatus: '待处理',
      statuses: ['待处理', '补漆中', '换线中', '修机关中', '换眼珠中', '试演中', '已完成'],
      required: ['puppetHeadId', 'repairType', 'handler'],
      titleFields: ['repairType', 'handler']
    },
    tourBoxes: {
      label: '巡演装箱单',
      defaultStatus: '草稿',
      statuses: ['草稿', '已装箱', '巡演中', '返场清点中', '已闭环'],
      required: ['showName', 'venue', 'play', 'headIds', 'accessoryIds'],
      titleFields: ['showName', 'play']
    },
    lossReports: {
      label: '缺损追踪',
      defaultStatus: '待处理',
      statuses: ['待处理', '修复中', '已补齐', '确认为遗失'],
      required: ['tourBoxId', 'itemType', 'itemName', 'problem'],
      titleFields: ['itemName', 'problem']
    },
    showSessions: {
      label: '巡演场次',
      defaultStatus: '已核',
      statuses: ['已核', '已作废'],
      required: ['tourBoxId', 'sessionName', 'sessionDate', 'ticketIncome'],
      titleFields: ['sessionName', 'sessionDate']
    },
    expenseVouchers: {
      label: '费用凭证',
      defaultStatus: '待核',
      statuses: ['待核', '已核', '已作废'],
      required: ['tourBoxId', 'feeType', 'voucherNo', 'amount'],
      titleFields: ['feeType', 'voucherNo']
    },
    tourSettlements: {
      label: '巡演结清单',
      defaultStatus: '待核',
      statuses: ['待核', '已核验', '已记账', '已失效'],
      required: ['tourBoxId', 'custodian'],
      titleFields: ['code', 'showName']
    },
    settlementVersions: {
      label: '结清单旧版留查',
      defaultStatus: '已失效',
      statuses: ['已失效'],
      required: ['settlementId', 'version', 'reason', 'snapshot'],
      titleFields: ['settlementId', 'version']
    },
    ledgerEntries: {
      label: '记账流水',
      defaultStatus: '正常',
      statuses: ['正常', '已红冲'],
      required: ['tourBoxId', 'settlementId', 'direction', 'subject', 'amount'],
      titleFields: ['subject', 'settlementCode']
    }
  },
  seed: [
    {
      collection: 'puppetHeads',
      id: 'head-seed-1',
      status: '待修补',
      data: {
        role: '武生',
        play: '火焰山',
        paintStatus: '左颊掉彩',
        mechanism: '开口机关偏紧',
        accessories: ['红缨冠', '短靠'],
        boxNo: '木箱乙-04',
        currentUsable: false
      },
      note: '返场发现掉彩'
    },
    {
      collection: 'accessories',
      id: 'accessory-seed-1',
      status: '在库',
      data: {
        name: '红缨冠',
        role: '武生',
        play: '火焰山',
        boxNo: '配件箱-02'
      }
    },
    {
      collection: 'tourBoxes',
      id: 'box-seed-1',
      status: '已闭环',
      data: {
        showName: '浙中古镇秋会巡演',
        venue: '金华婺州古戏台',
        play: '火焰山',
        tourStart: '2026-09-10',
        tourEnd: '2026-09-12',
        plannedSessions: [
          { sessionName: '秋会夜场', sessionDate: '2026-09-10' },
          { sessionName: '秋会日场', sessionDate: '2026-09-11' }
        ],
        deposit: 2000,
        headIds: ['head-seed-1'],
        accessoryIds: ['accessory-seed-1']
      },
      note: '巡演已返场清点，可结清单核验'
    },
    {
      collection: 'showSessions',
      id: 'session-seed-1',
      status: '已核',
      data: {
        tourBoxId: 'box-seed-1',
        sessionName: '秋会夜场',
        sessionDate: '2026-09-10',
        ticketIncome: 6800,
        note: '主办方结算单已到'
      }
    },
    {
      collection: 'showSessions',
      id: 'session-seed-2',
      status: '已核',
      data: {
        tourBoxId: 'box-seed-1',
        sessionName: '秋会日场',
        sessionDate: '2026-09-11',
        ticketIncome: 5200,
        note: '主办方结算单已到'
      }
    },
    {
      collection: 'expenseVouchers',
      id: 'voucher-seed-1',
      status: '已核',
      data: {
        tourBoxId: 'box-seed-1',
        feeType: '场租',
        voucherNo: 'CZ-20260910-01',
        amount: 3000,
        note: '两晚古戏台场租'
      }
    },
    {
      collection: 'expenseVouchers',
      id: 'voucher-seed-2',
      status: '已核',
      data: {
        tourBoxId: 'box-seed-1',
        feeType: '运输费',
        voucherNo: 'YS-20260910-02',
        amount: 1800,
        note: '往返包车与木箱加固'
      }
    },
    {
      collection: 'expenseVouchers',
      id: 'voucher-seed-3',
      status: '已核',
      data: {
        tourBoxId: 'box-seed-1',
        feeType: '破损赔偿',
        voucherNo: 'PC-20260912-03',
        amount: 30,
        linkedLossIds: ['loss-seed-1'],
        note: '武生红缨冠穗子撕裂赔偿'
      }
    },
    {
      collection: 'lossReports',
      id: 'loss-seed-1',
      status: '已补齐',
      data: {
        tourBoxId: 'box-seed-1',
        itemType: '配件',
        itemName: '红缨冠',
        problem: '穗子撕裂',
        compensationAmount: 30
      }
    },
    {
      collection: 'tourSettlements',
      id: 'settlement-seed-1',
      status: '已核验',
      data: {
        code: 'JS-SEED-0001',
        tourBoxId: 'box-seed-1',
        showName: '浙中古镇秋会巡演',
        custodian: '周保管',
        deposit: 2000,
        ticketTotal: 12000,
        venueFee: 3000,
        shippingFee: 1800,
        compensation: 30,
        netBalance: 7170,
        grossRefund: 9170,
        refundAmount: 2000,
        retainedAmount: 0,
        owedAmount: 0,
        requiresSecondKeeper: false,
        secondKeeperConfirmedBy: '',
        checkResult: { ok: true, issues: [] },
        basisFingerprint: '',
        verifiedAt: new Date('2026-09-13T09:00:00Z').toISOString(),
        verifiedBy: '周保管'
      },
      eventAction: '核验',
      note: '核验通过示例（重新核验可刷新指纹）'
    },
    {
      collection: 'tourBoxes',
      id: 'box-seed-2',
      status: '返场清点中',
      data: {
        showName: '邻县庙会巡演戏箱',
        venue: '义乌城隍庙戏台',
        play: '火焰山',
        tourStart: '2026-09-18',
        tourEnd: '2026-09-20',
        plannedSessions: [
          { sessionName: '庙会头场', sessionDate: '2026-09-18' },
          { sessionName: '庙会末场', sessionDate: '2026-09-20' }
        ],
        deposit: 800,
        headIds: ['head-seed-1'],
        accessoryIds: ['accessory-seed-1']
      },
      note: '待核区示例：凭证不全、场次不符、破损未处理'
    },
    {
      collection: 'showSessions',
      id: 'session-seed-3',
      status: '已核',
      data: {
        tourBoxId: 'box-seed-2',
        sessionName: '庙会头场',
        sessionDate: '2026-09-18',
        ticketIncome: 2600
      }
    },
    {
      collection: 'expenseVouchers',
      id: 'voucher-seed-4',
      status: '待核',
      data: {
        tourBoxId: 'box-seed-2',
        feeType: '场租',
        voucherNo: 'CZ-20260918-05',
        amount: 1200,
        note: '凭证尚未由财务核准'
      }
    },
    {
      collection: 'lossReports',
      id: 'loss-seed-2',
      status: '修复中',
      data: {
        tourBoxId: 'box-seed-2',
        itemType: '偶头',
        itemName: '武生偶头',
        problem: '返场发现左颊新掉彩',
        compensationAmount: 0
      }
    },
    {
      collection: 'tourSettlements',
      id: 'settlement-seed-2',
      status: '待核',
      data: {
        code: 'JS-SEED-0002',
        tourBoxId: 'box-seed-2',
        showName: '邻县庙会巡演戏箱',
        custodian: '吴保管',
        deposit: 800,
        checkResult: { ok: false, issues: [] }
      },
      note: '停留在待核区的示例'
    }
  ],
  examples: [
    'GET /api/puppetHeads?play=火焰山&status=可演出 查询某剧目可用偶头',
    'POST /api/tourBoxes 创建巡演装箱单',
    'POST /api/lossReports 登记返场缺损或遗失',
    'POST /api/tourSettlements 为一场装箱单开立唯一未结清结清单',
    'POST /api/tourSettlements/:id/verify 核对场次票款与费用，核验通过或留在待核区',
    'POST /api/tourSettlements/:id/confirm 第二位保管员确认差额退款',
    'POST /api/tourSettlements/:id/close 结清并记账，生成应退流水',
    'GET /api/tourSettlements/pending/review 查看待核区及未通过原因'
  ]
};
