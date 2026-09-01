import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canon, rateKey } from '../src/cdr.js'
import type { Rate } from '../src/cdr.js'

const lvr = { name: 'Loan to Value Ratio', unitOfMeasure: 'PERCENT', minimumValue: '0.01', maximumValue: '0.5' }
const amt = { name: 'Total borrowing', unitOfMeasure: 'DOLLAR', minimumValue: '150000.00' }

const rate = (tiers: unknown, over: Partial<Rate> = {}): Rate => ({
  kind: 'lending',
  rateType: 'VARIABLE',
  rate: 0.0599,
  term: null,
  detail: { tiers, loanPurpose: 'OWNER_OCCUPIED', repayType: 'PRINCIPAL_AND_INTEREST' },
  ...over,
})

test('tier order does not change the key', () => {
  assert.equal(rateKey(rate([lvr, amt])), rateKey(rate([amt, lvr])))
})

test('object key order does not change the key', () => {
  const flipped = { maximumValue: '0.5', minimumValue: '0.01', unitOfMeasure: 'PERCENT', name: 'Loan to Value Ratio' }
  assert.equal(rateKey(rate([lvr])), rateKey(rate([flipped])))
})

test('a different tier band is a different key', () => {
  const other = { ...lvr, minimumValue: '0.51', maximumValue: '0.6' }
  assert.notEqual(rateKey(rate([lvr, amt])), rateKey(rate([other, amt])))
})

test('purpose and repayment separate rates priced the same', () => {
  const inv = rate([lvr], { detail: { tiers: [lvr], loanPurpose: 'INVESTMENT', repayType: 'PRINCIPAL_AND_INTEREST' } })
  assert.notEqual(rateKey(rate([lvr])), rateKey(inv))
})

test('term separates term deposits', () => {
  assert.notEqual(rateKey(rate(null, { term: 'P1Y' })), rateKey(rate(null, { term: 'P2Y' })))
})

test('the rate value is not part of the key', () => {
  assert.equal(rateKey(rate([lvr])), rateKey(rate([lvr], { rate: 0.0699 })))
})

test('canon is stable for nested arrays', () => {
  assert.equal(canon({ a: [3, 1, 2], b: null }), canon({ b: null, a: [2, 3, 1] }))
})

test('missing tiers and null tiers agree', () => {
  const noTiers = rate(undefined, { detail: { loanPurpose: 'OWNER_OCCUPIED', repayType: 'PRINCIPAL_AND_INTEREST' } })
  assert.equal(rateKey(rate(null)), rateKey(noTiers))
})
