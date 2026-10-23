/* Cartina di Classe — immagini SVG/PNG, stampa, CSV */
(function (global) {
  'use strict';

  const CC = global.CC;
  const core = CC.core;

  const A4 = { w: 1122, h: 793 };
  const M = 46;
  const FONT = "Verdana, Arial, Helvetica, sans-serif";
  const MAX_NAME_SIZE = 19;
  /* Spaziature del disegno: compagni vicini (appiccicati), corridoi ampi tra file e colonne. */
  const LANE_GAP = 52;
  const DESK_GAP = 3;
  const ROW_GAP = 38;

  const PALETTES = {
    light: {
      bg: '#ffffff',
      text: '#000000',
      muted: '#3f4652',
      desk: '#ffffff',
      deskEmpty: '#ffffff',
      border: '#000000',
      emptyBorder: '#4b5563',
      accent: '#003f8f',
      numberBg: '#ffffff',
      footerLine: '#4b5563',
    },
    dark: {
      bg: '#0a111d',
      text: '#f8fafc',
      muted: '#c7d2e3',
      desk: '#12203a',
      deskEmpty: '#0a111d',
      border: '#f8fafc',
      emptyBorder: '#a8b8cc',
      accent: '#ffd54a',
      numberBg: '#12203a',
      footerLine: '#8fa2ba',
    },
  };

  let measureCanvas = null;
  let measureCtx = null;

  function ctx() {
    if (!measureCtx) {
      measureCanvas = global.document.createElement('canvas');
      measureCanvas.width = 8;
      measureCanvas.height = 8;
      measureCtx = measureCanvas.getContext('2d');
    }
    return measureCtx;
  }

  function measure(text, fontSize, weight) {
    const c = ctx();
    c.font = (weight || 600) + ' ' + fontSize + 'px ' + FONT;
    return c.measureText(text).width;
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function wrapLongWord(word, maxWidth, fontSize, weight) {
    const chunks = [];
    let current = '';
    for (const ch of word) {
      const test = current + ch;
      if (current && measure(test, fontSize, weight) > maxWidth) {
        chunks.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current) chunks.push(current);
    return chunks.length ? chunks : [word];
  }

  function wrapText(text, maxWidth, fontSize, weight) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = '';
    for (let word of words) {
      if (measure(word, fontSize, weight) > maxWidth) {
        if (line) { lines.push(line); line = ''; }
        const chunks = wrapLongWord(word, maxWidth, fontSize, weight);
        chunks.forEach(function (chunk, i) {
          if (i === chunks.length - 1) line = chunk;
          else lines.push(chunk);
        });
        continue;
      }
      const test = line ? line + ' ' + word : word;
      if (!line || measure(test, fontSize, weight) <= maxWidth) {
        line = test;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function ellipsize(text, maxWidth, fontSize, weight) {
    let out = text;
    while (out.length > 1 && measure(out + '…', fontSize, weight) > maxWidth) {
      out = out.slice(0, -1);
    }
    return out + '…';
  }

  function fitName(text, maxWidth, maxHeight, baseSize) {
    let size = Math.max(6.5, Math.min(MAX_NAME_SIZE, baseSize));
    for (; size >= 6.3; size -= 0.5) {
      const lines = wrapText(text, maxWidth, size, 700);
      const lh = size * 1.12;
      const maxLines = Math.max(1, Math.min(4, Math.floor((maxHeight - 8) / lh)));
      if (lines.length <= maxLines && lines.length * lh <= maxHeight - 8) {
        return { size: size, lines: lines, lineHeight: lh };
      }
    }
    const finalSize = 6.3;
    const lh = finalSize * 1.12;
    let lines = wrapText(text, maxWidth, finalSize, 700);
    const maxLines = Math.max(1, Math.min(4, Math.floor((maxHeight - 8) / lh)));
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[lines.length - 1] = ellipsize(lines[lines.length - 1], maxWidth, finalSize, 700);
    }
    return { size: finalSize, lines: lines, lineHeight: lh };
  }

  function fitLine(text, maxWidth, startSize, minSize, weight) {
    let size = startSize;
    while (size > minSize && measure(text, size, weight) > maxWidth) size -= 0.5;
    return size;
  }

  function columnName(c, cols) {
    if (cols === 3) return ['SINISTRA', 'CENTRO', 'DESTRA'][c];
    if (cols === 2) return ['SINISTRA', 'DESTRA'][c];
    if (cols === 1) return 'UNICA COLONNA';
    return 'COL. ' + (c + 1);
  }

  function rowName(r, rows) {
    if (rows === 1) return { title: 'UNICA FILA', note: '' };
    const n = rows - r;
    if (r === 0) return { title: 'FILA ' + n, note: 'ultima · fondo' };
    if (r === rows - 1) return { title: 'FILA ' + n, note: 'prima · lavagna' };
    return { title: 'FILA ' + n, note: '' };
  }

  function buildSvg(state, settings, variant, options) {
    const o = options || {};
    // Dimensione su misura: se non richiesta si usa il foglio A4 orizzontale.
    const size = o.size && o.size.w > 0 && o.size.h > 0
      ? { w: Math.round(o.size.w), h: Math.round(o.size.h) }
      : { w: A4.w, h: A4.h };
    const W = size.w;
    const H = size.h;
    const palette = PALETTES[variant === 'dark' ? 'dark' : 'light'];
    const st = core.stats(state);
    const index = core.buildSeatIndex(state);
    const active = [];
    for (let c = 0; c < index.cols; c++) if (index.maxPerCol[c] > 0) active.push(c);
    const uid = 'cc' + Math.random().toString(36).slice(2, 8);
    const classLabel = state.className || 'Classe';
    const dateText = core.formatDateIt(o.date || new Date());

    const titleId = uid + '-title';
    const descId = uid + '-desc';
    const desc = classLabel + '. ' + st.capacity + ' banchi, ' + st.assigned + ' assegnati. ' +
      'Mappa vista dal docente, con la lavagna in basso. Ogni riquadro riporta il nome dell\'alunno.';

    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="' + titleId + ' ' + descId + '">';
    svg += '<title id="' + titleId + '">Cartina dei posti — ' + esc(classLabel) + '</title>';
    svg += '<desc id="' + descId + '">' + esc(desc) + '</desc>';
    svg += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + palette.bg + '"/>';
    svg += '<rect x="17" y="17" width="' + (W - 34) + '" height="' + (H - 34) + '" fill="none" stroke="' + palette.footerLine + '" stroke-width="1.2" opacity="0.55"/>';

    /* Intestazione ---------------------------------------------------- */
    svg += '<text x="' + M + '" y="54" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="10.5" font-weight="700" letter-spacing="2.2">CARTINA DI CLASSE</text>';
    const titleMax = W - 2 * M - 235;
    const titleSize = fitLine(classLabel, titleMax, 32, 18, 700);
    svg += '<text x="' + M + '" y="94" fill="' + palette.text + '" font-family="' + FONT + '" font-size="' + titleSize + '" font-weight="700">' + esc(classLabel) + '</text>';

    svg += '<text x="' + (W - M) + '" y="53" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="9.6" font-weight="600" text-anchor="end">Vista dal docente</text>';
    svg += '<text x="' + (W - M) + '" y="67" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="9.6" font-weight="600" text-anchor="end">la lavagna è in basso</text>';
    if (settings.showDate !== false) {
      svg += '<text x="' + (W - M) + '" y="91" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="9.2" font-weight="600" text-anchor="end">' + esc(dateText) + '</text>';
    }
    svg += '<line x1="' + M + '" y1="112" x2="' + (W - M) + '" y2="112" stroke="' + palette.border + '" stroke-width="2.4"/>';

    const area = { x: M, y: 136, w: W - 2 * M, h: H - 136 - 72 };
    const gutter = 76;
    const labelsTop = 26;
    const boardBand = 34;
    const boardGap = 12;
    const availableW = area.w - gutter;
    const availableH = area.h - labelsTop - boardBand - 12;

    if (st.capacity === 0 || active.length === 0) {
      svg += '<rect x="' + (area.x + 20) + '" y="' + (area.y + 50) + '" width="' + (area.w - 40) + '" height="' + (area.h - 100) + '" rx="12" fill="none" stroke="' + palette.emptyBorder + '" stroke-width="2" stroke-dasharray="7 6"/>';
      svg += '<text x="' + (W / 2) + '" y="' + (H / 2 - 12) + '" fill="' + palette.text + '" font-family="' + FONT + '" font-size="22" font-weight="700" text-anchor="middle">Nessun banco da mostrare</text>';
      svg += '<text x="' + (W / 2) + '" y="' + (H / 2 + 18) + '" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="13" font-weight="600" text-anchor="middle">Aggiungi i banchi nella scheda Banchi.</text>';
      svg += footerSvg(palette, st, classLabel, size);
      svg += '</svg>';
      return svg;
    }

    const rows = index.rows;
    const activeCols = active.length;
    const totalUnits = active.reduce(function (sum, c) { return sum + index.maxPerCol[c]; }, 0);
    let gapsW = (activeCols - 1) * LANE_GAP;
    active.forEach(function (c) { gapsW += (index.maxPerCol[c] - 1) * DESK_GAP; });
    let deskW = totalUnits > 0 ? (availableW - gapsW) / totalUnits : 0;
    deskW = Math.max(18, Math.min(210, deskW));
    let deskH = (availableH - (rows - 1) * ROW_GAP) / rows;
    deskH = Math.max(24, Math.min(112, deskH));

    let gridW = (activeCols - 1) * LANE_GAP;
    active.forEach(function (c) {
      gridW += index.maxPerCol[c] * deskW + Math.max(0, index.maxPerCol[c] - 1) * DESK_GAP;
    });
    const gridH = rows * deskH + (rows - 1) * ROW_GAP;

    /* Centratura del disegno sul foglio --------------------------------
       Il blocco comprende le etichette delle file (a sinistra), la griglia
       dei banchi e la fascia della lavagna. Lo si centra sia in orizzontale
       sia in verticale: prima restava appoggiato in basso a sinistra. */
    let labelW = 0;
    for (let r = 0; r < rows; r++) {
      const rn = rowName(r, rows);
      labelW = Math.max(labelW, measure(rn.title, 9.2, 700));
      if (rn.note) labelW = Math.max(labelW, measure(rn.note, 7.2, 600));
    }
    const labelGap = 18;
    const minLeft = area.x + labelGap + labelW;
    const centeredX = area.x + (area.w - gridW) / 2;
    const gridX = Math.max(minLeft, centeredX);

    const contentH = labelsTop + gridH + boardGap + boardBand;
    const extraY = Math.max(0, (area.h - contentH) / 2);
    const gridY = area.y + extraY + labelsTop;
    const laneX = {};
    let cursor = gridX;
    active.forEach(function (c) {
      laneX[c] = cursor;
      cursor += index.maxPerCol[c] * deskW + (index.maxPerCol[c] - 1) * DESK_GAP + LANE_GAP;
    });

    /* Separatori leggeri tra le colonne */
    active.forEach(function (c, i) {
      if (i === 0) return;
      const xSep = laneX[c] - LANE_GAP / 2;
      svg += '<line x1="' + round(xSep) + '" y1="' + round(gridY - 6) + '" x2="' + round(xSep) + '" y2="' + round(gridY + gridH + 6) +
        '" stroke="' + palette.footerLine + '" stroke-width="1" stroke-dasharray="3 5" opacity="0.55"/>';
    });

    /* Etichetta fondo aula ------------------------------------------- */
    if (rows > 1) {
      svg += '<text x="' + (gridX + gridW / 2) + '" y="' + (gridY - 30) + '" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="8.4" font-weight="700" letter-spacing="1.8" text-anchor="middle">FONDO AULA · ULTIMA FILA</text>';
    }

    /* Etichette colonne ---------------------------------------------- */
    active.forEach(function (c) {
      const cx = laneX[c] + (index.maxPerCol[c] * deskW + (index.maxPerCol[c] - 1) * DESK_GAP) / 2;
      svg += '<text x="' + cx + '" y="' + (gridY - 9) + '" fill="' + palette.text + '" font-family="' + FONT + '" font-size="8.6" font-weight="700" letter-spacing="1" text-anchor="middle">' + esc(columnName(c, index.cols)) + '</text>';
    });
    svg += '<line x1="' + gridX + '" y1="' + (gridY - 4) + '" x2="' + (gridX + gridW) + '" y2="' + (gridY - 4) + '" stroke="' + palette.border + '" stroke-width="2"/>';
    svg += '<line x1="' + (gridX - 10) + '" y1="' + gridY + '" x2="' + (gridX - 10) + '" y2="' + (gridY + gridH) + '" stroke="' + palette.muted + '" stroke-width="1" stroke-dasharray="4 4"/>';

    /* Righe e banchi -------------------------------------------------- */
    for (let r = 0; r < rows; r++) {
      const y = gridY + r * (deskH + ROW_GAP);
      const rn = rowName(r, rows);
      const cy = y + deskH / 2;
      svg += '<text x="' + (gridX - 18) + '" y="' + (cy - (rn.note ? 2 : 0)) + '" fill="' + palette.text + '" font-family="' + FONT + '" font-size="9.2" font-weight="700" text-anchor="end">' + esc(rn.title) + '</text>';
      if (rn.note) {
        svg += '<text x="' + (gridX - 18) + '" y="' + (cy + 10) + '" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="7.2" font-weight="600" text-anchor="end">' + esc(rn.note) + '</text>';
      }

      active.forEach(function (c) {
        const count = state.layout[r][c] || 0;
        if (count <= 0) return;
        const max = index.maxPerCol[c];
        const groupW = count * deskW + (count - 1) * DESK_GAP;
        let groupX = laneX[c] + (index.maxPerCol[c] * deskW + (index.maxPerCol[c] - 1) * DESK_GAP - groupW) / 2;
        index.byCell[r][c].forEach(function (seat, d) {
          const x = groupX + d * (deskW + DESK_GAP);
          const empty = !seat.student;
          svg += '<rect x="' + round(x) + '" y="' + round(y) + '" width="' + round(deskW) + '" height="' + round(deskH) + '" rx="6" fill="' + (empty ? palette.deskEmpty : palette.desk) + '" stroke="' + (empty ? palette.emptyBorder : palette.border) + '" stroke-width="2"' + (empty ? ' stroke-dasharray="5 4"' : '') + '/>';

          if (settings.showNumbers) {
            const label = String(seat.number);
            const badgeW = 8 + label.length * 4.4;
            svg += '<rect x="' + round(x + 4) + '" y="' + round(y + 4) + '" width="' + round(badgeW) + '" height="11" rx="2" fill="' + palette.numberBg + '" stroke="' + (empty ? palette.emptyBorder : palette.accent) + '" stroke-width="0.8"/>';
            svg += '<text x="' + round(x + 4 + badgeW / 2) + '" y="' + round(y + 12) + '" fill="' + (empty ? palette.muted : palette.accent) + '" font-family="' + FONT + '" font-size="7" font-weight="700" text-anchor="middle">' + label + '</text>';
          }

          if (empty) {
            if (settings.showEmpty !== false) {
              const label = 'libero';
              const fs = Math.min(13, Math.max(7, deskH / 4.4));
              svg += '<text x="' + round(x + deskW / 2) + '" y="' + round(y + deskH / 2 + fs * .35 + (settings.showNumbers ? 4 : 0)) + '" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="' + round(fs) + '" font-style="italic" font-weight="600" text-anchor="middle">' + label + '</text>';
            }
          } else {
            const name = core.formatStudentName(seat.student.name, settings.nameMode);
            const maxTextW = Math.max(10, deskW - 8);
            const maxTextH = Math.max(10, deskH - 8 - (settings.showNumbers ? 4 : 0));
            const base = Math.min(MAX_NAME_SIZE, deskW / 6.4, deskH / 3.05);
            const fit = fitName(name, maxTextW, maxTextH, base);
            const blockH = fit.lines.length * fit.lineHeight;
            const startY = y + deskH / 2 - blockH / 2 + fit.lineHeight * .78 + (settings.showNumbers ? 2 : 0);
            fit.lines.forEach(function (line, i) {
              svg += '<text x="' + round(x + deskW / 2) + '" y="' + round(startY + i * fit.lineHeight) + '" fill="' + palette.text + '" font-family="' + FONT + '" font-size="' + round(fit.size * 10) / 10 + '" font-weight="700" text-anchor="middle">' + esc(line) + '</text>';
            });
          }
        });
      });
    }

    /* Lavagna e piè di pagina ---------------------------------------- */
    const boardY = Math.min(area.y + area.h - boardBand, gridY + gridH + boardGap);
    svg += '<line x1="' + area.x + '" y1="' + boardY + '" x2="' + (area.x + area.w) + '" y2="' + boardY + '" stroke="' + palette.border + '" stroke-width="3.4"/>';
    svg += '<text x="' + area.x + '" y="' + (boardY + 21) + '" fill="' + palette.text + '" font-family="' + FONT + '" font-size="10.2" font-weight="700" letter-spacing="1.2">LAVAGNA · CATTEDRA</text>';
    svg += '<text x="' + (area.x + area.w) + '" y="' + (boardY + 21) + '" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="8.4" font-weight="600" text-anchor="end">PRIMA FILA · DAVANTI ALLA CLASSE</text>';

    /* Lato delle finestre --------------------------------------------- */
    if (state.windowsSide === 'left' || state.windowsSide === 'right') {
      const isLeft = state.windowsSide === 'left';
      const bandW = 30;
      const bandX = isLeft ? 14 : W - 14 - bandW;
      const bandTop = area.y;
      const bandH = area.h;
      svg += '<rect x="' + bandX + '" y="' + bandTop + '" width="' + bandW + '" height="' + bandH + '" rx="12" fill="none" stroke="#4a94e0" stroke-width="1.8" stroke-dasharray="6 5"/>';
      const bandCx = round(bandX + bandW / 2);
      const bandCy = round(bandTop + bandH / 2);
      const fs = 9.5;
      svg += '<text x="0" y="' + round(fs * 0.35) + '" transform="translate(' + bandCx + ' ' + bandCy + ') rotate(-90)"' +
        ' fill="#4a94e0" font-family="' + FONT + '" font-size="' + fs + '" font-weight="700" letter-spacing="2.6"' +
        ' text-anchor="middle">FINESTRE</text>';
    }

    svg += footerSvg(palette, st, classLabel, size);
    svg += '</svg>';
    return svg;
  }

  function footerSvg(palette, st, classLabel, size) {
    const dim = size || A4;
    let svg = '';
    svg += '<line x1="' + M + '" y1="' + (dim.h - 57) + '" x2="' + (dim.w - M) + '" y2="' + (dim.h - 57) + '" stroke="' + palette.footerLine + '" stroke-width="1"/>';
    svg += '<text x="' + M + '" y="' + (dim.h - 37) + '" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="9.2" font-weight="600">' +
      st.capacity + ' ' + core.plural(st.capacity, 'banco', 'banchi') + ' · ' +
      st.assigned + ' ' + core.plural(st.assigned, 'assegnato', 'assegnati') + ' · ' +
      st.empty + ' ' + core.plural(st.empty, 'libero', 'liberi') + '</text>';
    svg += '<text x="' + (dim.w - M) + '" y="' + (dim.h - 37) + '" fill="' + palette.muted + '" font-family="' + FONT + '" font-size="8.8" font-weight="600" text-anchor="end">Cartina di Classe · ' + esc(classLabel) + '</text>';
    return svg;
  }

  function autoSize(state) {
    const W = A4.w;
    const index = core.buildSeatIndex(state);
    const active = [];
    for (let c = 0; c < index.cols; c++) if (index.maxPerCol[c] > 0) active.push(c);
    if (!active.length) return { w: W, h: 720 };
    const rows = Math.max(1, index.rows);
    const activeCols = active.length;
    const totalUnits = active.reduce(function (sum, c) { return sum + index.maxPerCol[c]; }, 0);
    let gapsW = (activeCols - 1) * LANE_GAP;
    active.forEach(function (c) { gapsW += (index.maxPerCol[c] - 1) * DESK_GAP; });
    const availableW = (W - 2 * M) - 76;
    let deskW = totalUnits > 0 ? (availableW - gapsW) / totalUnits : 0;
    deskW = Math.max(18, Math.min(210, deskW));
    const deskH = Math.max(24, Math.min(112, deskW * 0.62));
    const gridH = rows * deskH + (rows - 1) * ROW_GAP;
    // 136 (testata) + 26 + 34 + 12 (margini della griglia) + 72 (piè di pagina)
    const h = Math.round(136 + 26 + 34 + 12 + gridH + 72);
    return { w: W, h: Math.max(320, h) };
  }

  function round(n) {
    return Math.round(n * 10) / 10;
  }

  function downloadBlob(blob, filename) {
    const url = global.URL.createObjectURL(blob);
    const a = global.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    global.document.body.appendChild(a);
    a.click();
    a.remove();
    global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 4000);
  }

  function downloadText(text, mime, filename) {
    downloadBlob(new Blob([text], { type: mime + ';charset=utf-8' }), filename);
  }

  function rasterizeSvg(svg, dpi, size) {
    const dim = size && size.w > 0 && size.h > 0 ? size : A4;
    return new Promise(function (resolve, reject) {
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = global.URL.createObjectURL(blob);
      const img = new global.Image();
      img.decoding = 'async';
      img.onload = function () {
        try {
          const width = Math.max(1, Math.round((dim.w / 96) * dpi));
          const height = Math.max(1, Math.round((dim.h / 96) * dpi));
          const canvas = global.document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const c = canvas.getContext('2d');
          c.fillStyle = '#ffffff';
          c.fillRect(0, 0, width, height);
          c.drawImage(img, 0, 0, width, height);
          canvas.toBlob(function (out) {
            global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
            if (!out) reject(new Error('Non è stato possibile creare l\'immagine PNG.'));
            else resolve(out);
          }, 'image/png');
        } catch (error) {
          global.URL.revokeObjectURL(url);
          reject(error);
        }
      };
      img.onerror = function () {
        global.URL.revokeObjectURL(url);
        reject(new Error('Non è stato possibile preparare l\'immagine.'));
      };
      img.src = url;
    });
  }

  async function exportImage(state, settings, variant, options) {
    const o = options || {};
    const format = o.format || settings.exportFormat || 'png';
    const dpi = o.dpi || settings.exportDpi || 300;
    const size = o.size || null;
    const svg = buildSvg(state, settings, variant, { date: o.date, size: size });
    const filename = core.exportFilename(state, variant, format, o.date);
    if (format === 'svg') {
      downloadText(svg, 'image/svg+xml', filename);
      return { filename: filename, format: 'svg', dpi: null, size: size };
    }
    const blob = await rasterizeSvg(svg, dpi, size);
    downloadBlob(blob, filename);
    return { filename: filename, format: 'png', dpi: dpi, size: size };
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    if (/[;"\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function buildRosterCsv(state) {
    const index = core.buildSeatIndex(state);
    const lines = [['Alunno', 'Posto', 'Fila', 'Colonna', 'Banco'].map(csvCell).join(';')];
    state.students.forEach(function (student) {
      const seat = index.byStudent.get(student.id);
      lines.push([
        student.name,
        seat ? seat.number : '',
        seat ? seat.fila : '',
        seat ? seat.colonna : '',
        seat ? seat.banco : '',
      ].map(csvCell).join(';'));
    });
    return '\ufeff' + lines.join('\r\n');
  }

  function exportRosterCsv(state) {
    const filename = 'Elenco_' + core.safeFilename(state.className || 'classe', 'classe') + '_' + core.dateStamp() + '.csv';
    downloadText(buildRosterCsv(state), 'text/csv', filename);
    return filename;
  }

  function preparePrint(state, settings) {
    const svg = buildSvg(state, settings, 'light');
    const root = global.document.getElementById('print-root');
    if (root) {
      root.innerHTML = svg;
      root.removeAttribute('aria-hidden');
    }
    return svg;
  }

  function printNow() {
    global.print();
  }

  CC.exporter = {
    A4: A4,
    FONT: FONT,
    PALETTES: PALETTES,
    buildSvg: buildSvg,
    autoSize: autoSize,
    exportImage: exportImage,
    downloadBlob: downloadBlob,
    downloadText: downloadText,
    rasterizeSvg: rasterizeSvg,
    buildRosterCsv: buildRosterCsv,
    exportRosterCsv: exportRosterCsv,
    preparePrint: preparePrint,
    printNow: printNow,
  };
})(typeof window !== 'undefined' ? window : globalThis);
