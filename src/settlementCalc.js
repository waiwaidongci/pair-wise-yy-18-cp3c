const crypto = require('crypto');

// 巡演结清单——计算业务文件。
// 只做金额计算、核验规则与指纹，不读写数据库；入口文件负责取数，记账文件负责落账。

const FEE_TYPES = {
  venue: '场租',
  shipping: '运输费',
  compensation: '破损赔偿'
};

const LOSS_TERMINAL_STATUSES = ['已补齐', '确认为遗失'];
const OPEN_BOX_STATUSES = ['返场清点中', '已闭环'];
const VALID_VOUCHER_STATUS = '已核';
const VALID_SESSION_STATUS = '已核';

function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round((num + Number.EPSILON) * 100);
}

function toYuan(cents) {
  return Math.round(cents) / 100;
}

function validRecords(records, status) {
  return (records || []).filter((item) => item.status !== '已作废' && (!status || item.status === status));
}

function sumAmounts(records, field = 'amount') {
  return validRecords(records)
    .reduce((total, item) => total + (toCents(item[field]) || 0), 0);
}

// 汇总费用基数：票款、场租、运输费、破损赔偿、保证金。
function computeBasis(box, sessions, vouchers, losses) {
  const validSessions = validRecords(sessions, VALID_SESSION_STATUS);
  const validVouchers = validRecords(vouchers, VALID_VOUCHER_STATUS);

  const ticketTotal = sumAmounts(validSessions, 'ticketIncome');
  const byType = (type) => validVouchers.filter((v) => v.feeType === type);
  const venueFee = sumAmounts(byType(FEE_TYPES.venue));
  const shippingFee = sumAmounts(byType(FEE_TYPES.shipping));
  const compensation = sumAmounts(byType(FEE_TYPES.compensation));
  const deposit = toCents(box.deposit);

  return {
    depositCents: deposit,
    deposit: deposit === null ? null : toYuan(deposit),
    ticketTotal: toYuan(ticketTotal),
    venueFee: toYuan(venueFee),
    shippingFee: toYuan(shippingFee),
    compensation: toYuan(compensation),
    totalCosts: toYuan(venueFee + shippingFee + compensation)
  };
}

// 应退金额：
//   净额 = 票款 - 场租 - 运输费 - 赔偿
//   可退盘子（应退金额）= 保证金 + 净额
// 应退金额不低于保证金时全额退保证金并退回结余；低于保证金时只退差额（保证金被费用吃掉后的剩余）；
// 盘子被吃穿则退款为 0，超出部分挂欠款。凡应退金额低于保证金，须另一位保管员确认。
function computeRefund(basis) {
  const deposit = basis.depositCents;
  const ticket = toCents(basis.ticketTotal);
  const venue = toCents(basis.venueFee);
  const shipping = toCents(basis.shippingFee);
  const compensation = toCents(basis.compensation);

  const totalCosts = venue + shipping + compensation;
  const netBalance = ticket - totalCosts;
  const grossRefund = deposit + netBalance;

  const refundAmount = Math.max(0, grossRefund);
  const retainedAmount = Math.min(deposit, Math.max(0, totalCosts - ticket));
  const owedAmount = Math.max(0, totalCosts - deposit - ticket);
  const requiresSecondKeeper = grossRefund < deposit;

  return {
    netBalance: toYuan(netBalance),
    grossRefund: toYuan(grossRefund),
    refundAmount: toYuan(refundAmount),
    retainedAmount: toYuan(retainedAmount),
    owedAmount: toYuan(owedAmount),
    requiresSecondKeeper
  };
}

function issue(code, message, extra) {
  return { code, message, ...extra };
}

