const assert = require('assert');
const {
  computeBasis,
  computeRefund,
  checkBasis,
  basisFingerprint,
  toYuan,
  toCents
} = require('../src/settlementCalc');

let pass = 0;
function test(name, fn) {
  fn();
  pass++;
  console.log('  ✓', name);
}

const box = (over = {}) => ({
  id: 'b1',
  status: '已闭环',
  showName: '测试巡演',
  deposit: 2000,
  plannedSessions: [
    { sessionName: '夜场', sessionDate: '2026-09-01' }
  ],
  ...over
});

const sessions = (over = []) => over.length ? over : [
  { id: 's1', status: '已核', sessionName: '夜场', sessionDate: '2026-09-01', ticketIncome: 8000 }
];
const vouchers = (over = []) => over.length ? over : [
  { id: 'v1', status: '已核', feeType: '场租', voucherNo: 'CZ-1', amount: 3000 },
  { id: 'v2', status: '已核', feeType: '运输费', voucherNo: 'YS-1', amount: 1000 }
];
const losses = (over = []) => over;

console.log('金额计算（分进位，避免浮点误差）');
test('元转分四舍五入到整数分（带 epsilon 修正）', () => {
  assert.strictEqual(toCents(1.005), 101);
  assert.strictEqual(toCents(12.344), 1234);
  assert.strictEqual(toYuan(101), 1.01);
});

test('票款 - 费用 = 净额，应退 = 保证金 + 净额', () => {
  const basis = computeBasis(box(), sessions(), vouchers(), losses());
  assert.strictEqual(basis.ticketTotal, 8000);
  assert.strictEqual(basis.venueFee, 3000);
  assert.strictEqual(basis.shippingFee, 1000);
  assert.strictEqual(basis.compensation, 0);
  const r = computeRefund(basis);
  assert.strictEqual(r.netBalance, 4000);
  assert.strictEqual(r.grossRefund, 6000);
  assert.strictEqual(r.refundAmount, 6000);
  assert.strictEqual(r.retainedAmount, 0);
  assert.strictEqual(r.requiresSecondKeeper, false);
});

test('应退低于保证金：只退差额、扣保证金、需第二人', () => {
  const basis = computeBasis(box(), [{ id: 's1', status: '已核', sessionName: '夜场', sessionDate: '2026-09-01', ticketIncome: 1500 }], vouchers(), losses());
  const r = computeRefund(basis);
  // 净额 = 1500 - 4000 = -2500；应退 = 2000 - 2500 = -500（挂欠 500）
  assert.strictEqual(r.netBalance, -2500);
  assert.strictEqual(r.grossRefund, -500);
  assert.strictEqual(r.refundAmount, 0);
  assert.strictEqual(r.retainedAmount, 2000);
  assert.strictEqual(r.owedAmount, 500);
  assert.strictEqual(r.requiresSecondKeeper, true);
});

test('保证金被吃掉一部分：退剩余差额', () => {
  const basis = computeBasis(box(), [{ id: 's1', status: '已核', sessionName: '夜场', sessionDate: '2026-09-01', ticketIncome: 3200 }], vouchers(), losses());
  const r = computeRefund(basis);
  // 净额 -800；应退 1200 = 保证金 2000 - 800
  assert.strictEqual(r.grossRefund, 1200);
  assert.strictEqual(r.refundAmount, 1200);
  assert.strictEqual(r.retainedAmount, 800);
  assert.strictEqual(r.owedAmount, 0);
  assert.strictEqual(r.requiresSecondKeeper, true);
});

test('恰好等于保证金不触发第二人（“低于”才触发）', () => {
  const basis = computeBasis(box(), [{ id: 's1', status: '已核', sessionName: '夜场', sessionDate: '2026-09-01', ticketIncome: 4000 }], vouchers(), losses());
  const r = computeRefund(basis);
  assert.strictEqual(r.grossRefund, 2000);
  assert.strictEqual(r.requiresSecondKeeper, false);
});

