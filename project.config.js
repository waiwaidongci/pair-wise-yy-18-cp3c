module.exports = {
  port: 3914,
  title: '传统木偶戏班偶头与巡演装箱API',
  description: '维护偶头、服装配件、修补流转、巡演装箱、返场缺损追踪和巡演结清。',
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
    tourSettlements: {
      label: '巡演结清单',
      defaultStatus: '待核对',
      statuses: ['待核对', '待确认', '已结清'],
      required: ['tourBoxId', 'deposit'],
      titleFields: ['showName', 'tourBoxId']
    },
    ledgerEntries: {
      label: '结清账目',
      defaultStatus: '已入账',
      statuses: ['已入账'],
      required: ['settlementId', 'tourBoxId', 'refundAmount'],
      titleFields: ['showName', 'settlementId']
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
      status: '返场清点中',
      data: {
        showName: '火焰山巡演·泉州站',
        venue: '泉州影剧院',
        play: '火焰山',
        headIds: ['head-seed-1'],
        accessoryIds: ['accessory-seed-1'],
        sessions: 3
      },
      note: '巡演结束返场，待结清'
    },
    {
      collection: 'lossReports',
      id: 'loss-seed-1',
      status: '待处理',
      data: {
        tourBoxId: 'box-seed-1',
        itemType: '偶头',
        itemName: '武生偶头',
        problem: '返场发现左颊掉彩加深',
        compensation: 800
      },
      note: '破损赔偿待处理'
    }
  ],
  examples: [
    'GET /api/puppetHeads?play=火焰山&status=可演出 查询某剧目可用偶头',
    'POST /api/tourBoxes 创建巡演装箱单',
    'POST /api/lossReports 登记返场缺损或遗失',
    'POST /api/settlements 创建巡演结清单（一场装箱只留一份未结清）',
    'POST /api/settlements/:id/verify 核对场次、票款、场租、运输费和赔偿，算出应退金额',
    'GET /api/settlements/pending 查看待核区',
    'POST /api/settlements/:id/confirm 另一位保管员确认后结清入账'
  ]
};
