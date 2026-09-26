const { randomUUID } = require('crypto');
const db = require('./db');
const calc = require('./settlementCalc');

const COLLECTION = 'tourSettlements';

// 原装箱单这些字段更正会让核验失效
const BOX_BASIS_FIELDS = ['showName', 'venue', 'play', 'sessions', 'headIds', 'accessoryIds'];

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function recordsOf(collection) {
  return db
    .select('SELECT * FROM records WHERE collection = ' + db.sqlValue(collection) + ' ORDER BY updated_at DESC;')
    .map(db.toRecord);
}

function insertRecord(collection, data, status, actor, action, note) {
  const collectionConfig = db.findCollection(collection);
  const id = randomUUID();
  const createdAt = db.now();
  const recordData = { ...data, status };
  db.runSql(
    'INSERT INTO records (id, collection, status, title, data, created_at, updated_at) VALUES (' +
    [
      db.sqlValue(id),
      db.sqlValue(collection),
      db.sqlValue(status),
      db.sqlValue(db.titleFor(collectionConfig, recordData)),
      db.sqlValue(JSON.stringify(recordData)),
      db.sqlValue(createdAt),
      db.sqlValue(createdAt)
    ].join(', ') +
    ');'
  );
  db.insertEvent({ recordId: id, collection, action, status, actor, note, data: recordData });
  return db.loadRecord(collection, id);
}

function getSettlement(id) {
  return db.loadRecord(COLLECTION, id);
}

function saveSettlement(record, actor, action, note) {
  const data = { ...record };
  delete data.id;
  delete data.collection;
  delete data.createdAt;
  delete data.updatedAt;
  db.saveRecord(COLLECTION, record.id, data, record.status);
  db.insertEvent({ recordId: record.id, collection: COLLECTION, action, status: record.status, actor, note, data });
  return getSettlement(record.id);
}

function listSettlements(query = {}) {
  return recordsOf(COLLECTION).filter((settlement) => {
    if (query.status && settlement.status !== query.status) return false;
    if (query.tourBoxId && settlement.tourBoxId !== query.tourBoxId) return false;
    return true;
  });
}

// 待核区：核对未过或核验失效的结清单
function listPending() {
  return listSettlements({ status: '待核对' });
}

function openSettlementForBox(tourBoxId) {
  return recordsOf(COLLECTION).find((settlement) => settlement.tourBoxId === tourBoxId && settlement.status !== '已结清') || null;
}

function lossReportsFor(tourBoxId) {
  return recordsOf('lossReports').filter((report) => report.tourBoxId === tourBoxId);
}

// 一场装箱只留一份未结清
function createSettlement(input, actor) {
  const tourBoxId = input.tourBoxId;
  if (!tourBoxId) fail(400, 'missing required fields: tourBoxId');
  const box = db.loadRecord('tourBoxes', tourBoxId);
  if (!box) fail(404, '装箱单不存在：' + tourBoxId);
  if (input.deposit === undefined || input.deposit === '') fail(400, 'missing required fields: deposit');
  const open = openSettlementForBox(tourBoxId);
  if (open) fail(409, '一场装箱只留一份未结清，已存在：' + open.id);
  const data = {
    tourBoxId,
    showName: box.showName || '',
    venue: box.venue || '',
    deposit: calc.money(input.deposit),
    ticketRevenue: calc.money(input.ticketRevenue),
    venueRent: calc.money(input.venueRent),
    transportFee: calc.money(input.transportFee),
    compensation: calc.money(input.compensation),
    sessions: input.sessions,
    vouchers: input.vouchers || {},
    custodian: actor || '',
    issues: [],
    current: null,
    versions: []
  };
  return insertRecord(COLLECTION, data, '待核对', actor, '创建结清单', '装箱单 ' + tourBoxId);
}

// 核对场次、票款、场租、运输费和赔偿，算出应退金额
function verifySettlement(id, actor) {
  const settlement = getSettlement(id);
  if (!settlement) fail(404, '结清单不存在：' + id);
  if (settlement.status !== '待核对') fail(409, '当前状态不可核对：' + settlement.status);
  const tourBox = db.loadRecord('tourBoxes', settlement.tourBoxId);
  const lossReports = lossReportsFor(settlement.tourBoxId);
  const result = calc.verify({ settlement, tourBox, lossReports });
  if (!result.passed) {
    const saved = saveSettlement(
      { ...settlement, issues: result.issues, status: '待核对' },
      actor,
      '核对未过',
      result.issues.map((issue) => issue.type).join('、')
    );
    return { passed: false, issues: result.issues, settlement: saved };
  }
  const refund = calc.computeRefund(settlement);
  const current = {
    version: (settlement.versions || []).length + 1,
    verifiedAt: db.now(),
    verifiedBy: actor || '',
    basisHash: calc.basisHash(calc.basisSnapshot({ settlement, tourBox, lossReports })),
    refund
  };
  const note = '应退' + refund.gross + '，实退' + refund.refundAmount + (refund.difference > 0 ? '，应退低于保证金只退差额' : '');
  const saved = saveSettlement({ ...settlement, issues: [], current, status: '待确认' }, actor, '核对通过', note);
  return { passed: true, issues: [], refund, settlement: saved };
}

