const express = require('express');
const {
  loadRecord,
  listByCollection,
  saveRecord,
  createRecord,
  insertEvent,
  now
} = require('./db');
const {
  computeBasis,
  computeRefund,
  checkBasis,
  basisFingerprint
} = require('./settlementCalc');
const { bookSettlement } = require('./settlementLedger');

// 巡演结清单——入口业务文件。
// 负责取数、状态流转与权限确认；金额规则在 settlementCalc，落账在 settlementLedger。

const SETTLEMENT = 'tourSettlements';
const VERSIONS = 'settlementVersions';
const BASIS_COLLECTIONS = ['tourBoxes', 'showSessions', 'expenseVouchers', 'lossReports'];
const OPEN_STATUSES = ['待核', '已核验'];

const router = express.Router();

function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status }, extra);
}

function gatherBoxData(tourBoxId) {
  const box = loadRecord('tourBoxes', tourBoxId);
  if (!box) return { box: null, sessions: [], vouchers: [], losses: [] };
  const linked = (collection) => listByCollection(collection).filter((item) => item.tourBoxId === tourBoxId);
  return {
    box,
    sessions: linked('showSessions'),
    vouchers: linked('expenseVouchers'),
    losses: linked('lossReports')
  };
}

function liveView(settlement) {
  const data = gatherBoxData(settlement.tourBoxId);
  const check = checkBasis(data.box, data.sessions, data.vouchers, data.losses);
  const basis = data.box ? computeBasis(data.box, data.sessions, data.vouchers, data.losses) : null;
  const refund = basis ? computeRefund(basis) : null;
  return { ...data, check, basis, refund };
}

function persistSettlementFields(settlement, fields, status, action, actor, note) {
  const next = { ...settlement, ...fields, status };
  saveRecord(SETTLEMENT, settlement.id, next, status);
  insertEvent({
    recordId: settlement.id,
    collection: SETTLEMENT,
    action,
    status,
    actor: actor || '',
    note: note || '',
    data: fields
  });
  return loadRecord(SETTLEMENT, settlement.id);
}

// 旧版留查：把已核验快照存入 settlementVersions，再把结清单置为已失效。
function archiveVersion(settlement, reason, actor) {
  const history = listByCollection(VERSIONS).filter((v) => v.settlementId === settlement.id);
  const snapshot = { ...settlement };
  const version = history.length + 1;
  createRecord(VERSIONS, {
    settlementId: settlement.id,
    code: settlement.code,
    version,
    reason,
    snapshot,
    archivedBy: actor || '',
    archivedAt: now()
  }, '已失效');
  return version;
}

function nextSettlementCode() {
  const date = new Date();
  const stamp = date.getFullYear() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0');
  const count = listByCollection(SETTLEMENT).length + 1;
  return 'JS-' + stamp + '-' + String(count).padStart(4, '0');
}

// 一场装箱只留一份未结清（待核 / 已核验）结清单。
router.post('/api/tourSettlements', (req, res, next) => {
  try {
    const { tourBoxId, custodian } = req.body || {};
    if (!tourBoxId) throw httpError(400, 'tourBoxId 必填');
    if (!custodian) throw httpError(400, 'custodian 必填（经手保管员）');

    const box = loadRecord('tourBoxes', tourBoxId);
    if (!box) throw httpError(404, '装箱单不存在：' + tourBoxId);

    const existing = listByCollection(SETTLEMENT).find(
      (item) => item.tourBoxId === tourBoxId && OPEN_STATUSES.includes(item.status)
    );
    if (existing) {
      throw httpError(409, '该装箱单已有未结清结清单 ' + existing.code + '（' + existing.status + '），一场装箱只留一份', {
        existingSettlementId: existing.id,
        existingSettlementCode: existing.code
      });
    }

    const settlement = createRecord(SETTLEMENT, {
      code: nextSettlementCode(),
      tourBoxId,
      showName: box.showName,
      custodian,
      deposit: box.deposit ?? null,
      checkResult: { ok: false, issues: [] },
      basisFingerprint: '',
      version: 1,
      secondKeeperConfirmedBy: ''
    }, '待核');

    insertEvent({
      recordId: settlement.id,
      collection: SETTLEMENT,
      action: '开立',
      status: '待核',
      actor: custodian,
      note: req.body.note || '',
      data: { tourBoxId, code: settlement.code }
    });

    // 开立时先跑一次活核验，问题直接显示在待核区。
    const view = liveView(settlement);
    const refreshed = persistSettlementFields(
      settlement,
      {
        checkResult: view.check,
        deposit: view.basis ? view.basis.deposit : box.deposit ?? null,
        ...(view.basis ? view.basis : {}),
        ...(view.refund ? view.refund : {})
      },
      '待核',
      view.check.ok ? '开立（核验通过待确认）' : '开立（留在待核区）',
      custodian,
      req.body.note || ''
    );

    res.status(201).json(refreshed);
  } catch (error) {
    next(error);
  }
});

