/* Test del motore di regole e validazione (Node, senza dipendenze).  Esecuzione:  node tests/engine.test.js */
const assert = require('assert');
const E = require('./harness.js');
const { U } = E;
let passed = 0, failed = 0; const failures = [];
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; failures.push([name, e]); console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }

/* ---------- strumenti ---------- */
const WS = '2026-10-05'; // lunedì
const d = n => U.addDays(WS, n); // giorno n dopo il lunedì
const TYPES = [
  ['t8', 'Turno 8h', 'work', '08:00', '16:00'], ['t1', 'Turno 1h', 'work', '08:00', '09:00'], ['t2', 'Turno 2h', 'work', '08:00', '10:00'], ['t3', 'Turno 3h', 'work', '08:00', '11:00'],
  ['t4', 'Turno 4h', 'work', '08:00', '12:00'], ['t7', 'Turno 7h', 'work', '08:00', '15:00'], ['t10', 'Turno 10h', 'work', '08:00', '18:00'], ['m8', 'Mattina 8-14', 'work', '08:00', '14:00'],
  ['g20', 'Guardia 20-08', 'guardia', '20:00', '08:00'], ['not', 'Notte', 'work', '22:00', '06:00', true], ['rep', 'Reperibilità', 'reperibilita', '20:00', '08:00'],
];
function mk(people, fill, tweak) {
  const S = {
    people: people.map(p => Object.assign({ first: p.id, last: '', display: p.id, role: '', services: ['svc'], night: true, active: true, notes: '' }, p)),
    shiftTypes: TYPES.map(([id, name, kind, start, end, night]) => ({ id, name, kind, start, end, night: !!night, points: kind === 'reperibilita' ? 0.5 : 1, color: '#6b6bd6' })),
    services: [{ id: 'svc', name: 'Sala', color: '#3d8bd9', active: true, continuity: false, req: {} }], unavail: [], weeks: {},
  };
  S.shiftTypes.forEach(t => { S.services[0].req[t.id] = [5, 5, 5, 5, 5, 5, 5]; });
  const N = E.normalizeState(S);
  N.settings.optimizer = { restarts: 2, iterations: 1500, timeMs: 3000, seed: 3 };
  if (fill) fill(N);
  if (tweak) tweak(N);
  return N;
}
let aid = 0;
const put = (S, pid, date, shift, extra) => { const w = E.ensureWeek(S, U.monday(date)); w.assignments.push(Object.assign({ id: 'x' + (++aid), svc: 'svc', date, shift, person: pid, locked: false }, extra || {})); };
const cellOf = (S, shift, date) => E.demandCells(S, U.monday(date)).find(c => c.shift === shift && c.date === date);
const find = (V, ruleId) => V.findings.filter(f => f.ruleId === ruleId);
const SPEC = { id: 'sp', tipoPersonale: 'specializzando' }, DIR = { id: 'dir', tipoPersonale: 'dirigente' };
/* settimana con 5 turni da 8 h (40 h) più un turno finale il sabato */
const week40 = (S, pid, last) => { for (let i = 0; i < 5; i++) put(S, pid, d(i), 't8'); if (last) put(S, pid, d(5), last); };

