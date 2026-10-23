/* Cartina di Classe — core puro (nessuna dipendenza) */
(function (global) {
  'use strict';

  const CC = (global.CC = global.CC || {});
  const VERSION = 1;
  const LIMITS = Object.freeze({ rows: 20, cols: 12, desksPerCell: 12, students: 500 });
  const APP_ID = 'cartina-di-classe';

  /* ------------------------------------------------------------------ */
  /* Utility                                                             */
  /* ------------------------------------------------------------------ */

  function newId(prefix) {
    let rnd;
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      rnd = global.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    } else {
      rnd = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }
    return (prefix || 's') + '_' + rnd;
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function normalizeName(name) {
    return String(name == null ? '' : name)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanName(name) {
    return String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function sanitizeWindowsSide(value) {
    return value === 'left' || value === 'right' ? value : 'none';
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  function seatKey(r, c, d) {
    return r + ':' + c + ':' + d;
  }

  function parseSeatKey(key) {
    const m = /^(\d+):(\d+):(\d+)$/.exec(String(key));
    if (!m) return null;
    return { r: Number(m[1]), c: Number(m[2]), d: Number(m[3]) };
  }

  /* ------------------------------------------------------------------ */
  /* Stato                                                               */
  /* ------------------------------------------------------------------ */

  function defaultLayout(rows, cols, desks) {
    const R = clampInt(rows == null ? 3 : rows, 1, LIMITS.rows, 3);
    const C = clampInt(cols == null ? 3 : cols, 1, LIMITS.cols, 3);
    const D = clampInt(desks == null ? 2 : desks, 0, LIMITS.desksPerCell, 2);
    const out = [];
    for (let r = 0; r < R; r++) {
      const row = [];
      for (let c = 0; c < C; c++) row.push(D);
      out.push(row);
    }
    return out;
  }

  function createState(options) {
    const o = options || {};
    return {
      version: VERSION,
      className: cleanName(o.className || ''),
      windowsSide: sanitizeWindowsSide(o.windowsSide),
      layout: o.layout ? sanitizeLayout(o.layout) : defaultLayout(o.rows, o.cols, o.desks),
      students: [],
      seats: {},
    };
  }

  function sanitizeLayout(layout) {
    if (!Array.isArray(layout) || layout.length === 0) return defaultLayout();
    const rows = Math.min(layout.length, LIMITS.rows);
    let cols = 0;
    layout.slice(0, rows).forEach(function (row) {
      if (Array.isArray(row)) cols = Math.max(cols, Math.min(row.length, LIMITS.cols));
    });
    if (cols === 0) return defaultLayout();
    const out = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const raw = Array.isArray(layout[r]) ? layout[r][c] : undefined;
        row.push(clampInt(raw, 0, LIMITS.desksPerCell, 0));
      }
      out.push(row);
    }
    return out;
  }

  function sanitizeState(raw) {
    const source = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
    if (!source || typeof source !== 'object') throw new Error('Il file non contiene una planimetria valida.');
    const state = createState({ className: typeof source.className === 'string' ? source.className : '' });
    state.layout = sanitizeLayout(source.layout);
    state.windowsSide = sanitizeWindowsSide(source.windowsSide);

    const seenIds = new Set();
    const seenNames = new Set();
    const inputStudents = Array.isArray(source.students) ? source.students.slice(0, LIMITS.students) : [];
    for (const s of inputStudents) {
      if (!s || typeof s !== 'object') continue;
      const name = cleanName(s.name);
      if (!name) continue;
      let id = typeof s.id === 'string' && s.id ? s.id : newId();
      if (seenIds.has(id)) id = newId();
      const nn = normalizeName(name);
      if (seenNames.has(nn)) continue;
      seenIds.add(id);
      seenNames.add(nn);
      state.students.push({ id: id, name: name });
    }

    // L'elenco è sempre in ordine alfabetico, qualunque sia l'ordine di inserimento.
    state.students.sort(compareStudents);

    const byId = new Map(state.students.map(function (s) { return [s.id, s]; }));
    const used = new Set();
    const seats = source.seats && typeof source.seats === 'object' ? source.seats : {};
    const orderedKeys = Object.keys(seats).sort();
    for (const key of orderedKeys) {
      const pos = parseSeatKey(key);
      if (!pos) continue;
      if (pos.r < 0 || pos.r >= state.layout.length) continue;
      if (pos.c < 0 || pos.c >= state.layout[0].length) continue;
      if (pos.d < 0 || pos.d >= state.layout[pos.r][pos.c]) continue;
      const sid = seats[key];
      if (typeof sid !== 'string' || !byId.has(sid) || used.has(sid)) continue;
      used.add(sid);
      state.seats[key] = sid;
    }
    return state;
  }

  function seatCapacity(layout) {
    let n = 0;
    for (const row of layout) for (const v of row) n += v;
    return n;
  }

  function maxDesksPerColumn(layout) {
    const cols = layout[0].length;
    const out = new Array(cols).fill(0);
    for (const row of layout) {
      for (let c = 0; c < cols; c++) out[c] = Math.max(out[c], row[c] || 0);
    }
    return out;
  }

  function findStudentSeat(state, studentId) {
    for (const key of Object.keys(state.seats)) {
      if (state.seats[key] === studentId) return key;
    }
    return null;
  }

  function studentById(state, studentId) {
    return state.students.find(function (s) { return s.id === studentId; }) || null;
  }

  function studentAt(state, key) {
    const id = state.seats[key];
    return id ? studentById(state, id) : null;
  }

  function stats(state) {
    const capacity = seatCapacity(state.layout);
    const assigned = Math.min(Object.keys(state.seats).length, capacity);
    return {
      rows: state.layout.length,
      cols: state.layout[0] ? state.layout[0].length : 0,
      capacity: capacity,
      assigned: assigned,
      empty: Math.max(0, capacity - assigned),
      students: state.students.length,
      unassigned: Math.max(0, state.students.length - assigned),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Etichette e numerazione                                             */
  /* ------------------------------------------------------------------ */

  function columnShort(c, cols) {
    if (cols === 3) return ['Sinistra', 'Centro', 'Destra'][c] || ('Colonna ' + (c + 1));
    return 'Colonna ' + (c + 1);
  }

  function columnLong(c, cols) {
    if (cols === 3) {
      return ['sinistra (vista dal docente)', 'centro', 'destra (vista dal docente)'][c] ||
        ('colonna ' + (c + 1) + ' da sinistra');
    }
    return 'colonna ' + (c + 1) + ' da sinistra (vista dal docente)';
  }

  function rowLabel(r, rows) {
    const fila = rows - r;
    if (rows === 1) return 'Unica fila';
    if (r === rows - 1) return 'Prima fila';
    if (r === 0) return 'Ultima fila';
    return 'Fila ' + fila;
  }

  function rowLabelLong(r, rows) {
    const fila = rows - r;
    if (rows === 1) return 'unica fila';
    if (r === rows - 1) return 'fila 1 (prima fila, davanti alla lavagna)';
    if (r === 0) return 'fila ' + fila + ' (ultima fila, fondo aula)';
    return 'fila ' + fila;
  }

  /**
   * Costruisce l'indice dei posti. La numerazione parte dalla prima fila
   * (davanti alla lavagna) e procede da sinistra a destra, fila per fila.
   * Ogni posto contiene coordinate, etichette e alunno assegnato.
   */
  function buildSeatIndex(state) {
    const layout = state.layout;
    const rows = layout.length;
    const cols = layout[0].length;
    const seats = [];
    const byKey = new Map();
    const byCell = [];
    const byStudent = new Map();
    let number = 0;

    for (let r = 0; r < rows; r++) {
      byCell[r] = [];
      for (let c = 0; c < cols; c++) byCell[r][c] = [];
    }

    for (let r = rows - 1; r >= 0; r--) {
      for (let c = 0; c < cols; c++) {
        const count = layout[r][c] || 0;
        for (let d = 0; d < count; d++) {
          number += 1;
          const key = seatKey(r, c, d);
          const sid = state.seats[key];
          const student = sid ? studentById(state, sid) : null;
          const rowLabelLongText = rowLabelLong(r, rows);
          const colLongText = columnLong(c, cols);
          const seat = {
            key: key,
            r: r,
            c: c,
            d: d,
            number: number,
            fila: rows - r,
            colonna: c + 1,
            banco: d + 1,
            rowLabel: rowLabel(r, rows),
            rowLabelLong: rowLabelLongText,
            colShort: columnShort(c, cols),
            colLong: colLongText,
            student: student,
            locationText: capitalise(rowLabelLongText) + ', ' + colLongText + ', banco ' + (d + 1) + '.',
            aria: '',
          };
          seat.aria = 'Posto ' + seat.number + '. ' + seat.locationText + ' ' +
            (student ? student.name : 'Libero.');
          seats.push(seat);
          byKey.set(key, seat);
          byCell[r][c].push(seat);
          if (student) byStudent.set(student.id, seat);
        }
      }
    }

    return {
      rows: rows,
      cols: cols,
      seats: seats,
      byKey: byKey,
      byCell: byCell,
      byStudent: byStudent,
      maxPerCol: maxDesksPerColumn(layout),
    };
  }

  function capitalise(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  }

  /* ------------------------------------------------------------------ */
  /* Alunni                                                              */
  /* ------------------------------------------------------------------ */

  // Ordine alfabetico italiano: ignora maiuscole/minuscole e accenti,
  // ma tiene conto dei numeri (Alunno 2 prima di Alunno 10).
  function compareStudents(a, b) {
    const nameA = a && typeof a.name === 'string' ? a.name : '';
    const nameB = b && typeof b.name === 'string' ? b.name : '';
    return nameA.localeCompare(nameB, 'it', { sensitivity: 'base', numeric: true });
  }

  function sortStudentsByName(students) {
    return students.slice().sort(compareStudents);
  }

  function findStudentsByName(state, name) {
    const nn = normalizeName(name);
    if (!nn) return [];
    return state.students.filter(function (s) { return normalizeName(s.name) === nn; });
  }

  function addStudent(state, name) {
    const next = clone(state);
    const clean = cleanName(name);
    if (!clean) return { state: next, student: null, created: false, error: 'Il nome è vuoto.' };
    const existing = findStudentsByName(next, clean);
    if (existing.length) {
      return { state: next, student: existing[0], created: false, error: null };
    }
    if (next.students.length >= LIMITS.students) {
      return { state: next, student: null, created: false, error: 'Hai raggiunto il limite di ' + LIMITS.students + ' alunni.' };
    }
    const student = { id: newId(), name: clean };
    next.students.push(student);
    next.students.sort(compareStudents);
    return { state: next, student: student, created: true, error: null };
  }

  function addStudentsFromText(state, text) {
    const next = clone(state);
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const added = [];
    const duplicates = [];
    let empty = 0;
    for (const line of lines) {
      const clean = cleanName(line.replace(/\t.*$/, ''));
      if (!clean) { empty += 1; continue; }
      const existing = findStudentsByName(next, clean);
      if (existing.length) { duplicates.push(clean); continue; }
      if (next.students.length >= LIMITS.students) break;
      const student = { id: newId(), name: clean };
      next.students.push(student);
      added.push(student);
    }
    next.students.sort(compareStudents);
    return { state: next, added: added, duplicates: duplicates, empty: empty };
  }

  function renameStudent(state, studentId, name) {
    const next = clone(state);
    const student = studentById(next, studentId);
    if (!student) return { state: next, error: 'Alunno non trovato.' };
    const clean = cleanName(name);
    if (!clean) return { state: next, error: 'Il nome non può essere vuoto.' };
    const other = findStudentsByName(next, clean).find(function (s) { return s.id !== studentId; });
    if (other) return { state: next, error: 'Esiste già un alunno con questo nome.' };
    student.name = clean;
    next.students.sort(compareStudents);
    return { state: next, error: null };
  }

  function removeStudent(state, studentId) {
    const next = clone(state);
    next.students = next.students.filter(function (s) { return s.id !== studentId; });
    for (const key of Object.keys(next.seats)) {
      if (next.seats[key] === studentId) delete next.seats[key];
    }
    return next;
  }

  function sortStudents(state, mode) {
    const next = clone(state);
    if (mode === 'az') next.students.sort(compareStudents);
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* Assegnazioni                                                        */
  /* ------------------------------------------------------------------ */

  function assignSeat(state, key, studentId) {
    const index = buildSeatIndex(state);
    if (!index.byKey.has(key)) return { state: state, error: 'Posto non valido.', info: null };
    const student = studentById(state, studentId);
    if (!student) return { state: state, error: 'Alunno non trovato.', info: null };
    if (state.seats[key] === studentId) return { state: state, error: null, info: null };

    const next = clone(state);
    const oldKey = findStudentSeat(next, studentId);
    const occupantId = next.seats[key] || null;
    let displacedTo = null;

    if (occupantId) {
      delete next.seats[key];
      if (oldKey && oldKey !== key) {
        next.seats[oldKey] = occupantId;
        displacedTo = oldKey;
      }
    } else if (oldKey) {
      delete next.seats[oldKey];
    }
    next.seats[key] = studentId;

    const target = index.byKey.get(key);
    const oldSeat = oldKey ? index.byKey.get(oldKey) : null;
    return {
      state: next,
      error: null,
      info: {
        student: student,
        to: target,
        from: oldSeat,
        displacedTo: displacedTo ? index.byKey.get(displacedTo) : null,
        occupantId: occupantId,
      },
    };
  }

  function clearSeat(state, key) {
    if (!state.seats[key]) return { state: state, info: null };
    const index = buildSeatIndex(state);
    const student = studentAt(state, key);
    const next = clone(state);
    delete next.seats[key];
    return { state: next, info: { student: student, at: index.byKey.get(key) } };
  }

  function autoAssign(state, options) {
    const o = options || {};
    const next = clone(state);
    if (!o.keepExisting) next.seats = {};
    const index = buildSeatIndex(next);
    const assignedIds = new Set(Object.values(next.seats));
    let students = next.students.filter(function (s) { return !assignedIds.has(s.id); });
    if (o.sort === 'az') {
      students = students.slice().sort(function (a, b) {
        return a.name.localeCompare(b.name, 'it', { sensitivity: 'base', numeric: true });
      });
    }
    const emptySeats = index.seats.filter(function (s) { return !next.seats[s.key]; });
    let assigned = 0;
    for (let i = 0; i < emptySeats.length && i < students.length; i++) {
      next.seats[emptySeats[i].key] = students[i].id;
      assigned += 1;
    }
    return {
      state: next,
      assigned: assigned,
      remainingStudents: Math.max(0, students.length - assigned),
      remainingSeats: Math.max(0, emptySeats.length - assigned),
    };
  }

  function nextEmptySeatKey(state) {
    const index = buildSeatIndex(state);
    const seat = index.seats.find(function (s) { return !state.seats[s.key]; });
    return seat ? seat.key : null;
  }

  /* ------------------------------------------------------------------ */
  /* Disposizione                                                        */
  /* ------------------------------------------------------------------ */

  function setDeskCount(state, r, c, count) {
    const next = clone(state);
    if (!next.layout[r] || next.layout[r][c] == null) {
      return { state: next, error: 'Cella non valida.', removed: [] };
    }
    const value = clampInt(count, 0, LIMITS.desksPerCell, next.layout[r][c]);
    const old = next.layout[r][c];
    if (value === old) return { state: next, error: null, removed: [] };
    next.layout[r][c] = value;
    const removed = [];
    if (value < old) {
      for (let d = value; d < old; d++) {
        const key = seatKey(r, c, d);
        if (next.seats[key]) {
          removed.push(next.seats[key]);
          delete next.seats[key];
        }
      }
    }
    return { state: next, error: null, removed: removed };
  }

  function resizeLayout(state, rows, cols) {
    const next = clone(state);
    const oldRows = next.layout.length;
    const oldCols = next.layout[0].length;
    const R = clampInt(rows, 1, LIMITS.rows, oldRows);
    const C = clampInt(cols, 1, LIMITS.cols, oldCols);
    if (R === oldRows && C === oldCols) return { state: next, removed: [] };

    let layout;
    const seatMap = next.seats;
    const newSeats = {};
    const removed = [];

    if (R > oldRows) {
      // Le file nuove si aggiungono in fondo (lato aula lontano dalla lavagna),
      // quindi in cima alla matrice. Le file esistenti slittano di (R-oldRows).
      const shift = R - oldRows;
      layout = [];
      const template = next.layout[0] ? next.layout[0].slice(0, C) : [];
      for (let i = 0; i < shift; i++) {
        const row = [];
        for (let c = 0; c < C; c++) row.push(template[c] != null ? template[c] : 2);
        layout.push(row);
      }
      for (let r = 0; r < oldRows; r++) {
        const row = [];
        for (let c = 0; c < C; c++) row.push(c < oldCols ? next.layout[r][c] : (next.layout[r][oldCols - 1] || 2));
        layout.push(row);
      }
      for (const key of Object.keys(seatMap)) {
        const pos = parseSeatKey(key);
        if (!pos || pos.c >= C) { removed.push(seatMap[key]); continue; }
        newSeats[seatKey(pos.r + shift, pos.c, pos.d)] = seatMap[key];
      }
    } else if (R < oldRows) {
      // Si rimuovono le file dal fondo (in cima alla matrice).
      const remove = oldRows - R;
      layout = [];
      for (let r = remove; r < oldRows; r++) {
        const row = [];
        for (let c = 0; c < C; c++) row.push(c < oldCols ? next.layout[r][c] : (next.layout[r][oldCols - 1] || 2));
        layout.push(row);
      }
      for (const key of Object.keys(seatMap)) {
        const pos = parseSeatKey(key);
        if (!pos || pos.r < remove || pos.c >= C) { removed.push(seatMap[key]); continue; }
        newSeats[seatKey(pos.r - remove, pos.c, pos.d)] = seatMap[key];
      }
    } else {
      layout = [];
      for (let r = 0; r < R; r++) {
        const row = [];
        for (let c = 0; c < C; c++) {
          if (c < oldCols) row.push(next.layout[r][c]);
          else row.push(next.layout[r][oldCols - 1] != null ? next.layout[r][oldCols - 1] : 2);
        }
        layout.push(row);
      }
      for (const key of Object.keys(seatMap)) {
        const pos = parseSeatKey(key);
        if (!pos || pos.c >= C) { removed.push(seatMap[key]); continue; }
        newSeats[key] = seatMap[key];
      }
    }

    // Rimuove posti eccedenti la capienza delle celle (es. se una cella non
    // ha abbastanza banchi nella nuova disposizione).
    for (const key of Object.keys(newSeats)) {
      const pos = parseSeatKey(key);
      if (!pos || !layout[pos.r] || pos.d >= (layout[pos.r][pos.c] || 0)) {
        removed.push(newSeats[key]);
        delete newSeats[key];
      }
    }

    next.layout = layout;
    next.seats = newSeats;
    return { state: next, removed: removed };
  }

  function parseLayoutText(text) {
    const raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (!raw.trim()) return { ok: false, layout: null, errors: ['Inserisci almeno una riga di numeri.'] };
    const normalized = raw.replace(/\//g, '\n');
    const lines = normalized.split('\n');
    const rows = [];
    const errors = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      const tokens = line.split(/[\s,;|]+/).filter(Boolean);
      if (!tokens.length) continue;
      const row = [];
      for (const token of tokens) {
        if (/^[xX._-]$/.test(token)) { row.push(0); continue; }
        if (!/^\d+$/.test(token)) {
          errors.push('Riga ' + (rows.length + 1) + ': "' + token + '" non è un numero.');
          row.push(NaN);
          continue;
        }
        const n = Number(token);
        if (n > LIMITS.desksPerCell) {
          errors.push('Riga ' + (rows.length + 1) + ': massimo ' + LIMITS.desksPerCell + ' banchi per cella.');
          row.push(NaN);
        } else {
          row.push(n);
        }
      }
      rows.push(row);
    }
    if (!rows.length) errors.push('Nessuna riga valida trovata.');
    if (rows.length > LIMITS.rows) errors.push('Massimo ' + LIMITS.rows + ' file.');
    const cols = rows[0] ? rows[0].length : 0;
    if (cols > LIMITS.cols) errors.push('Massimo ' + LIMITS.cols + ' colonne.');
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].length !== cols) {
        errors.push('La riga ' + (i + 1) + ' ha ' + rows[i].length + ' numeri invece di ' + cols + '.');
      }
    }
    if (errors.length) return { ok: false, layout: null, errors: errors };
    const warnings = [];
    const max = Math.max.apply(null, rows.map(function (r) { return Math.max.apply(null, r); }));
    if (max > 6) warnings.push('Ci sono gruppi con più di 6 banchi: sulla mappa i nomi saranno piccoli.');
    return { ok: true, layout: rows, errors: [], warnings: warnings };
  }

  function formatLayoutText(layout) {
    return layout.map(function (row) { return row.join('  '); }).join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Nomi visualizzati                                                   */
  /* ------------------------------------------------------------------ */

  function formatStudentName(name, mode) {
    const clean = cleanName(name);
    if (!clean) return '';
    const parts = clean.split(' ');
    if (mode === 'first') return parts[0];
    if (mode === 'last') return parts[parts.length - 1];
    if (mode === 'initials') {
      return parts.map(function (p) { return p.charAt(0).toUpperCase() + '.'; }).join(' ');
    }
    return clean;
  }

  function seatDisplayName(seat, mode) {
    return seat.student ? formatStudentName(seat.student.name, mode) : '';
  }

  /* ------------------------------------------------------------------ */
  /* File                                                                */
  /* ------------------------------------------------------------------ */

  function projectPayload(state) {
    return {
      app: APP_ID,
      version: VERSION,
      savedAt: new Date().toISOString(),
      data: state,
    };
  }

  function safeFilename(text, fallback) {
    const clean = String(text || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._\s]+|[._\s]+$/g, '')
      .slice(0, 80);
    return clean || (fallback || 'cartina');
  }

  function dateStamp(date) {
    const d = date || new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function exportFilename(state, variant, ext, date) {
    const base = 'Cartina_' + safeFilename(state.className || 'classe', 'classe') +
      '_' + variant + '_' + dateStamp(date);
    return base + '.' + (ext || 'png');
  }

  function formatDateIt(date) {
    const d = date || new Date();
    const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  CC.core = {
    VERSION: VERSION,
    LIMITS: LIMITS,
    APP_ID: APP_ID,
    newId: newId,
    clone: clone,
    clampInt: clampInt,
    normalizeName: normalizeName,
    cleanName: cleanName,
    sanitizeWindowsSide: sanitizeWindowsSide,
    plural: plural,
    seatKey: seatKey,
    parseSeatKey: parseSeatKey,
    defaultLayout: defaultLayout,
    createState: createState,
    sanitizeLayout: sanitizeLayout,
    sanitizeState: sanitizeState,
    seatCapacity: seatCapacity,
    maxDesksPerColumn: maxDesksPerColumn,
    findStudentSeat: findStudentSeat,
    studentById: studentById,
    studentAt: studentAt,
    stats: stats,
    columnShort: columnShort,
    columnLong: columnLong,
    rowLabel: rowLabel,
    rowLabelLong: rowLabelLong,
    buildSeatIndex: buildSeatIndex,
    compareStudents: compareStudents,
    sortStudentsByName: sortStudentsByName,
    findStudentsByName: findStudentsByName,
    addStudent: addStudent,
    addStudentsFromText: addStudentsFromText,
    renameStudent: renameStudent,
    removeStudent: removeStudent,
    sortStudents: sortStudents,
    assignSeat: assignSeat,
    clearSeat: clearSeat,
    autoAssign: autoAssign,
    nextEmptySeatKey: nextEmptySeatKey,
    setDeskCount: setDeskCount,
    resizeLayout: resizeLayout,
    parseLayoutText: parseLayoutText,
    formatLayoutText: formatLayoutText,
    formatStudentName: formatStudentName,
    seatDisplayName: seatDisplayName,
    projectPayload: projectPayload,
    safeFilename: safeFilename,
    dateStamp: dateStamp,
    exportFilename: exportFilename,
    formatDateIt: formatDateIt,
  };
})(typeof window !== 'undefined' ? window : globalThis);
