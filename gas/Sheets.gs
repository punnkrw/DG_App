// Sheet schema and one-time setup. The script is bound to the DG Trip Report spreadsheet.

const SCHEMA = {
  Trips: ['TripID', 'ServiceDate', 'PlanTime', 'Round', 'ScheduledAt', 'DestCode', 'Plate', 'DriverCode',
    'PlannedWeightKg', 'Company', 'BillingPeriod', 'Status', 'FolderItemId', 'Note', 'UpdatedAt'],
  Drivers: ['DriverCode', 'Name', 'LineUserId', 'Status', 'RegisteredAt'],
  Admins: ['LineUserId', 'Name'],
  Destinations: ['DestCode', 'DestName', 'Company', 'Color', 'Active'],
  Trucks: ['Plate', 'Active'],
  Steps: ['TripID', 'Step', 'SubmittedAt', 'SubmittedBy'],
  Photos: ['TripID', 'Field', 'ItemId', 'FileName', 'UploadedAt', 'UploadedBy', 'Version'],
  EditLog: ['Timestamp', 'Actor', 'Source', 'TripID', 'Field', 'OldValue', 'NewValue'],
  Config: ['Key', 'Value'],
};

const CONFIG_DEFAULTS = [['NightCutoff', '14:00'], ['CustomerLookbackDays', 31]];
const COMPANIES = ['PJW', 'PSF'];
const DRIVER_STATUSES = ['Pending', 'Active', 'Inactive'];

function tripStatuses_() {
  return ['Planned'].concat(STEPS.map(s => s.status), ['Cancelled']);
}

function ss_() {
  return SpreadsheetApp.getActive();
}

// All data rows of a sheet as objects keyed by the SCHEMA headers.
function readRows_(sheetName) {
  const headers = SCHEMA[sheetName];
  return ss_().getSheetByName(sheetName).getDataRange().getValues().slice(1)
    .map(v => Object.fromEntries(headers.map((h, i) => [h, v[i] === undefined ? '' : v[i]])));
}

function configValue_(key, fallback) {
  const row = readRows_('Config').find(r => r.Key === key);
  return row && row.Value !== '' ? String(row.Value) : fallback;
}

// Run once from the Apps Script editor. Safe to re-run: existing sheets and data are kept.
function setupSheets() {
  const ss = ss_();
  ss.setSpreadsheetTimeZone('Asia/Bangkok');
  Object.keys(SCHEMA).forEach(name => {
    const headers = SCHEMA[name];
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (current.every(v => v === '')) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    } else if (current.join('|') !== headers.join('|')) {
      throw new Error('Header ของชีต ' + name + ' ไม่ตรง schema: ' + current.join(', '));
    }
  });

  // Plain text keeps '22:00' as typed instead of turning it into a time value.
  textColumn_('Trips', 'PlanTime');
  textColumn_('Config', 'Value');
  dateColumn_('Trips', 'ServiceDate');
  columnRange_('Trips', 'ScheduledAt').setNumberFormat('yyyy-mm-dd hh:mm');
  columnRange_('Trips', 'UpdatedAt').setNumberFormat('yyyy-mm-dd hh:mm:ss');

  listFromSheet_('Trips', 'DestCode', 'Destinations', 'DestCode');
  listFromSheet_('Trips', 'Plate', 'Trucks', 'Plate');
  listFromSheet_('Trips', 'DriverCode', 'Drivers', 'DriverCode');
  listOf_('Trips', 'Status', tripStatuses_());
  listOf_('Destinations', 'Company', COMPANIES);
  listOf_('Drivers', 'Status', DRIVER_STATUSES);
  checkbox_('Destinations', 'Active');
  checkbox_('Trucks', 'Active');

  const config = ss.getSheetByName('Config');
  if (config.getLastRow() < 2) {
    config.getRange(2, 1, CONFIG_DEFAULTS.length, 2).setValues(CONFIG_DEFAULTS);
  }

  const blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

// Rows 2..max of one column.
function columnRange_(sheetName, header) {
  const sheet = ss_().getSheetByName(sheetName);
  const col = SCHEMA[sheetName].indexOf(header) + 1;
  return sheet.getRange(2, col, sheet.getMaxRows() - 1, 1);
}

function setRule_(sheetName, header, rule) {
  columnRange_(sheetName, header).setDataValidation(rule.setAllowInvalid(false).build());
}

function listOf_(sheetName, header, values) {
  setRule_(sheetName, header, SpreadsheetApp.newDataValidation().requireValueInList(values, true));
}

function listFromSheet_(sheetName, header, sourceSheet, sourceHeader) {
  const source = columnRange_(sourceSheet, sourceHeader);
  setRule_(sheetName, header, SpreadsheetApp.newDataValidation().requireValueInRange(source, true));
}

function checkbox_(sheetName, header) {
  columnRange_(sheetName, header).insertCheckboxes();
}

function dateColumn_(sheetName, header) {
  setRule_(sheetName, header, SpreadsheetApp.newDataValidation().requireDate());
  columnRange_(sheetName, header).setNumberFormat('yyyy-mm-dd');
}

function textColumn_(sheetName, header) {
  columnRange_(sheetName, header).setNumberFormat('@');
}