console.log('Regole di reperibilità');
test('1. Specializzando + reperibilità: bloccata, non conteggiata, nessuna statistica', () => {
  const S = mk([SPEC]); const c = cellOf(S, 'rep', d(2));
  const pv = E.previewAssignment(S, WS, c, 'sp', []);
  assert.ok(pv.blocked, 'deve essere bloccata'); assert.strictEqual(pv.blocked.msg, 'Questo personale è classificato come specializzando e non è abilitato alla reperibilità.');
  assert.ok(pv.hardTypes.includes('SPEC_REP'));
  // dato storico incompatibile: segnalato, ma NON conteggiato
  const S2 = mk([SPEC], s => put(s, 'sp', d(2), 'rep'));
  const V = E.validateSchedule(S2, WS); assert.strictEqual(find(V, 'spec_no_reperibilita').length, 1);
  const st = V.stats.find(x => x.person.id === 'sp'); assert.strictEqual(st.rep, null, 'reperibilità non applicabile (null, non 0)'); assert.strictEqual(st.repHours, null);
  const ps = E.periodStats(S2, [WS], new Set(Array.from({ length: 7 }, (_, i) => d(i)))).rows[0]; assert.strictEqual(ps.rep, null);
  assert.strictEqual(E.PersonnelRules.canDoReperibilita(Object.assign({}, S2.people[0], { abil: { reperibilita: true } })), false);
});
test('2. Dirigente abilitato + reperibilità: assegnazione possibile', () => {
  const S = mk([DIR]); const pv = E.previewAssignment(S, WS, cellOf(S, 'rep', d(2)), 'dir', []);
  assert.strictEqual(pv.blocked, null); assert.strictEqual(pv.hard.length, 0);
});
test('3. Dirigente non abilitato alla reperibilità: bloccata', () => {
  const S = mk([Object.assign({}, DIR, { abil: { reperibilita: false } })]); const pv = E.previewAssignment(S, WS, cellOf(S, 'rep', d(2)), 'dir', []);
  assert.ok(pv.blocked); assert.ok(pv.hardTypes.includes('NONABIL_REP'));
});

console.log('Limite ore degli specializzandi (parametro centrale)');
test('4. Specializzando 41 ore: nessun errore', () => { const S = mk([SPEC], s => week40(s, 'sp', 't1')); const V = E.validateSchedule(S, WS); assert.strictEqual(find(V, 'spec_weekly_hours').length, 0); assert.strictEqual(V.stats[0].hours, 41); assert.strictEqual(V.stats[0].limit.residual, 1); });
test('5. Specializzando 42 ore: nessun errore', () => { const S = mk([SPEC], s => week40(s, 'sp', 't2')); const V = E.validateSchedule(S, WS); assert.strictEqual(find(V, 'spec_weekly_hours').length, 0); assert.strictEqual(V.stats[0].limit.residual, 0); });
test('6. Specializzando 43 ore: violazione organizzativa, +1 h, assegnazione bloccata', () => {
  const S = mk([SPEC], s => week40(s, 'sp', 't3')); const V = E.validateSchedule(S, WS); const f = find(V, 'spec_weekly_hours');
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].status, 'error'); assert.strictEqual(f[0].severity, 'organizational'); assert.strictEqual(f[0].source, 'aziendale'); assert.strictEqual(f[0].level, 2);
  assert.deepStrictEqual([f[0].details.actualHours, f[0].details.maximumHours, f[0].details.excessHours], [43, 42, 1]);
  assert.ok(/Superamento del limite settimanale configurato per gli specializzandi/.test(f[0].message));
  const S2 = mk([SPEC], s => week40(s, 'sp')); const pv = E.previewAssignment(S2, WS, cellOf(S2, 't3', d(5)), 'sp', []); assert.ok(pv.blocked && pv.blocked.type === 'SPEC_ORE');
  // se la regola diventa «avviso» la modifica non è più bloccata
  S2.settings.rules.spec_weekly_hours.behavior = 'warning'; const pv2 = E.previewAssignment(S2, WS, cellOf(S2, 't3', d(5)), 'sp', []); assert.strictEqual(pv2.blocked, null); assert.ok(pv2.warn.length >= 1);
});
test('7. Specializzando 39 h + turno da 4 h = 43: assegnazione rifiutata', () => {
  const S = mk([SPEC], s => { for (let i = 0; i < 4; i++) put(s, 'sp', d(i), 't8'); put(s, 'sp', d(4), 't7'); });
  const pv = E.previewAssignment(S, WS, cellOf(S, 't4', d(5)), 'sp', []); assert.ok(pv.blocked); assert.strictEqual(pv.blocked.details.actualHours, 43);
});
test('Il limite non è fisso: cambiandolo 42 → 40 tutto lo usa; non si applica ai dirigenti', () => {
  const S = mk([SPEC, DIR], s => { week40(s, 'sp', 't1'); week40(s, 'dir', 't3'); });
  assert.strictEqual(find(E.validateSchedule(S, WS), 'spec_weekly_hours').length, 0);
  S.settings.rules.spec_weekly_hours.value = 40; const V = E.validateSchedule(S, WS); const f = find(V, 'spec_weekly_hours');
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].person, 'sp'); assert.strictEqual(f[0].details.maximumHours, 40); assert.strictEqual(f[0].details.actualHours, 41);
  assert.strictEqual(E.Rules.specMaxWeeklyHours(S), 40);
  S.settings.rules.spec_weekly_hours.enabled = false; assert.strictEqual(find(E.validateSchedule(S, WS), 'spec_weekly_hours').length, 0, 'disattivabile');
});

