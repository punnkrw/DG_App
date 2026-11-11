const test = require('node:test');
const assert = require('node:assert/strict');
const loadGas = require('./load-gas');
const fakeSpreadsheetApp = require('./fake-sheets');

const TRIPS_HEADER = ['TripID', 'ServiceDate', 'PlanTime', 'Round', 'ScheduledAt', 'DestCode', 'Plate', 'DriverCode',
  'PlannedWeightKg', 'Company', 'BillingPeriod', 'Status', 'FolderItemId', 'Note', 'UpdatedAt'];

// Only the columns an admin types; system columns start blank.
const planRow = (id, date, time, dest, driver, status = '') =>
  [id, date, time, '', '', dest, '', driver, '', '', '', status, '', '', ''];

function setup(tripRows) {
  const app = fakeSpreadsheetApp({
    Trips: [TRIPS_HEADER, ...tripRows],
    Destinations: [['DestCode', 'DestName', 'Company', 'Color', 'Active'], ['AAA', 'A', 'PJW', '', true], ['BBB', 'B', 'PSF', '', true]],
    Config: [['Key', 'Value'], ['NightCutoff', '14:00']],
  });
  const lock = { waitLock() {}, releaseLock() { lock.released = true; } };
  const gas = loadGas(['Steps.gs', 'Calc.gs', 'Router.gs', 'Sheets.gs', 'Triggers.gs'], {
    SpreadsheetApp: app,
    LockService: { getScriptLock: () => lock },
  });
  const trips = app.sheets.Trips;
  const edit = (first, last = first) => gas.onTripsEdit({ range: trips.getRange(first, 1, last - first + 1, 1) });
  const get = (row, header) => trips.cell(row, TRIPS_HEADER.indexOf(header) + 1);
  const shown = (row, header) => trips.getRange(row, TRIPS_HEADER.indexOf(header) + 1).getDisplayValues()[0][0];
  return { app, gas, trips, edit, get, shown, lock };
}

test('fills system columns for the plan block and night trips', () => {
  const s = setup([
    planRow('', '2026-11-16', '22:00', 'AAA', 'D1'),
    planRow('', '2026-11-16', '06:00', 'BBB', 'D1'),
  ]);
  s.edit(2, 3);
  assert.equal(s.get(2, 'TripID'), 'T20261116-01');
  assert.equal(s.get(3, 'TripID'), 'T20261116-02');
  assert.equal(s.shown(2, 'ScheduledAt'), '2026-11-15 22:00');
  assert.equal(s.get(2, 'BillingPeriod'), '2026-11-B');
  assert.equal(s.get(2, 'Company'), 'PJW');
  assert.equal(s.get(3, 'Company'), 'PSF');
  assert.equal(s.get(2, 'Status'), 'Planned');
  assert.equal(s.get(2, 'Round'), 1);
  assert.equal(s.get(3, 'Round'), 2);
  assert.equal(Object.prototype.toString.call(s.get(2, 'UpdatedAt')), '[object Date]');
  assert.ok(s.lock.released);
});

test('existing TripID and Status are kept, UpdatedAt only on edited rows', () => {
  const s = setup([
    planRow('T20261104-05', '2026-11-04', '22:00', 'AAA', 'D1', 'S2'),
    planRow('', '2026-11-04', '06:00', 'AAA', 'D2'),
  ]);
  s.edit(3);
  assert.equal(s.get(2, 'TripID'), 'T20261104-05');
  assert.equal(s.get(2, 'Status'), 'S2');
  assert.equal(s.get(3, 'TripID'), 'T20261104-06');
  assert.equal(s.get(2, 'UpdatedAt'), '');
  assert.equal(Object.prototype.toString.call(s.get(3, 'UpdatedAt')), '[object Date]');
});

test('changing the driver recounts rounds for both drivers', () => {
  const s = setup([
    planRow('T1', '2026-11-04', '22:00', 'AAA', 'D1'),
    planRow('T2', '2026-11-04', '06:00', 'AAA', 'D1'),
    planRow('T3', '2026-11-04', '01:00', 'AAA', 'D2'),
  ]);
  s.edit(2, 4);
  assert.deepEqual([s.get(2, 'Round'), s.get(3, 'Round'), s.get(4, 'Round')], [1, 2, 1]);
  s.trips.getRange(2, 8).setValue('D2');
  s.edit(2);
  assert.deepEqual([s.get(2, 'Round'), s.get(3, 'Round'), s.get(4, 'Round')], [1, 1, 2]);
});

test('cancelling round 1 makes round 2 the new round 1', () => {
  const s = setup([planRow('T1', '2026-11-04', '22:00', 'AAA', 'D1'), planRow('T2', '2026-11-04', '06:00', 'AAA', 'D1')]);
  s.edit(2, 3);
  s.trips.getRange(2, 12).setValue('Cancelled');
  s.edit(2);
  assert.equal(s.get(2, 'Round'), '');
  assert.equal(s.get(3, 'Round'), 1);
});

test('edits on other sheets are ignored', () => {
  const s = setup([planRow('', '2026-11-04', '22:00', 'AAA', 'D1')]);
  s.gas.onTripsEdit({ range: s.app.sheets.Destinations.getRange(2, 3) });
  assert.equal(s.get(2, 'TripID'), '');
});
