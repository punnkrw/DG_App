// Loads .gs files into one shared context, the way Apps Script shares a global scope.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function loadGas(files, globals = {}) {
  const ctx = vm.createContext({ console, ...globals });
  for (const f of files) {
    const file = path.join(__dirname, '..', 'gas', f);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return ctx;
};