console.log('Riposi, sovrapposizioni, indisponibilità');
test('8. Riposo giornaliero insufficiente: violazione con ore disponibili/richieste', () => {
  const S = mk([DIR], s => { put(s, 'dir', d(0), 'g20'); put(s, 'dir', d(1), 'm8'); }); const f = find(E.validateSchedule(S, WS), 'rest_daily');
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].status, 'error'); assert.strictEqual(f[0].source, 'norma'); assert.strictEqual(f[0].level, 1);
  assert.strictEqual(f[0].details.availableRest, 0); assert.strictEqual(f[0].details.requiredRest, 11); assert.ok(/Riposo disponibile: 0 h · richiesto: 11 h/.test(f[0].message));
});
test('9. Riposo sufficiente (20–08 poi 20–08 del giorno dopo: 12 h): nessuna violazione', () => {
  const S = mk([DIR], s => { put(s, 'dir', d(0), 'g20'); put(s, 'dir', d(1), 'g20'); }); assert.strictEqual(find(E.validateSchedule(S, WS), 'rest_daily').length, 0);
});
test('10. Sovrapposizione di turni: conflitto', () => {
  const S = mk([DIR], s => { put(s, 'dir', d(0), 't8'); put(s, 'dir', d(0), 't10'); }); assert.strictEqual(find(E.validateSchedule(S, WS), 'overlap').length, 1);
});
test('11. Indisponibilità «Notte» del 10 e guardia 20:00–08:00 del 10: conflitto sugli orari effettivi', () => {
  const S = mk([DIR], s => { s.unavail.push({ id: 'u', person: 'dir', from: d(5), to: d(5), shifts: ['not'], note: '' }); put(s, 'dir', d(5), 'g20'); });
  const f = find(E.validateSchedule(S, WS), 'unavailability'); assert.strictEqual(f.length, 1); assert.strictEqual(f[0].status, 'error');
  const env = E.makeEnv(S, WS); assert.strictEqual(E.staticReason(env, S.people[0], 'svc', null, d(5), 't8'), null, 'il turno 08–16 non si sovrappone alla notte');
});
test('Riposo settimanale: violazione certa solo con dati completi, altrimenti «dati insufficienti»', () => {
  const sevenDays = (s, w0) => { for (let i = 0; i < 7; i++) put(s, 'dir', U.addDays(w0, i), 't8'); };
  const S1 = mk([DIR], s => sevenDays(s, WS)); S1.settings.maxConsecutiveDays = 0;
  const V1 = E.validateSchedule(S1, WS); assert.strictEqual(find(V1, 'rest_weekly').filter(f => f.status === 'error').length, 0, 'nessuna violazione certa con dati mancanti');
  assert.ok(find(V1, 'rest_weekly').some(f => f.certainty === 'insufficient_data' && /Impossibile verificare completamente il riposo settimanale/.test(f.message)));
  const S2 = mk([DIR], s => { sevenDays(s, U.addDays(WS, -7)); sevenDays(s, WS); }); S2.settings.maxConsecutiveDays = 0;
  const V2 = E.validateSchedule(S2, WS); assert.ok(find(V2, 'rest_weekly').some(f => f.status === 'error' && f.certainty === 'certain'));
});