// 核验失效：当前版本转入旧版留查，结清单回到待核区
function invalidate(settlement, reason, actor) {
  if (!settlement.current) return settlement;
  const version = { ...settlement.current, invalidatedAt: db.now(), invalidateReason: reason };
  const next = {
    ...settlement,
    status: '待核对',
    current: null,
    versions: [...(settlement.versions || []), version],
    issues: [{ type: '核验失效', detail: reason }]
  };
  return saveSettlement(next, actor || '', '核验失效', reason + '，旧版留查 v' + version.version);
}

// 费用基数更正：落新基数，已通过的核验随之失效
function correctSettlement(id, fields, actor, note) {
  const settlement = getSettlement(id);
  if (!settlement) fail(404, '结清单不存在：' + id);
  if (settlement.status === '已结清') fail(409, '已结清，费用基数不可更正');
  const picked = {};
  for (const field of calc.BASIS_FIELDS) {
    if (fields[field] === undefined) continue;
    picked[field] = field === 'sessions' || field === 'vouchers' ? fields[field] : calc.money(fields[field]);
  }
  if (!Object.keys(picked).length) fail(400, '没有可更正的费用基数字段：' + calc.BASIS_FIELDS.join(', '));
  const saved = saveSettlement({ ...settlement, ...picked }, actor, '费用更正', note || '费用基数已更正');
  return saved.current ? invalidate(saved, '费用基数已更正', actor) : saved;
}

// 另一位保管员确认后结清入账
function confirmSettlement(id, actor) {
  if (!actor) fail(400, '需要确认保管员（actor 或 confirmedBy）');
  const settlement = getSettlement(id);
  if (!settlement) fail(404, '结清单不存在：' + id);
  if (settlement.status !== '待确认' || !settlement.current) fail(409, '结清单不在待确认状态');
  if (settlement.current.verifiedBy && settlement.current.verifiedBy === actor) fail(409, '需另一位保管员确认');
  const tourBox = db.loadRecord('tourBoxes', settlement.tourBoxId);
  const lossReports = lossReportsFor(settlement.tourBoxId);
  const hash = calc.basisHash(calc.basisSnapshot({ settlement, tourBox, lossReports }));
  if (hash !== settlement.current.basisHash) {
    invalidate(settlement, '装箱、缺损或费用基数已变动', actor);
    fail(409, '装箱、缺损或费用基数已变动，核验失效，请重新核对');
  }
  const current = settlement.current;
  const saved = saveSettlement({ ...settlement, status: '已结清', confirmedBy: actor, confirmedAt: db.now() }, actor, '确认结清', '另一位保管员确认');
  const refund = current.refund;
  const note = refund.difference > 0
    ? '应退' + refund.gross + '低于保证金' + calc.money(settlement.deposit) + '，只退差额' + refund.refundAmount
    : '全额退保证金' + refund.refundAmount;
  const ledgerEntry = insertRecord('ledgerEntries', {
    settlementId: settlement.id,
    tourBoxId: settlement.tourBoxId,
    showName: settlement.showName || '',
    venue: settlement.venue || '',
    deposit: calc.money(settlement.deposit),
    ticketRevenue: calc.money(settlement.ticketRevenue),
    venueRent: calc.money(settlement.venueRent),
    transportFee: calc.money(settlement.transportFee),
    compensation: calc.money(settlement.compensation),
    sessions: settlement.sessions,
    gross: refund.gross,
    refundAmount: refund.refundAmount,
    difference: refund.difference,
    verifiedBy: current.verifiedBy,
    confirmedBy: actor
  }, '已入账', actor, '结清入账', note);
  return { settlement: saved, ledgerEntry };
}

function invalidateForBox(tourBoxId, reason) {
  if (!tourBoxId) return;
  for (const settlement of recordsOf(COLLECTION)) {
    if (settlement.tourBoxId === tourBoxId && settlement.status === '待确认' && settlement.current) {
      invalidate(settlement, reason, '');
    }
  }
}

// 原装箱、缺损或费用基数一经更正，关联结清单的核验即失效
function handleSourceChanged(collection, record, changedFields) {
  if (!record) return;
  const fields = changedFields || [];
  if (collection === 'tourBoxes') {
    if (fields.includes('__deleted__') || fields.some((field) => BOX_BASIS_FIELDS.includes(field))) {
      invalidateForBox(record.id, '原装箱单已更正');
    }
  } else if (collection === 'lossReports') {
    invalidateForBox(record.tourBoxId, '缺损单已更正');
  } else if (collection === COLLECTION) {
    if (fields.some((field) => calc.BASIS_FIELDS.includes(field))) {
      const settlement = getSettlement(record.id);
      if (settlement) invalidate(settlement, '费用基数已更正', '');
    }
  }
}

module.exports = {
  listSettlements,
  listPending,
  getSettlement,
  createSettlement,
  verifySettlement,
  correctSettlement,
  confirmSettlement,
  handleSourceChanged
};
