const test = require('node:test');
const assert = require('node:assert/strict');
const loadGas = require('./load-gas');

const { scheduledAt, billingPeriod, companyFor, computeRounds, nextTripId, deriveTrips } = loadGas(['Calc.gs']);

test('scheduledAt: night trips move to the day before the plan block', () => {
  assert.equal(scheduledAt('2026-11-04', '14:00', '14:00'), '2026-11-03 14:00');
  assert.equal(scheduledAt('2026-11-04', '18:00', '14:00'), '2026-11-03 18:00');
  assert.equal(scheduledAt('2026-11-04', '22:00', '14:00'), '2026-11-03 22:00');
  assert.equal(scheduledAt('2026-11-04', '13:59', '14:00'), '2026-11-04 13:59');
  assert.equal(scheduledAt('2026-11-04', '10:00', '14:00'), '2026-11-04 10:00');
  assert.equal(scheduledAt('2026-11-04', '0:00', '14:00'), '2026-11-04 00:00');
});

test('scheduledAt: crosses month, year and leap day', () => {
  assert.equal(scheduledAt('2026-12-01', '22:00', '14:00'), '2026-11-30 22:00');
  assert.equal(scheduledAt('2027-01-01', '22:00', '14:00'), '2026-12-31 22:00');
  assert.equal(scheduledAt('2028-03-01', '22:00', '14:00'), '2028-02-29 22:00');
});

test('scheduledAt: rejects bad input', () => {
  assert.throws(() => scheduledAt('4/11/2026', '22:00', '14:00'));
  assert.throws(() => scheduledAt('2026-11-04', '25:00', '14:00'));
});

test('billingPeriod: 1-15 is A, 16-end is B', () => {
  assert.equal(billingPeriod('2026-11-01'), '2026-11-A');
  assert.equal(billingPeriod('2026-11-15'), '2026-11-A');
  assert.equal(billingPeriod('2026-11-16'), '2026-11-B');
  assert.equal(billingPeriod('2026-11-30'), '2026-11-B');
  assert.equal(billingPeriod('2026-12-31'), '2026-12-B');
  assert.equal(billingPeriod('2028-02-29'), '2028-02-B');
});

test('billingPeriod: night trip follows its plan block, not the run date', () => {
  const at = scheduledAt('2026-11-16', '22:00', '14:00');
  assert.equal(at, '2026-11-15 22:00');
  assert.equal(billingPeriod('2026-11-16'), '2026-11-B');
});

test('companyFor: looks up the destination', () => {
  const dests = [{ DestCode: 'AAA', Company: 'PJW' }, { DestCode: 'BBB', Company: 'PSF' }];
  assert.equal(companyFor('BBB', dests), 'PSF');
  assert.equal(companyFor('ZZZ', dests), '');
});

const trip = (TripID, DriverCode, ScheduledAt, Status = 'Planned', ServiceDate = '2026-11-04') =>
  ({ TripID, ServiceDate, DriverCode, ScheduledAt, Status });

// Rounds are returned in input order, so tests key them back by TripID.
const roundsById = trips => {
  const r = computeRounds(trips);
  return Object.fromEntries(trips.map((t, i) => [t.TripID, r[i]]));
};

test('computeRounds: orders by ScheduledAt within one ServiceDate', () => {
  const r = roundsById([
    trip('T2', 'D1', '2026-11-04 06:00'),
    trip('T1', 'D1', '2026-11-03 22:00'),
    trip('T3', 'D2', '2026-11-04 01:00'),
    trip('T4', 'D1', '2026-11-04 22:00', 'Planned', '2026-11-05'),
  ]);
  assert.equal(r.T1, 1);
  assert.equal(r.T2, 2);
  assert.equal(r.T3, 1);
  assert.equal(r.T4, 1);
});

test('computeRounds: changing driver recounts both drivers', () => {
  const before = [trip('T1', 'D1', '2026-11-03 22:00'), trip('T2', 'D1', '2026-11-04 06:00'), trip('T3', 'D2', '2026-11-04 01:00')];
  const after = before.map(t => (t.TripID === 'T1' ? { ...t, DriverCode: 'D2' } : t));
  const r = roundsById(after);
  assert.equal(r.T2, 1);
  assert.equal(r.T1, 1);
  assert.equal(r.T3, 2);
});

test('computeRounds: changing time reorders rounds', () => {
  const r = roundsById([trip('T1', 'D1', '2026-11-04 08:00'), trip('T2', 'D1', '2026-11-03 22:00')]);
  assert.equal(r.T2, 1);
  assert.equal(r.T1, 2);
});

test('computeRounds: cancelled trips are skipped and later ones move up', () => {
  const r = roundsById([trip('T1', 'D1', '2026-11-03 22:00', 'Cancelled'), trip('T2', 'D1', '2026-11-04 06:00')]);
  assert.equal(r.T1, '');
  assert.equal(r.T2, 1);
});

test('computeRounds: trips without a driver or time get no round', () => {
  assert.deepEqual(computeRounds([trip('T1', '', '2026-11-04 06:00'), trip('T2', 'D1', '')]), ['', '']);
});

test('nextTripId: numbers trips per ServiceDate', () => {
  assert.equal(nextTripId('2026-11-04', []), 'T20261104-01');
  assert.equal(nextTripId('2026-11-04', ['T20261104-01', 'T20261104-03', 'T20261105-07', '']), 'T20261104-04');
});

test('deriveTrips: fills system columns and tolerates incomplete rows', () => {
  const dests = [{ DestCode: 'AAA', Company: 'PJW' }];
  const rows = [
    { TripID: 'T1', ServiceDate: '2026-11-16', PlanTime: '22:00', DestCode: 'AAA', DriverCode: 'D1', Status: '' },
    { TripID: 'T2', ServiceDate: '2026-11-16', PlanTime: '06:00', DestCode: 'AAA', DriverCode: 'D1', Status: 'S2' },
    { TripID: 'T3', ServiceDate: '2026-11-16', PlanTime: 'soon', DestCode: '', DriverCode: 'D1', Status: '' },
    { TripID: '', ServiceDate: '', PlanTime: '', DestCode: '', DriverCode: '', Status: '' },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(deriveTrips(rows, dests, '14:00'))), [
    { ScheduledAt: '2026-11-15 22:00', BillingPeriod: '2026-11-B', Company: 'PJW', Status: 'Planned', Round: 1 },
    { ScheduledAt: '2026-11-16 06:00', BillingPeriod: '2026-11-B', Company: 'PJW', Status: 'S2', Round: 2 },
    { ScheduledAt: '', BillingPeriod: '2026-11-B', Company: '', Status: 'Planned', Round: '' },
    { ScheduledAt: '', BillingPeriod: '', Company: '', Status: '', Round: '' },
  ]);
});
