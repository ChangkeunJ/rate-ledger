import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool, putBrand, putProduct, syncRates, retire } from '../src/db.js'
import type { Rate } from '../src/cdr.js'

const live = !!process.env.DATABASE_URL
const opts = live ? {} : { skip: 'DATABASE_URL not set' }
const db = live ? pool() : null
const id = randomUUID()
const PID = 'p1'

const at = (n: number) => new Date(Date.UTC(2026, 0, n))
const dep = (rate: number, term = 'P1Y'): Rate =>
  ({ kind: 'deposit', rateType: 'FIXED', rate, term, detail: { tiers: null } })

before(async () => {
  if (!db) return
  await putBrand(db, { id, name: 'Test Bank', abn: null, industries: ['banking'], base: 'https://x', logo: null })
  await putProduct(db, id, {
    pid: PID, category: 'TERM_DEPOSITS', name: 'TD', descr: null,
    tailored: false, updated: null, rates: [],
  }, at(1))
})

after(async () => {
  if (!db) return
  await db.query('delete from brand where id = $1', [id])
  await db.end()
})

const open = async () => (await db!.query(
  `select key, rate::float8, from_at, to_at from rate where brand_id=$1 and to_at is null order by rate`, [id])).rows

test('first sight opens one interval per rate', opts, async () => {
  const [o, c] = await syncRates(db!, id, PID, [dep(0.05, 'P1Y'), dep(0.052, 'P2Y')], at(1))
  assert.deepEqual([o, c], [2, 0])
  assert.equal((await open()).length, 2)
})

test('an unchanged rate writes nothing', opts, async () => {
  const [o, c] = await syncRates(db!, id, PID, [dep(0.05, 'P1Y'), dep(0.052, 'P2Y')], at(2))
  assert.deepEqual([o, c], [0, 0])
  const rows = await open()
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.from_at.getTime()), [at(1).getTime(), at(1).getTime()])
})

test('a moved rate closes the old interval and opens a new one', opts, async () => {
  const [o, c] = await syncRates(db!, id, PID, [dep(0.045, 'P1Y'), dep(0.052, 'P2Y')], at(3))
  assert.deepEqual([o, c], [1, 1])
  const rows = await open()
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.rate === 0.045)!.from_at.getTime(), at(3).getTime())
})

test('the old number stays answerable at its own date', opts, async () => {
  const asOf = async (d: Date) => (await db!.query(
    `select rate::float8 from rate where brand_id=$1 and term='P1Y'
       and from_at <= $2 and (to_at is null or to_at > $2)`, [id, d])).rows
  assert.deepEqual((await asOf(at(2))).map((r) => r.rate), [0.05])
  assert.deepEqual((await asOf(at(4))).map((r) => r.rate), [0.045])
})

test('a withdrawn rate is closed, not deleted', opts, async () => {
  const [o, c] = await syncRates(db!, id, PID, [dep(0.045, 'P1Y')], at(5))
  assert.deepEqual([o, c], [0, 1])
  assert.equal((await open()).length, 1)
  const { rows } = await db!.query(
    `select count(*)::int n from rate where brand_id=$1 and term='P2Y'`, [id])
  assert.equal(rows[0].n, 1)
})

test('a delisted product closes its open rates', opts, async () => {
  const gone = await retire(db!, id, at(6))
  assert.equal(gone, 1)
  assert.equal((await open()).length, 0)
})

test('duplicate rates in one payload collapse to one interval', opts, async () => {
  const pid2 = 'p2'
  await putProduct(db!, id, {
    pid: pid2, category: 'TERM_DEPOSITS', name: 'TD2', descr: null,
    tailored: false, updated: null, rates: [],
  }, at(7))
  const [o] = await syncRates(db!, id, pid2, [dep(0.06), dep(0.06), dep(0.06)], at(7))
  assert.equal(o, 1)
})
