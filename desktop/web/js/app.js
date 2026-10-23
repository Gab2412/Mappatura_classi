/* Cartina di Classe — interfaccia desktop (home + classe) */
(function (global) {
  'use strict';

  const CC = global.CC;
  const core = CC.core;
  const store = CC.createStore();
  const PARAMS = new URLSearchParams(global.location.search);
  const DESKTOP = PARAMS.has('desktop');
  const PREVIEW = PARAMS.has('preview');
  const doc = global.document;

  const el = {};
  const app = {
    view: 'home',
    file: null,
    className: '',
    classes: [],
    info: {},
    settings: store.getSettings(),
    panelOpen: true,
    initialized: false,
    busy: false,
    lastSaved: null,
    activeSeatKey: null,
    activeStudentId: null,
    nameMode: 'create',
    nameTarget: null,
    importAnalysis: null,
    confirmResolve: null,
    exportedPath: null,
    quickAdded: [],
    wizardStep: 1,
    wizardLayout: null,
    wizardWindows: 'none',
    mapView: { scale: 1, x: 0, y: 0 },
    mapDrag: null,
    suppressClick: false,
    suppressTimer: null,
    flashTimer: null,
    layoutGridCols: 0,
    toastTimer: null,
    settingsTimer: null,
    saveTimer: null,
    saveChain: Promise.resolve(),
  };

  let api = null;

  /* ------------------------------------------------------------------ */
  /* Utilità                                                            */
  /* ------------------------------------------------------------------ */

  function $(id) {
    return doc.getElementById(id);
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  function formatModified(iso) {
    if (!iso) return 'data sconosciuta';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);
    try {
      return date.toLocaleString('it-IT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (error) {
      return String(iso);
    }
  }

  function timeShort(iso) {
    const date = iso ? new Date(iso) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    try {
      return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      return '';
    }
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('Lettura del file non riuscita.'));
      };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBytes(base64) {
    const binary = global.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function base64ToText(base64) {
    return new TextDecoder('utf-8').decode(base64ToBytes(base64));
  }

  function announce(text) {
    if (!el.srStatus) return;
    el.srStatus.textContent = '';
    global.setTimeout(function () {
      el.srStatus.textContent = text;
    }, 30);
  }

  function toast(message, isError) {
    if (!message) return;
    clearTimeout(app.toastTimer);
    el.toast.textContent = message;
    el.toast.classList.toggle('is-error', !!isError);
    el.toast.hidden = false;
    announce(message);
    app.toastTimer = global.setTimeout(function () {
      el.toast.hidden = true;
    }, isError ? 7000 : 4200);
  }

  function showDialog(dialog) {
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function confirmDanger(title, message, okLabel) {
    return new Promise(function (resolve) {
      if (app.confirmResolve) {
        app.confirmResolve(false);
        app.confirmResolve = null;
      }
      app.confirmResolve = resolve;
      el.confirmTitle.textContent = title;
      el.confirmMessage.textContent = message;
      el.confirmOk.textContent = okLabel || 'Conferma';
      showDialog(el.dialogConfirm);
      el.confirmCancel.focus();
    });
  }

  function finishConfirm(value) {
    const resolve = app.confirmResolve;
    app.confirmResolve = null;
    closeDialog(el.dialogConfirm);
    if (resolve) resolve(value);
  }

  /* ------------------------------------------------------------------ */
  /* API: desktop reale oppure anteprima nel browser                    */
  /* ------------------------------------------------------------------ */

  function waitForDesktopApi() {
    return new Promise(function (resolve) {
      if (global.pywebview && global.pywebview.api) {
        resolve(global.pywebview.api);
        return;
      }
      let finished = false;
      function done() {
        if (finished) return;
        if (global.pywebview && global.pywebview.api) {
          finished = true;
          resolve(global.pywebview.api);
        }
      }
      global.addEventListener('pywebviewready', done, { once: true });
      global.setTimeout(function () {
        if (finished) return;
        finished = true;
        resolve((global.pywebview && global.pywebview.api) || mockApi());
      }, 4000);
    });
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.position = 'fixed';
      input.style.left = '-2000px';
      input.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(input);
      let settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(value);
      }
      input.addEventListener('change', function () {
        const file = input.files && input.files[0];
        if (!file) {
          finish({ ok: false, cancelled: true });
          return;
        }
        const reader = new FileReader();
        reader.onload = function () {
          const result = String(reader.result || '');
          finish({
            ok: true,
            name: file.name,
            base64: result.slice(result.indexOf(',') + 1),
          });
        };
        reader.onerror = function () {
          finish({ ok: false, error: 'Lettura del file non riuscita.' });
        };
        reader.readAsDataURL(file);
      });
      input.click();
    });
  }

  function mockApi() {
    const KEY = 'cc.desktop.mock.classes.v1';
    const SETTINGS = 'cc.desktop.mock.settings.v1';

    function readDb() {
      try {
        const parsed = JSON.parse(global.localStorage.getItem(KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (error) {
        return {};
      }
    }

    function writeDb(db) {
      try {
        global.localStorage.setItem(KEY, JSON.stringify(db));
      } catch (error) {
        // L'anteprima resta utilizzabile anche senza spazio locale.
      }
    }

    function summary(file, payload) {
      const data = payload.data || payload;
      const layout = Array.isArray(data.layout) ? data.layout : [];
      const seats = data.seats && typeof data.seats === 'object' ? data.seats : {};
      let capacity = 0;
      layout.forEach(function (row) {
        if (Array.isArray(row)) {
          row.forEach(function (value) {
            capacity += Math.max(0, Number(value) || 0);
          });
        }
      });
      return {
        file: file,
        name: data.className || 'Classe senza nome',
        students: Array.isArray(data.students) ? data.students.length : 0,
        capacity: capacity,
        assigned: Object.keys(seats).length,
        modified: payload.modifiedAt || payload.savedAt || new Date().toISOString(),
      };
    }

    function uniqueFile(name) {
      const db = readDb();
      const base = 'mock-' + Date.now().toString(36);
      let file = base + '.json';
      let n = 2;
      while (db[file]) {
        file = base + '-' + n + '.json';
        n += 1;
      }
      return file;
    }

    function downloadBase64(filename, base64) {
      const bytes = base64ToBytes(base64);
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const link = doc.createElement('a');
      link.href = url;
      link.download = filename || 'cartina';
      doc.body.appendChild(link);
      link.click();
      link.remove();
      global.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 3000);
      return { ok: true, filename: filename, path: '(download del browser)' };
    }

    return {
      app_info: function () {
        return Promise.resolve({
          ok: true,
          version: '2.5 (anteprima)',
          dataDir: 'Anteprima nel browser: i file veri sono nell\'app desktop',
          classesDir: '',
          exportsDir: '',
          isPortable: true,
        });
      },
      list_classes: function () {
        const db = readDb();
        const classes = Object.keys(db).map(function (file) {
          return summary(file, db[file]);
        });
        classes.sort(function (a, b) {
          return String(b.modified).localeCompare(String(a.modified));
        });
        return Promise.resolve({ ok: true, classes: classes, dataDir: 'Anteprima nel browser' });
      },
      create_class: function (name) {
        const clean = String(name || '').trim() || 'Nuova classe';
        const file = uniqueFile(clean);
        const payload = {
          app: 'cartina-di-classe',
          version: 1,
          savedAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          data: {
            version: 1,
            className: clean,
            layout: [[2, 2, 2], [2, 2, 2], [2, 2, 2]],
            students: [],
            seats: {},
          },
        };
        const db = readDb();
        db[file] = payload;
        writeDb(db);
        return Promise.resolve({ ok: true, file: file, payload: payload, class: summary(file, payload) });
      },
      load_class: function (file) {
        const db = readDb();
        if (!db[file]) return Promise.resolve({ ok: false, error: 'Classe non trovata (anteprima).' });
        return Promise.resolve({ ok: true, file: file, payload: db[file] });
      },
      save_class: function (file, payload) {
        const db = readDb();
        const next = JSON.parse(JSON.stringify(payload));
        next.modifiedAt = new Date().toISOString();
        next.savedAt = next.modifiedAt;
        db[file] = next;
        writeDb(db);
        return Promise.resolve({ ok: true, file: file, modified: next.modifiedAt });
      },
      delete_class: function (file) {
        const db = readDb();
        delete db[file];
        writeDb(db);
        return Promise.resolve({ ok: true });
      },
      rename_class: function (file, name) {
        const db = readDb();
        if (!db[file]) return Promise.resolve({ ok: false, error: 'Classe non trovata.' });
        db[file].data.className = String(name || '').trim();
        db[file].modifiedAt = new Date().toISOString();
        writeDb(db);
        return Promise.resolve({ ok: true, file: file, name: db[file].data.className });
      },
      duplicate_class: function (file) {
        const db = readDb();
        if (!db[file]) return Promise.resolve({ ok: false, error: 'Classe non trovata.' });
        const copy = JSON.parse(JSON.stringify(db[file]));
        copy.data.className = (copy.data.className || 'Classe') + ' (copia)';
        const newFile = uniqueFile(copy.data.className);
        copy.modifiedAt = new Date().toISOString();
        db[newFile] = copy;
        writeDb(db);
        return Promise.resolve({ ok: true, file: newFile, class: summary(newFile, copy) });
      },
      import_dialog: function () {
        return pickFile('.xlsx,.xlsm,.csv,.txt');
      },
      import_project_dialog: async function () {
        const picked = await pickFile('.json,application/json');
        if (!picked.ok) return picked;
        try {
          const payload = JSON.parse(base64ToText(picked.base64));
          const data = payload.data || payload;
          const clean = String(data.className || picked.name.replace(/\.json$/i, '')) || 'Classe importata';
          const file = uniqueFile(clean);
          const db = readDb();
          db[file] = payload.data ? payload : { data: payload };
          db[file].modifiedAt = new Date().toISOString();
          writeDb(db);
          return { ok: true, file: file, payload: db[file], class: summary(file, db[file]) };
        } catch (error) {
          return { ok: false, error: 'File non valido: ' + error.message };
        }
      },
      export_bytes: function (filename, base64) {
        return Promise.resolve(downloadBase64(filename, base64));
      },
      print_bytes: function () {
        return Promise.resolve({
          ok: false,
          error: 'La stampa è disponibile solo nell\'app desktop.',
        });
      },
      settings_load: function () {
        try {
          return Promise.resolve({
            ok: true,
            settings: JSON.parse(global.localStorage.getItem(SETTINGS) || '{}'),
          });
        } catch (error) {
          return Promise.resolve({ ok: true, settings: {} });
        }
      },
      settings_save: function (settings) {
        try {
          global.localStorage.setItem(SETTINGS, JSON.stringify(settings));
        } catch (error) {
          // ignore
        }
        return Promise.resolve({ ok: true });
      },
      open_folder: function () {
        toast('Anteprima nel browser: la cartella è disponibile nell\'app desktop.');
        return Promise.resolve({ ok: true });
      },
      set_title: function (title) {
        doc.title = 'Cartina di Classe' + (title ? ' — ' + title : '');
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
      open_log: function () {
        toast('Anteprima nel browser: il registro è disponibile nell\'app desktop.');
        return Promise.resolve({ ok: true });
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* Avvio                                                              */
  /* ------------------------------------------------------------------ */

  async function init() {
    cacheElements();

    if (DESKTOP) {
      api = await waitForDesktopApi();
    } else {
      api = (global.CCWebApi && global.CCWebApi.available())
        ? global.CCWebApi.create()
        : mockApi();
    }
    app.savesFiles = DESKTOP || (api && api.SAVES_FILES === true);
    app.noFileApi = !DESKTOP && !PREVIEW && !(global.CCWebApi && global.CCWebApi.available());
    if (app.noFileApi) {
      ['btn-new-class', 'btn-new-class-empty', 'btn-open-file', 'btn-open-classes'].forEach(function (id) {
        const button = $(id);
        if (button) button.disabled = true;
      });
    }

    const info = await safeCall('app_info', {});
    app.info = info || {};
    if (app.info.dataDir) {
      el.dataDir.textContent = app.info.dataDir;
    }

    const saved = await safeCall('settings_load', { settings: {} });
    store.restore();
    if (saved && saved.settings && Object.keys(saved.settings).length) {
      store.setSettings(saved.settings);
    } else {
      store.setSettings({ theme: 'dark', textSize: 22 });
    }
    store.applyTheme();
    app.settings = store.getSettings();
    applySettingsToUi();

    bindUi();
    bindStore();
    patchExporter();

    const state = store.getState();
    if (!state.className) {
      // La prima classe creata parte da una disposizione 3 × 3 con 2 banchi,
      // coerente con il modello Excel e con l'anteprima storica.
    }

    setView('home');
    await refreshHome();
    app.initialized = true;
    el.homeTitle.setAttribute('tabindex', '-1');
    el.homeTitle.focus();
    if (api && api.log_client) {
      api.log_client('Interfaccia pronta · v' + (app.info.version || '?') + ' · ' + (DESKTOP ? 'desktop' : 'HTML (browser)'));
    }
  }

  async function safeCall(name, fallback) {
    const args = Array.prototype.slice.call(arguments, 2);
    try {
      if (!api || typeof api[name] !== 'function') return fallback;
      const result = await api[name].apply(api, args);
      return result == null ? fallback : result;
    } catch (error) {
      console.error('Errore API ' + name, error);
      return fallback;
    }
  }

  function cacheElements() {
    [
      'view-home', 'view-class', 'home-title', 'class-list', 'home-empty',
      'data-dir', 'class-title', 'save-status', 'map-root', 'side-panel',
      'panel-layout', 'panel-students', 'layout-summary', 'students-summary',
      'layout-head', 'layout-body', 'layout-text', 'rows-input', 'cols-input',
      'students-input', 'student-search', 'roster-body', 'roster-summary',
      'toast', 'sr-status', 'dialog-name', 'name-dialog-title',
      'name-dialog-subtitle', 'name-input', 'name-error', 'name-submit',
      'form-name', 'dialog-desk', 'desk-dialog-title', 'desk-location',
      'desk-student', 'desk-empty-hint', 'desk-new-block', 'desk-new-name',
      'desk-feedback', 'dialog-assign', 'assign-dialog-title',
      'assign-location', 'assign-seat', 'dialog-student', 'student-dialog-title',
      'student-location', 'student-name-input', 'student-error',
      'dialog-settings', 'dialog-import', 'import-body', 'import-actions',
      'dialog-confirm', 'confirm-title', 'confirm-message', 'confirm-ok',
      'confirm-cancel', 'text-size', 'text-size-out', 'name-mode',
      'show-numbers', 'show-empty', 'export-dpi', 'image-ratio', 'btn-toggle-panel',
      'btn-undo', 'btn-redo', 'btn-desk-assign', 'btn-desk-clear',
      'btn-assign-seat', 'btn-save-student', 'btn-remove-student',
      'dialog-add-students', 'add-students-subtitle', 'quick-name',
      'btn-quick-add', 'quick-add-feedback', 'quick-added-list', 'btn-import-2',
      'dialog-wizard', 'wizard-step-label', 'wiz-name', 'wiz-name-error',
      'wiz-rows', 'wiz-cols', 'wiz-windows', 'wiz-grid', 'wiz-side-left',
      'wiz-side-right', 'wiz-layout-preview',
      'wiz-students', 'wiz-back', 'wiz-next', 'wiz-create',
      'panel-resizer', 'windows-side',
      'map-area', 'map-zoom-in', 'map-zoom-out', 'map-zoom-reset',
      'dialog-exported', 'exported-name', 'exported-info', 'btn-open-image',
      'btn-open-exports-2',
      'folder-banner', 'btn-choose-folder', 'folder-banner-title', 'folder-banner-text',
    ].forEach(function (id) {
      el[id.replace(/-([a-z])/g, function (_, letter) { return letter.toUpperCase(); })] = $(id);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Eventi                                                             */
  /* ------------------------------------------------------------------ */

  function bindUi() {
    $('btn-new-class').addEventListener('click', openWizard);
    $('btn-new-class-empty').addEventListener('click', openWizard);
    $('btn-open-file').addEventListener('click', openProjectFile);
    $('btn-open-classes').addEventListener('click', function () {
      openFolder('classes');
    });
    $('btn-open-classes-2').addEventListener('click', function () {
      openFolder('classes');
    });
    $('btn-open-exports').addEventListener('click', function () {
      openFolder('exports');
    });
    $('btn-open-log').addEventListener('click', function () {
      if (!api || !api.open_log) return;
      Promise.resolve(api.open_log()).then(function (res) {
        if (res && !res.ok && res.error) toast(res.error, true);
      });
    });
    $('btn-home-settings').addEventListener('click', openSettings);
    $('btn-class-settings').addEventListener('click', openSettings);

    $('btn-back').addEventListener('click', goHome);
    $('btn-rename-class').addEventListener('click', function () {
      if (app.file) openNameDialog('rename', app.file, app.className);
    });
    $('btn-undo').addEventListener('click', function () {
      store.undo();
    });
    $('btn-redo').addEventListener('click', function () {
      store.redo();
    });

    $('btn-add-students').addEventListener('click', openAddStudents);
    $('btn-open-add-students').addEventListener('click', openAddStudents);
    $('btn-quick-add').addEventListener('click', quickAddStudent);
    el.quickName.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        quickAddStudent();
      }
    });
    $('btn-import-2').addEventListener('click', importFromFile);
    if ($('btn-edit-layout')) {
      $('btn-edit-layout').addEventListener('click', function () {
        openPanel('layout');
      });
    }
    if ($('btn-auto-assign')) {
      $('btn-auto-assign').addEventListener('click', autoAssignSeats);
    }
    el.btnTogglePanel.addEventListener('click', function () {
      togglePanel();
    });

    $('btn-export-light').addEventListener('click', function () {
      exportImage('light');
    });
    $('btn-export-dark').addEventListener('click', function () {
      exportImage('dark');
    });
    $('btn-print').addEventListener('click', printMap);
    $('btn-open-image').addEventListener('click', openExportedImage);
    $('btn-open-exports-2').addEventListener('click', function () {
      openFolder('exports');
    });

    $('wiz-next').addEventListener('click', function () {
      setWizardStep(app.wizardStep + 1);
    });
    $('wiz-back').addEventListener('click', function () {
      setWizardStep(app.wizardStep - 1);
    });
    $('wiz-create').addEventListener('click', wizardFinish);
    [el.wizRows, el.wizCols].forEach(function (input) {
      input.addEventListener('change', function () {
        syncWizardSize();
      });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
    });
    el.wizWindows.addEventListener('change', function () {
      app.wizardWindows = el.wizWindows.value;
      renderWizardWindows();
    });
    el.wizGrid.addEventListener('input', onWizardGridInput);
    el.wizGrid.addEventListener('change', normalizeWizardCell);
    el.wizGrid.addEventListener('focusin', function (event) {
      if (event.target.matches('input')) event.target.select();
    });
    el.wizName.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        setWizardStep(2);
      }
    });

    el.classList.addEventListener('click', onHomeAction);

    el.mapRoot.addEventListener('click', function (event) {
      const desk = event.target.closest('.desk-button');
      if (desk) {
        openDeskDialog(desk.getAttribute('data-seat-key'));
        return;
      }
      const action = event.target.closest('[data-action="go-layout"]');
      if (action) openPanel('layout');
    });

    el.layoutBody.addEventListener('click', onLayoutClick);
    el.layoutBody.addEventListener('change', onLayoutChange);
    el.rosterBody.addEventListener('click', onRosterClick);
    el.studentSearch.addEventListener('input', renderRoster);

    $('btn-apply-size').addEventListener('click', applySize);
    $('btn-apply-layout-text').addEventListener('click', applyLayoutText);
    $('btn-clear-seats').addEventListener('click', clearAllSeats);
    $('btn-add-names').addEventListener('click', addNames);
    $('btn-import').addEventListener('click', importFromFile);

    el.formName.addEventListener('submit', onSubmitName);
    el.btnDeskAssign.addEventListener('click', assignDeskStudent);
    el.deskNewName.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        assignDeskStudent();
      }
    });
    el.btnDeskClear.addEventListener('click', clearDeskStudent);
    el.windowsSide.addEventListener('change', function () {
      setWindowsSide(el.windowsSide.value);
    });
    initPanelResizer();
    initMapView();
    el.btnAssignSeat.addEventListener('click', assignSelectedSeat);
    el.btnSaveStudent.addEventListener('click', saveStudentName);
    el.btnRemoveStudent.addEventListener('click', removeStudent);

    el.confirmOk.addEventListener('click', function () {
      finishConfirm(true);
    });
    el.confirmCancel.addEventListener('click', function () {
      finishConfirm(false);
    });
    el.dialogConfirm.addEventListener('close', function () {
      if (app.confirmResolve) {
        const resolve = app.confirmResolve;
        app.confirmResolve = null;
        resolve(false);
      }
    });

    doc.querySelectorAll('[data-close]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeDialog(button.closest('dialog'));
      });
    });

    bindSettings();
    bindShortcuts();

    if (el.btnChooseFolder) el.btnChooseFolder.addEventListener('click', chooseFolder);

    global.addEventListener('beforeunload', function () {
      if (app.file) {
        // Tentativo best-effort: l'autosalvataggio è già stato programmato.
        saveNow();
      }
    });
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden' && app.file) saveNow();
    });
  }

  function bindStore() {
    store.on('change', function () {
      if (!app.initialized) return;
      if (app.view === 'class') {
        renderClass();
        scheduleSave();
      }
    });
    store.on('settings', function (settings) {
      app.settings = settings;
      applySettingsToUi();
      clearTimeout(app.settingsTimer);
      app.settingsTimer = global.setTimeout(function () {
        if (api && api.settings_save) api.settings_save(settings);
      }, 350);
      if (app.initialized && app.view === 'class') renderClass();
    });
    store.on('history', updateHistoryButtons);
    store.on('announce', function (detail) {
      if (!detail || !detail.text) return;
      announce(detail.text);
      if (detail.toast) toast(detail.text);
    });
  }

  function bindShortcuts() {
    doc.addEventListener('keydown', function (event) {
      if (event.defaultPrevented) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = String(event.key || '').toLowerCase();
      const editing = event.target.closest && event.target.closest('input, textarea, select, [contenteditable="true"]');

      if (mod && key === 's') {
        if (app.view === 'class' && app.file) {
          event.preventDefault();
          saveNow().then(function () {
            toast('Classe salvata.');
          });
        }
        return;
      }
      if (app.view !== 'class') return;
      if (editing) return;
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      } else if (mod && key === 'y') {
        event.preventDefault();
        store.redo();
      }
    });
  }

  function bindSettings() {
    doc.querySelectorAll('input[name="theme"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) store.setSettings({ theme: radio.value });
      });
    });
    el.textSize.addEventListener('input', function () {
      const value = Number(el.textSize.value);
      el.textSizeOut.textContent = String(value);
      store.setSettings({ textSize: value });
    });
    el.showNumbers.addEventListener('change', function () {
      store.setSettings({ showNumbers: el.showNumbers.checked });
    });
    el.showEmpty.addEventListener('change', function () {
      store.setSettings({ showEmpty: el.showEmpty.checked });
    });
    el.nameMode.addEventListener('change', function () {
      store.setSettings({ nameMode: el.nameMode.value });
    });
    el.exportDpi.addEventListener('change', function () {
      store.setSettings({ exportDpi: Number(el.exportDpi.value) });
    });
    el.imageRatio.addEventListener('change', function () {
      store.setSettings({ imageRatio: el.imageRatio.value });
    });
  }

  function applySettingsToUi() {
    const settings = store.getSettings();
    app.settings = settings;
    doc.querySelectorAll('input[name="theme"]').forEach(function (radio) {
      radio.checked = radio.value === settings.theme;
    });
    el.textSize.value = String(settings.textSize);
    el.textSizeOut.textContent = String(settings.textSize);
    el.showNumbers.checked = !!settings.showNumbers;
    el.showEmpty.checked = !!settings.showEmpty;
    el.nameMode.value = settings.nameMode;
    el.exportDpi.value = String(settings.exportDpi);
    el.imageRatio.value = settings.imageRatio || 'auto';
    const panelWidth = Number(settings.panelWidth) || 0;
    if (panelWidth > 0) {
      doc.documentElement.style.setProperty('--panel-width', Math.min(64, Math.max(17, panelWidth)) + 'rem');
    }
  }

  function openSettings() {
    applySettingsToUi();
    showDialog(el.dialogSettings);
  }

  /* ------------------------------------------------------------------ */
  /* Home                                                               */
  /* ------------------------------------------------------------------ */

  async function refreshHome() {
    const res = await safeCall('list_classes', { classes: [] });
    app.classes = Array.isArray(res.classes) ? res.classes : [];
    if (res.dataDir && el.dataDir) {
      el.dataDir.textContent = res.dataDir;
    }
    updateFolderBanner();
    renderHome();
  }

  function updateFolderBanner() {
    const ready = folderReady();
    const blockedReason = app.noFileApi
      ? 'Apri l\'app con Chrome o Edge per creare o aprire classi.'
      : 'Prima scegli una cartella per i file.';

    ['btn-new-class', 'btn-new-class-empty', 'btn-open-file', 'btn-open-classes'].forEach(function (id) {
      const b = $(id);
      if (b) {
        b.disabled = !ready;
        if (!ready) {
          b.setAttribute('title', blockedReason);
          b.setAttribute('aria-disabled', 'true');
        } else {
          b.removeAttribute('title');
          b.removeAttribute('aria-disabled');
        }
      }
    });

    if (app.noFileApi) {
      el.folderBanner.hidden = false;
      if (el.folderBannerTitle) el.folderBannerTitle.textContent = 'Serve Chrome o Edge';
      if (el.folderBannerText) {
        el.folderBannerText.textContent = 'Questo browser non permette di salvare nella cartella dei file. Apri l\'app con Chrome o Edge: le classi resteranno in file .json nella cartella scelta.';
      }
      if (el.btnChooseFolder) el.btnChooseFolder.hidden = true;
      return;
    }
    if (el.btnChooseFolder) el.btnChooseFolder.hidden = false;
    const needed = Boolean(api && api.needDir === true);
    el.folderBanner.hidden = !needed;
    if (!needed) return;
    const restore = app.info && app.info.restorePending === true;
    if (el.folderBannerTitle) {
      el.folderBannerTitle.textContent = restore
        ? 'Riattiva la cartella dei file'
        : 'Senza la cartella dei file l\'app non può funzionare';
    }
    if (el.folderBannerText) {
      const chooseFolderText = location.protocol === 'file:'
        ? 'Scegli la cartella in cui si trova questo file HTML: l\'app crea lì la sottocartella files e vi salva le classi. Finché non la scegli, non è possibile creare o aprire classi.'
        : 'Scegli una cartella per i file: l\'app crea lì la sottocartella files e vi salva le classi. Finché non la scegli, non è possibile creare o aprire classi.';
      el.folderBannerText.textContent = restore
        ? 'Hai già scelto la cartella «' + (app.info.pendingName || 'files') + '». Per sicurezza il browser richiede un clic: premi «Riattiva l\'accesso» per continuare a leggere e salvare le classi.'
        : chooseFolderText;
    }
    if (el.btnChooseFolder) {
      el.btnChooseFolder.textContent = restore ? 'Riattiva l\'accesso' : 'Scegli la cartella…';
    }
  }

  function folderReady() {
    if (DESKTOP) return true;
    return Boolean(api && api.needDir !== true);
  }

  async function ensureFolder() {
    if (folderReady()) return true;
    el.folderBanner.hidden = false;
    const restore = app.info && app.info.restorePending === true;
    toast(restore
      ? 'Riattiva l\'accesso alla cartella «' + (app.info.pendingName || 'files') + '»: senza di essa l\'app non può funzionare.'
      : 'Prima di iniziare scegli la cartella dei file: senza di essa l\'app non può funzionare.', true);
    if (el.btnChooseFolder) el.btnChooseFolder.focus();
    await chooseFolder();
    return folderReady();
  }

  async function chooseFolder() {
    if (!api || typeof api.pick_data_dir !== 'function') return;
    const res = await api.pick_data_dir();
    if (res && res.ok) {
      app.info.dataDir = res.name;
      app.info.restorePending = false;
      app.info.pendingName = '';
      el.dataDir.textContent = res.name + '  (cartella scelta)';
      const where = res.parent ? ' dentro «' + res.parent + '»' : '';
      toast(res.restored
        ? 'Accesso riattivato: i file della cartella «' + res.name + '» sono di nuovo disponibili.'
        : 'Cartella «' + res.name + '» pronta' + where + ': le classi vengono salvate lì.');
      el.folderBanner.hidden = true;
      await refreshHome();
    } else if (res && res.error) {
      toast(res.error, true);
    }
  }

  function renderHome() {
    const empty = app.classes.length === 0;
    el.homeEmpty.hidden = !empty;
    el.classList.hidden = empty;
    if (empty) {
      el.classList.innerHTML = '';
      return;
    }

    el.classList.innerHTML = app.classes.map(function (item, index) {
      const count = Number(item.students) || 0;
      const capacity = Number(item.capacity) || 0;
      return '' +
        '<li class="class-card">' +
          '<div class="class-card-main">' +
            '<span class="class-index" aria-hidden="true">' + (index + 1) + '</span>' +
            '<div class="class-card-info">' +
              '<button type="button" class="class-open" data-action="open" data-file="' + esc(item.file) + '">' + esc(item.name) + '</button>' +
              '<p class="class-meta">' + count + ' ' + plural(count, 'alunno', 'alunni') +
                ' · ' + capacity + ' ' + plural(capacity, 'banco', 'banchi') +
                ' · modificata il ' + esc(formatModified(item.modified)) + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="card-actions">' +
            '<button type="button" class="btn btn-blue" data-action="open" data-file="' + esc(item.file) + '">Apri</button>' +
            '<button type="button" class="btn btn-amber" data-action="rename" data-file="' + esc(item.file) + '">Rinomina</button>' +
            '<button type="button" class="btn btn-ghost" data-action="duplicate" data-file="' + esc(item.file) + '">Duplica</button>' +
            '<button type="button" class="btn btn-red" data-action="delete" data-file="' + esc(item.file) + '">Elimina</button>' +
          '</div>' +
        '</li>';
    }).join('');
  }

  async function onHomeAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    const file = button.getAttribute('data-file');
    if (action === 'open') {
      await openClass(file);
    } else if (action === 'rename') {
      const item = app.classes.find(function (entry) { return entry.file === file; });
      openNameDialog('rename', file, item ? item.name : '');
    } else if (action === 'duplicate') {
      await duplicateClass(file);
    } else if (action === 'delete') {
      await deleteClass(file);
    }
  }

  async function deleteClass(file) {
    const item = app.classes.find(function (entry) { return entry.file === file; });
    const name = item ? item.name : 'questa classe';
    const ok = await confirmDanger(
      'Eliminare la classe?',
      'La classe «' + name + '» sarà spostata nella cartella Cestino. Potrai recuperarla dalla cartella delle classi.',
      'Elimina'
    );
    if (!ok) return;
    const res = await safeCall('delete_class', { ok: false }, file);
    if (!res || !res.ok) {
      toast('Eliminazione non riuscita: ' + ((res && res.error) || 'errore'), true);
      return;
    }
    await refreshHome();
    toast('Classe «' + name + '» spostata nel Cestino.');
  }

  async function duplicateClass(file) {
    if (!api || typeof api.duplicate_class !== 'function') {
      toast('Duplicazione non disponibile in questa versione.', true);
      return;
    }
    const res = await api.duplicate_class(file);
    if (!res || !res.ok) {
      toast('Duplicazione non riuscita: ' + ((res && res.error) || 'errore'), true);
      return;
    }
    await refreshHome();
    toast('Classe duplicata.');
  }

  async function openProjectFile() {
    if (!(await ensureFolder())) return;
    if (!api || typeof api.import_project_dialog !== 'function') return;
    const res = await api.import_project_dialog();
    if (!res || !res.ok) {
      if (res && res.error) toast(res.error, true);
      return;
    }
    await refreshHome();
    await openClass(res.file, res.payload);
    toast('Classe importata.');
  }

  async function openFolder(kind) {
    if (!(await ensureFolder())) return;
    if (!api || typeof api.open_folder !== 'function') return;
    const res = await api.open_folder(kind);
    if (res && res.ok && res.path) {
      toast('Cartella aperta: ' + res.path);
    } else if (res && res.error) {
      if (el.dialogExported && el.dialogExported.open && el.exportedInfo) {
        el.exportedInfo.textContent = res.error;
        el.exportedInfo.style.color = 'var(--c-amber, #b45309)';
      }
      toast(res.error, true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Apertura e chiusura di una classe                                  */
  /* ------------------------------------------------------------------ */

  async function openClass(file, payload) {
    let data = payload;
    if (!data) {
      let res;
      try {
        res = await api.load_class(file);
      } catch (error) {
        res = { ok: false, error: String(error) };
      }
      if (!res || !res.ok) {
        toast((res && res.error) || 'Impossibile aprire la classe.', true);
        return;
      }
      data = res.payload;
    }

    let state;
    try {
      state = core.sanitizeState(data);
    } catch (error) {
      toast('Classe non valida: ' + error.message, true);
      return;
    }

    app.file = file;
    app.className = state.className || '';
    app.lastSaved = (data && (data.modifiedAt || data.savedAt)) || null;
    app.panelOpen = true;
    app.quickAdded = [];

    // Sostituisce lo stato mentre siamo ancora nella home, così non parte
    // un salvataggio inutile della classe appena aperta.
    store.replaceState(state, { resetHistory: true });
    app.view = 'class';
    setView('class');
    renderClass();
    resetMapView();
    el.layoutText.value = core.formatLayoutText(state.layout);
    app.lastSaved = app.lastSaved || new Date().toISOString();
    setSaveStatus('saved');
    if (api && api.set_title) api.set_title(app.className);
    el.classTitle.focus();
    el.sidePanel.hidden = false;
    const body = doc.querySelector('.class-body');
    if (body) body.classList.remove('panel-closed');
    updatePanelButton();
  }

  async function goHome() {
    if (app.file) await saveNow();
    app.file = null;
    app.className = '';
    clearTimeout(app.saveTimer);
    app.saveTimer = null;
    app.view = 'home';
    setView('home');
    if (api && api.set_title) api.set_title('');
    await refreshHome();
    el.homeTitle.setAttribute('tabindex', '-1');
    el.homeTitle.focus();
  }

  function setView(view) {
    el.viewHome.hidden = view !== 'home';
    el.viewClass.hidden = view !== 'class';
  }

  /* ------------------------------------------------------------------ */
  /* Rendering della classe                                             */
  /* ------------------------------------------------------------------ */

  function renderClass() {
    const state = store.getState();
    const settings = store.getSettings();
    app.className = state.className || '';

    el.classTitle.textContent = app.className || 'Classe senza nome';
    if (api && api.set_title) api.set_title(app.className);

    CC.mapView.renderInto(el.mapRoot, state, settings);
    CC.mapView.bindKeyboard(el.mapRoot);

    const st = core.stats(state);
    el.layoutSummary.textContent = st.rows + ' file × ' + st.cols + ' colonne · ' + st.capacity + ' ' + plural(st.capacity, 'banco', 'banchi');
    el.studentsSummary.textContent = st.students + ' ' + plural(st.students, 'alunno', 'alunni') + ' · ' + st.assigned + ' sistemati';

    CC.editor.renderLayout(state, el.layoutHead, el.layoutBody);
    updateLayoutGrid();
    el.windowsSide.value = state.windowsSide || 'none';
    if (doc.activeElement !== el.layoutText) {
      el.layoutText.value = core.formatLayoutText(state.layout);
    }
    renderRoster();
    updateHistoryButtons();
  }

  function updateLayoutGrid() {
    // La tabella dei banchi usa layout a tabella flessibile che si espande con la colonna.
  }

  function renderRoster() {
    const state = store.getState();
    const query = el.studentSearch.value;
    const stats = CC.editor.renderRoster(state, { tbody: el.rosterBody, query: query });
    if (!state.students.length) {
      el.rosterBody.innerHTML = '<tr><td colspan="3" class="hint">Nessun alunno. Usa «+ Aggiungi alunni» qui sopra per inserirli.</td></tr>';
    }
    if (stats.filtered) {
      el.rosterSummary.textContent = 'Mostrati ' + stats.shown + ' di ' + stats.total + ' alunni.';
    } else {
      el.rosterSummary.textContent = stats.total + ' ' + plural(stats.total, 'alunno', 'alunni') + ' nell\'elenco.';
    }
  }

  function updateHistoryButtons() {
    const info = store.historyInfo();
    el.btnUndo.disabled = !info.canUndo;
    el.btnRedo.disabled = !info.canRedo;
    el.btnUndo.title = info.undoLabel ? 'Annulla: ' + info.undoLabel : 'Niente da annullare';
    el.btnRedo.title = info.redoLabel ? 'Ripeti: ' + info.redoLabel : 'Niente da ripetere';
  }

  function updatePanelButton() {
    el.btnTogglePanel.setAttribute('aria-expanded', String(app.panelOpen));
    el.btnTogglePanel.setAttribute('aria-pressed', String(app.panelOpen));
    el.btnTogglePanel.classList.toggle('is-active', app.panelOpen);
    el.btnTogglePanel.title = app.panelOpen
      ? 'Nascondi il pannello di modifica e guarda la pianta'
      : 'Mostra il pannello per modificare banchi e alunni';
  }

  function togglePanel(force) {
    app.panelOpen = typeof force === 'boolean' ? force : !app.panelOpen;
    el.sidePanel.hidden = !app.panelOpen;
    const body = doc.querySelector('.class-body');
    if (body) body.classList.toggle('panel-closed', !app.panelOpen);
    updatePanelButton();
    if (app.panelOpen) el.sidePanel.scrollTop = 0;
  }

  function openPanel(which) {
    if (!app.panelOpen) togglePanel(true);
    const isLayout = which === 'layout';
    const block = isLayout ? el.panelLayout : el.panelStudents;
    const other = isLayout ? el.panelStudents : el.panelLayout;
    block.open = true;
    other.open = false;
    block.scrollIntoView({ block: 'start', behavior: 'smooth' });
    flashPanelBlock(block);
    if (isLayout) {
      toast('Modifica banchi: imposta file, colonne o il numero di banchi nelle celle.');
      global.setTimeout(function () {
        if (el.rowsInput) el.rowsInput.focus();
      }, 100);
    }
  }

  function flashPanelBlock(block) {
    if (!block) return;
    block.classList.remove('is-flash');
    void block.offsetWidth;
    block.classList.add('is-flash');
    clearTimeout(app.flashTimer);
    app.flashTimer = setTimeout(function () {
      block.classList.remove('is-flash');
    }, 1400);
  }

  /* ------------------------------------------------------------------ */
  /* Pianta: ingrandimento e spostamento col mouse                      */
  /* ------------------------------------------------------------------ */

  const MAP_MIN_SCALE = 0.6;
  const MAP_MAX_SCALE = 3;
  const MAP_SCALE_STEP = 0.2;

  function applyMapView() {
    if (!el.mapRoot) return;
    const view = app.mapView;
    el.mapRoot.style.transform =
      'translate(' + Math.round(view.x) + 'px, ' + Math.round(view.y) + 'px) scale(' + view.scale + ')';
    if (el.mapZoomReset) {
      const percent = Math.round(view.scale * 100);
      el.mapZoomReset.textContent = percent + '%';
      el.mapZoomReset.setAttribute('aria-label',
        'Ingrandimento ' + percent + ' per cento. Premi per tornare al cento per cento.');
    }
  }

  function resetMapView() {
    app.mapView = { scale: 1, x: 0, y: 0 };
    if (el.mapArea) {
      el.mapArea.scrollTop = 0;
      el.mapArea.scrollLeft = 0;
    }
    applyMapView();
  }

  function zoomMapTo(next, clientX, clientY) {
    if (!el.mapArea) return;
    const view = app.mapView;
    const scale = Math.min(MAP_MAX_SCALE,
      Math.max(MAP_MIN_SCALE, Math.round(next * 100) / 100));
    if (scale === view.scale) return;
    const rect = el.mapArea.getBoundingClientRect();
    const px = typeof clientX === 'number' ? clientX - rect.left : rect.width / 2;
    const py = typeof clientY === 'number' ? clientY - rect.top : rect.height / 2;
    const cx = px + el.mapArea.scrollLeft;
    const cy = py + el.mapArea.scrollTop;
    const ratio = scale / view.scale;
    view.x = cx - (cx - view.x) * ratio;
    view.y = cy - (cy - view.y) * ratio;
    view.scale = scale;
    applyMapView();
  }

  function initMapView() {
    const area = el.mapArea;
    if (!area) return;

    area.addEventListener('selectstart', function (event) {
      event.preventDefault();
    });
    area.addEventListener('dragstart', function (event) {
      event.preventDefault();
    });

    area.addEventListener('wheel', function (event) {
      if (app.view !== 'class') return;
      event.preventDefault();
      zoomMapTo(app.mapView.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY);
    }, { passive: false });

    area.addEventListener('pointerdown', function (event) {
      if (app.view !== 'class' || event.button !== 0) return;
      if (event.target.closest('.map-tools, .desk-button, button, a, input, select')) return;
      event.preventDefault();
      if (global.getSelection) {
        try { global.getSelection().removeAllRanges(); } catch (e) {}
      }
      app.mapDrag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: app.mapView.x,
        originY: app.mapView.y,
        moved: false,
      };
      try { area.setPointerCapture(event.pointerId); } catch (error) { /* ignora */ }
    });

    area.addEventListener('pointermove', function (event) {
      const drag = app.mapDrag;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        area.classList.add('is-panning');
        doc.body.classList.add('is-panning');
        if (global.getSelection) {
          try { global.getSelection().removeAllRanges(); } catch (e) {}
        }
      }
      if (!drag.moved) return;
      app.mapView.x = drag.originX + dx;
      app.mapView.y = drag.originY + dy;
      applyMapView();
    });

    function endPan(event) {
      const drag = app.mapDrag;
      if (!drag || drag.id !== event.pointerId) return;
      app.mapDrag = null;
      area.classList.remove('is-panning');
      doc.body.classList.remove('is-panning');
      if (global.getSelection) {
        try { global.getSelection().removeAllRanges(); } catch (e) {}
      }
      if (drag.moved) {
        app.suppressClick = true;
        clearTimeout(app.suppressTimer);
        app.suppressTimer = global.setTimeout(function () {
          app.suppressClick = false;
        }, 500);
      }
      try { area.releasePointerCapture(event.pointerId); } catch (error) { /* ignora */ }
    }

    area.addEventListener('pointerup', endPan);
    area.addEventListener('pointercancel', endPan);

    // Un trascinamento non deve aprire il dialogo del banco sotto il mouse.
    area.addEventListener('click', function (event) {
      if (!app.suppressClick) return;
      app.suppressClick = false;
      if (event.target.closest('.map-tools')) return;
      event.preventDefault();
      event.stopPropagation();
    }, true);

    area.addEventListener('keydown', function (event) {
      if (event.target !== area) return;
      const step = 70;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomMapTo(app.mapView.scale + MAP_SCALE_STEP);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomMapTo(app.mapView.scale - MAP_SCALE_STEP);
      } else if (event.key === '0') {
        event.preventDefault();
        resetMapView();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
                 event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (event.key === 'ArrowLeft') app.mapView.x += step;
        if (event.key === 'ArrowRight') app.mapView.x -= step;
        if (event.key === 'ArrowUp') app.mapView.y += step;
        if (event.key === 'ArrowDown') app.mapView.y -= step;
        applyMapView();
      }
    });

    if (el.mapZoomIn) {
      el.mapZoomIn.addEventListener('click', function () {
        zoomMapTo(app.mapView.scale + MAP_SCALE_STEP);
      });
    }
    if (el.mapZoomOut) {
      el.mapZoomOut.addEventListener('click', function () {
        zoomMapTo(app.mapView.scale - MAP_SCALE_STEP);
      });
    }
    if (el.mapZoomReset) {
      el.mapZoomReset.addEventListener('click', resetMapView);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Salvataggio                                                        */
  /* ------------------------------------------------------------------ */

  function setSaveStatus(kind, detail) {
    if (!el.saveStatus) return;
    el.saveStatus.classList.remove('is-saving', 'is-error');
    if (kind === 'saving') {
      el.saveStatus.textContent = 'Salvataggio…';
      el.saveStatus.classList.add('is-saving');
    } else if (kind === 'error') {
      el.saveStatus.textContent = 'Salvataggio non riuscito' + (detail ? ' — ' + detail : '');
      el.saveStatus.classList.add('is-error');
    } else {
      el.saveStatus.textContent = 'Salvato' + (app.lastSaved ? ' · ' + timeShort(app.lastSaved) : '');
    }
  }

  function scheduleSave() {
    if (!app.file) return;
    clearTimeout(app.saveTimer);
    app.saveTimer = global.setTimeout(function () {
      app.saveTimer = null;
      saveNow();
    }, 350);
  }

  function saveNow() {
    if (!app.file) return Promise.resolve({ ok: true });
    const file = app.file;
    const payload = core.projectPayload(store.getState());
    setSaveStatus('saving');
    const task = app.saveChain.then(function () {
      return api.save_class(file, payload);
    }).then(function (res) {
      if (res && res.ok) {
        app.lastSaved = res.modified || payload.savedAt;
        if (file === app.file) setSaveStatus('saved');
        return { ok: true };
      }
      const message = (res && res.error) || 'errore sconosciuto';
      if (file === app.file) setSaveStatus('error', message);
      return { ok: false, error: message };
    }).catch(function (error) {
      if (file === app.file) setSaveStatus('error', String(error));
      return { ok: false, error: String(error) };
    });
    app.saveChain = task.then(function () { return undefined; });
    return task;
  }

  /* ------------------------------------------------------------------ */
  /* Banchi                                                             */
  /* ------------------------------------------------------------------ */

  function focusInLayout(key) {
    if (!key) return;
    global.setTimeout(function () {
      const target = el.layoutBody.querySelector('[data-focus-key="' + key + '"]');
      if (target) target.focus();
    }, 0);
  }

  function applyDeskCount(r, c, nextValue) {
    const current = store.getState();
    const value = core.clampInt(nextValue, 0, core.LIMITS.desksPerCell, current.layout[r][c] || 0);
    const res = core.setDeskCount(current, r, c, value);
    if (res.error) {
      toast(res.error, true);
      return;
    }
    if (!res.state) return;
    const removed = res.removed.length;
    store.commit(res.state, {
      label: 'Modifica banchi',
      coalesce: 'desk-' + r + '-' + c,
      announce: CC.editor.rowParts(r, current.layout.length).name + ', '
        + CC.editor.columnHead(c, current.layout[0].length) + ': ' + value + ' ' + plural(value, 'banco', 'banchi')
        + (removed ? '. ' + removed.length + ' ' + plural(removed.length, 'alunno spostato', 'alunni spostati') : '') + '.',
    });
  }

  function onLayoutClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    const r = Number(button.getAttribute('data-r'));
    const c = Number(button.getAttribute('data-c'));
    const current = store.getState();
    if (!current.layout[r] || current.layout[r][c] == null) return;
    if (action === 'desk-plus') {
      applyDeskCount(r, c, (current.layout[r][c] || 0) + 1);
      focusInLayout('desk-plus-' + r + '-' + c);
    } else if (action === 'desk-minus') {
      applyDeskCount(r, c, (current.layout[r][c] || 0) - 1);
      focusInLayout('desk-minus-' + r + '-' + c);
    }
  }

  function onLayoutChange(event) {
    const input = event.target.closest('.desk-count-input');
    if (!input) return;
    const r = Number(input.getAttribute('data-r'));
    const c = Number(input.getAttribute('data-c'));
    applyDeskCount(r, c, input.value);
    focusInLayout('count-' + r + '-' + c);
  }

  function applySize() {
    const state = store.getState();
    const rows = Number(el.rowsInput.value);
    const cols = Number(el.colsInput.value);
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) {
      toast('Indica un numero valido di file e colonne (almeno 1).', true);
      return;
    }
    const res = core.resizeLayout(state, rows, cols);
    if (!res.state) return;
    const removed = res.removed ? res.removed.length : 0;
    store.commit(res.state, {
      label: 'Dimensione aula',
      announce: 'Disposizione impostata: ' + res.state.layout.length + ' file per ' + res.state.layout[0].length
        + ' colonne.' + (removed ? ' ' + removed + ' ' + plural(removed, 'alunno senza posto', 'alunni senza posto') + '.' : ''),
    });
  }

  function applyLayoutText() {
    const parsed = core.parseLayoutText(el.layoutText.value);
    if (!parsed.ok) {
      toast(parsed.errors.join(' '), true);
      announce(parsed.errors.join(' '));
      return;
    }
    const state = store.getState();
    const next = core.clone(state);
    next.layout = core.sanitizeLayout(parsed.layout);
    const valid = core.buildSeatIndex(Object.assign({}, next, { seats: {} }));
    const seats = {};
    Object.keys(state.seats).forEach(function (key) {
      if (valid.byKey.has(key) && !seats[key]) seats[key] = state.seats[key];
    });
    next.seats = seats;
    const removed = Object.keys(state.seats).length - Object.keys(seats).length;
    store.commit(next, {
      label: 'Disposizione da testo',
      announce: 'Disposizione applicata: ' + next.layout.length + ' file per ' + next.layout[0].length + ' colonne.'
        + (removed ? ' ' + removed + ' ' + plural(removed, 'posto non più valido', 'posti non più validi') + '.' : ''),
    });
    if (parsed.warnings.length) toast(parsed.warnings.join(' '));
  }

  /* Lato delle finestre: aiuta a riconoscere l'aula a colpo d'occhio. */
  function setWindowsSide(side) {
    const value = core.sanitizeWindowsSide(side);
    const state = store.getState();
    if ((state.windowsSide || 'none') === value) return;
    const next = core.clone(state);
    next.windowsSide = value;
    store.commit(next, {
      label: 'Lato finestre',
      announce: value === 'none'
        ? 'Finestre: nessun lato indicato.'
        : 'Finestre indicate a ' + (value === 'left' ? 'sinistra.' : 'destra.'),
    });
  }

  /* Larghezza della colonna destra, trascinabile e ricordata. */
  function initPanelResizer() {
    const handle = el.panelResizer;
    const body = doc.querySelector('.class-body');
    if (!handle || !body) return;
    const root = doc.documentElement;
    const MIN = 17;
    const MAX = 75;
    const DEFAULT = 27;
    let current = 0;
    let dragging = false;

    function remSize() {
      const value = parseFloat(global.getComputedStyle(root).fontSize);
      return Number.isFinite(value) && value > 0 ? value : 22;
    }
    function clampWidth(value) {
      return Math.min(MAX, Math.max(MIN, Math.round(value * 10) / 10));
    }
    function panelWidth() {
      if (!el.sidePanel.hidden) {
        const width = el.sidePanel.getBoundingClientRect().width;
        if (width > 0) return width / remSize();
      }
      return Number(store.getSettings().panelWidth) || DEFAULT;
    }
    function apply(rem) {
      root.style.setProperty('--panel-width', rem + 'rem');
      handle.setAttribute('aria-valuenow', String(Math.round(rem)));
      return rem;
    }
    function save(rem) {
      if (Math.abs((Number(store.getSettings().panelWidth) || 0) - rem) < 0.05) return;
      store.setSettings({ panelWidth: rem });
    }
    function set(rem, persist) {
      current = apply(clampWidth(rem));
      if (persist) save(current);
    }

    handle.setAttribute('aria-valuemin', String(MIN));
    handle.setAttribute('aria-valuemax', String(MAX));
    handle.setAttribute('aria-valuenow', String(Math.round(panelWidth())));

    handle.addEventListener('pointerdown', function (event) {
      if (event.button) return;
      dragging = true;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      const rect = body.getBoundingClientRect();
      set((rect.right - event.clientX) / remSize(), false);
    });
    function stop(event) {
      if (!dragging) return;
      dragging = false;
      if (handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      save(current);
    }
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('dblclick', function () {
      set(DEFAULT, true);
    });
    handle.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      set(panelWidth() + (event.key === 'ArrowLeft' ? 1 : -1), true);
    });

    // Quando cambia la larghezza della colonna, la tabella dei banchi
    // ricalcola quante celle stanno in una riga.
    if (typeof global.ResizeObserver === 'function') {
      new global.ResizeObserver(function () {
        updateLayoutGrid();
      }).observe(el.sidePanel);
    }
  }

  async function clearAllSeats() {
    const state = store.getState();
    if (!Object.keys(state.seats).length) {
      toast('Tutti i posti sono già liberi.');
      return;
    }
    const ok = await confirmDanger(
      'Svuotare tutti i posti?',
      'Gli alunni restano nell\'elenco ma nessuno avrà più un posto assegnato. Puoi annullare con «Annulla».',
      'Svuota posti'
    );
    if (!ok) return;
    store.commit(Object.assign({}, state, { seats: {} }), {
      label: 'Svuota posti',
      announce: 'Tutti i posti sono stati liberati.',
    });
  }

  async function autoAssignSeats() {
    const state = store.getState();
    if (!state.students.length) {
      toast('Nessun alunno: clicca su «Aggiungi alunni» per inserire i nomi della classe.', true);
      openAddStudents();
      return;
    }
    const res = core.autoAssign(state, { keepExisting: true, sort: 'az' });
    if (!res.assigned) {
      toast(res.remainingStudents ? 'Non ci sono banchi liberi sufficienti per i rimanenti alunni.' : 'Tutti gli alunni hanno già un banco assegnato.');
      return;
    }
    store.commit(res.state, {
      label: 'Disposizione automatica',
      announce: 'Disposti ' + res.assigned + ' ' + plural(res.assigned, 'alunno', 'alunni') + ' nei banchi liberi.'
        + (res.remainingStudents ? ' Restano ' + res.remainingStudents + ' senza posto.' : ''),
    });
    toast('Disposti ' + res.assigned + ' ' + plural(res.assigned, 'alunno', 'alunni') + ' nei banchi liberi (A→Z).'
      + (res.remainingStudents ? ' Restano ' + res.remainingStudents + ' senza posto.' : ''));
  }

  /* ------------------------------------------------------------------ */
  /* Alunni                                                             */
  /* ------------------------------------------------------------------ */

  function addNames() {
    const text = el.studentsInput.value;
    const res = core.addStudentsFromText(store.getState(), text);
    if (!res.added.length) {
      if (res.duplicates.length) toast('Nomi già presenti: ' + res.duplicates.join(', '));
      else toast('Scrivi almeno un nome, uno per riga.');
      return;
    }
    let message = 'Aggiunti ' + res.added.length + ' ' + plural(res.added.length, 'alunno', 'alunni') + '.';
    if (res.duplicates.length) message += ' Già presenti: ' + res.duplicates.join(', ') + '.';
    store.commit(res.state, { label: 'Aggiungi alunni', announce: message });
    el.studentsInput.value = '';
    toast(message);
  }

  /* ------------------------------------------------------------------ */
  /* Schermata «Aggiungi alunni»                                        */
  /* ------------------------------------------------------------------ */

  function countNames(text) {
    return String(text == null ? '' : text).split(/\r?\n/).filter(function (line) {
      return line.trim() !== '';
    }).length;
  }

  function openAddStudents() {
    app.quickAdded = app.quickAdded || [];
    el.quickAddFeedback.textContent = '';
    el.quickAddFeedback.className = 'feedback';
    el.quickName.value = '';
    renderQuickAdded();
    updateAddStudentsSubtitle();
    showDialog(el.dialogAddStudents);
    global.setTimeout(function () {
      el.quickName.focus();
    }, 30);
  }

  function updateAddStudentsSubtitle() {
    const total = store.getState().students.length;
    el.addStudentsSubtitle.textContent = total
      ? total + ' ' + plural(total, 'alunno', 'alunni') + ' nell\'elenco. Scrivi un nome e premi «Aggiungi».'
      : 'Scrivi un nome e premi «Aggiungi».';
  }

  function renderQuickAdded() {
    const names = app.quickAdded || [];
    el.quickAddedList.hidden = names.length === 0;
    el.quickAddedList.innerHTML = names.map(function (name) {
      return '<li>' + esc(name) + '</li>';
    }).join('');
  }

  function quickAddStudent() {
    const res = core.addStudentsFromText(store.getState(), el.quickName.value);
    if (!res.added.length) {
      el.quickAddFeedback.className = 'feedback error';
      el.quickAddFeedback.textContent = res.duplicates.length
        ? 'Già in elenco: ' + res.duplicates.join(', ') + '.'
        : 'Scrivi un nome e premi «Aggiungi».';
      el.quickName.focus();
      return;
    }
    const name = res.added[0].name;
    app.quickAdded = (app.quickAdded || []).concat(res.added.map(function (s) { return s.name; })).slice(-8);
    store.commit(res.state, {
      label: 'Aggiungi alunno',
      announce: name + ' aggiunto all\'elenco.',
    });
    el.quickName.value = '';
    el.quickAddFeedback.className = 'feedback';
    el.quickAddFeedback.textContent = 'Aggiunto: ' + name + '. Totale ' + store.getState().students.length + ' ' + plural(store.getState().students.length, 'alunno', 'alunni') + '.';
    renderQuickAdded();
    updateAddStudentsSubtitle();
    el.quickName.focus();
  }

  function onRosterClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (action === 'open-desk') {
      openDeskDialog(button.getAttribute('data-seat-key'));
    } else if (action === 'assign-student') {
      openAssignDialog(button.getAttribute('data-student-id'));
    } else if (action === 'manage-student') {
      openStudentDialog(button.getAttribute('data-student-id'));
    }
  }

  function openDeskDialog(seatKey) {
    const state = store.getState();
    const index = core.buildSeatIndex(state);
    const seat = index.byKey.get(seatKey);
    if (!seat) return;
    app.activeSeatKey = seatKey;
    const free = !seat.student;
    el.deskDialogTitle.textContent = 'Posto ' + seat.number;
    el.deskLocation.textContent = CC.editor.seatPositionText(seat);
    CC.editor.renderDeskStudentSelect(state, el.deskStudent, seatKey);
    el.deskStudent.value = seat.student ? seat.student.id : '';
    el.deskEmptyHint.hidden = state.students.length > 0;
    el.btnDeskAssign.disabled = false;
    el.btnDeskClear.disabled = !seat.student;
    // Su un posto libero si può anche scrivere subito il nome di un nuovo alunno.
    el.deskNewBlock.hidden = !free;
    el.deskNewName.value = '';
    setDeskFeedback('');
    showDialog(el.dialogDesk);
    global.setTimeout(function () {
      if (free && state.students.length === 0) el.deskNewName.focus();
      else el.deskStudent.focus();
    }, 30);
  }

  function setDeskFeedback(message, isError) {
    el.deskFeedback.textContent = message || '';
    el.deskFeedback.className = isError ? 'feedback error' : 'feedback';
  }

  function assignDeskStudent() {
    const studentId = el.deskStudent.value;
    // «Assegna» fa tutto: se l'elenco è vuoto usa il nome scritto a mano.
    if (!studentId && !el.deskNewBlock.hidden && el.deskNewName.value.trim()) {
      createDeskStudent();
      return;
    }
    if (!studentId) {
      const message = el.deskNewBlock.hidden
        ? 'Scegli un alunno dall\'elenco.'
        : 'Scegli un alunno dall\'elenco oppure scrivi un nome nuovo.';
      setDeskFeedback(message, true);
      if (el.deskNewBlock.hidden) el.deskStudent.focus();
      else el.deskNewName.focus();
      return;
    }
    const seatKey = app.activeSeatKey;
    const res = core.assignSeat(store.getState(), seatKey, studentId);
    if (res.error) {
      setDeskFeedback(res.error, true);
      return;
    }
    if (res.state && res.info) {
      let message = res.info.student.name + ' al posto ' + res.info.to.number + '.';
      if (res.info.displacedTo && res.info.displacedTo.key) {
        const index = core.buildSeatIndex(res.state);
        const displacedSeat = index.byKey.get(res.info.displacedTo.key);
        if (displacedSeat && displacedSeat.student) {
          message += ' ' + displacedSeat.student.name + ' è stato spostato al posto ' + displacedSeat.number + '.';
        }
      }
      store.commit(res.state, { label: 'Assegna posto', announce: message });
    }
    closeDialog(el.dialogDesk);
    focusDesk(seatKey);
  }

  function clearDeskStudent() {
    const seatKey = app.activeSeatKey;
    const res = core.clearSeat(store.getState(), seatKey);
    if (res.info && res.state) {
      store.commit(res.state, {
        label: 'Libera posto',
        announce: 'Posto ' + res.info.at.number + ' liberato' + (res.info.student ? ' (' + res.info.student.name + ').' : '.'),
      });
    }
    closeDialog(el.dialogDesk);
    focusDesk(seatKey);
  }

  /* Crea l'alunno e lo siede subito nel posto libero aperto. */
  function createDeskStudent() {
    const seatKey = app.activeSeatKey;
    const name = el.deskNewName.value;
    if (!String(name).trim()) {
      setDeskFeedback('Scrivi nome e cognome, poi premi Assegna.', true);
      el.deskNewName.focus();
      return;
    }
    const added = core.addStudent(store.getState(), name);
    if (added.error) {
      setDeskFeedback(added.error, true);
      return;
    }
    const res = core.assignSeat(added.state, seatKey, added.student.id);
    if (res.error) {
      setDeskFeedback(res.error, true);
      return;
    }
    if (res.state) {
      const seatNumber = res.info && res.info.to ? res.info.to.number : '';
      const message = added.created
        ? added.student.name + ' aggiunto al posto ' + seatNumber + '.'
        : added.student.name + ' era già in elenco: sistemato al posto ' + seatNumber + '.';
      store.commit(res.state, {
        label: added.created ? 'Nuovo alunno' : 'Assegna posto',
        announce: message,
      });
    }
    closeDialog(el.dialogDesk);
    focusDesk(seatKey);
  }

  function focusDesk(seatKey) {
    global.setTimeout(function () {
      CC.mapView.focusByKey(el.mapRoot, 'desk-' + seatKey);
    }, 30);
  }

  function openAssignDialog(studentId) {
    const state = store.getState();
    const student = core.studentById(state, studentId);
    if (!student) return;
    app.activeStudentId = studentId;
    const seatKey = core.findStudentSeat(state, studentId);
    const seat = seatKey ? core.buildSeatIndex(state).byKey.get(seatKey) : null;
    el.assignDialogTitle.textContent = 'Cambia posto';
    el.assignLocation.textContent = student.name + (seat ? ' · ora al posto ' + seat.number : ' · non assegnato');
    const info = CC.editor.renderSeatSelect(state, el.assignSeat, seatKey);
    el.btnAssignSeat.disabled = !info || info.count === 0;
    showDialog(el.dialogAssign);
    global.setTimeout(function () {
      el.assignSeat.focus();
    }, 30);
  }

  function assignSelectedSeat() {
    const key = el.assignSeat.value;
    if (!key) {
      toast('Scegli un posto libero.', true);
      return;
    }
    const res = core.assignSeat(store.getState(), key, app.activeStudentId);
    if (res.error) {
      toast(res.error, true);
      return;
    }
    if (res.state && res.info) {
      store.commit(res.state, {
        label: 'Cambia posto',
        announce: res.info.student.name + ' al posto ' + res.info.to.number + '.',
      });
    }
    closeDialog(el.dialogAssign);
    focusDesk(key);
  }

  function openStudentDialog(studentId) {
    const state = store.getState();
    const student = core.studentById(state, studentId);
    if (!student) return;
    const seatKey = core.findStudentSeat(state, studentId);
    const seat = seatKey ? core.buildSeatIndex(state).byKey.get(seatKey) : null;
    app.activeStudentId = studentId;
    el.studentDialogTitle.textContent = student.name;
    el.studentLocation.textContent = seat ? 'Posto ' + seat.number + ' · ' + seat.rowLabel + ' · ' + seat.colShort : 'Non assegnato';
    el.studentNameInput.value = student.name;
    el.studentError.textContent = '';
    showDialog(el.dialogStudent);
    global.setTimeout(function () {
      el.studentNameInput.focus();
      el.studentNameInput.select();
    }, 30);
  }

  function saveStudentName() {
    const name = el.studentNameInput.value;
    const res = core.renameStudent(store.getState(), app.activeStudentId, name);
    if (res.error) {
      el.studentError.textContent = res.error;
      return;
    }
    store.commit(res.state, { label: 'Rinomina alunno', announce: 'Alunno rinominato in ' + name + '.' });
    closeDialog(el.dialogStudent);
  }

  async function removeStudent() {
    const student = core.studentById(store.getState(), app.activeStudentId);
    if (!student) return;
    const ok = await confirmDanger(
      'Rimuovere l\'alunno?',
      '«' + student.name + '» sarà tolto dall\'elenco e il suo posto sarà liberato. Puoi annullare con «Annulla».',
      'Rimuovi'
    );
    if (!ok) return;
    store.commit(core.removeStudent(store.getState(), student.id), {
      label: 'Rimuovi alunno',
      announce: student.name + ' rimosso dall\'elenco.',
    });
    closeDialog(el.dialogStudent);
  }

  /* ------------------------------------------------------------------ */
  /* Importazione                                                       */
  /* ------------------------------------------------------------------ */

  async function importFromFile() {
    if (!api || typeof api.import_dialog !== 'function') return;
    const picked = await api.import_dialog();
    if (!picked || !picked.ok) {
      if (picked && picked.error) toast(picked.error, true);
      return;
    }
    try {
      const bytes = base64ToBytes(picked.base64);
      const file = new File([bytes], picked.name);
      const analysis = await CC.importer.analyzeFile(file);
      app.importAnalysis = analysis;
      showImportDialog(analysis);
    } catch (error) {
      toast('Importazione non riuscita: ' + error.message, true);
    }
  }

  function showImportDialog(analysis) {
    const layout = analysis.layout;
    const students = Array.isArray(analysis.students) ? analysis.students : [];
    let html = '';
    html += '<div class="import-summary">';
    html += '<h3>' + esc(analysis.fileName || 'File selezionato') + '</h3>';
    html += '<p class="import-found">Alunni trovati: ' + students.length + '</p>';
    if (layout) {
      html += '<p>Disposizione: <strong>' + layout.rows + ' file × ' + layout.cols + ' colonne</strong> · ' + layout.capacity + ' banchi</p>';
    } else {
      html += '<p class="import-missing">Nessuna disposizione dei banchi nel file.</p>';
    }
    if (analysis.withPosition) {
      html += '<p>Posti già indicati nel file: <strong>' + analysis.withPosition + '</strong></p>';
    }
    if (analysis.warnings && analysis.warnings.length) {
      html += '<div class="import-warning"><strong>Avvertenze</strong><ul>';
      analysis.warnings.slice(0, 8).forEach(function (warning) {
        html += '<li>' + esc(warning) + '</li>';
      });
      if (analysis.warnings.length > 8) html += '<li>…e altre ' + (analysis.warnings.length - 8) + '.</li>';
      html += '</ul></div>';
    }
    html += '</div>';
    html += '<p class="hint">Scegli come applicare il file. Potrai annullare con «Annulla» dopo l\'importazione.</p>';
    el.importBody.innerHTML = html;

    let actions = '';
    if (layout) {
      actions += '<button type="button" class="btn btn-blue" data-import-mode="replace">' +
        (students.length ? 'Sostituisci tutto' : 'Applica disposizione') + '</button>';
    }
    if (students.length) {
      actions += '<button type="button" class="btn btn-green" data-import-mode="students">Aggiungi solo gli alunni</button>';
    }
    actions += '<button type="button" class="btn btn-ghost" id="btn-import-template">Scarica modello Excel</button>';
    actions += '<button type="button" class="btn btn-ghost" data-close>Annulla</button>';
    el.importActions.innerHTML = actions;

    el.importActions.querySelectorAll('[data-import-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        applyImport(button.getAttribute('data-import-mode'));
      });
    });
    const template = $('btn-import-template');
    if (template) {
      template.addEventListener('click', function () {
        try {
          CC.importer.downloadTemplate();
          toast('Modello Excel salvato nella cartella Esportazioni.');
        } catch (error) {
          toast(error.message, true);
        }
      });
    }
    el.importActions.querySelectorAll('[data-close]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeDialog(el.dialogImport);
      });
    });

    showDialog(el.dialogImport);
  }

  function applyImport(mode) {
    const analysis = app.importAnalysis;
    if (!analysis) return;
    try {
      const result = CC.importer.buildImportedState(store.getState(), analysis, mode);
      store.replaceState(result.state, {
        pushUndo: true,
        label: 'Importazione',
        reason: 'import',
        announce: 'Importazione completata.',
      });
      closeDialog(el.dialogImport);
      let message = 'Importazione completata: ' + result.studentsAdded + ' ' + plural(result.studentsAdded, 'alunno', 'alunni') + '.';
      if (result.assignedByPosition) message += ' ' + result.assignedByPosition + ' ' + plural(result.assignedByPosition, 'posto letto dal file', 'posti letti dal file') + '.';
      toast(message);
      if (result.warnings && result.warnings.length) {
        if (api && api.message) api.message('Importazione completata', result.warnings.join('\n'));
      }
    } catch (error) {
      toast('Importazione non riuscita: ' + error.message, true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Esportazione                                                       */
  /* ------------------------------------------------------------------ */

  function patchExporter() {
    if (!app.savesFiles || !CC.exporter || !CC.exporter.downloadBlob) return;
    CC.exporter.downloadBlob = function (blob, filename) {
      blobToBase64(blob).then(function (base64) {
        return api.export_bytes(filename, base64);
      }).then(function (res) {
        if (res && res.ok) toast('File salvato: ' + (res.filename || filename));
        else toast('Salvataggio non riuscito: ' + ((res && res.error) || 'errore'), true);
      }).catch(function (error) {
        toast('Salvataggio non riuscito: ' + error.message, true);
      });
    };
  }

  async function exportImage(variant) {
    if (app.busy) return;
    if (!app.file) {
      toast('Apri una classe prima di esportare.', true);
      return;
    }
    app.busy = true;
    const current = store.getSettings();
    const settings = Object.assign({}, current, {
      exportFormat: 'png',
      exportDpi: Number(el.exportDpi.value) || current.exportDpi || 300,
    });
    const state = store.getState();
    const auto = settings.imageRatio !== 'a4';
    const size = auto ? CC.exporter.autoSize(state) : null;
    toast(variant === 'dark' ? 'Preparazione immagine scura…' : 'Preparazione immagine chiara…');
    try {
      if (!app.savesFiles) {
        const result = await CC.exporter.exportImage(state, settings, variant, { size: size });
        toast('Immagine salvata: ' + ((result && result.filename) || 'file scaricato'));
        return;
      }
      const svg = CC.exporter.buildSvg(state, settings, variant, { size: size });
      const filename = core.exportFilename(state, variant, 'png');
      const blob = await CC.exporter.rasterizeSvg(svg, settings.exportDpi, size);
      const base64 = await blobToBase64(blob);
      const res = await api.export_bytes(filename, base64);
      if (res && res.ok) {
        const dim = size || CC.exporter.A4;
        const px = Math.round((dim.w / 96) * settings.exportDpi) + ' × ' + Math.round((dim.h / 96) * settings.exportDpi) + ' pixel';
        showExported({
          filename: res.filename || filename,
          path: res.path,
          info: (auto ? 'Immagine adattata al disegno' : 'Foglio A4 orizzontale') + ' · ' + settings.exportDpi + ' DPI · ' + px,
        });
      } else {
        toast('Salvataggio non riuscito: ' + ((res && res.error) || 'errore'), true);
      }
    } catch (error) {
      toast('Esportazione non riuscita: ' + error.message, true);
    } finally {
      app.busy = false;
    }
  }

  function showExported(info) {
    const data = info || {};
    app.exportedPath = data.path || null;
    el.exportedName.textContent = data.filename || 'immagine';
    el.exportedInfo.textContent = data.info || '';
    el.btnOpenImage.disabled = !app.exportedPath || !(api && typeof api.open_path === 'function');
    showDialog(el.dialogExported);
    toast('Immagine salvata: ' + (data.filename || 'file'));
  }

  function openExportedImage() {
    if (!app.exportedPath || !api || typeof api.open_path !== 'function') return;
    api.open_path(app.exportedPath);
  }

  async function printMap() {
    if (app.busy || !app.file) return;
    app.busy = true;
    toast('Preparazione della stampa…');
    try {
      const settings = Object.assign({}, store.getSettings(), { exportDpi: 300 });
      const svg = CC.exporter.buildSvg(store.getState(), settings, 'light');
      const blob = await CC.exporter.rasterizeSvg(svg, 300);
      const base64 = await blobToBase64(blob);
      const name = core.exportFilename(store.getState(), 'stampa', 'png');
      const res = await api.print_bytes(name, base64);
      if (res && res.ok) {
        toast(res.printed ? 'Stampa avviata.' : (res.message || 'Immagine pronta: usa Stampa dal programma di visualizzazione.'));
      } else {
        toast('Stampa non riuscita: ' + ((res && res.error) || 'errore'), true);
      }
    } catch (error) {
      toast('Stampa non riuscita: ' + error.message, true);
    } finally {
      app.busy = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dialoghi: nuova classe guidata                                     */
  /* ------------------------------------------------------------------ */

  const WIZARD_LABELS = { 1: 'Nome', 2: 'Aula', 3: 'Alunni' };

  async function openWizard() {
    if (!(await ensureFolder())) return;
    el.wizName.value = '';
    el.wizNameError.textContent = '';
    el.wizRows.value = '3';
    el.wizCols.value = '3';
    el.wizWindows.value = 'none';
    el.wizStudents.value = '';
    app.wizardWindows = 'none';
    app.wizardLayout = core.defaultLayout(3, 3, 2);
    renderWizardGrid();
    renderWizardWindows();
    app.wizardStep = 1;
    setWizardStep(1);
    showDialog(el.dialogWizard);
  }

  function setWizardStep(step) {
    const target = Math.min(3, Math.max(1, Math.round(step) || 1));
    if (target > 1 && !el.wizName.value.trim()) {
      el.wizNameError.textContent = 'Scrivi un nome per la classe.';
      app.wizardStep = 1;
      el.wizName.focus();
      return;
    }
    app.wizardStep = target;
    el.wizNameError.textContent = '';
    el.dialogWizard.querySelectorAll('.wizard-step').forEach(function (section) {
      section.hidden = Number(section.getAttribute('data-step')) !== target;
    });
    el.dialogWizard.querySelectorAll('.wizard-dot').forEach(function (dot) {
      const n = Number(dot.getAttribute('data-step'));
      dot.classList.toggle('is-active', n === target);
      dot.classList.toggle('is-done', n < target);
    });
    el.wizardStepLabel.textContent = 'Passo ' + target + ' di 3 · ' + WIZARD_LABELS[target];
    el.wizBack.hidden = target === 1;
    el.wizNext.hidden = target === 3;
    el.wizCreate.hidden = target !== 3;
    updateWizardPreview();
    const focusTarget = target === 1 ? el.wizName : (target === 2 ? el.wizRows : el.wizStudents);
    global.setTimeout(function () { focusTarget.focus(); }, 30);
  }

  function wizardLayout() {
    return { layout: core.sanitizeLayout(app.wizardLayout || core.defaultLayout(1, 1, 2)), warnings: [] };
  }

  /* Passo 2: tabella da compilare, una cella per gruppo di banchi */
  function renderWizardGrid() {
    const layout = app.wizardLayout;
    const rows = layout.length;
    const cols = layout[0].length;
    el.wizGrid.style.setProperty('--wiz-cols', String(cols));
    let html = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        html += '<input type="number" min="0" max="12" step="1" inputmode="numeric"' +
          ' data-r="' + r + '" data-c="' + c + '" value="' + layout[r][c] + '"' +
          ' aria-label="' + esc((r === 0 ? 'Riga in alto, fondo aula' : 'Riga ' + (r + 1)) + ', colonna ' + (c + 1) + ': quanti banchi') + '">';
      }
    }
    el.wizGrid.innerHTML = html;
    updateWizardPreview();
  }

  function onWizardGridInput(event) {
    const input = event.target;
    if (!input || !input.matches || !input.matches('input[data-r]')) return;
    const r = Number(input.getAttribute('data-r'));
    const c = Number(input.getAttribute('data-c'));
    let value = Number(input.value);
    if (!Number.isFinite(value)) value = 0;
    app.wizardLayout[r][c] = Math.max(0, Math.min(12, Math.round(value)));
    updateWizardPreview();
  }

  function normalizeWizardCell(event) {
    const input = event.target;
    if (!input || !input.matches || !input.matches('input[data-r]')) return;
    const r = Number(input.getAttribute('data-r'));
    const c = Number(input.getAttribute('data-c'));
    input.value = String(app.wizardLayout[r][c] || 0);
    updateWizardPreview();
  }

  function wizardNumber(raw, fallback, max) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.min(max, n);
  }

  function syncWizardSize() {
    const rows = wizardNumber(el.wizRows.value, 3, 20);
    const cols = wizardNumber(el.wizCols.value, 3, 12);
    el.wizRows.value = String(rows);
    el.wizCols.value = String(cols);
    const prev = app.wizardLayout || [];
    const next = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push(prev[r] && typeof prev[r][c] === 'number' ? prev[r][c] : 2);
      }
      next.push(row);
    }
    app.wizardLayout = next;
    renderWizardGrid();
  }

  function renderWizardWindows() {
    const side = app.wizardWindows || 'none';
    el.wizSideLeft.hidden = side !== 'left';
    el.wizSideRight.hidden = side !== 'right';
  }

  function updateWizardPreview() {
    const res = wizardLayout();
    if (!res.layout) {
      el.wizLayoutPreview.className = 'wizard-preview is-error';
      el.wizLayoutPreview.textContent = res.warnings.join(' ');
      return;
    }
    const capacity = res.layout.reduce(function (sum, row) {
      return sum + row.reduce(function (s, value) { return s + value; }, 0);
    }, 0);
    const students = countNames(el.wizStudents.value);
    let text = res.layout.length + ' ' + plural(res.layout.length, 'fila', 'file') + ' × ' +
      res.layout[0].length + ' ' + plural(res.layout[0].length, 'colonna', 'colonne') + ' · ' +
      capacity + ' ' + plural(capacity, 'banco', 'banchi');
    if (students > capacity) text += ' · attenzione: ' + students + ' alunni per ' + capacity + ' banchi';
    el.wizLayoutPreview.className = 'wizard-preview';
    el.wizLayoutPreview.textContent = text;
  }

  async function wizardFinish() {
    const name = el.wizName.value.replace(/\s+/g, ' ').trim();
    if (!name) {
      setWizardStep(1);
      return;
    }
    const res = wizardLayout();
    if (!res.layout) {
      setWizardStep(2);
      toast(res.warnings.join(' '), true);
      return;
    }
    const button = el.wizCreate;
    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Creazione…';
    try {
      const created = await api.create_class(name);
      if (!created || !created.ok) {
        el.wizNameError.textContent = (created && created.error) || 'Non è stato possibile creare la classe.';
        setWizardStep(1);
        return;
      }
      let state = core.createState({ className: name, windowsSide: app.wizardWindows || 'none' });
      state.layout = res.layout;
      const roster = core.addStudentsFromText(state, el.wizStudents.value);
      state = roster.state;
      const payload = core.projectPayload(state);
      await api.save_class(created.file, payload);
      closeDialog(el.dialogWizard);
      await openClass(created.file, payload);
      let message = 'Classe «' + name + '» creata.';
      if (roster.added.length) {
        message += ' ' + roster.added.length + ' ' + plural(roster.added.length, 'alunno aggiunto', 'alunni aggiunti') + '.';
      }
      toast(message);
    } catch (error) {
      el.wizNameError.textContent = error.message;
      setWizardStep(1);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dialoghi: nome classe, conferma                                    */
  /* ------------------------------------------------------------------ */

  function openNameDialog(mode, file, currentName) {
    app.nameMode = mode;
    app.nameTarget = file || null;
    el.nameDialogTitle.textContent = mode === 'create' ? 'Nuova classe' : 'Rinomina classe';
    el.nameDialogSubtitle.textContent = mode === 'create'
      ? 'Scegli un nome riconoscibile, ad esempio 1A.'
      : 'Il nuovo nome sarà visibile nella home e nella cartina.';
    el.nameSubmit.textContent = mode === 'create' ? 'Crea classe' : 'Salva nome';
    el.nameInput.value = currentName || '';
    el.nameError.textContent = '';
    showDialog(el.dialogName);
    global.setTimeout(function () {
      el.nameInput.focus();
      el.nameInput.select();
    }, 30);
  }

  async function onSubmitName(event) {
    event.preventDefault();
    const name = el.nameInput.value.replace(/\s+/g, ' ').trim();
    if (!name) {
      el.nameError.textContent = 'Scrivi un nome per la classe.';
      el.nameInput.focus();
      return;
    }
    el.nameError.textContent = '';
    el.nameSubmit.disabled = true;
    const label = el.nameSubmit.textContent;
    el.nameSubmit.textContent = 'Attendere…';
    try {
      if (app.nameMode === 'create') {
        const res = await api.create_class(name);
        if (!res || !res.ok) {
          el.nameError.textContent = (res && res.error) || 'Non è stato possibile creare la classe.';
          return;
        }
        const state = core.createState({ className: name });
        const payload = core.projectPayload(state);
        await api.save_class(res.file, payload);
        closeDialog(el.dialogName);
        await openClass(res.file, payload);
        toast('Classe «' + name + '» creata.');
      } else {
        const file = app.nameTarget;
        if (file && app.view === 'class' && file === app.file) {
          store.commit(Object.assign({}, store.getState(), { className: name }), {
            label: 'Rinomina classe',
            announce: 'Classe rinominata in ' + name + '.',
          });
          closeDialog(el.dialogName);
          toast('Classe rinominata in «' + name + '».');
        } else if (file) {
          const res = await api.rename_class(file, name);
          if (!res || !res.ok) {
            el.nameError.textContent = (res && res.error) || 'Non è stato possibile rinominare la classe.';
            return;
          }
          closeDialog(el.dialogName);
          await refreshHome();
          toast('Classe rinominata in «' + name + '».');
        }
      }
    } catch (error) {
      el.nameError.textContent = error.message;
    } finally {
      el.nameSubmit.disabled = false;
      el.nameSubmit.textContent = label;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Strumenti di anteprima (solo quando l'app gira nel browser)        */
  /* ------------------------------------------------------------------ */

  if (!DESKTOP) {
    global.CCDesktop = {
      store: store,
      app: app,
      getApi: function () { return api; },
      refreshHome: refreshHome,
      openClass: openClass,
      goHome: goHome,
      renderClass: renderClass,
      showImportDialog: showImportDialog,
      applyImport: applyImport,
      exportImage: exportImage,
      printMap: printMap,
      openWizard: openWizard,
      setWizardStep: setWizardStep,
      openAddStudents: openAddStudents,
      quickAddStudent: quickAddStudent,
      openDeskDialog: openDeskDialog,
      createDeskStudent: createDeskStudent,
      showExported: showExported,
      saveNow: saveNow,
      chooseFolder: chooseFolder,
      updateFolderBanner: updateFolderBanner,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Avvio                                                              */
  /* ------------------------------------------------------------------ */

  init().catch(function (error) {
    console.error(error);
    if (el.toast) {
      toast('Errore di avvio: ' + error.message, true);
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