console.log('Ore e limiti');
const weeks17 = (S, pid, shiftsPerWeek, shift) => { for (let k = 16; k >= 0; k--) for (let i = 0; i < shiftsPerWeek; i++) put(S, pid, U.addDays(WS, -7 * k + i), shift); };
test('12. Media 48 ore sul periodo di riferimento (17 settimane)', () => {
  const S = mk([DIR], s => weeks17(s, 'dir', 5, 't10')); const f = find(E.validateSchedule(S, WS), 'hours_avg_48');
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].status, 'error'); assert.strictEqual(f[0].certainty, 'certain'); assert.strictEqual(f[0].details.averageHours, 50); assert.strictEqual(f[0].details.weeksConsidered, 17); assert.strictEqual(f[0].source, 'norma');
  const ok = mk([DIR], s => weeks17(s, 'dir', 5, 't8')); assert.strictEqual(find(E.validateSchedule(ok, WS), 'hours_avg_48').length, 0);
  const mix = mk([DIR], s => { for (let k = 16; k >= 1; k--) for (let i = 0; i < 4; i++) put(s, 'dir', U.addDays(WS, -7 * k + i), 't10'); for (let i = 0; i < 6; i++) put(s, 'dir', d(i), 't10'); });
  mix.settings.maxConsecutiveDays = 0; assert.strictEqual(find(E.validateSchedule(mix, WS), 'hours_avg_48').length, 0, 'la media su 17 settimane resta sotto 48');
  const partial = mk([DIR], s => { for (let i = 0; i < 6; i++) { put(s, 'dir', d(i), 't10'); put(s, 'dir', U.addDays(d(i), -7), 't10'); } }); partial.settings.maxConsecutiveDays = 0;
  const p = find(E.validateSchedule(partial, WS), 'hours_avg_48'); assert.strictEqual(p.length, 1); assert.strictEqual(p[0].status, 'warning'); assert.strictEqual(p[0].certainty, 'potential', 'periodo non completo: solo potenziale');
});
test('13. Limiti notti: settimanale (avviso/bloccante) e mensile configurabili', () => {
  const S = mk([DIR], s => { put(s, 'dir', d(0), 'not'); put(s, 'dir', d(2), 'not'); put(s, 'dir', d(4), 'not'); s.settings.maxNightsWeek = 2; });
  let f = find(E.validateSchedule(S, WS), 'max_nights_week'); assert.strictEqual(f.length, 1); assert.strictEqual(f[0].status, 'warning'); assert.strictEqual(f[0].source, 'aziendale');
  S.settings.rules.max_nights_week.behavior = 'blocking'; f = find(E.validateSchedule(S, WS), 'max_nights_week'); assert.strictEqual(f[0].status, 'error');
  S.settings.maxNightsWeek = 0; S.settings.rules.max_nights_month = { enabled: true, behavior: 'blocking', value: 2 };
  f = find(E.validateSchedule(S, WS), 'max_nights_month'); assert.strictEqual(f.length, 1); assert.strictEqual(f[0].details.maximum, 2);
});
test('14. Reperibilità + chiamata: ore effettive, riposo, recupero', () => {
  const S = mk([DIR], s => { put(s, 'dir', d(0), 'rep', { calls: [{ id: 'c1', from: d(1) + 'T02:00', to: d(1) + 'T04:00', note: '' }] }); put(s, 'dir', d(1), 'm8'); });
  const V = E.validateSchedule(S, WS), f = find(V, 'rep_rest_after_call');
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].status, 'warning'); assert.strictEqual(f[0].details.availableRest, 4); assert.strictEqual(f[0].details.requiredRest, 11); assert.strictEqual(f[0].details.recoveryHours, 7);
  const ps = E.periodStats(S, [WS], new Set(Array.from({ length: 7 }, (_, i) => d(i)))).rows[0];
  assert.strictEqual(ps.hours, 8, '6 h di turno + 2 h di intervento: la reperibilità passiva (12 h) non è lavoro'); assert.strictEqual(ps.callHours, 2); assert.strictEqual(ps.repHours, 12);
  const passive = mk([DIR], s => { for (let i = 0; i < 5; i++) put(s, 'dir', d(i), 'rep'); }); const Vp = E.validateSchedule(passive, WS);
  assert.strictEqual(Vp.stats[0].hours, 0); assert.strictEqual(find(Vp, 'hours_avg_48').length + find(Vp, 'hours_week_cap').length, 0);
});

