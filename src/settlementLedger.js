const { now, createRecord, listByCollection } = require('./db');

// 巡演结清单——记账业务文件。
// 只负责把已结清的结清单翻译成记账流水；入口文件负责权限/确认校验，计算文件负责金额。

const DEBIT = '借';
const CREDIT = '贷';

function entry({ key, direction, subject, amount, summary, settlement, tourBoxId }) {
  return {
    key,
    tourBoxId,
    settlementId: settlement.id,
    settlementCode: settlement.code,
    direction,
    subject,
    amount,
    summary,
    postedAt: now()
  };
}

// 据结清单生成记账流水（金额单位：元，两位小数）。
function buildEntries(settlement) {
  const tourBoxId = settlement.tourBoxId;
  const entries = [];

  entries.push(entry({
    key: 'ticket',
    direction: DEBIT,
    subject: '应收票款',
    amount: settlement.ticketTotal,
    summary: '巡演票款入账：' + settlement.showName,
    settlement,
    tourBoxId
  }));

  entries.push(entry({
    key: 'venue',
    direction: CREDIT,
    subject: '应付场租',
    amount: settlement.venueFee,
    summary: '支付场租：' + settlement.showName,
    settlement,
    tourBoxId
  }));

  entries.push(entry({
    key: 'shipping',
    direction: CREDIT,
    subject: '应付运输费',
    amount: settlement.shippingFee,
    summary: '支付运输费：' + settlement.showName,
    settlement,
    tourBoxId
  }));

  entries.push(entry({
    key: 'compensation',
    direction: CREDIT,
    subject: '破损赔偿收入',
    amount: settlement.compensation,
    summary: '破损赔偿抵扣：' + settlement.showName,
    settlement,
    tourBoxId
  }));

  entries.push(entry({
    key: 'deposit',
    direction: CREDIT,
    subject: '存入保证金',
    amount: settlement.deposit,
    summary: '核销保管员保证金：' + settlement.showName,
    settlement,
    tourBoxId
  }));

  if (settlement.refundAmount > 0) {
    entries.push(entry({
      key: 'refund',
      direction: DEBIT,
      subject: '应退保证金及票款',
      amount: settlement.refundAmount,
      summary: '应退保管员：' + settlement.showName,
      settlement,
      tourBoxId
    }));
  }

  if (settlement.owedAmount > 0) {
    entries.push(entry({
      key: 'owed',
      direction: DEBIT,
      subject: '应收保管员欠款',
      amount: settlement.owedAmount,
      summary: '票款与保证金不足抵扣，挂欠款：' + settlement.showName,
      settlement,
      tourBoxId
    }));
  }

  return entries;
}

function existingKeys(settlementId) {
  const rows = listByCollection('ledgerEntries').filter((record) =>
    record.status !== '已红冲' && record.settlementId === settlementId
  );
  return new Set(rows.map((row) => row.entryKey));
}

// 结清记账：幂等，重复记账不会产生双份流水。
function bookSettlement(settlement, actor) {
  const keys = existingKeys(settlement.id);
  const created = [];
  for (const payload of buildEntries(settlement)) {
    if (keys.has(payload.key)) continue;
    const { key, ...fields } = payload;
    const record = {
      entryKey: key,
      status: '正常',
      ...fields
    };
    created.push(createRecord('ledgerEntries', record, '正常'));
  }
  return created;
}

module.exports = {
  buildEntries,
  bookSettlement
};
