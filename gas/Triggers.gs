// Run once from the Apps Script editor. Re-running replaces the existing trigger.
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onTripsEdit')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onTripsEdit').forSpreadsheet(ss_()).onEdit().create();
}

// Installable onEdit. Script writes do not fire onEdit, so this does not loop.
function onTripsEdit(e) {
  if (e.range.getSheet().getName() !== 'Trips') return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    recalcTrips_(e.range.getRow(), e.range.getLastRow());
  } finally {
    lock.releaseLock();
  }
}

// Recomputes the system columns for every trip, because a change to one row can shift
// another trip's Round. Assigns a TripID once to new rows and stamps UpdatedAt on edited rows.
function recalcTrips_(firstEdited, lastEdited) {
  const sheet = ss_().getSheetByName('Trips');
  const n = sheet.getLastRow() - 1;
  if (n < 1) return;
  const H = SCHEMA.Trips;
  const col = h => H.indexOf(h) + 1;

  // Display values give dates as yyyy-MM-dd and times as typed, without Date timezone quirks.
  const rows = sheet.getRange(2, 1, n, H.length).getDisplayValues()
    .map(v => Object.fromEntries(H.map((h, i) => [h, v[i].trim()])));
  const derived = deriveTrips(rows, readRows_('Destinations'), configValue_('NightCutoff', '14:00'));

  const ids = rows.map(r => r.TripID);
  rows.forEach((r, i) => {
    if (r.TripID || !r.ServiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(r.ServiceDate)) return;
    ids[i] = nextTripId(r.ServiceDate, ids);
    sheet.getRange(i + 2, col('TripID')).setValue(ids[i]);
  });

  // Round, ScheduledAt and Company, BillingPeriod, Status are adjacent column pairs in SCHEMA.
  sheet.getRange(2, col('Round'), n, 2)
    .setValues(derived.map(d => [d.Round, d.ScheduledAt ? bangkokDate_(d.ScheduledAt) : '']));
  sheet.getRange(2, col('Company'), n, 3)
    .setValues(derived.map(d => [d.Company, d.BillingPeriod, d.Status]));

  const from = Math.max(firstEdited, 2);
  const to = Math.min(lastEdited, n + 1);
  if (to >= from) {
    const now = new Date();
    sheet.getRange(from, col('UpdatedAt'), to - from + 1, 1)
      .setValues(rows.slice(from - 2, to - 1).map(r => [r.ServiceDate || r.TripID ? now : '']));
  }
}

// 'yyyy-MM-dd HH:mm' in Bangkok time to a Date.
function bangkokDate_(s) {
  return new Date(s.replace(' ', 'T') + ':00+07:00');
}