console.log('Importazione, ruolo, deroghe, migrazione');
test('15. Import Excel: reperibilità a specializzando = riga non valida, nessuna assegnazione valida', () => {
  const S = mk([SPEC, DIR]); const r = E.screenAssignments(S, [{ personId: 'sp', date: d(2), svcId: 'svc', shiftId: 'rep' }, { personId: 'dir', date: d(2), svcId: 'svc', shiftId: 'rep' }]);
  assert.strictEqual(r.invalid.length, 1); assert.strictEqual(r.invalid[0].reason, 'Questo personale è classificato come specializzando e non è abilitato alla reperibilità.'); assert.strictEqual(r.valid.length, 1); assert.strictEqual(r.valid[0].row.personId, 'dir');
  assert.strictEqual(Object.keys(S.weeks).length, 0, 'lo stato originale non viene modificato dal controllo');
});
test('16. Cambio ruolo dirigente → specializzando: reperibilità future segnalate, non cancellate', () => {
  const S = mk([DIR], s => { put(s, 'dir', d(2), 'rep'); put(s, 'dir', d(3), 'rep'); });
  assert.strictEqual(find(E.validateSchedule(S, WS), 'spec_no_reperibilita').length, 0);
  S.people[0].tipoPersonale = 'specializzando';
  const V = E.validateSchedule(S, WS); assert.strictEqual(find(V, 'spec_no_reperibilita').length, 2); assert.ok(find(V, 'spec_no_reperibilita').every(f => f.status === 'error'));
  assert.strictEqual(S.weeks[WS].assignments.length, 2, 'storico conservato');
  S.people[0].tipoPersonale = 'dirigente'; assert.strictEqual(find(E.validateSchedule(S, WS), 'spec_no_reperibilita').length, 0, 'tornando dirigente le assegnazioni sono di nuovo valide');
});
test('Deroga esplicita: declassa il limite ore, ma non vale per la reperibilità degli specializzandi', () => {
  const S = mk([SPEC], s => { week40(s, 'sp'); put(s, 'sp', d(5), 't3', { derogation: { rules: ['spec_weekly_hours'], note: 'autorizzata' } }); put(s, 'sp', d(6), 'rep', { derogation: { rules: ['spec_no_reperibilita'] } }); });
  const V = E.validateSchedule(S, WS), f = find(V, 'spec_weekly_hours'); assert.strictEqual(f[0].status, 'info'); assert.strictEqual(f[0].certainty, 'derogated');
  assert.strictEqual(find(V, 'spec_no_reperibilita')[0].status, 'error');
});
test('Migrazione: dati esistenti conservati, ruolo dedotto, abilitazioni e regole di default', () => {
  const old = { version: 1, people: [{ id: 'a', first: 'Anna', last: 'U', display: 'Anna U.', role: 'Specializzando 3° anno', services: ['svc'], night: true, active: true }, { id: 'b', display: 'B', role: 'Operatore', services: [], night: false, active: true }],
    shiftTypes: [{ id: 'mat', name: 'Mattina', start: '06:00', end: '14:00', night: false, points: 1, color: '#fde68a' }, { id: 'rp', name: 'Pronta disponibilità', start: '20:00', end: '08:00', night: false, points: 1, color: '#bfdbfe' }], services: [{ id: 'svc', name: 'Sala', active: true, req: { mat: [1, 1, 1, 1, 1, 1, 1] } }],
    weeks: { [WS]: { assignments: [{ id: 'z1', svc: 'svc', date: WS, shift: 'mat', person: 'b', locked: true }] } }, unavail: [{ id: 'u1', person: 'a', from: WS, to: WS, shifts: null, note: 'ferie' }], settings: { minRestHours: 12, maxConsecutiveDaysHard: false } };
  const S = E.normalizeState(JSON.parse(JSON.stringify(old)));
  assert.strictEqual(S.people.length, 2); assert.strictEqual(S.people[0].tipoPersonale, 'specializzando'); assert.strictEqual(S.people[1].tipoPersonale, 'dirigente');
  assert.strictEqual(S.people[0].abil.reperibilita, true); assert.strictEqual(E.PersonnelRules.canDoReperibilita(S.people[0]), false);
  assert.strictEqual(S.shiftTypes[0].kind, 'work'); assert.strictEqual(S.shiftTypes[1].kind, 'reperibilita');
  assert.strictEqual(S.weeks[WS].assignments.length, 1); assert.strictEqual(S.weeks[WS].assignments[0].locked, true); assert.strictEqual(S.unavail.length, 1); assert.strictEqual(S.settings.minRestHours, 12);
  assert.strictEqual(S.settings.rules.max_consec_days.behavior, 'warning'); assert.strictEqual(S.settings.rules.spec_weekly_hours.value, 42); assert.strictEqual(S.version, 2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(E.normalizeState(JSON.parse(JSON.stringify(S))).settings.rules)), JSON.parse(JSON.stringify(S.settings.rules)), 'migrazione idempotente');
});
test('Equità: la reperibilità si confronta solo fra abilitati (specializzandi esclusi, «—»)', () => {
  const S = mk([SPEC, DIR, Object.assign({}, DIR, { id: 'dir2' })], s => { put(s, 'dir', d(0), 'rep'); put(s, 'dir', d(1), 'rep'); put(s, 'dir2', d(2), 'rep'); });
  const env = E.makeEnv(S, WS), pm = Object.fromEntries(S.people.map(p => [p.id, p])), vec = pid => E.FairnessEngine.loadVec(env, (S.weeks[WS].assignments.filter(a => a.person === pid)).flatMap(a => E.itemsFromAssignment(env, a, WS)), pm[pid]);
  const vs = ['sp', 'dir', 'dir2'].map(vec); assert.deepStrictEqual(vs.map(v => v.rep), [false, true, true]);
  const fc = E.FairnessEngine.calc(env, vs, true), ri = env.tIdx['rep'] + 4;
  assert.strictEqual(fc.devs[0][ri], 0, 'nessuna deviazione di reperibilità per lo specializzando'); assert.strictEqual(fc.mean[ri], 1.5, 'media calcolata solo su 2 dirigenti');
});

