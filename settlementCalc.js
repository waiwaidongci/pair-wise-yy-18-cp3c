const { createHash } = require('crypto');

// 费用基数字段：更正任一字段都会让已通过的核验失效
const BASIS_FIELDS = ['deposit', 'ticketRevenue', 'venueRent', 'transportFee', 'compensation', 'sessions', 'vouchers'];

// 缺损单走到这两个状态才算已处理
const LOSS_CLOSED_STATUSES = ['已补齐', '确认为遗失'];

const VOUCHER_NEEDS = [
  ['ticket', '票款凭证'],
  ['rent', '场租凭证'],
  ['transport', '运输凭证']
];

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function sessionCount(value) {
  if (Array.isArray(value)) return value.length;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function voucherSet(vouchers) {
  if (Array.isArray(vouchers)) return new Set(vouchers);
  const set = new Set();
  for (const [key, value] of Object.entries(vouchers || {})) {
    if (value) set.add(key);
  }
  return set;
}

function missingVouchers(settlement) {
  const set = voucherSet(settlement.vouchers);
  const missing = VOUCHER_NEEDS.filter(([key]) => !set.has(key)).map(([, label]) => label);
  if (money(settlement.compensation) > 0 && !set.has('compensation')) missing.push('赔偿凭证');
  return missing;
}

// 核对场次、票款、场租、运输费和赔偿；不通过的结清单留在待核区
function verify({ settlement, tourBox, lossReports }) {
  const issues = [];
  const missing = missingVouchers(settlement);
  if (missing.length) {
    issues.push({ type: '凭证缺少', detail: '缺少' + missing.join('、') });
  }
  if (!tourBox) {
    issues.push({ type: '场次不符', detail: '找不到对应装箱单' });
  } else if (tourBox.sessions === undefined || tourBox.sessions === null || tourBox.sessions === '') {
    issues.push({ type: '场次不符', detail: '装箱清单未登记场次' });
  } else if (sessionCount(tourBox.sessions) !== sessionCount(settlement.sessions)) {
    issues.push({
      type: '场次不符',
      detail: '装箱清单' + sessionCount(tourBox.sessions) + '场，结清单' + sessionCount(settlement.sessions) + '场'
    });
  }
  const openReports = (lossReports || []).filter((report) => !LOSS_CLOSED_STATUSES.includes(report.status));
  if (openReports.length) {
    issues.push({
      type: '破损单未处理',
      detail: openReports.map((report) => (report.itemName || report.id) + '（' + report.status + '）').join('、')
    });
  }
  return { passed: issues.length === 0, issues };
}

// 应退金额 = 保证金 + 票款 - 场租 - 运输费 - 赔偿；应退低于保证金时只退差额
function computeRefund(base) {
  const gross = money(money(base.deposit) + money(base.ticketRevenue) - money(base.venueRent) - money(base.transportFee) - money(base.compensation));
  const refundAmount = money(Math.max(0, Math.min(gross, money(base.deposit))));
  return { gross, refundAmount, difference: money(money(base.deposit) - refundAmount) };
}

// 核验通过时的基数快照：原装箱、缺损和费用基数任一变动都会得到不同指纹
function basisSnapshot({ settlement, tourBox, lossReports }) {
  return {
    base: {
      deposit: money(settlement.deposit),
      ticketRevenue: money(settlement.ticketRevenue),
      venueRent: money(settlement.venueRent),
      transportFee: money(settlement.transportFee),
      compensation: money(settlement.compensation),
      sessions: sessionCount(settlement.sessions),
      vouchers: Array.from(voucherSet(settlement.vouchers)).sort()
    },
    box: tourBox ? {
      id: tourBox.id,
      showName: tourBox.showName || '',
      venue: tourBox.venue || '',
      play: tourBox.play || '',
      sessions: sessionCount(tourBox.sessions),
      headIds: tourBox.headIds || [],
      accessoryIds: tourBox.accessoryIds || []
    } : null,
    lossReports: (lossReports || [])
      .map((report) => ({ id: report.id, status: report.status, compensation: money(report.compensation) }))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

function basisHash(snapshot) {
  return createHash('sha256').update(stableStringify(snapshot)).digest('hex');
}

module.exports = {
  BASIS_FIELDS,
  LOSS_CLOSED_STATUSES,
  money,
  sessionCount,
  verify,
  computeRefund,
  basisSnapshot,
  basisHash
};