// 核验：凭证缺少、场次与装箱清单不符、破损单未处理，一律进待核区。
function checkBasis(box, sessions, vouchers, losses) {
  const issues = [];

  if (!box) {
    return { ok: false, issues: [issue('BOX_NOT_FOUND', '装箱单不存在')] };
  }

  if (!OPEN_BOX_STATUSES.includes(box.status)) {
    issues.push(issue('BOX_STATUS', '装箱单尚未返场清点（当前状态：' + box.status + '）', { status: box.status }));
  }

  if (toCents(box.deposit) === null || toCents(box.deposit) < 0) {
    issues.push(issue('DEPOSIT_INVALID', '保证金金额缺失或不是非负数字', { deposit: box.deposit }));
  }

  const planned = Array.isArray(box.plannedSessions) ? box.plannedSessions : [];
  const validSessions = validRecords(sessions, VALID_SESSION_STATUS);
  const sessionKey = (name, date) => name + '@' + date;
  const actualKeys = new Set(validSessions.map((s) => sessionKey(s.sessionName, s.sessionDate)));

  // 装箱清单上的场次必须逐场对上。
  for (const plan of planned) {
    if (!actualKeys.has(sessionKey(plan.sessionName, plan.sessionDate))) {
      issues.push(issue('SESSION_MISSING', '缺少装箱清单内场次：' + plan.sessionName + '（' + plan.sessionDate + '）', { plan }));
    }
  }

  // 多出的、不在装箱清单内的已核场次同样属于不符。
  const plannedKeys = new Set(planned.map((p) => sessionKey(p.sessionName, p.sessionDate)));
  for (const session of validSessions) {
    if (!plannedKeys.has(sessionKey(session.sessionName, session.sessionDate))) {
      issues.push(issue('SESSION_EXTRA', '已核场次不在装箱清单内：' + session.sessionName + '（' + session.sessionDate + '）', { sessionId: session.id }));
    }
    if (toCents(session.ticketIncome) === null || toCents(session.ticketIncome) < 0) {
      issues.push(issue('TICKET_AMOUNT', '场次票款金额缺失或非法：' + session.sessionName, { sessionId: session.id, ticketIncome: session.ticketIncome }));
    }
  }

  const validVouchers = validRecords(vouchers, VALID_VOUCHER_STATUS);
  const pendingVouchers = validRecords(vouchers).filter((v) => v.status === '待核');

  for (const voucher of pendingVouchers) {
    issues.push(issue('VOUCHER_UNVERIFIED', '费用凭证尚未核准：' + voucher.feeType + ' ' + (voucher.voucherNo || '(无单号)'), {
      voucherId: voucher.id, feeType: voucher.feeType
    }));
  }

  for (const voucher of validRecords(vouchers)) {
    if (toCents(voucher.amount) === null || toCents(voucher.amount) <= 0) {
      issues.push(issue('VOUCHER_AMOUNT', '费用凭证金额缺失或非正数：' + (voucher.voucherNo || voucher.id), {
        voucherId: voucher.id, feeType: voucher.feeType, amount: voucher.amount
      }));
    }
  }

  if (!validVouchers.some((v) => v.feeType === FEE_TYPES.venue)) {
    issues.push(issue('VENUE_VOUCHER_MISSING', '缺少已核准的场租凭证'));
  }
  if (!validVouchers.some((v) => v.feeType === FEE_TYPES.shipping)) {
    issues.push(issue('SHIPPING_VOUCHER_MISSING', '缺少已核准的运输费凭证'));
  }

  // 破损单必须全部处理到位（已补齐 / 确认为遗失）。
  const openLosses = (losses || []).filter((loss) => !LOSS_TERMINAL_STATUSES.includes(loss.status));
  for (const loss of openLosses) {
    issues.push(issue('LOSS_OPEN', '破损单未处理完结：' + loss.itemName + '（' + loss.problem + '）', {
      lossId: loss.id, status: loss.status
    }));
  }

  // 已完结且登记了赔偿金额的破损单，必须有对应已核赔偿凭证兜底。
  for (const loss of (losses || []).filter((l) => LOSS_TERMINAL_STATUSES.includes(l.status))) {
    const expected = toCents(loss.compensationAmount);
    if (expected === null) {
      issues.push(issue('LOSS_COMPENSATION_AMOUNT', '破损单赔偿金额缺失：' + loss.itemName, { lossId: loss.id }));
      continue;
    }
    if (expected > 0) {
      const linked = validVouchers.filter((v) =>
        v.feeType === FEE_TYPES.compensation &&
        Array.isArray(v.linkedLossIds) &&
        v.linkedLossIds.includes(loss.id)
      );
      const covered = linked.reduce((total, v) => total + (toCents(v.amount) || 0), 0);
      if (covered < expected) {
        issues.push(issue('LOSS_COMPENSATION_MISMATCH', '破损单赔偿无足额凭证：' + loss.itemName +
          '（应赔 ' + toYuan(expected) + ' 元，已核 ' + toYuan(covered) + ' 元）', {
          lossId: loss.id, expected: toYuan(expected), covered: toYuan(covered)
        }));
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

// 核验依据指纹：原装箱、场次、费用基数、缺损任一更正都会使指纹变化、核验失效。
function basisFingerprint(box, sessions, vouchers, losses, basis) {
  const pick = (obj, fields) => Object.fromEntries(fields.map((f) => [f, obj[f] ?? null]));
  const payload = {
    box: pick(box, ['id', 'status', 'showName', 'play', 'deposit', 'plannedSessions', 'headIds', 'accessoryIds']),
    sessions: validRecords(sessions).map((s) => pick(s, ['id', 'status', 'sessionName', 'sessionDate', 'ticketIncome'])),
    vouchers: validRecords(vouchers).map((v) => pick(v, ['id', 'status', 'feeType', 'voucherNo', 'amount', 'linkedLossIds'])),
    losses: (losses || []).map((l) => pick(l, ['id', 'status', 'itemName', 'problem', 'compensationAmount'])),
    basis: basis || null
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

module.exports = {
  FEE_TYPES,
  LOSS_TERMINAL_STATUSES,
  OPEN_BOX_STATUSES,
  toCents,
  toYuan,
  computeBasis,
  computeRefund,
  checkBasis,
  basisFingerprint
};
