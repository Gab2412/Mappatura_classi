/* Cartina di Classe — disegno della mappa a schermo */
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

  function activeColumns(layout, maxPerCol) {
    const cols = layout[0] ? layout[0].length : 0;
    const out = [];
    for (let c = 0; c < cols; c++) {
      if (maxPerCol[c] > 0) out.push(c);
    }
    return out;
  }

  function deskName(seat, settings) {
    return core.seatDisplayName(seat, settings.nameMode);
  }

  function rowVisualLabel(r, rows) {
    if (rows === 1) return { name: 'Unica fila', note: 'fronte e fondo' };
    const n = rows - r;
    if (r === 0) return { name: 'Fila ' + n, note: 'ultima · fondo' };
    if (r === rows - 1) return { name: 'Fila ' + n, note: 'prima · lavagna' };
    return { name: 'Fila ' + n, note: ' ' };
  }

  function columnVisualLabel(c, cols) {
    if (cols === 3) return ['Sinistra', 'Centro', 'Destra'][c];
    if (cols === 2) return ['Sinistra', 'Destra'][c];
    if (cols === 1) return 'Unica colonna';
    return 'Colonna ' + (c + 1);
  }

  function renderMapMarkup(state, settings) {
    const index = core.buildSeatIndex(state);
    const st = core.stats(state);
    const active = activeColumns(state.layout, index.maxPerCol);
    const totalUnits = active.reduce(function (sum, c) { return sum + index.maxPerCol[c]; }, 0);
    const classLabel = state.className ? state.className : 'Classe senza nome';
    const colGaps = Math.max(0, active.length - 1);
    const minWidth = totalUnits > 0 ? 'calc(' + totalUnits + ' * 3.5rem + ' + colGaps + ' * 1.6rem + 10rem)' : '0';

    let html = '';
    html += '<div class="map-print-head">';
    html += '<div><p class="map-kicker">Cartina di Classe</p><h3 class="map-class-name">' + esc(classLabel) + '</h3></div>';
    html += '<p class="map-view-note">Vista dal docente<br>la lavagna è in basso</p>';
    html += '</div>';

    if (st.capacity === 0 || active.length === 0) {
      html += '<div class="map-empty-state">';
      html += '<h3>Nessun banco da mostrare</h3>';
      html += '<p>Apri la scheda <strong>Banchi</strong> e aggiungi almeno un banco a una cella.</p>';
      html += '<button type="button" class="btn btn-primary" data-action="go-layout">Vai alla scheda Banchi</button>';
      html += '</div>';
      return wrapSheet(html, minWidth, settings, state.windowsSide);
    }

    if (state.windowsSide === 'left' || state.windowsSide === 'right') {
      html += '<p class="map-windows-note is-' + state.windowsSide + '">' +
        '<span class="map-windows-bar" aria-hidden="true"></span>Finestre a ' +
        (state.windowsSide === 'left' ? 'sinistra' : 'destra') + '</p>';
    }

    html += '<p class="map-top-note">Fondo aula · ultima fila</p>';
    const template = ['auto'].concat(active.map(function (c) { return index.maxPerCol[c] + 'fr'; })).join(' ');
    html += '<div class="map-grid" style="grid-template-columns:' + esc(template) + '" role="group" aria-label="Mappa dei banchi. ' +
      esc(classLabel) + '.">';

    html += '<div class="map-corner" aria-hidden="true"></div>';
    active.forEach(function (c) {
      html += '<div class="map-col-label">' + esc(columnVisualLabel(c, index.cols)) + '</div>';
    });

    for (let r = 0; r < index.rows; r++) {
      const rowHasSeats = active.some(function (c) { return (state.layout[r][c] || 0) > 0; });
      if (!rowHasSeats) continue;
      const rl = rowVisualLabel(r, index.rows);
      html += '<div class="map-row-label"><span class="fila-name">' + esc(rl.name) + '</span><span class="fila-note">' + esc(rl.note) + '</span></div>';

      active.forEach(function (c) {
        const count = state.layout[r][c] || 0;
        const max = index.maxPerCol[c];
        const width = count > 0 ? Math.max(1, Math.round((count / max) * 100000) / 1000) : 0;
        html += '<div class="map-lane">';
        if (count > 0) {
          html += '<div class="desk-group" style="width:' + width + '%">';
          index.byCell[r][c].forEach(function (seat) {
            const empty = !seat.student;
            const name = deskName(seat, settings);
            const title = 'Posto ' + seat.number + ' — ' + (seat.student ? seat.student.name : 'libero');
            html += '<button type="button" class="desk-button' + (empty ? ' is-empty' : '') + '"' +
              ' data-seat-key="' + esc(seat.key) + '"' +
              ' data-r="' + seat.r + '" data-c="' + seat.c + '" data-d="' + seat.d + '" data-number="' + seat.number + '"' +
              ' data-focus-key="desk-' + esc(seat.key) + '"' +
              ' aria-haspopup="dialog" aria-describedby="desk-loc-' + esc(seat.key) + '" title="' + esc(title) + '">' +
              '<span class="desk-number">' + seat.number + '</span>' +
              '<span class="desk-name">' + (empty ? '' : esc(name)) + '</span>' +
              (empty ? '<span class="desk-empty-label">libero</span>' : '') +
              '<span class="sr-only" id="desk-loc-' + esc(seat.key) + '">' + esc(seat.locationText) + '</span>' +
              '</button>';
          });
          html += '</div>';
        }
        html += '</div>';
      });
    }

    html += '</div>';

    html += '<div class="map-board"><span>Lavagna · cattedra</span><span class="board-sub">davanti alla classe · prima fila</span></div>';
    html += '<div class="map-sheet-footer"><span>' + st.capacity + ' ' + core.plural(st.capacity, 'banco', 'banchi') +
      ' · ' + st.assigned + ' ' + core.plural(st.assigned, 'assegnato', 'assegnati') +
      ' · ' + st.empty + ' ' + core.plural(st.empty, 'libero', 'liberi') +
      '</span><span>Vista dal docente</span></div>';

    return wrapSheet(html, minWidth, settings, state.windowsSide);
  }

  function wrapSheet(inner, minWidth, settings, windowsSide) {
    const classes = ['map-sheet'];
    classes.push(settings.showNumbers ? 'show-numbers' : 'hide-numbers');
    classes.push(settings.showEmpty ? 'show-empty' : 'hide-empty');
    if (windowsSide === 'left' || windowsSide === 'right') classes.push('has-windows-' + windowsSide);
    return '<div class="' + classes.join(' ') + '" style="--map-min-width:' + minWidth + '">' + inner + '</div>';
  }

  function renderInto(element, state, settings) {
    if (!element) return;
    element.innerHTML = renderMapMarkup(state, settings);
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', 'Mappa dei banchi di ' + (state.className || 'classe senza nome'));
  }

  function focusByKey(root, key) {
    if (!root || !key) return false;
    const buttons = root.querySelectorAll('.desk-button');
    for (const button of buttons) {
      if (button.getAttribute('data-focus-key') === key) {
        button.focus();
        button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return true;
      }
    }
    return false;
  }

  function bindKeyboard(root) {
    if (!root || root.dataset.keyboardBound === '1') return;
    root.dataset.keyboardBound = '1';
    root.addEventListener('keydown', function (event) {
      const button = event.target.closest && event.target.closest('.desk-button');
      if (!button || !root.contains(button)) return;
      const key = event.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
      const all = Array.from(root.querySelectorAll('.desk-button'));
      if (!all.length) return;
      const r = Number(button.dataset.r);
      const c = Number(button.dataset.c);
      let next = null;

      if (key === 'Home' || key === 'End') {
        const sameRow = all.filter(function (b) { return Number(b.dataset.r) === r; });
        next = key === 'Home' ? sameRow[0] : sameRow[sameRow.length - 1];
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const sameRow = all.filter(function (b) { return Number(b.dataset.r) === r; });
        const idx = sameRow.indexOf(button);
        next = sameRow[idx + (key === 'ArrowRight' ? 1 : -1)] || null;
      } else {
        const targetRow = r + (key === 'ArrowDown' ? 1 : -1);
        const candidates = all.filter(function (b) { return Number(b.dataset.r) === targetRow; });
        if (candidates.length) {
          const currentRect = button.getBoundingClientRect();
          const cx = currentRect.left + currentRect.width / 2;
          let best = null;
          let bestDist = Infinity;
          candidates.forEach(function (b) {
            const rect = b.getBoundingClientRect();
            const dist = Math.abs((rect.left + rect.width / 2) - cx);
            if (dist < bestDist) { bestDist = dist; best = b; }
          });
          next = best;
        }
      }

      if (next) {
        event.preventDefault();
        next.focus();
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }

  CC.mapView = {
    esc: esc,
    renderMapMarkup: renderMapMarkup,
    renderInto: renderInto,
    bindKeyboard: bindKeyboard,
    focusByKey: focusByKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