// 活核验预览，不改动单据。
router.get('/api/tourSettlements/:id/check', (req, res, next) => {
  try {
    const settlement = loadRecord(SETTLEMENT, req.params.id);
    if (!settlement) throw httpError(404, '结清单不存在');
    res.json(liveView(settlement));
  } catch (error) {
    next(error);
  }
});

// 待核区：凭证缺少 / 场次与装箱清单不符 / 破损单未处理 / 核验已失效 的单据。
router.get('/api/tourSettlements/pending/review', (req, res, next) => {
  try {
    const all = listByCollection(SETTLEMENT);
    const decorate = (settlement) => ({ settlement, live: liveView(settlement) });

    const result = {
      pending: all.filter((s) => s.status === '待核').map(decorate),
      invalidated: all.filter((s) => s.status === '已失效').map(decorate),
      awaitingConfirmation: all
        .filter((s) => s.status === '已核验' && s.requiresSecondKeeper && !s.secondKeeperConfirmedBy)
        .map(decorate),
      readyToClose: all
        .filter((s) => s.status === '已核验' && (!s.requiresSecondKeeper || s.secondKeeperConfirmedBy))
        .map(decorate),
      closed: all.filter((s) => s.status === '已记账').map((s) => ({ settlement: s }))
    };
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// 核对场次、票款、场租、运输费和赔偿，算出应退金额。
router.post('/api/tourSettlements/:id/verify', (req, res, next) => {
  try {
    const settlement = loadRecord(SETTLEMENT, req.params.id);
    if (!settlement) throw httpError(404, '结清单不存在');
    if (settlement.status === '已记账') {
      throw httpError(409, '结清单已结清记账，金额已锁定；更正须走红冲，不能重新核验');
    }

    const actor = (req.body && req.body.actor) || settlement.custodian || '';
    const view = liveView(settlement);
    const fingerprint = view.basis
      ? basisFingerprint(view.box, view.sessions, view.vouchers, view.losses, view.basis)
      : '';

    const commonFields = {
      checkResult: view.check,
      deposit: view.basis ? view.basis.deposit : settlement.deposit,
      ...(view.basis ? view.basis : {}),
      ...(view.refund ? view.refund : {}),
      invalidateReason: '',
      invalidatedAt: null
    };

    if (!view.check.ok) {
      const saved = persistSettlementFields(
        settlement,
        { ...commonFields, basisFingerprint: '', verifiedAt: null, verifiedBy: '', secondKeeperConfirmedBy: '' },
        '待核',
        '核验未通过',
        actor,
        '问题 ' + view.check.issues.length + ' 项，留在待核区'
      );
      return res.status(200).json({ ok: false, settlement: saved, issues: view.check.issues });
    }

    if (settlement.status === '已核验' && settlement.basisFingerprint === fingerprint) {
      throw httpError(409, '核验依据未发生变化，原核验仍有效；无需重复核验', {
        basisFingerprint: fingerprint
      });
    }

    // 依据已更正：旧版留查后，以新版本重新核验。
    if (settlement.status === '已核验') {
      archiveVersion(settlement, '核验依据更正，重新核验', actor);
    } else if (settlement.status === '已失效' && (settlement.basisFingerprint || settlement.verifiedAt)) {
      // 失效单补正后重新核验：上一版（已留指纹的已核验快照）同样留查。
      archiveVersion(settlement, '失效补正后重新核验通过', actor);
    }

    const rearchived = settlement.status !== '待核';
    const saved = persistSettlementFields(
      settlement,
      {
        ...commonFields,
        basisFingerprint: fingerprint,
        verifiedAt: now(),
        verifiedBy: actor,
        version: (settlement.version || 1) + (rearchived ? 1 : 0),
        secondKeeperConfirmedBy: ''
      },
      '已核验',
      '核验通过',
      actor,
      view.refund.requiresSecondKeeper ? '应退金额低于保证金，须另一位保管员确认' : ''
    );

    res.json({ ok: true, settlement: saved });
  } catch (error) {
    next(error);
  }
});

// 另一位保管员确认（应退金额低于保证金时必须）。
router.post('/api/tourSettlements/:id/confirm', (req, res, next) => {
  try {
    const settlement = loadRecord(SETTLEMENT, req.params.id);
    if (!settlement) throw httpError(404, '结清单不存在');
    if (settlement.status !== '已核验') throw httpError(409, '只有已核验结清单可请第二位保管员确认');

    const secondKeeper = (req.body && req.body.secondKeeper) || '';
    if (!secondKeeper) throw httpError(400, 'secondKeeper 必填（另一位保管员）');
    if (secondKeeper === settlement.custodian) {
      throw httpError(400, '确认人必须是另一位保管员，不能与经手人 ' + settlement.custodian + ' 相同');
    }
    if (!settlement.requiresSecondKeeper) {
      throw httpError(409, '应退金额不低于保证金，全额退款无需第二位保管员确认');
    }

    const saved = persistSettlementFields(
      settlement,
      {
        secondKeeperConfirmedBy: secondKeeper,
        secondKeeperConfirmedAt: now()
      },
      '已核验',
      '第二位保管员确认差额退款',
      secondKeeper,
      req.body.note || ''
    );
    res.json(saved);
  } catch (error) {
    next(error);
  }
});

// 结清并记账。
router.post('/api/tourSettlements/:id/close', (req, res, next) => {
  try {
    const settlement = loadRecord(SETTLEMENT, req.params.id);
    if (!settlement) throw httpError(404, '结清单不存在');

    if (settlement.status === '已记账') {
      const entries = listByCollection('ledgerEntries')
        .filter((entry) => entry.settlementId === settlement.id && entry.status !== '已红冲');
      return res.json({ ok: true, idempotent: true, settlement, entries });
    }
    if (settlement.status !== '已核验') throw httpError(409, '结清单尚未核验通过，不能记账');

    if (settlement.requiresSecondKeeper && !settlement.secondKeeperConfirmedBy) {
      throw httpError(409, '应退金额低于保证金，必须先由另一位保管员确认差额退款');
    }

    const actor = (req.body && req.body.actor) || settlement.secondKeeperConfirmedBy || settlement.custodian || '';
    const entries = bookSettlement(settlement, actor);
    const saved = persistSettlementFields(
      settlement,
      { closedAt: now(), closedBy: actor },
      '已记账',
      '结清记账',
      actor,
      req.body.note || ''
    );
    res.json({ ok: true, settlement: saved, entries });
  } catch (error) {
    next(error);
  }
});

// 原装箱、缺损或费用基数更正后，使已核验（未记账）结清单失效，旧版留查。
function invalidateVerifiedForBox(tourBoxId, context) {
  if (!tourBoxId) return [];
  const invalidated = [];
  const open = listByCollection(SETTLEMENT).filter(
    (item) => item.tourBoxId === tourBoxId && item.status === '已核验'
  );
  for (const fresh of open) {
    // 防御并发：落库前重读，已被另一请求置为失效则跳过。
    const current = loadRecord(SETTLEMENT, fresh.id);
    if (!current || current.status !== '已核验') continue;

    const view = liveView(current);
    const fingerprint = view.basis
      ? basisFingerprint(view.box, view.sessions, view.vouchers, view.losses, view.basis)
      : '';
    if (fingerprint === current.basisFingerprint) continue;

    const reason = context.reason ||
      ('核验依据发生更正（' + context.collection + ' / ' + context.sourceId + '），核验失效');
    archiveVersion(current, reason, context.actor);
    persistSettlementFields(
      current,
      {
        invalidateReason: reason,
        invalidatedAt: now(),
        basisFingerprint: ''
      },
      '已失效',
      '核验失效',
      context.actor || '',
      reason
    );
    invalidated.push(current.id);
  }
  return invalidated;
}

function resolveBoxId(collection, id) {
  if (collection === 'tourBoxes') return id;
  const record = loadRecord(collection, id);
  return record ? record.tourBoxId : null;
}

// 供 server.js 通用增改接口调用：写入后比对指纹。
function onBasisRecordChanged({ collection, id, actor, note }) {
  if (!BASIS_COLLECTIONS.includes(collection)) return [];
  const tourBoxId = resolveBoxId(collection, id);
  return invalidateVerifiedForBox(tourBoxId, { collection, sourceId: id, actor, note });
}

// 供 server.js 通用删除接口调用：删除前记下 tourBoxId，删除后比对。
function onBasisRecordDeleted({ collection, record, actor, note }) {
  if (!BASIS_COLLECTIONS.includes(collection)) return [];
  const tourBoxId = collection === 'tourBoxes' ? record.id : record.tourBoxId;
  if (collection === 'tourBoxes') {
    // 装箱单本体被删：无法重算，直接失效其下已核验单据。
    return listByCollection(SETTLEMENT)
      .filter((item) => item.tourBoxId === tourBoxId && item.status === '已核验')
      .map((settlement) => {
        const reason = '原装箱单已删除，核验失效';
        archiveVersion(settlement, reason, actor);
        persistSettlementFields(
          settlement,
          { invalidateReason: reason, invalidatedAt: now(), basisFingerprint: '' },
          '已失效',
          '核验失效',
          actor || '',
          reason
        );
        return settlement.id;
      });
  }
  return invalidateVerifiedForBox(tourBoxId, { collection, sourceId: record.id, actor, note });
}

module.exports = {
  router,
  onBasisRecordChanged,
  onBasisRecordDeleted
};
