/* Cartina di Classe — importazione XLSX/CSV senza dipendenze esterne */
(function (global) {
  'use strict';

  const CC = global.CC;
  const core = CC.core;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_UNZIPPED = 40 * 1024 * 1024;
  const MAX_SHEETS = 40;
  const MAX_ROWS = 500;
  const MAX_COLS = 60;
  const MAX_SHARED = 30000;

  function decodeUtf8(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('Il file contiene un foglio Excel non leggibile.');
    }
    return doc;
  }

  function tags(node, localName) {
    return Array.from(node.getElementsByTagNameNS('*', localName));
  }

  function textOf(node) {
    return tags(node, 't').map(function (t) { return t.textContent; }).join('');
  }

  function normalizePath(path) {
    const parts = String(path || '').replace(/\\/g, '/').split('/');
    const out = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') out.pop();
      else out.push(part);
    }
    return out.join('/');
  }

  function resolvePath(base, target) {
    const t = String(target || '').replace(/\\/g, '/');
    if (t.startsWith('/')) return normalizePath(t);
    const dir = String(base || '').split('/').slice(0, -1).join('/');
    return normalizePath(dir + '/' + t);
  }

  function colIndex(ref) {
    const m = /^([A-Za-z]+)/.exec(String(ref || ''));
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function rowIndex(ref) {
    const m = /(\d+)$/.exec(String(ref || ''));
    return m ? Number(m[1]) - 1 : -1;
  }

  /* ------------------------------------------------------------------ */
  /* Lettore ZIP (solo il necessario per XLSX)                          */
  /* ------------------------------------------------------------------ */

  async function readZip(buffer) {
    const dv = new DataView(buffer);
    const len = buffer.byteLength;
    if (len < 22) throw new Error('Il file ZIP è troppo piccolo.');
    let eocd = -1;
    const min = Math.max(0, len - 22 - 65535);
    for (let i = len - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Il file non è un archivio Excel valido.');
    const total = dv.getUint16(eocd + 10, true);
    const cdOffset = dv.getUint32(eocd + 16, true);
    if (total === 0xffff || cdOffset === 0xffffffff) {
      throw new Error('I file Excel ZIP64 non sono supportati. Salva il file come CSV UTF-8.');
    }
    if (total > 2000) throw new Error('Il file contiene troppi elementi.');

    const entries = new Map();
    let off = cdOffset;
    let totalUnzipped = 0;
    for (let i = 0; i < total; i++) {
      if (off + 46 > len) throw new Error('Archivio Excel danneggiato.');
      if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('Archivio Excel danneggiato.');
      const flags = dv.getUint16(off + 8, true);
      const method = dv.getUint16(off + 10, true);
      const compSize = dv.getUint32(off + 20, true);
      const uncompSize = dv.getUint32(off + 24, true);
      const nameLen = dv.getUint16(off + 28, true);
      const extraLen = dv.getUint16(off + 30, true);
      const commentLen = dv.getUint16(off + 32, true);
      const localOff = dv.getUint32(off + 42, true);
      const nameBytes = new Uint8Array(buffer, off + 46, nameLen);
      const name = normalizePath(new TextDecoder('utf-8').decode(nameBytes));
      totalUnzipped += uncompSize;
      if (totalUnzipped > MAX_UNZIPPED) throw new Error('Il file Excel è troppo grande una volta aperto.');
      if (flags & 0x1) throw new Error('Il file Excel è protetto da password.');
      entries.set(name, { method: method, compSize: compSize, uncompSize: uncompSize, localOff: localOff });
      off += 46 + nameLen + extraLen + commentLen;
    }

    async function get(name) {
      const entry = entries.get(normalizePath(name));
      if (!entry) return null;
      const local = entry.localOff;
      if (local + 30 > len || dv.getUint32(local, true) !== 0x04034b50) {
        throw new Error('Archivio Excel danneggiato.');
      }
      const nameLen = dv.getUint16(local + 26, true);
      const extraLen = dv.getUint16(local + 28, true);
      const start = local + 30 + nameLen + extraLen;
      if (start + entry.compSize > len) throw new Error('Archivio Excel danneggiato.');
      const data = new Uint8Array(buffer, start, entry.compSize);
      if (entry.method === 0) return data;
      if (entry.method !== 8) throw new Error('Metodo di compressione Excel non supportato.');
      if (typeof DecompressionStream !== 'function') {
        throw new Error('Questo browser non può aprire file Excel. Salva il file come CSV UTF-8 e importalo.');
      }
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const out = await new Response(stream).arrayBuffer();
      if (out.byteLength > MAX_UNZIPPED) throw new Error('Il file Excel è troppo grande una volta aperto.');
      return new Uint8Array(out);
    }

    return { entries: entries, get: get };
  }

  /* ------------------------------------------------------------------ */
  /* Lettore XLSX                                                       */
  /* ------------------------------------------------------------------ */

  async function readXlsx(buffer) {
    const zip = await readZip(buffer);
    const warnings = [];
    const workbookBytes = await zip.get('xl/workbook.xml');
    if (!workbookBytes) throw new Error('Il file non sembra un file Excel valido.');

    const workbookDoc = parseXml(decodeUtf8(workbookBytes));
    const relsBytes = await zip.get('xl/_rels/workbook.xml.rels');
    let rels = new Map();
    if (relsBytes) {
      const relsDoc = parseXml(decodeUtf8(relsBytes));
      tags(relsDoc, 'Relationship').forEach(function (rel) {
        const id = rel.getAttribute('Id');
        const target = rel.getAttribute('Target');
        if (id && target) rels.set(id, resolvePath('xl/workbook.xml', target));
      });
    }

    let shared = [];
    const sharedBytes = await zip.get('xl/sharedStrings.xml');
    if (sharedBytes) {
      const sharedDoc = parseXml(decodeUtf8(sharedBytes));
      const sis = tags(sharedDoc, 'si');
      if (sis.length > MAX_SHARED) throw new Error('Il file Excel contiene troppi testi.');
      shared = sis.map(textOf);
    }

    const sheetEls = tags(workbookDoc, 'sheet');
    if (!sheetEls.length) throw new Error('Il file Excel non contiene fogli.');
    const sheets = [];
    for (let i = 0; i < sheetEls.length && i < MAX_SHEETS; i++) {
      const el = sheetEls[i];
      const name = el.getAttribute('name') || ('Foglio ' + (i + 1));
      const rid = el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ||
        el.getAttribute('r:id') || el.getAttribute('id');
      let path = rels.get(rid) || ('xl/worksheets/sheet' + (i + 1) + '.xml');
      if (!path.startsWith('xl/')) path = normalizePath('xl/' + path);
      const bytes = await zip.get(path);
      if (!bytes) {
        warnings.push('Il foglio «' + name + '» non è leggibile ed è stato saltato.');
        continue;
      }
      sheets.push({ name: name, rows: parseSheetXml(decodeUtf8(bytes), shared, warnings) });
    }
    if (!sheets.length) throw new Error('Nessun foglio leggibile nel file Excel.');
    return { sheets: sheets, warnings: warnings };
  }

  function parseSheetXml(text, shared, warnings) {
    const doc = parseXml(text);
    const rows = [];
    let maxCol = 0;
    const rowEls = tags(doc, 'row');
    for (let i = 0; i < rowEls.length && i < MAX_ROWS; i++) {
      const rowEl = rowEls[i];
      const rAttr = rowEl.getAttribute('r');
      const r = rAttr ? Number(rAttr) - 1 : i;
      if (r < 0 || r >= MAX_ROWS) continue;
      if (!rows[r]) rows[r] = [];
      const cellEls = tags(rowEl, 'c');
      for (const cell of cellEls) {
        const ref = cell.getAttribute('r');
        let c = colIndex(ref);
        if (c < 0) c = 0;
        if (c >= MAX_COLS) {
          warnings.push('Alcune colonne oltre la ' + MAX_COLS + ' sono state ignorate.');
          continue;
        }
        maxCol = Math.max(maxCol, c);
        const type = cell.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') {
          value = textOf(cell);
        } else {
          const v = tags(cell, 'v')[0];
          const raw = v ? v.textContent : '';
          if (type === 's') {
            const idx = Number(raw);
            value = shared[idx] != null ? shared[idx] : '';
          } else if (type === 'b') {
            value = raw === '1' ? 'VERO' : 'FALSO';
          } else if (type === 'e') {
            value = '';
          } else if (type === 'str') {
            value = raw;
          } else {
            if (raw === '') value = '';
            else {
              const n = Number(raw);
              value = Number.isFinite(n) ? n : raw;
            }
          }
        }
        rows[r][c] = value;
      }
    }

    const out = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const dense = [];
      for (let c = 0; c <= maxCol; c++) dense.push(row[c] == null ? '' : row[c]);
      out.push(dense);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* CSV                                                                */
  /* ------------------------------------------------------------------ */

  function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
    const counts = { ';': 0, ',': 0, '\t': 0 };
    let inQuotes = false;
    for (let i = 0; i < sample.length; i++) {
      const ch = sample[i];
      if (ch === '"') {
        if (inQuotes && sample[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (!inQuotes && Object.prototype.hasOwnProperty.call(counts, ch)) {
        counts[ch] += 1;
      }
    }
    let best = ',';
    let bestN = 0;
    Object.keys(counts).forEach(function (d) {
      if (counts[d] > bestN) { bestN = counts[d]; best = d; }
    });
    return best;
  }

  function parseCsv(text, delimiter) {
    const d = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === d) {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every(function (v) { return String(v).trim() === ''; })) {
      rows.pop();
    }
    return rows;
  }

  async function readCsvFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text;
    let warnings = [];
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      text = new TextDecoder('windows-1252').decode(bytes);
      warnings.push('Il file non era in UTF-8: è stato letto con la codifica di Windows. Controlla le lettere accentate.');
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = parseCsv(text);
    if (!rows.length) throw new Error('Il file CSV è vuoto.');
    if (rows.length > MAX_ROWS) throw new Error('Il file CSV ha troppe righe.');
    return {
      sheets: [{ name: file.name.replace(/\.[^.]+$/, ''), rows: rows }],
      warnings: warnings,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Interpretazione dei fogli                                          */
  /* ------------------------------------------------------------------ */

  const NAME_HEADERS = new Set([
    'alunno', 'alunna', 'alunni', 'alunne', 'studente', 'studentessa', 'studenti', 'studentesse',
    'nome', 'cognome', 'nome e cognome', 'cognome e nome', 'nominativo', 'nominativi',
    'student', 'students', 'name', 'full name', 'first name', 'last name',
  ]);
  const FIRST_HEADERS = new Set(['nome', 'first name', 'firstname']);
  const LAST_HEADERS = new Set(['cognome', 'last name', 'lastname', 'surname']);
  const ROW_HEADERS = new Set(['fila', 'riga', 'row', 'fila n', 'n fila']);
  const COL_HEADERS = new Set(['colonna', 'col', 'column', 'colonna n', 'n colonna']);
  const DESK_HEADERS = new Set(['banco', 'desk', 'seat', 'posto nel banco']);
  const SEAT_HEADERS = new Set(['posto', 'numero posto', 'n posto', 'posto numero', 'seat number']);
  const LAYOUT_NAMES = /(layout|disposizione|banchi|aula|pianta|seating)/i;
  const ROSTER_NAMES = /(alunn|student|elenco|registro|classe)/i;
  const IGNORE_NAMES = /(istruz|aiuto|help|readme|note|esempi|example)/i;

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function norm(value) {
    return core.normalizeName(value);
  }

  /** Toglie le spiegazioni tra parentesi: «Fila (facoltativo)» diventa «fila». */
  function normHeader(value) {
    return norm(String(value == null ? '' : value).replace(/\([^)]*\)/g, ' '));
  }

  function findHeaderInfo(rows) {
    const limit = Math.min(rows.length, 12);
    for (let r = 0; r < limit; r++) {
      const cells = (rows[r] || []).map(normHeader);
      let nameCol = -1;
      let firstCol = -1;
      let lastCol = -1;
      let rowCol = -1;
      let colCol = -1;
      let deskCol = -1;
      let seatCol = -1;
      cells.forEach(function (cell, c) {
        if (!cell) return;
        if (FIRST_HEADERS.has(cell) && firstCol < 0) firstCol = c;
        else if (LAST_HEADERS.has(cell) && lastCol < 0) lastCol = c;
        else if (NAME_HEADERS.has(cell) && nameCol < 0) nameCol = c;
        if (ROW_HEADERS.has(cell) && rowCol < 0) rowCol = c;
        if (COL_HEADERS.has(cell) && colCol < 0) colCol = c;
        if (DESK_HEADERS.has(cell) && deskCol < 0) deskCol = c;
        if (SEAT_HEADERS.has(cell) && seatCol < 0) seatCol = c;
      });
      if (nameCol < 0 && firstCol < 0 && lastCol < 0) continue;
      return {
        row: r,
        nameCol: nameCol,
        firstCol: firstCol,
        lastCol: lastCol,
        rowCol: rowCol,
        colCol: colCol,
        deskCol: deskCol,
        seatCol: seatCol,
      };
    }
    return null;
  }

  function numeric(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = clean(value).replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  function extractLayoutMatrix(rows) {
    let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
    let numericCount = 0;
    const problems = [];
    for (let r = 0; r < rows.length && r < MAX_ROWS; r++) {
      for (let c = 0; c < (rows[r] || []).length && c < MAX_COLS; c++) {
        const v = numeric(rows[r][c]);
        if (v == null) continue;
        numericCount += 1;
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
    if (numericCount === 0) return null;
    const height = maxR - minR + 1;
    const width = maxC - minC + 1;
    if (height > 20) problems.push('La disposizione ha ' + height + ' file: il massimo è 20.');
    if (width > 12) problems.push('La disposizione ha ' + width + ' colonne: il massimo è 12.');
    if (problems.length) return { error: problems.join(' ') };
    const matrix = [];
    for (let r = minR; r <= maxR; r++) {
      const row = [];
      for (let c = minC; c <= maxC; c++) {
        const raw = rows[r] && rows[r][c] != null ? rows[r][c] : '';
        let n = numeric(raw);
        if (n == null) n = 0;
        if (n < 0 || n > 12) {
          problems.push('Valore non valido ' + n + ' nella cella fila ' + (r - minR + 1) + ', colonna ' + (c - minC + 1) + ': usa un numero da 0 a 12.');
        }
        if (!Number.isInteger(n)) {
          n = Math.round(n);
          problems.push('Il valore nella cella fila ' + (r - minR + 1) + ', colonna ' + (c - minC + 1) + ' non era intero: è stato arrotondato a ' + n + '.');
        }
        row.push(n);
      }
      matrix.push(row);
    }
    if (problems.length) return { matrix: matrix, warnings: problems };
    return { matrix: matrix, warnings: [] };
  }

  function parsePositionValue(value) {
    const n = numeric(value);
    if (n == null || !Number.isInteger(n) || n < 1) return null;
    return n;
  }

  function parseRosterSheet(sheet) {
    const rows = sheet.rows;
    const header = findHeaderInfo(rows);
    const students = [];
    const warnings = [];
    const seen = new Set();

    function pushStudent(name, position, rowNumber) {
      const cleanName = clean(name);
      if (!cleanName) return;
      if (cleanName.length > 80) {
        warnings.push('Un nome alla riga ' + rowNumber + ' è troppo lungo ed è stato accorciato.');
      }
      const key = norm(cleanName);
      if (seen.has(key)) {
        warnings.push('Nome ripetuto ignorato: ' + cleanName + '.');
        return;
      }
      seen.add(key);
      if (students.length >= core.LIMITS.students) {
        warnings.push('Ci sono più di ' + core.LIMITS.students + ' alunni: gli altri sono stati ignorati.');
        return;
      }
      students.push({
        name: cleanName.slice(0, 80),
        fila: position ? position.fila : null,
        colonna: position ? position.colonna : null,
        banco: position ? position.banco : null,
        posto: position ? position.posto : null,
        sourceRow: rowNumber,
      });
    }

    if (!header) {
      // Nessuna intestazione: usa la prima colonna come elenco di nomi.
      for (let r = 0; r < rows.length; r++) {
        const first = clean((rows[r] || [])[0]);
        if (!first) continue;
        const n = norm(first);
        if (['alunni', 'alunno', 'studenti', 'studente', 'elenco alunni', 'elenco', 'nome e cognome', 'nome', 'classe'].includes(n)) continue;
        pushStudent(first, null, r + 1);
      }
      return { students: students, warnings: warnings, hasHeader: false };
    }

    for (let r = header.row + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      let name = '';
      if (header.nameCol >= 0) name = clean(row[header.nameCol]);
      else if (header.firstCol >= 0 || header.lastCol >= 0) {
        const first = header.firstCol >= 0 ? clean(row[header.firstCol]) : '';
        const last = header.lastCol >= 0 ? clean(row[header.lastCol]) : '';
        name = (first + ' ' + last).trim();
      }
      if (!name) continue;
      const position = {
        fila: header.rowCol >= 0 ? parsePositionValue(row[header.rowCol]) : null,
        colonna: header.colCol >= 0 ? parsePositionValue(row[header.colCol]) : null,
        banco: header.deskCol >= 0 ? parsePositionValue(row[header.deskCol]) : null,
        posto: header.seatCol >= 0 ? parsePositionValue(row[header.seatCol]) : null,
      };
      if (position.fila == null && position.colonna == null && position.posto == null) {
        // potrebbe essere una riga di intestazione ripetuta o una nota
        if (/^(totale|tot|note|classe|anno scolastico)/i.test(name)) continue;
      }
      pushStudent(name, position, r + 1);
    }
    return { students: students, warnings: warnings, hasHeader: true };
  }

  function analyzeSheets(sheets, fileName) {
    const warnings = [];
    const namedLayout = [];
    const namedRoster = [];
    const layouts = [];
    const rosters = [];

    sheets.forEach(function (sheet) {
      const name = sheet.name || '';
      if (IGNORE_NAMES.test(name)) return;
      const header = findHeaderInfo(sheet.rows);
      const layout = extractLayoutMatrix(sheet.rows);
      if (LAYOUT_NAMES.test(name) && layout && !layout.error) namedLayout.push({ sheet: sheet, layout: layout });
      if (ROSTER_NAMES.test(name) && (header || sheet.rows.length)) namedRoster.push({ sheet: sheet, header: header });
      if (layout) layouts.push({ sheet: sheet, layout: layout, header: header });
      if (header) rosters.push({ sheet: sheet, header: header });
    });

    let layoutChoice = namedLayout[0] || layouts.find(function (x) { return !x.header; }) || null;
    let rosterChoice = namedRoster.find(function (x) { return x.header; }) || rosters[0] ||
      (layoutChoice ? null : namedRoster[0]) || null;

    // Un foglio di sole istruzioni non deve diventare l'elenco alunni.
    if (rosterChoice && rosterChoice.sheet === (layoutChoice && layoutChoice.sheet) && !rosterChoice.header) {
      rosterChoice = null;
    }

    if (layoutChoice && layoutChoice.layout.error) {
      warnings.push(layoutChoice.layout.error);
      layoutChoice = null;
    } else if (layoutChoice && layoutChoice.layout.warnings && layoutChoice.layout.warnings.length) {
      warnings.push.apply(warnings, layoutChoice.layout.warnings);
    }

    let students = [];
    let rosterSheetName = null;
    if (rosterChoice) {
      const parsed = parseRosterSheet(rosterChoice.sheet);
      students = parsed.students;
      rosterSheetName = rosterChoice.sheet.name;
      if (parsed.warnings.length) warnings.push.apply(warnings, parsed.warnings);
      if (!students.length) {
        warnings.push('Il foglio «' + rosterSheetName + '» non contiene nomi di alunni.');
      }
    }

    if (!layoutChoice && !students.length) {
      throw new Error('Non ho trovato né una disposizione di banchi né un elenco di alunni. Usa il modello Excel oppure incolla i nomi nella scheda Alunni.');
    }

    let layout = null;
    if (layoutChoice) {
      layout = {
        matrix: layoutChoice.layout.matrix,
        sheetName: layoutChoice.sheet.name,
        rows: layoutChoice.layout.matrix.length,
        cols: layoutChoice.layout.matrix[0].length,
        capacity: layoutChoice.layout.matrix.reduce(function (sum, row) {
          return sum + row.reduce(function (a, b) { return a + b; }, 0);
        }, 0),
      };
    }

    const withPosition = students.filter(function (s) {
      return s.posto != null || (s.fila != null && s.colonna != null);
    }).length;

    return {
      fileName: fileName || '',
      sheets: sheets.map(function (s) { return s.name; }),
      layout: layout,
      students: students,
      rosterSheetName: rosterSheetName,
      warnings: warnings,
      withPosition: withPosition,
      mode: layout ? (students.length ? 'full' : 'layout') : 'students',
    };
  }

  async function analyzeFile(file) {
    if (!file) throw new Error('Nessun file selezionato.');
    if (file.size > MAX_FILE_BYTES) throw new Error('Il file è troppo grande (massimo 12 MB).');
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    const lower = (file.name || '').toLowerCase();
    let parsed;
    if (isZip || lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
      if (typeof DecompressionStream !== 'function') {
        throw new Error('Questo browser non può aprire file Excel. Apri il file in Excel, salvalo come CSV UTF-8 e importa il CSV.');
      }
      parsed = await readXlsx(await file.arrayBuffer());
    } else if (lower.endsWith('.csv') || lower.endsWith('.txt') || isZip === false) {
      parsed = await readCsvFile(file);
    } else {
      throw new Error('Formato non supportato. Usa un file .xlsx, .csv o .txt.');
    }
    const analysis = analyzeSheets(parsed.sheets, file.name);
    analysis.warnings = (parsed.warnings || []).concat(analysis.warnings);
    return analysis;
  }

  /* ------------------------------------------------------------------ */
  /* Costruzione dello stato importato                                  */
  /* ------------------------------------------------------------------ */

  function buildImportedState(current, analysis, mode) {
    const replace = mode !== 'students';
    const warnings = (analysis.warnings || []).slice();
    let state;
    let roster;
    let newStudents = 0;

    if (replace) {
      state = core.createState({ className: current.className });
      if (analysis.layout) state.layout = core.sanitizeLayout(analysis.layout.matrix);
      else state.layout = core.clone(current.layout);
      if (analysis.students.length) {
        roster = [];
        const seen = new Set();
        analysis.students.forEach(function (s) {
          const nn = core.normalizeName(s.name);
          if (seen.has(nn)) return;
          seen.add(nn);
          roster.push({ id: core.newId(), name: s.name, _import: s });
        });
      } else {
        roster = current.students.map(function (s) { return { id: s.id, name: s.name }; });
        warnings.push('Il file non contiene alunni: è stato mantenuto l\'elenco attuale.');
      }
      state.students = roster.map(function (s) { return { id: s.id, name: s.name }; });
    } else {
      state = core.clone(current);
      const byName = new Map(state.students.map(function (s) { return [core.normalizeName(s.name), s]; }));
      roster = state.students.map(function (s) { return { id: s.id, name: s.name }; });
      analysis.students.forEach(function (s) {
        const nn = core.normalizeName(s.name);
        if (byName.has(nn)) return;
        if (state.students.length >= core.LIMITS.students) return;
        const student = { id: core.newId(), name: s.name };
        state.students.push(student);
        byName.set(nn, student);
        newStudents += 1;
      });
      if (analysis.layout) warnings.push('La disposizione contenuta nel file non è stata applicata perché hai scelto di aggiungere solo gli alunni.');
      if (analysis.students.length && !newStudents) warnings.push('Tutti gli alunni del file erano già presenti nell\'elenco.');
    }

    let index = core.buildSeatIndex(state);
    let assignedByPosition = 0;
    const positionWarnings = [];

    if (replace && analysis.students.length) {
      const imported = analysis.students;
      imported.forEach(function (item) {
        if (!item.fila && !item.colonna && !item.posto) return;
        const student = state.students.find(function (s) { return core.normalizeName(s.name) === core.normalizeName(item.name); });
        if (!student) return;
        let seat = null;
        if (item.posto != null) {
          const byNumber = index.seats[item.posto - 1];
          if (byNumber) seat = byNumber;
        }
        if (!seat && item.fila != null && item.colonna != null) {
          const r = index.rows - item.fila;
          const c = item.colonna - 1;
          const d = (item.banco != null ? item.banco : 1) - 1;
          if (r >= 0 && r < index.rows && c >= 0 && c < index.cols && d >= 0 && d < (state.layout[r][c] || 0)) {
            seat = index.byKey.get(core.seatKey(r, c, d));
          }
        }
        if (!seat) {
          positionWarnings.push('Posto non valido per ' + item.name + ' (fila ' + (item.fila || '?') + ', colonna ' + (item.colonna || '?') + ', banco ' + (item.banco || '?') + ').');
          return;
        }
        if (state.seats[seat.key]) {
          positionWarnings.push('Il posto ' + seat.number + ' era già occupato: ' + item.name + ' è stato lasciato da disporre.');
          return;
        }
        state.seats[seat.key] = student.id;
        assignedByPosition += 1;
      });
      index = core.buildSeatIndex(state);
    }

    const auto = core.autoAssign(state, { keepExisting: true });
    state = auto.state;
    const st = core.stats(state);

    if (positionWarnings.length) warnings.push.apply(warnings, positionWarnings);
    if (st.capacity === 0) warnings.push('La disposizione non contiene banchi: aggiungi i banchi nella scheda Banchi.');
    if (st.unassigned > 0) warnings.push('Restano ' + st.unassigned + ' ' + core.plural(st.unassigned, 'alunno senza posto', 'alunni senza posto') + ': aggiungi banchi o assegna i posti a mano.');

    return {
      state: state,
      mode: replace ? 'replace' : 'students',
      layoutApplied: replace && !!analysis.layout,
      rosterReplaced: replace && analysis.students.length > 0,
      studentsAdded: replace ? state.students.length : newStudents,
      assignedByPosition: assignedByPosition,
      autoAssigned: auto.assigned,
      warnings: warnings,
      stats: st,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Modello Excel                                                      */
  /* ------------------------------------------------------------------ */

  function base64ToBytes(base64) {
    const binary = global.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function downloadTemplate() {
    const b64 = CC.TEMPLATE_XLSX_B64;
    if (!b64) throw new Error('Il modello Excel non è disponibile in questa copia dell\'applicazione.');
    const bytes = base64ToBytes(b64);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    CC.exporter.downloadBlob(blob, 'Modello_Planimetria_Classi.xlsx');
  }

  CC.importer = {
    MAX_FILE_BYTES: MAX_FILE_BYTES,
    detectDelimiter: detectDelimiter,
    parseCsv: parseCsv,
    readXlsx: readXlsx,
    readCsvFile: readCsvFile,
    analyzeSheets: analyzeSheets,
    analyzeFile: analyzeFile,
    buildImportedState: buildImportedState,
    downloadTemplate: downloadTemplate,
    findHeaderInfo: findHeaderInfo,
    extractLayoutMatrix: extractLayoutMatrix,
  };
})(typeof window !== 'undefined' ? window : globalThis);
