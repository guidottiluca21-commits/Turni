/* Carica il motore (sezione ENGINE di index.html: nessun DOM) in un contesto Node isolato. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const file = process.env.INDEX_HTML || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const a = html.indexOf('/*@@ENGINE_BEGIN@@*/'), b = html.indexOf('/*@@ENGINE_END@@*/');
if (a < 0 || b < 0) throw new Error('Marcatori ENGINE non trovati in ' + file);
const code = html.slice(a, b);
const names = ['U', 'defaultState', 'normalizeState', 'validateSchedule', 'generateSchedule', 'previewAssignment', 'periodStats', 'screenAssignments', 'demandCells', 'weekServices', 'ensureWeek', 'makeEnv', 'analyzePerson', 'staticReason', 'Rules', 'PersonnelRules', 'ShiftRules', 'Unav', 'Imp', 'shiftDuration', 'cellKey', 'Store', 'monthWeeks', 'monthDays', 'holidayName', 'RestRules', 'WorkingHoursRules', 'ReperibilitaRules', 'OrganizationalRules', 'FairnessEngine', 'TurnValidationEngine', 'TurnGenerationEngine', 'itemsFromAssignment'];
const ctx = vm.createContext({ console, Date, Math, JSON, Set, Map, Object, Array, String, Number, RegExp, Error });
vm.runInContext(code + '\n;globalThis.__E = {' + names.map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(',') + '};', ctx, { filename: 'engine' });
module.exports = ctx.__E;
module.exports.__source = code;
