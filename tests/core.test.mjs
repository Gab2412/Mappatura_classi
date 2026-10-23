import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/js/00-core.js', import.meta.url), 'utf8');
vm.runInThisContext(source);
const C = globalThis.CC.core;

function stateWith(layout) {
  const s = C.createState();
  s.layout = layout;
  return s;
}

function add(s, name) {
  const r = C.addStudent(s, name);
  s = r.state;
  return { s, id: r.student.id };
}

test('crea una disposizione predefinita 3x3 con 2 banchi', () => {
  const s = C.createState();
  assert.deepEqual(s.layout, [[2, 2, 2], [2, 2, 2], [2, 2, 2]]);
  assert.equal(C.seatCapacity(s.layout), 18);
});

test('numera i posti dalla prima fila, da sinistra a destra', () => {
  const s = stateWith([[2, 3, 2], [2, 2, 2], [2, 2, 1]]);
  const idx = C.buildSeatIndex(s);
  assert.equal(idx.seats.length, 18);
  const first = idx.byKey.get('2:0:0');
  assert.equal(first.number, 1);
  assert.equal(first.fila, 1);
  assert.equal(first.banco, 1);
  assert.match(first.aria, /^Posto 1\. Fila 1 \(prima fila/);
  const last = idx.byKey.get('0:2:1');
  assert.equal(last.number, 18);
  assert.equal(last.fila, 3);
  assert.match(last.aria, /ultima fila/);
  const centerBack = idx.byCell[0][1];
  assert.equal(centerBack.length, 3);
  assert.equal(centerBack[2].number, 16);
});

test('un posto con 3 banchi al centro ha banchi numerati 1..3', () => {
  const s = stateWith([[2, 3, 2], [2, 2, 2], [2, 2, 1]]);
  const idx = C.buildSeatIndex(s);
  assert.deepEqual(idx.byCell[0][1].map((x) => x.banco), [1, 2, 3]);
});

test('parser: accetta spazi, virgole, slash e trattini', () => {
  let r = C.parseLayoutText('2 3 2\n2,2,2\n2 2 1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.layout, [[2, 3, 2], [2, 2, 2], [2, 2, 1]]);
  r = C.parseLayoutText('2 3 2 / 2 2 2 / 2 2 1');
  assert.equal(r.ok, true);
  assert.equal(r.layout.length, 3);
  r = C.parseLayoutText('2 3 x\n2 - 1');
  assert.equal(r.ok, true);
  assert.deepEqual(r.layout, [[2, 3, 0], [2, 0, 1]]);
});

test('parser: segnala righe di lunghezza diversa e valori non numerici', () => {
  let r = C.parseLayoutText('2 3\n2 2 2');
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  r = C.parseLayoutText('2 a 2');
  assert.equal(r.ok, false);
  r = C.parseLayoutText('');
  assert.equal(r.ok, false);
});

test('parser: rifiuta più di 12 banchi e 13 colonne', () => {
  assert.equal(C.parseLayoutText('13').ok, false);
  assert.equal(C.parseLayoutText(Array(13).fill('1').join(' ')).ok, false);
});

test('aggiunta alunni: deduplica per nome, anche con accenti', () => {
  let s = C.createState();
  let r = C.addStudentsFromText(s, 'Mario Rossi\nLuca Bianchi\nmario rossi\nNicolò Verdi\n');
  assert.equal(r.added.length, 3);
  assert.equal(r.duplicates.length, 1);
  s = r.state;
  r = C.addStudentsFromText(s, 'NICOLO VERDI');
  assert.equal(r.added.length, 0);
  assert.equal(r.duplicates.length, 1);
});

test('l’elenco degli alunni è sempre in ordine alfabetico', () => {
  let s = C.createState();
  s = C.addStudentsFromText(s, 'Zoe\nanna\nMarco\nÀlvaro\nbianchi\nAlunno 10\nAlunno 2').state;
  assert.deepEqual(s.students.map(function (x) { return x.name; }),
    ['Alunno 2', 'Alunno 10', 'Àlvaro', 'anna', 'bianchi', 'Marco', 'Zoe']);
});

test('aggiunta singola e rinomina riordinano subito l’elenco', () => {
  let s = C.createState();
  s = C.addStudent(s, 'Zoe').state;
  s = C.addStudent(s, 'anna').state;
  s = C.addStudent(s, 'Marco').state;
  assert.deepEqual(s.students.map(function (x) { return x.name; }), ['anna', 'Marco', 'Zoe']);
  const zoe = s.students.find(function (x) { return x.name === 'Zoe'; });
  s = C.renameStudent(s, zoe.id, 'Aaron').state;
  assert.deepEqual(s.students.map(function (x) { return x.name; }), ['Aaron', 'anna', 'Marco']);
});

test('anche i file già salvati vengono riordinati all’apertura', () => {
  const s = C.sanitizeState({
    layout: [[2]],
    students: [
      { id: 'z', name: 'Zoe' },
      { id: 'a', name: 'anna' },
      { id: 'm', name: 'Marco' },
    ],
    seats: { '0:0:0': 'z', '0:0:1': 'm' },
  });
  assert.deepEqual(s.students.map(function (x) { return x.name; }), ['anna', 'Marco', 'Zoe']);
  assert.equal(s.seats['0:0:0'], 'z');
  assert.equal(s.seats['0:0:1'], 'm');
});

test('assegna un alunno e svuota il posto', () => {
  const s0 = stateWith([[1]]);
  const a = add(s0, 'Anna Neri');
  let s = a.s;
  let r = C.assignSeat(s, '0:0:0', a.id);
  assert.equal(r.error, null);
  s = r.state;
  assert.equal(s.seats['0:0:0'], a.id);
  assert.equal(C.stats(s).assigned, 1);
  r = C.clearSeat(s, '0:0:0');
  s = r.state;
  assert.equal(s.seats['0:0:0'], undefined);
});

test('spostare un alunno in un posto occupato scambia i due', () => {
  let s = stateWith([[2]]);
  const a = add(s, 'Anna'); s = a.s;
  const b = add(s, 'Bruno'); s = b.s;
  s = C.assignSeat(s, '0:0:0', a.id).state;
  s = C.assignSeat(s, '0:0:1', b.id).state;
  const r = C.assignSeat(s, '0:0:1', a.id);
  assert.equal(r.info.displacedTo != null, true);
  s = r.state;
  assert.equal(s.seats['0:0:1'], a.id);
  assert.equal(s.seats['0:0:0'], b.id);
});

test('spostare un alunno in un posto occupato senza posto precedente libera l’occupante', () => {
  let s = stateWith([[1]]);
  const a = add(s, 'Anna'); s = a.s;
  const b = add(s, 'Bruno'); s = b.s;
  s = C.assignSeat(s, '0:0:0', a.id).state;
  s = C.assignSeat(s, '0:0:0', b.id).state;
  assert.equal(s.seats['0:0:0'], b.id);
  assert.equal(Object.values(s.seats).includes(a.id), false);
});

test('disposizione automatica riempie dal posto 1 e lascia i non assegnati', () => {
  let s = stateWith([[1, 1], [1]]);
  s = C.addStudentsFromText(s, 'A\nB\nC\nD').state;
  const r = C.autoAssign(s, { keepExisting: false });
  s = r.state;
  assert.equal(r.assigned, 3);
  assert.equal(r.remainingStudents, 1);
  const idx = C.buildSeatIndex(s);
  assert.equal(s.seats['1:0:0'], s.students[0].id);
  assert.equal(s.seats['0:0:0'], s.students[1].id);
  assert.equal(s.seats['0:1:0'], s.students[2].id);
  assert.equal(Object.values(s.seats).includes(s.students[3].id), false);
});

test('disposizione automatica mantiene gli assegnamenti esistenti', () => {
  let s = stateWith([[2]]);
  const a = add(s, 'Anna'); s = a.s;
  const b = add(s, 'Bruno'); s = b.s;
  s = C.assignSeat(s, '0:0:1', b.id).state;
  const r = C.autoAssign(s, { keepExisting: true });
  assert.equal(r.assigned, 1);
  assert.equal(r.state.seats['0:0:1'], b.id);
  assert.equal(r.state.seats['0:0:0'], a.id);
});

test('ridurre le colonne rimuove i posti di destra e libera gli alunni', () => {
  let s = stateWith([[1, 1], [1, 1]]);
  const a = add(s, 'Anna'); s = a.s;
  const b = add(s, 'Bruno'); s = b.s;
  s = C.assignSeat(s, '0:1:0', a.id).state;
  s = C.assignSeat(s, '0:0:0', b.id).state;
  const r = C.resizeLayout(s, 2, 1);
  assert.equal(r.removed.length, 1);
  assert.equal(r.state.layout[0].length, 1);
  assert.equal(r.state.students.length, 2);
  assert.equal(Object.values(r.state.seats).includes(a.id), false);
  assert.equal(r.state.seats['0:0:0'], b.id);
});

test('aggiungere una fila in fondo mantiene gli alunni nelle file esistenti', () => {
  let s = stateWith([[1], [1]]);
  const a = add(s, 'Anna'); s = a.s;
  s = C.assignSeat(s, '0:0:0', a.id).state;
  const r = C.resizeLayout(s, 3, 1);
  assert.equal(r.state.layout.length, 3);
  assert.equal(r.state.seats['1:0:0'], a.id);
  assert.equal(r.state.layout[0].length, 1);
});

test('aggiungere una colonna a destra non sposta i posti', () => {
  let s = stateWith([[1]]);
  const a = add(s, 'Anna'); s = a.s;
  s = C.assignSeat(s, '0:0:0', a.id).state;
  const r = C.resizeLayout(s, 1, 2);
  assert.equal(r.state.layout[0].length, 2);
  assert.equal(r.state.seats['0:0:0'], a.id);
});

test('ridurre i banchi di una cella libera gli alunni in eccesso', () => {
  let s = stateWith([[2]]);
  const a = add(s, 'Anna'); s = a.s;
  const b = add(s, 'Bruno'); s = b.s;
  s = C.assignSeat(s, '0:0:0', a.id).state;
  s = C.assignSeat(s, '0:0:1', b.id).state;
  const r = C.setDeskCount(s, 0, 0, 1);
  assert.deepEqual(r.removed, [b.id]);
  assert.equal(r.state.seats['0:0:0'], a.id);
  assert.equal(r.state.seats['0:0:1'], undefined);
  assert.equal(r.state.students.length, 2);
});

test('sanitizeState scarta posti invalidi e alunni doppi', () => {
  const raw = {
    className: '  3A  ',
    layout: [[2, 1], [1, 1]],
    students: [
      { id: 'a', name: 'Anna' },
      { id: 'b', name: 'anna' },
      { id: 'c', name: '  ' },
      { id: 'a', name: 'Doppio id' },
      { id: 'd', name: 'Carla' },
    ],
    seats: {
      '0:0:0': 'a',
      '0:0:1': 'a',
      '9:9:9': 'c',
      '0:1:0': 'd',
      '1:0:0': 'sconosciuto',
    },
  };
  const s = C.sanitizeState(raw);
  assert.equal(s.className, '3A');
  assert.equal(s.students.length, 3);
  assert.equal(s.layout.length, 2);
  assert.equal(s.seats['0:0:0'], 'a');
  assert.equal(s.seats['0:0:1'], undefined);
  assert.equal(s.seats['0:1:0'], 'd');
  assert.equal(s.seats['1:0:0'], undefined);
});

test('sanitizeState accetta il wrapper del progetto', () => {
  const s = C.sanitizeState({ app: 'cartina-di-classe', version: 1, data: { layout: [[1]], students: [{ id: 'a', name: 'A' }], seats: { '0:0:0': 'a' } } });
  assert.equal(s.students.length, 1);
  assert.equal(s.seats['0:0:0'], 'a');
});

test('formatta i nomi in modalità nome/cognome/iniziali', () => {
  assert.equal(C.formatStudentName('Mario Rossi', 'full'), 'Mario Rossi');
  assert.equal(C.formatStudentName('Mario Rossi', 'first'), 'Mario');
  assert.equal(C.formatStudentName('Mario Rossi', 'last'), 'Rossi');
  assert.equal(C.formatStudentName('Maria Pia Rossi', 'initials'), 'M. P. R.');
});

test('nome file sicuro', () => {
  assert.equal(C.safeFilename('3A / sezione: A'), '3A_sezione_A');
  assert.equal(C.exportFilename({ className: '3A' }, 'chiara', 'png', new Date(2026, 9, 21)), 'Cartina_3A_chiara_2026-10-21.png');
});

test('statistiche', () => {
  let s = stateWith([[2, 1], [1]]);
  s = C.addStudentsFromText(s, 'A\nB\nC\nD').state;
  const a = C.studentById(s, s.students[0].id);
  s = C.assignSeat(s, '1:0:0', a.id).state;
  const st = C.stats(s);
  assert.equal(st.capacity, 4);
  assert.equal(st.assigned, 1);
  assert.equal(st.empty, 3);
  assert.equal(st.students, 4);
  assert.equal(st.unassigned, 3);
});
