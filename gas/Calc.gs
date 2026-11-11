// Pure calculations for Trips columns. No Apps Script services here, so tests can run in Node.
// Dates are 'yyyy-MM-dd' strings and times are 'HH:mm' strings, all in Asia/Bangkok.

function parseDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new Error('Bad date: ' + s);
  return { y: +m[1], mo: +m[2], d: +m[3] };
}

function normTime_(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('Bad time: ' + s);
  return m[1].padStart(2, '0') + ':' + m[2];
}

function pad2_(n) {
  return String(n).padStart(2, '0');
}

// Plan times at or after the cutoff belong to the night before the plan block.
function scheduledAt(serviceDate, planTime, nightCutoff) {
  const t = normTime_(planTime);
  let { y, mo, d } = parseDate_(serviceDate);
  if (t >= normTime_(nightCutoff)) {
    const prev = new Date(Date.UTC(y, mo - 1, d - 1));
    y = prev.getUTCFullYear();
    mo = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }
  return y + '-' + pad2_(mo) + '-' + pad2_(d) + ' ' + t;
}

function billingPeriod(serviceDate) {
  const { y, mo, d } = parseDate_(serviceDate);
  return y + '-' + pad2_(mo) + '-' + (d <= 15 ? 'A' : 'B');
}

// destinations: [{ DestCode, Company }]. Returns '' for an unknown code.
function companyFor(destCode, destinations) {
  const dest = destinations.find(x => x.DestCode === destCode);
  return dest ? dest.Company : '';
}

// trips: [{ TripID, ServiceDate, DriverCode, ScheduledAt, Status }].
// Returns rounds in input order: a driver's trips within one ServiceDate counted in ScheduledAt order.
// Cancelled trips and trips without a driver or ScheduledAt get ''.
function computeRounds(trips) {
  const groups = {};
  const rounds = trips.map(() => '');
  trips.forEach((t, i) => {
    if (t.Status === 'Cancelled' || !t.DriverCode || !t.ScheduledAt) return;
    const key = t.ServiceDate + '|' + t.DriverCode;
    (groups[key] = groups[key] || []).push(i);
  });
  Object.keys(groups).forEach(key => {
    groups[key]
      .sort((a, b) => trips[a].ScheduledAt.localeCompare(trips[b].ScheduledAt) || a - b)
      .forEach((idx, n) => { rounds[idx] = n + 1; });
  });
  return rounds;
}

// Next free TripID for a ServiceDate, e.g. T20261104-03. existingIds may hold any dates.
function nextTripId(serviceDate, existingIds) {
  const prefix = 'T' + serviceDate.replace(/-/g, '') + '-';
  const max = existingIds
    .filter(id => String(id).startsWith(prefix))
    .reduce((m, id) => Math.max(m, parseInt(String(id).slice(prefix.length), 10) || 0), 0);
  return prefix + pad2_(max + 1);
}

// rows: [{ TripID, ServiceDate, PlanTime, DestCode, DriverCode, Status }] with ServiceDate 'yyyy-MM-dd'
// and PlanTime 'HH:mm' (either may be ''). Returns the system columns for each row in input order.
// Rows with a bad date or time get blank ScheduledAt and no Round instead of failing the whole sheet.
function deriveTrips(rows, destinations, nightCutoff) {
  const derived = rows.map(r => {
    let at = '';
    let period = '';
    try { at = scheduledAt(r.ServiceDate, r.PlanTime, nightCutoff); } catch (err) { /* left blank */ }
    try { period = billingPeriod(r.ServiceDate); } catch (err) { /* left blank */ }
    return {
      ScheduledAt: at,
      BillingPeriod: period,
      Company: r.DestCode ? companyFor(r.DestCode, destinations) : '',
      Status: r.Status || (r.ServiceDate ? 'Planned' : ''),
    };
  });
  const rounds = computeRounds(rows.map((r, i) => ({
    ServiceDate: r.ServiceDate, DriverCode: r.DriverCode, ScheduledAt: derived[i].ScheduledAt, Status: derived[i].Status,
  })));
  derived.forEach((d, i) => { d.Round = rounds[i]; });
  return derived;
}