console.log('Generazione automatica');
test('17. Generazione: niente reperibilità agli specializzandi, ore ≤ limite, riposi e indisponibilità, equità', () => {
  const people = [SPEC, Object.assign({}, SPEC, { id: 'sp2' }), DIR, Object.assign({}, DIR, { id: 'd2' }), Object.assign({}, DIR, { id: 'd3' }), Object.assign({}, DIR, { id: 'd4' })];
  const S = mk(people, s => {
    s.services[0].req = {}; s.shiftTypes.forEach(t => { s.services[0].req[t.id] = [0, 0, 0, 0, 0, 0, 0]; }); s.services[0].req.m8 = [2, 2, 2, 2, 2, 2, 2]; s.services[0].req.rep = [1, 1, 1, 1, 1, 1, 1];
    s.unavail.push({ id: 'u', person: 'd2', from: d(1), to: d(1), shifts: null, note: '' });
  }, s => { s.settings.rules.spec_weekly_hours.value = 12; });
  const weeksList = [WS, U.addDays(WS, 7)];
  for (const w of weeksList) E.generateSchedule(S, w);
  const all = weeksList.flatMap(w => S.weeks[w].assignments);
  assert.ok(all.length >= 40, 'turni generati'); assert.ok(!all.some(a => a.shift === 'rep' && (a.person === 'sp' || a.person === 'sp2')), 'reperibilità agli specializzandi');
  for (const w of weeksList) {
    const V = E.validateSchedule(S, w); assert.strictEqual(V.hard.length, 0, 'violazioni bloccanti: ' + V.hard.map(h => h.message).join(' | ')); assert.strictEqual(V.uncoveredCount, 0, 'turni scoperti');
    for (const sp of ['sp', 'sp2']) { const st = V.stats.find(x => x.person.id === sp); assert.ok(st.hours <= 12 + 1e-9, sp + ' ore ' + st.hours); assert.strictEqual(st.rep, null); }
  }
  assert.ok(!S.weeks[WS].assignments.some(a => a.person === 'd2' && a.date === d(1)), 'indisponibilità rispettata');
  const cnt = {}; all.filter(a => a.shift === 'rep').forEach(a => { cnt[a.person] = (cnt[a.person] || 0) + 1; }); const v = Object.values(cnt); assert.ok(Math.max(...v) - Math.min(...v) <= 2, 'equità reperibilità ' + JSON.stringify(cnt));
});
test('Generazione impossibile: nessun limite viene allentato, i turni restano scoperti con la causa', () => {
  const S = mk([SPEC], s => { s.services[0].req = {}; s.shiftTypes.forEach(t => { s.services[0].req[t.id] = [0, 0, 0, 0, 0, 0, 0]; }); s.services[0].req.t8 = [1, 1, 1, 1, 1, 1, 1]; }, s => { s.settings.rules.spec_weekly_hours.value = 16; });
  E.generateSchedule(S, WS); const V = E.validateSchedule(S, WS);
  assert.ok(V.uncoveredCount > 0, 'servono più di 16 h'); assert.strictEqual(V.hard.length, 0); assert.strictEqual(S.settings.rules.spec_weekly_hours.value, 16, 'il limite non viene modificato');
  assert.ok(V.uncovered.some(u => u.excluded.some(e => /limite settimanale configurato per gli specializzandi/.test(e.reason))), 'causa principale indicata');
});

