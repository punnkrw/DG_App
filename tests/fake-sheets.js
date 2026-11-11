// Minimal in-memory SpreadsheetApp for tests. Cells hold raw values; display values are String(value)
// except Dates, shown as yyyy-MM-dd HH:mm in UTC+7.
function display(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    const d = new Date(v.getTime() + 7 * 3600 * 1000).toISOString();
    return d.slice(0, 10) + ' ' + d.slice(11, 16);
  }
  return v === undefined || v === null ? '' : String(v);
}

class FakeSheet {
  constructor(name, rows) {
    this.name = name;
    this.rows = rows.map(r => r.slice());
  }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  cell(r, c) { return (this.rows[r - 1] || [])[c - 1]; }
  getRange(row, col, nr = 1, nc = 1) {
    const sheet = this;
    const grid = fn => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fn(sheet.cell(row + i, col + j))));
    return {
      getValues: () => grid(v => (v === undefined ? '' : v)),
      getDisplayValues: () => grid(display),
      setValues(values) {
        values.forEach((vals, i) => vals.forEach((v, j) => {
          const r = row + i - 1;
          while (sheet.rows.length <= r) sheet.rows.push([]);
          sheet.rows[r][col + j - 1] = v;
        }));
        return this;
      },
      setValue(v) { return this.setValues([[v]]); },
      getSheet: () => sheet,
      getRow: () => row,
      getLastRow: () => row + nr - 1,
    };
  }
  getDataRange() {
    const width = Math.max(0, ...this.rows.map(r => r.length));
    return this.getRange(1, 1, this.rows.length, width);
  }
}

module.exports = function fakeSpreadsheetApp(sheets) {
  const byName = Object.fromEntries(Object.entries(sheets).map(([n, rows]) => [n, new FakeSheet(n, rows)]));
  return { getActive: () => ({ getSheetByName: n => byName[n] || null }), sheets: byName };
};
