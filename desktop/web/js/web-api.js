/* Cartina di Classe — versione HTML: implementazione browser della stessa
   API dei file dell'app desktop (vedi desktop/app.py).
   Salva e legge classi, esportazioni e impostazioni in una cartella reale
   (di solito «files», accanto a questo file HTML) usando l'API File System
   Access di Chrome/Edge. La cartella va scelta la prima volta; il permesso
   resta memorizzato e viene riattivato con un clic alle aperture seguenti. */
(function (global) {
  'use strict';

  var DB_NAME = 'cartina-files';
  var DB_STORE = 'handles';
  var DB_KEY = 'files';
  var SETTINGS_KEY = 'cc.web.settings.v1';
  var SERVICE_FILES = { 'impostazioni.json': true, 'diagnostica.log': true };

  var state = { dir: null, name: '' };
  var savedHandle = null;   // cartella scelta ma con permesso da riattivare
  var exported = {};        // nome file → handle (per «Apri immagine»)
  var ready = null;

  function available() {
    if (global.pywebview) return false; // nell'exe parla l'API Python
    var qs = new URLSearchParams(global.location.search);
    if (qs.has('preview') || qs.has('desktop')) return false;
    return typeof global.showDirectoryPicker === 'function';
  }

  /* -- IndexedDB: promemoria della cartella scelta ------------------- */

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = global.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function idbSet(value) {
    try {
      var db = await idbOpen();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, DB_KEY);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
      db.close();
    } catch (error) {
      // Senza IndexedDB la cartella va riscegliuta a ogni avvio.
    }
  }

  async function idbGet() {
    try {
      var db = await idbOpen();
      var value = await new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).get(DB_KEY);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
      db.close();
      return value;
    } catch (error) {
      return null;
    }
  }

  async function idbClear() {
    try {
      var db = await idbOpen();
      await new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(DB_KEY);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
      db.close();
    } catch (error) {
      // ignore
    }
  }

  /* -- utilità -------------------------------------------------------- */

  function slugify(text) {
    var clean = String(text || '').trim();
    clean = clean.replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
    return (clean.slice(0, 60) || 'classe').toLowerCase();
  }

  function randomId() {
    var chars = 'abcdef0123456789';
    var out = '';
    for (var i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function asText(value) {
    return typeof value === 'string' ? value : '';
  }

  function summary(file, payload, modified) {
    var data = payload && payload.data && typeof payload.data === 'object' ? payload.data : (payload || {});
    var layout = Array.isArray(data.layout) ? data.layout : [];
    var seats = data.seats && typeof data.seats === 'object' ? data.seats : {};
    var students = Array.isArray(data.students) ? data.students : [];
    var capacity = 0;
    layout.forEach(function (row) {
      if (Array.isArray(row)) row.forEach(function (v) { capacity += Math.max(0, Number(v) || 0); });
    });
    var assigned = 0;
    Object.keys(seats).forEach(function (k) { if (typeof seats[k] === 'string' && seats[k]) assigned++; });
    return { file: file, name: asText(data.className) || 'Classe senza nome', students: students.length, capacity: capacity, assigned: assigned, modified: modified };
  }

  function readPayload(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Il file non contiene una classe valida.');
    var data = raw.data && typeof raw.data === 'object' ? raw.data : raw;
    if (!Array.isArray(data.layout)) throw new Error('Il file non contiene una disposizione dei banchi.');
    return raw.data && typeof raw.data === 'object' ? raw : { data: data };
  }

  function sanitizeFilename(name, fallbackExt) {
    var clean = String(name || 'cartina').split(/[\\/]/).pop();
    clean = clean.replace(/[<>:"|?*\x00-\x1f]/g, '').trim();
    return clean || fallbackExt;
  }

  function modifiedIsoFrom(file) {
    return file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
  }

  async function listExportedFolders(dir) {
    try { await dir.getDirectoryHandle('Esportazioni', { create: true }); } catch (error) { /* ignora */ }
    try { await dir.getDirectoryHandle('Cestino', { create: true }); } catch (error) { /* ignora */ }
  }

  async function isDataFolder(dir) {
    if (String(dir.name || '').toLowerCase() === 'files') return true;
    try { await dir.getFileHandle('impostazioni.json'); return true; } catch (error) { /* continua */ }
    try { await dir.getDirectoryHandle('Esportazioni'); return true; } catch (error) { /* continua */ }
    try {
      var iterator = dir.values();
      for (var i = 0; i < 100; i++) {
        var step = await iterator.next();
        if (step.done) break;
        if (step.value && step.value.kind === 'file' && /\.json$/i.test(String(step.value.name || ''))) return true;
      }
    } catch (error) { /* ignora */ }
    return false;
  }

  /* -- avvio ----------------------------------------------------------- */

  async function init() {
    var handle = await idbGet();
    if (!handle) return;
    var granted = 'prompt';
    try { granted = await handle.queryPermission({ mode: 'readwrite' }); } catch (error) { /* ignore */ }
    if (granted === 'granted') {
      state.dir = handle;
      state.name = handle.name || 'files';
      await listExportedFolders(handle);
    } else {
      savedHandle = handle;
    }
  }

  function ensureReady() {
    if (!ready) ready = init();
    return ready;
  }

  function needDir() {
    return !state.dir;
  }

  async function activateFolder() {
    await ensureReady();
    // 1) Riattivazione del permesso sulla cartella scelta in precedenza.
    if (state.dir) return { ok: true, name: state.name, restored: true };
    if (savedHandle) {
      try {
        var p = await savedHandle.requestPermission({ mode: 'readwrite' });
        if (p === 'granted') {
          state.dir = savedHandle;
          state.name = savedHandle.name || 'files';
          await listExportedFolders(state.dir);
          await idbSet(state.dir);
          savedHandle = null;
          return { ok: true, name: state.name, restored: true };
        }
        return { ok: false, error: 'Permesso non concesso per la cartella «' + (savedHandle.name || 'files') + '».' };
      } catch (error) {
        if (error && error.name === 'NotAllowedError') {
          return { ok: false, error: 'Serve un clic per riattivare l\'accesso: riprova sul pulsante verde.' };
        }
        savedHandle = null; // cartella non più valida: si riparte dalla scelta
      }
    }
    // 2) Prima apertura: la persona sceglie la cartella del programma.
    //    Se non è già una cartella dati, l'app crea al suo interno «files»
    //    e usa quella: i dati finiscono sempre accanto al file HTML.
    var dir;
    try {
      dir = await global.showDirectoryPicker({ id: 'cartina', mode: 'readwrite' });
    } catch (error) {
      if (error && error.name === 'AbortError') return { ok: false, cancelled: true };
      return { ok: false, error: (error && error.message) || 'Scelta della cartella non riuscita.' };
    }
    try {
      var perm = await dir.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return { ok: false, error: 'Permesso di scrittura negato: riprova e scegli «Salva modifiche»' };
    } catch (error) { /* l'utente ha già concesso con il selettore */ }
    var parent = '';
    try {
      if (!(await isDataFolder(dir))) {
        parent = dir.name || '';
        dir = await dir.getDirectoryHandle('files', { create: true });
      }
    } catch (error) {
      return { ok: false, error: 'Non è stato possibile creare la cartella «files»: ' + ((error && error.message) || error) };
    }
    state.dir = dir;
    state.name = dir.name || 'files';
    await listExportedFolders(dir);
    await idbSet(dir);
    return { ok: true, name: state.name, parent: parent, created: !!parent };
  }

  function requireDir() {
    if (!state.dir) throw new Error('Scegli la cartella della classe dal banner verde nella schermata iniziale.');
    return state.dir;
  }

  /* -- api ------------------------------------------------------------ */

  function create() {
    var api = {
      SAVES_FILES: true,

      app_info: async function () {
        await ensureReady();
        return {
          ok: true,
          version: '2.4 (HTML)',
          dataDir: state.dir ? (state.name + '  (cartella scelta)') : 'Cartella non ancora scelta',
          classesDir: state.dir ? state.name : '',
          exportsDir: state.dir ? state.name + '/Esportazioni' : '',
          isPortable: true,
          needDir: needDir(),
          restorePending: !!savedHandle,
          pendingName: savedHandle ? (savedHandle.name || 'files') : '',
        };
      },

      pick_data_dir: activateFolder,

      list_classes: async function () {
        await ensureReady();
        if (!state.dir) {
          return { ok: true, classes: [], dataDir: 'Cartella non ancora scelta', needDir: true };
        }
        var items = [];
        var skipped = 0;
        var names = [];
        var iterator = state.dir.values();
        while (true) {
          var step = await iterator.next();
          if (step.done) break;
          if (step.value.kind !== 'file') continue;
          var name = String(step.value.name || '');
          if (!/\.json$/i.test(name) || SERVICE_FILES[name.toLowerCase()]) continue;
          names.push(name);
        }
        names.sort();
        for (var i = 0; i < names.length; i++) {
          try {
            var handle = await state.dir.getFileHandle(names[i]);
            var file = await handle.getFile();
            var raw = JSON.parse(await file.text());
            var payload = readPayload(raw);
            var modified = asText(payload.modifiedAt) || asText(payload.savedAt) || modifiedIsoFrom(file);
            items.push(summary(names[i], payload, modified));
          } catch (error) {
            skipped++;
          }
        }
        items.sort(function (a, b) { return String(b.modified).localeCompare(String(a.modified)); });
        var result = { ok: true, classes: items, dataDir: state.name };
        if (skipped) result.warnings = [skipped + ' file ignorati perché non validi.'];
        return result;
      },

      create_class: async function (name) {
        await ensureReady();
        var dir = requireDir();
        var clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Nuova classe';
        var base = slugify(clean) + '-' + randomId() + '.json';
        var filename = base;
        for (var n = 2; n < 9999; n++) {
          try {
            await dir.getFileHandle(filename);
          } catch (error) { break; } // non esiste: va bene
          filename = base.replace(/\.json$/, '-' + n + '.json');
        }
        var payload = {
          app: 'cartina-di-classe',
          version: 1,
          data: { version: 1, className: clean, layout: [[2, 2, 2], [2, 2, 2], [2, 2, 2]], students: [], seats: {} },
        };
        await writeJson(dir, filename, payload);
        return { ok: true, file: filename, payload: payload, class: summary(filename, payload, payload.modifiedAt) };
      },

      load_class: async function (file) {
        await ensureReady();
        var dir = requireDir();
        try {
          var handle = await dir.getFileHandle(String(file || ''));
          var f = await handle.getFile();
          var payload = readPayload(JSON.parse(await f.text()));
          return { ok: true, file: String(file), payload: payload };
        } catch (error) {
          return { ok: false, error: /not|no file|trov/i.test(String(error && error.message)) ? 'La classe non esiste più nella cartella.' : 'Lettura non riuscita: ' + ((error && error.message) || error) };
        }
      },

      save_class: async function (file, payload) {
        await ensureReady();
        var dir = requireDir();
        if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
          return { ok: false, error: 'Dati della classe non validi.' };
        }
        try {
          var out = JSON.parse(JSON.stringify(payload));
          await writeJson(dir, String(file || ''), out);
          return { ok: true, file: String(file), modified: out.modifiedAt };
        } catch (error) {
          var msg = (error && error.message) || String(error);
          if (error && (error.name === 'NotAllowedError' || /no modifica|permission/i.test(msg))) {
            state.dir = null; // permesso revocato: il banner riappare
            return { ok: false, error: 'Permesso di scrittura non più attivo: clicca «Riattiva l\'accesso» per continuare a salvare.' };
          }
          return { ok: false, error: 'Salvataggio non riuscito: ' + msg };
        }
      },

      delete_class: async function (file) {
        await ensureReady();
        var dir = requireDir();
        var name = String(file || '');
        var stamp = new Date();
        var pad = function (v) { return String(v).padStart(2, '0'); };
        var suffix = stamp.getFullYear() + pad(stamp.getMonth() + 1) + pad(stamp.getDate()) + '-' + pad(stamp.getHours()) + pad(stamp.getMinutes()) + pad(stamp.getSeconds());
        try {
          var handle = await dir.getFileHandle(name);
        } catch (error) {
          return { ok: true, trash: null }; // già sparito: va bene
        }
        var trash = await dir.getDirectoryHandle('Cestino', { create: true });
        var target = name.replace(/\.json$/i, '') + '-' + suffix + '.json';
        var moved = false;
        try {
          if (typeof handle.move === 'function') {
            await handle.move(trash, target);
            moved = true;
          }
        } catch (error) { moved = false; }
        if (!moved) {
          var file = await handle.getFile();
          var copy = await trash.getFileHandle(target, { create: true }).then(function (h) { return h.createWritable(); });
          await copy.write(await file.arrayBuffer());
          await copy.close();
          await dir.removeEntry(name);
        }
        return { ok: true, trash: target };
      },

      rename_class: async function (file, name) {
        await ensureReady();
        var dir = requireDir();
        var clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!clean) return { ok: false, error: 'Il nome della classe non può essere vuoto.' };
        try {
          var handle = await dir.getFileHandle(String(file || ''));
          var raw = JSON.parse(await (await handle.getFile()).text());
          var payload = readPayload(raw);
          payload.data = payload.data && typeof payload.data === 'object' ? payload.data : {};
          payload.data.className = clean;
          await writeJson(dir, String(file), payload);
          return { ok: true, file: String(file), name: clean };
        } catch (error) {
          return { ok: false, error: 'La classe non esiste più nella cartella.' };
        }
      },

      duplicate_class: async function (file) {
        await ensureReady();
        var dir = requireDir();
        var filename = String(file || '');
        var raw;
        try {
          raw = JSON.parse(await (await (await dir.getFileHandle(filename)).getFile()).text());
        } catch (error) {
          return { ok: false, error: 'La classe non esiste più nella cartella.' };
        }
        var payload = readPayload(raw);
        var data = payload.data;
        data.className = (asText(data.className) || 'Classe') + ' (copia)';
        var base = slugify(data.className) + '-' + randomId() + '.json';
        var target = base;
        for (var n = 2; n < 9999; n++) {
          try { await dir.getFileHandle(target); } catch (error) { break; }
          target = base.replace(/\.json$/, '-' + n + '.json');
        }
        var idMap = {};
        (data.students || []).forEach(function (student) {
          if (student && student.id) {
            var newId = 's_' + randomId() + randomId();
            idMap[student.id] = newId;
            student.id = newId;
          }
        });
        if (data.seats && typeof data.seats === 'object') {
          var next = {};
          Object.keys(data.seats).forEach(function (k) {
            var v = data.seats[k];
            next[k] = idMap[v] || v;
          });
          data.seats = next;
        }
        await writeJson(dir, target, payload);
        return { ok: true, file: target, class: summary(target, payload, payload.modifiedAt) };
      },

      import_dialog: function () {
        return pickFile('.xlsx,.xlsm,.csv,.txt');
      },

      import_project_dialog: async function () {
        var picked = await pickFile('.json,application/json');
        if (!picked.ok) return picked;
        try {
          var bytes = await base64ToBytes(picked.base64);
          var payload = readPayload(JSON.parse(new TextDecoder().decode(bytes)));
          await ensureReady();
          var dir = requireDir();
          var data = payload.data;
          var name = asText(data.className) || String(picked.name || '').replace(/\.json$/i, '') || 'Classe importata';
          var base = slugify(name) + '-' + randomId() + '.json';
          var target = base;
          for (var n = 2; n < 9999; n++) {
            try { await dir.getFileHandle(target); } catch (error) { break; }
            target = base.replace(/\.json$/, '-' + n + '.json');
          }
          await writeJson(dir, target, payload);
          return { ok: true, file: target, payload: payload, class: summary(target, payload, payload.modifiedAt) };
        } catch (error) {
          return { ok: false, error: 'File non valido: ' + ((error && error.message) || error) };
        }
      },

      export_bytes: async function (filename, base64) {
        await ensureReady();
        var dir = requireDir();
        var name = sanitizeFilename(filename, 'cartina.png');
        var exports = await dir.getDirectoryHandle('Esportazioni', { create: true });
        var stem = name.replace(/\.[^.]+$/, '');
        var ext = (name.match(/\.[^.]+$/) || [''])[0];
        var candidate = name;
        for (var n = 2; n < 9999; n++) {
          var clash = null;
          try { clash = await exports.getFileHandle(candidate); } catch (error) { clash = null; }
          if (!clash) break;
          candidate = stem + '-' + n + ext;
        }
        try {
          var writable = await (await exports.getFileHandle(candidate, { create: true })).createWritable();
          await writable.write(await base64ToBytes(base64));
          await writable.close();
          var fileHandle = await exports.getFileHandle(candidate);
          exported[candidate] = fileHandle;
          var label = state.name + '/Esportazioni/' + candidate;
          return { ok: true, path: label, filename: candidate };
        } catch (error) {
          var msg = (error && error.message) || String(error);
          if (error && error.name === 'NotAllowedError') {
            state.dir = null;
            return { ok: false, error: 'Permesso di scrittura non più attivo: clicca «Riattiva l\'accesso» nella schermata iniziale.' };
          }
          return { ok: false, error: 'Impossibile scrivere il file: ' + msg };
        }
      },

      print_bytes: async function (filename, base64) {
        var saved = await api.export_bytes(filename, base64);
        if (!saved.ok) return saved;
        var opened = await api.open_path(saved.path);
        return {
          ok: true,
          path: saved.path,
          printed: false,
          message: 'Immagine salvata in ' + saved.path + (opened.ok ? ' e aperta in una nuova scheda: usa Ctrl+P per stamparla.' : ': aprila e usa Ctrl+P per stamparla.'),
        };
      },

      open_path: async function (path) {
        await ensureReady();
        var name = String(path || '').split(/[\\/]/).pop();
        var handle = exported[name] || null;
        if (!handle && state.dir) {
          try { handle = await state.dir.getFileHandle(name); } catch (error) {
            try {
              var exportsDir = await state.dir.getDirectoryHandle('Esportazioni');
              handle = await exportsDir.getFileHandle(name);
            } catch (error2) { /* non trovato */ }
          }
        }
        if (!handle) return { ok: false, error: 'File non disponibile.' };
        try {
          var file = await handle.getFile();
          var url = URL.createObjectURL(file);
          var win = global.open(url, '_blank');
          if (!win) return { ok: false, error: 'Il browser ha bloccato la scheda: consenti i popup e riprova.' };
          global.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
          return { ok: true, path: name };
        } catch (error) {
          return { ok: false, error: 'Apertura non riuscita: ' + ((error && error.message) || error) };
        }
      },

      open_folder: function (kind) {
        var where = state.dir ? (state.name + (kind === 'exports' || kind === 'exports2' ? '/Esportazioni' : ''))
                              : 'cartella non ancora scelta';
        return Promise.resolve({ ok: false, error: 'Dalla versione HTML apri la cartella «' + where + '» con Esplora file.' });
      },

      open_log: function () {
        return Promise.resolve({ ok: false, error: 'Il registro diagnostico è disponibile solo nell\'app .exe.' });
      },

      settings_load: async function () {
        var stored = null;
        try { stored = JSON.parse(global.localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (error) { /* ignore */ }
        await ensureReady();
        if (state.dir) {
          try {
            var handle = await state.dir.getFileHandle('impostazioni.json');
            var fromFile = JSON.parse(await (await handle.getFile()).text());
            if (fromFile && typeof fromFile === 'object') {
              global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(fromFile));
              return { ok: true, settings: fromFile };
            }
          } catch (error) { // non scritta: restano quelle locali
          }
        }
        return { ok: true, settings: stored && typeof stored === 'object' ? stored : {} };
      },

      settings_save: async function (settings) {
        try {
          global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (error) { /* ignore */ }
        await ensureReady();
        if (state.dir) {
          try {
            await writeJson(state.dir, 'impostazioni.json', settings);
          } catch (error) { // localStorage resta il file di scorta
          }
        }
        return { ok: true };
      },

      set_title: function (title) {
        global.document.title = 'Cartina di Classe' + (title ? ' — ' + String(title) : '');
        return Promise.resolve({ ok: true });
      },

      confirm: function (title, message) {
        return Promise.resolve(global.confirm(title + '\n\n' + message));
      },

      message: function (title, message) {
        global.alert(title + '\n\n' + message);
        return Promise.resolve(true);
      },

      log_client: function (message) {
        if (global.console) console.info('[Cartina]', message);
        return Promise.resolve({ ok: true });
      },
    };

    // needDir si aggiorna via property getter: quando la cartella diventa attiva false.
    Object.defineProperty(api, 'needDir', {
      get: function () { return needDir(); },
      enumerable: true,
    });

    return api;
  }

  /* -- supporto --------------------------------------------------------- */

  async function writeJson(dir, filename, payload) {
    payload.app = payload.app || 'cartina-di-classe';
    payload.version = payload.version || 1;
    payload.modifiedAt = new Date().toISOString();
    payload.savedAt = payload.modifiedAt;
    var handle = await dir.getFileHandle(filename, { create: true });
    var text = JSON.stringify(payload, null, 2) + '\n';
    // createWritable scrive su un file temporaneo e applica il risultato
    // alla chiusura: il salvataggio resta integro anche in caso di problema.
    var writable = await handle.createWritable();
    await writable.write(new Blob([text]));
    await writable.close();
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var input = global.document.createElement('input');
      input.type = 'file';
      input.accept = accept || '';
      input.style.position = 'fixed';
      input.style.left = '-2000px';
      input.setAttribute('aria-hidden', 'true');
      global.document.body.appendChild(input);
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        try { input.remove(); } catch (error) { /* ignore */ }
        resolve(value);
      }
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) { finish({ ok: false, cancelled: true }); return; }
        if (file.size > 12 * 1024 * 1024) {
          finish({ ok: false, error: 'Il file è troppo grande (massimo 12 MB).' });
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          var result = String(reader.result || '');
          finish({ ok: true, name: file.name, base64: result.slice(result.indexOf(',') + 1) });
        };
        reader.onerror = function () {
          finish({ ok: false, error: 'Lettura del file non riuscita.' });
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });
  }

  async function base64ToBytes(base64) {
    var clean = String(base64 || '').split(',').pop();
    var response = await fetch('data:application/octet-stream;base64,' + clean);
    return await response.arrayBuffer();
  }

  global.CCWebApi = {
    available: available,
    create: create,
  };
})(window);
