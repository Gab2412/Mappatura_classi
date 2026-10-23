/* Cartina di Classe — tabelle di modifica e registro alunni */
(function (global) {
  'use strict';

  const CC = global.CC;
  const core = CC.core;

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function columnHead(c, cols) {
    if (cols === 3) return ['Sinistra', 'Centro', 'Destra'][c];
    if (cols === 2) return ['Sinistra', 'Destra'][c];
    if (cols === 1) return 'Unica colonna';
    return 'Col. ' + (c + 1);
  }

  function rowParts(r, rows) {
    if (rows === 1) return { name: 'Unica fila', note: 'fronte e fondo' };
    const n = rows - r;
    if (r === 0) return { name: 'Fila ' + n, note: 'ultima · fondo' };
    if (r === rows - 1) return { name: 'Fila ' + n, note: 'prima · lavagna' };
    return { name: 'Fila ' + n, note: ' ' };
  }

  function cellAria(r, c, rows, cols, value) {
    const rp = rowParts(r, rows);
    return 'Banchi in ' + rp.name + (rp.note && rp.note.trim() ? ' (' + rp.note + ')' : '') +
      ', ' + columnHead(c, cols) + '. Valore attuale ' + value + '.';
  }

  function renderLayout(state, headEl, bodyEl) {
    const layout = state.layout;
    const rows = layout.length;
    const cols = layout[0].length;

    let head = '<tr><th scope="col"><span class="sr-only">Fila</span></th>';
    for (let c = 0; c < cols; c++) {
      head += '<th scope="col">' + esc(columnHead(c, cols)) + '</th>';
    }
    head += '</tr>';
    headEl.innerHTML = head;

    let body = '';
    for (let r = 0; r < rows; r++) {
      const rp = rowParts(r, rows);
      body += '<tr>';
      body += '<th scope="row"><span class="fila-name">' + esc(rp.name) + '</span><span class="fila-note">' + esc(rp.note) + '</span></th>';
      for (let c = 0; c < cols; c++) {
        const value = layout[r][c];
        const aria = cellAria(r, c, rows, cols, value);
        body += '<td class="layout-cell">';
        body += '<div class="stepper">';
        body += '<button type="button" class="step-btn" data-action="desk-minus" data-r="' + r + '" data-c="' + c +
          '" data-focus-key="desk-minus-' + r + '-' + c + '"' +
          ' aria-label="' + esc('Togli un banco: ' + aria) + '">−</button>';
        body += '<input type="number" min="0" max="12" step="1" inputmode="numeric" value="' + value + '"' +
          ' class="desk-count-input" data-r="' + r + '" data-c="' + c + '"' +
          ' data-focus-key="count-' + r + '-' + c + '"' +
          ' aria-label="' + esc(aria) + '">';
        body += '<button type="button" class="step-btn" data-action="desk-plus" data-r="' + r + '" data-c="' + c +
          '" data-focus-key="desk-plus-' + r + '-' + c + '"' +
          ' aria-label="' + esc('Aggiungi un banco: ' + aria) + '">+</button>';
        body += '</div>';
        body += '</td>';
      }
      body += '</tr>';
    }
    bodyEl.innerHTML = body;

    const rowsInput = global.document.getElementById('rows-input');
    const colsInput = global.document.getElementById('cols-input');
    if (rowsInput) rowsInput.value = rows;
    if (colsInput) colsInput.value = cols;
  }

  function seatLocationText(seat) {
    return 'Posto ' + seat.number + ' · ' + seat.rowLabel + ' · ' + seat.colShort + ' · banco ' + seat.banco;
  }

  function seatLocationShort(seat) {
    return 'Posto ' + seat.number + ' — ' + seat.rowLabel + ', ' + seat.colShort + ', banco ' + seat.banco;
  }

  function normalizeQuery(text) {
    return core.normalizeName(text || '');
  }

  function renderRoster(state, options) {
    const o = options || {};
    const query = normalizeQuery(o.query || '');
    const index = core.buildSeatIndex(state);
    const tbody = o.tbody;
    if (!tbody) return { total: 0, shown: 0 };
    const students = state.students.filter(function (s) {
      return !query || core.normalizeName(s.name).includes(query);
    }).sort(core.compareStudents);

    let html = '';
    students.forEach(function (student) {
      const seat = index.byStudent.get(student.id) || null;
      const actions = [];
      if (seat) {
        actions.push('<button type="button" class="btn btn-roster-seat" data-action="open-desk" data-seat-key="' + esc(seat.key) +
          '" data-focus-key="roster-open-' + esc(student.id) + '">Vai al banco</button>');
        actions.push('<button type="button" class="btn btn-roster-seat" data-action="assign-student" data-student-id="' + esc(student.id) +
          '" data-focus-key="roster-assign-' + esc(student.id) + '">Cambia posto</button>');
      } else {
        actions.push('<button type="button" class="btn btn-roster-seat" data-action="assign-student" data-student-id="' + esc(student.id) +
          '" data-focus-key="roster-assign-' + esc(student.id) + '">Assegna a un posto…</button>');
      }
      actions.push('<button type="button" class="btn btn-roster-seat" data-action="manage-student" data-student-id="' + esc(student.id) +
        '" data-focus-key="roster-manage-' + esc(student.id) + '">Rinomina o rimuovi</button>');

      html += '<tr data-student-row="' + esc(student.id) + '">';
      html += '<td><span class="student-name">' + esc(student.name) + '</span></td>';
      if (seat) {
        html += '<td class="seat-cell"><span class="seat-assigned">Posto ' + seat.number + '</span>' +
          '<span class="seat-sub">' + esc(seat.rowLabel) + ' · ' + esc(seat.colShort) + ' · banco ' + seat.banco + '</span></td>';
      } else {
        html += '<td class="seat-cell"><span class="seat-unassigned">Non assegnato</span></td>';
      }
      html += '<td class="actions-cell">' + actions.join('') + '</td>';
      html += '</tr>';
    });
    tbody.innerHTML = html;

    return {
      total: state.students.length,
      shown: students.length,
      filtered: !!query,
    };
  }

  function renderStudentSuggestions(state, datalist) {
    if (!datalist) return;
    let html = '';
    state.students.slice().sort(core.compareStudents).forEach(function (s) {
      html += '<option value="' + esc(s.name) + '"></option>';
    });
    datalist.innerHTML = html;
  }

  function renderDeskStudentSelect(state, select, currentSeatKey) {
    if (!select) return;
    const index = core.buildSeatIndex(state);
    const assignedElsewhere = [];
    const unassigned = [];
    state.students.slice().sort(core.compareStudents).forEach(function (s) {
      const seat = index.byStudent.get(s.id);
      if (!seat || seat.key === currentSeatKey) {
        if (!seat) unassigned.push({ student: s, seat: null });
      } else {
        assignedElsewhere.push({ student: s, seat: seat });
      }
    });
    const currentSeat = currentSeatKey ? index.byKey.get(currentSeatKey) : null;
    const currentStudent = currentSeat && currentSeat.student ? currentSeat.student : null;

    let html = '<option value="">— Scegli un alunno —</option>';
    if (currentStudent) {
      html += '<option value="' + esc(currentStudent.id) + '">' + esc(currentStudent.name + ' (in questo posto)') + '</option>';
    }
    if (unassigned.length) {
      html += '<optgroup label="Non assegnati">';
      unassigned.forEach(function (item) {
        html += '<option value="' + esc(item.student.id) + '">' + esc(item.student.name) + '</option>';
      });
      html += '</optgroup>';
    }
    if (assignedElsewhere.length) {
      html += '<optgroup label="Già assegnati — verranno spostati">';
      assignedElsewhere.forEach(function (item) {
        html += '<option value="' + esc(item.student.id) + '">' + esc(item.student.name + ' — ' + seatLocationShort(item.seat)) + '</option>';
      });
      html += '</optgroup>';
    }
    select.innerHTML = html;
  }

  function renderSeatSelect(state, select, currentSeatKey) {
    if (!select) return { count: 0 };
    const index = core.buildSeatIndex(state);
    const options = [];
    index.seats.forEach(function (seat) {
      if (!state.seats[seat.key] || seat.key === currentSeatKey) options.push(seat);
    });
    let html = '';
    if (!options.length) {
      html = '<option value="">Nessun posto libero</option>';
    } else {
      html = '<option value="">— Scegli un posto libero —</option>';
      options.forEach(function (seat) {
        const isCurrent = seat.key === currentSeatKey;
        html += '<option value="' + esc(seat.key) + '"' + (isCurrent ? ' selected' : '') + '>' +
          esc(seatLocationShort(seat) + (isCurrent ? ' (posto attuale)' : '')) + '</option>';
      });
    }
    select.innerHTML = html;
    return { count: options.length };
  }

  function seatPositionText(seat) {
    return 'Posto ' + seat.number + ' · ' + seat.rowLabelLong + ' · ' + seat.colLong + ' · banco ' + seat.banco;
  }

  CC.editor = {
    esc: esc,
    columnHead: columnHead,
    rowParts: rowParts,
    renderLayout: renderLayout,
    renderRoster: renderRoster,
    renderStudentSuggestions: renderStudentSuggestions,
    renderDeskStudentSelect: renderDeskStudentSelect,
    renderSeatSelect: renderSeatSelect,
    seatLocationText: seatLocationText,
    seatLocationShort: seatLocationShort,
    seatPositionText: seatPositionText,
    normalizeQuery: normalizeQuery,
  };
})(typeof window !== 'undefined' ? window : globalThis);