console.log('Struttura e fonti');
test('Il limite delle ore degli specializzandi è definito una sola volta (nessun valore fisso nel codice)', () => {
  const src = E.__source.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l));
  const hits = src.filter(l => /\b42\b/.test(l)); const allowed = hits.filter(l => /d\.spec_weekly_hours\.value = 42/.test(l) || /ordine di|\|\| 42\b/.test(l));
  assert.strictEqual(hits.length - allowed.length, 0, 'occorrenze di 42 nel codice del motore:\n' + hits.join('\n'));
  assert.ok(E.Rules.defaults().spec_weekly_hours.value === 42);
});
test('Catalogo: ogni regola dichiara livello, fonte e stato di verifica; il limite specializzandi non è «norma»', () => {
  for (const r of E.Rules.CATALOG) { assert.ok([1, 2, 3].includes(r.level), r.id); assert.ok(r.source && r.verified && r.title, r.id); }
  const s = E.Rules.BY_ID.spec_weekly_hours; assert.strictEqual(s.source, 'aziendale'); assert.strictEqual(s.level, 2); assert.ok(!/limite di legge nazionale/i.test(s.desc.replace(/Non è presentata come limite di legge/, '')));
  assert.strictEqual(E.Rules.BY_ID.rest_daily.source, 'norma'); assert.strictEqual(E.Rules.BY_ID.rep_max_month.verified, 'da_confermare');
});

console.log(`\n${passed} test superati, ${failed} falliti`);
if (failed) { failures.forEach(([n, e]) => console.log('\n✗ ' + n + '\n' + (e && e.stack))); process.exit(1); }
