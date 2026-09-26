const express = require('express');
const books = require('./settlementBooks');

const router = express.Router();

function actorOf(req) {
  const body = req.body || {};
  return body.actor || body.custodian || body.verifiedBy || body.confirmedBy || '';
}

// 待核区：凭证缺少、场次不符或破损单未处理的结清单留在这里
router.get('/pending', (req, res, next) => {
  try {
    res.json(books.listPending());
  } catch (error) {
    next(error);
  }
});

router.get('/', (req, res, next) => {
  try {
    res.json(books.listSettlements(req.query));
  } catch (error) {
    next(error);
  }
});

router.post('/', (req, res, next) => {
  try {
    res.status(201).json(books.createSettlement(req.body || {}, actorOf(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const settlement = books.getSettlement(req.params.id);
    if (!settlement) return res.status(404).json({ error: 'not found' });
    res.json(settlement);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/verify', (req, res, next) => {
  try {
    res.json(books.verifySettlement(req.params.id, actorOf(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/correct', (req, res, next) => {
  try {
    const body = req.body || {};
    res.json(books.correctSettlement(req.params.id, body.fields || body, actorOf(req), body.note));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/confirm', (req, res, next) => {
  try {
    const body = req.body || {};
    res.json(books.confirmSettlement(req.params.id, body.confirmedBy || actorOf(req)));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