console.log('核验规则');
test('缺场租凭证、运输凭证 → 待核', () => {
  const result = checkBasis(box(), sessions(), [], losses());
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes('VENUE_VOUCHER_MISSING'));
  assert.ok(codes.includes('SHIPPING_VOUCHER_MISSING'));
  assert.strictEqual(result.ok, false);
});

test('凭证待核、缺已核凭证同时报出', () => {
  const result = checkBasis(box(), sessions(), [
    { id: 'v1', status: '待核', feeType: '场租', voucherNo: 'CZ-1', amount: 3000 }
  ], losses());
  const codes = result.issues.map((i) => i.code);
  assert.ok(codes.includes('VOUCHER_UNVERIFIED'));
  assert.ok(codes.includes('VENUE_VOUCHER_MISSING'));
  assert.ok(codes.includes('SHIPPING_VOUCHER_MISSING'));
});

test('场次与装箱清单不符（缺场/多场）→ 待核', () => {
  const missing = checkBasis(box(), [], vouchers(), losses());
  assert.ok(missing.issues.some((i) => i.code === 'SESSION_MISSING'));

  const extra = checkBasis(box(), [
    { id: 's1', status: '已核', sessionName: '夜场', sessionDate: '2026-09-01', ticketIncome: 8000 },
    { id: 's2', status: '已核', sessionName: '加演', sessionDate: '2026-09-02', ticketIncome: 1000 }
  ], vouchers(), losses());
  assert.ok(extra.issues.some((i) => i.code === 'SESSION_EXTRA'));
});

test('破损单未处理 → LOSS_OPEN；赔偿无足额凭证 → MISMATCH', () => {
  const open = checkBasis(box(), sessions(), vouchers(), [
    { id: 'l1', status: '修复中', itemName: '偶头', problem: '掉彩' }
  ]);
  assert.ok(open.issues.some((i) => i.code === 'LOSS_OPEN'));

  const mismatched = checkBasis(box(), sessions(), [
    ...vouchers(),
    { id: 'v3', status: '已核', feeType: '破损赔偿', voucherNo: 'PC-1', amount: 10, linkedLossIds: ['l2'] }
  ], [
    { id: 'l2', status: '已补齐', itemName: '红缨冠', problem: '穗裂', compensationAmount: 50 }
  ]);
  assert.ok(mismatched.issues.some((i) => i.code === 'LOSS_COMPENSATION_MISMATCH'));

  const matched = checkBasis(box(), sessions(), [
    ...vouchers(),
    { id: 'v3', status: '已核', feeType: '破损赔偿', voucherNo: 'PC-1', amount: 50, linkedLossIds: ['l2'] }
  ], [
    { id: 'l2', status: '确认为遗失', itemName: '红缨冠', problem: '穗裂', compensationAmount: 50 }
  ]);
  assert.strictEqual(matched.ok, true);
});

test('作废的场次/凭证不计入基数', () => {
  const basis = computeBasis(box(), [
    { id: 's1', status: '已作废', sessionName: '夜场', sessionDate: '2026-09-01', ticketIncome: 8000 }
  ], vouchers(), losses());
  assert.strictEqual(basis.ticketTotal, 0);
});

console.log('指纹');
test('任一字段更正都会改变指纹；相同数据指纹稳定', () => {
  const l = losses();
  const fp1 = basisFingerprint(box(), sessions(), vouchers(), l, computeBasis(box(), sessions(), vouchers(), l));
  const fp2 = basisFingerprint(box(), sessions(), vouchers(), l, computeBasis(box(), sessions(), vouchers(), l));
  assert.strictEqual(fp1, fp2);
  const fp3 = basisFingerprint(box({ deposit: 1999 }), sessions(), vouchers(), l, null);
  assert.notStrictEqual(fp1, fp3);
  const vChanged = vouchers().map((v) => v.id === 'v1' ? { ...v, amount: 3001 } : v);
  const fp4 = basisFingerprint(box(), sessions(), vChanged, l, null);
  assert.notStrictEqual(fp1, fp4);
});

console.log('\n计算单元测试: ' + pass + ' 通过');
