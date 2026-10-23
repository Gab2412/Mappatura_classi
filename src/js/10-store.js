/* Cartina di Classe — stato, cronologia, preferenze, salvataggio */
(function (global) {
  'use strict';

  const CC = global.CC;
  const core = CC.core;

  const PROJECT_KEY = 'cc.project.v1';
  const SETTINGS_KEY = 'cc.settings.v1';
  const DEFAULT_SETTINGS = Object.freeze({
    theme: 'auto',
    textSize: 20,
    nameMode: 'full',
    showNumbers: true,
    showEmpty: true,
    exportFormat: 'png',
    exportDpi: 300,
    imageRatio: 'auto',
    showDate: true,
    welcomeDismissed: false,
    lastTab: 'banchi',
    panelWidth: 0,
  });

  const THEMES = ['auto', 'light', 'dark'];
  const NAME_MODES = ['full', 'first', 'last', 'initials'];
  const FORMATS = ['png', 'svg'];
  const DPIS = [150, 300, 600];
  const RATIOS = ['auto', 'a4'];

  function storageAvailable() {
    try {
      const key = '__cc_test_storage__';
      global.localStorage.setItem(key, '1');
      global.localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function sanitizeSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS);
    if (!raw || typeof raw !== 'object') return s;
    if (THEMES.includes(raw.theme)) s.theme = raw.theme;
    const size = Number(raw.textSize);
    if (Number.isFinite(size)) s.textSize = Math.min(32, Math.max(16, Math.round(size)));
    if (NAME_MODES.includes(raw.nameMode)) s.nameMode = raw.nameMode;
    if (typeof raw.showNumbers === 'boolean') s.showNumbers = raw.showNumbers;
    if (typeof raw.showEmpty === 'boolean') s.showEmpty = raw.showEmpty;
    if (FORMATS.includes(raw.exportFormat)) s.exportFormat = raw.exportFormat;
    if (DPIS.includes(Number(raw.exportDpi))) s.exportDpi = Number(raw.exportDpi);
    if (RATIOS.includes(raw.imageRatio)) s.imageRatio = raw.imageRatio;
    if (typeof raw.showDate === 'boolean') s.showDate = raw.showDate;
    if (typeof raw.welcomeDismissed === 'boolean') s.welcomeDismissed = raw.welcomeDismissed;
    if (raw.lastTab === 'banchi' || raw.lastTab === 'alunni') s.lastTab = raw.lastTab;
    const panelWidth = Number(raw.panelWidth);
    if (Number.isFinite(panelWidth) && panelWidth > 0) s.panelWidth = Math.min(64, Math.max(17, panelWidth));
    return s;
  }

  function createStore() {
    const listeners = {
      change: new Set(),
      settings: new Set(),
      save: new Set(),
      announce: new Set(),
      history: new Set(),
      restored: new Set(),
    };

    let state = core.createState();
    let settings = sanitizeSettings(null);
    let undoStack = [];
    let redoStack = [];
    let saveTimer = null;
    let lastSaveError = null;
    let storageOK = storageAvailable();
    let started = false;
    let pendingSave = false;

    function on(type, fn) {
      if (!listeners[type]) throw new Error('Evento sconosciuto: ' + type);
      listeners[type].add(fn);
      return function () { listeners[type].delete(fn); };
    }

    function emit(type, detail) {
      listeners[type].forEach(function (fn) {
        try { fn(detail); } catch (error) { console.error(error); }
      });
    }

    function announce(text, options) {
      if (!text) return;
      emit('announce', { text: text, toast: !options || options.toast !== false });
    }

    function toast(text) {
      announce(text, { toast: true });
    }

    function applyTheme() {
      const root = global.document.documentElement;
      const resolved = settings.theme === 'auto'
        ? (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : settings.theme;
      root.dataset.theme = resolved;
      root.style.fontSize = settings.textSize + 'px';
    }

    function loadSettings() {
      if (!storageOK) {
        settings = sanitizeSettings(null);
        return settings;
      }
      try {
        const raw = global.localStorage.getItem(SETTINGS_KEY);
        settings = sanitizeSettings(raw ? JSON.parse(raw) : null);
      } catch (error) {
        settings = sanitizeSettings(null);
      }
      applyTheme();
      return settings;
    }

    function saveSettings() {
      applyTheme();
      if (!storageOK) return;
      try {
        global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch (error) {
        // Le preferenze non sono essenziali: il progetto resta salvabile.
      }
      emit('settings', settings);
    }

    function setSettings(patch) {
      settings = sanitizeSettings(Object.assign({}, settings, patch));
      saveSettings();
      return settings;
    }

    function readSavedProject() {
      if (!storageOK) return null;
      const raw = global.localStorage.getItem(PROJECT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        state: core.sanitizeState(parsed),
        savedAt: parsed && parsed.savedAt ? parsed.savedAt : null,
      };
    }

    function restore() {
      started = true;
      let restored = null;
      let error = null;
      try {
        restored = readSavedProject();
      } catch (e) {
        error = e;
        restored = null;
      }
      if (restored && restored.state) {
        state = restored.state;
      } else {
        state = core.createState();
      }
      loadSettings();
      emit('restored', { restored: !!restored, savedAt: restored ? restored.savedAt : null, error: error });
      if (error) {
        announce('Il salvataggio automatico non era leggibile. È stata aperta una cartina vuota.', { toast: false });
      }
      emit('change', { reason: 'restore', announce: null });
      emit('history', { canUndo: false, canRedo: false });
      applyTheme();
      return { restored: !!restored, savedAt: restored ? restored.savedAt : null, error: error };
    }

    function persistNow() {
      if (!started) return;
      pendingSave = false;
      if (!storageOK) {
        if (lastSaveError !== 'storage') {
          lastSaveError = 'storage';
          emit('save', { ok: false, reason: 'storage', at: null });
          announce('Il salvataggio automatico non è disponibile in questo browser. Usa «Salva file» per non perdere il lavoro.', { toast: false });
        }
        return;
      }
      try {
        const payload = {
          app: core.APP_ID,
          version: core.VERSION,
          savedAt: new Date().toISOString(),
          data: state,
        };
        global.localStorage.setItem(PROJECT_KEY, JSON.stringify(payload));
        lastSaveError = null;
        emit('save', { ok: true, at: new Date(), reason: 'auto' });
      } catch (error) {
        if (lastSaveError !== error.message) {
          lastSaveError = error.message;
          emit('save', { ok: false, reason: 'quota', at: null, error: error });
          announce('Non è stato possibile salvare automaticamente. Usa «Salva file» per conservare il lavoro.', { toast: false });
        }
      }
    }

    function scheduleSave() {
      pendingSave = true;
      if (saveTimer) global.clearTimeout(saveTimer);
      saveTimer = global.setTimeout(function () {
        saveTimer = null;
        persistNow();
      }, 300);
    }

    function flushSave() {
      if (saveTimer) {
        global.clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (pendingSave) persistNow();
    }

    function historyInfo() {
      return {
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undoLabel: undoStack.length ? undoStack[undoStack.length - 1].label : null,
        redoLabel: redoStack.length ? redoStack[redoStack.length - 1].label : null,
      };
    }

    function emitHistory() {
      emit('history', historyInfo());
    }

    function pushUndo(label, coalesce) {
      const now = Date.now();
      const top = undoStack[undoStack.length - 1];
      if (coalesce && top && top.coalesce === coalesce && now - top.time < 1400) {
        top.time = now;
        return;
      }
      undoStack.push({
        state: core.clone(state),
        label: label || 'Modifica',
        coalesce: coalesce || null,
        time: now,
      });
      if (undoStack.length > 60) undoStack.shift();
    }

    /**
     * Applica un nuovo stato.
     * options.label     etichetta mostrata in Annulla
     * options.coalesce  unisce modifiche ravvicinate con la stessa chiave
     * options.history   false per non registrare in cronologia
     * options.announce  messaggio da annunciare
     * options.reason    motivo per i sottoscrittori
     */
    function commit(next, options) {
      const o = options || {};
      if (!next) return false;
      if (JSON.stringify(next) === JSON.stringify(state)) return false;
      if (o.history !== false) pushUndo(o.label, o.coalesce);
      state = next;
      redoStack = [];
      scheduleSave();
      emitHistory();
      emit('change', { reason: o.reason || 'commit', announce: o.announce || null, label: o.label || null });
      if (o.announce) announce(o.announce);
      return true;
    }

    /**
     * Sostituisce lo stato (es. apertura file o importazione).
     * options.resetHistory  azzera la cronologia
     * options.pushUndo      registra lo stato precedente, così si può annullare
     * options.label         etichetta mostrata in Annulla
     */
    function replaceState(next, options) {
      const o = options || {};
      if (o.resetHistory) {
        undoStack = [];
        redoStack = [];
      } else if (o.pushUndo) {
        pushUndo(o.label || 'Sostituzione');
        redoStack = [];
      }
      state = next;
      scheduleSave();
      emitHistory();
      emit('change', { reason: o.reason || 'replace', announce: o.announce || null });
      if (o.announce) announce(o.announce);
    }

    function undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      redoStack.push({
        state: core.clone(state),
        label: entry.label,
        coalesce: null,
        time: Date.now(),
      });
      state = entry.state;
      scheduleSave();
      emitHistory();
      emit('change', { reason: 'undo', announce: null });
      announce('Annullato: ' + entry.label + '.', { toast: true });
      return true;
    }

    function redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      undoStack.push({
        state: core.clone(state),
        label: entry.label,
        coalesce: null,
        time: Date.now(),
      });
      state = entry.state;
      scheduleSave();
      emitHistory();
      emit('change', { reason: 'redo', announce: null });
      announce('Ripetuto: ' + entry.label + '.', { toast: true });
      return true;
    }

    function setUndoLabel(label) {
      if (undoStack.length) undoStack[undoStack.length - 1].label = label;
      emitHistory();
    }

    function clearHistory() {
      undoStack = [];
      redoStack = [];
      emitHistory();
    }

    function saveFilePayload() {
      return core.projectPayload(state);
    }

    function getState() {
      return state;
    }

    function getSettings() {
      return settings;
    }

    function applyThemeNow() {
      applyTheme();
    }

    applyTheme();

    return {
      on: on,
      announce: announce,
      toast: toast,
      restore: restore,
      commit: commit,
      replaceState: replaceState,
      undo: undo,
      redo: redo,
      historyInfo: historyInfo,
      clearHistory: clearHistory,
      setUndoLabel: setUndoLabel,
      getState: getState,
      getSettings: getSettings,
      setSettings: setSettings,
      applyTheme: applyThemeNow,
      saveFilePayload: saveFilePayload,
      scheduleSave: scheduleSave,
      flushSave: flushSave,
      storageAvailable: function () { return storageOK; },
      defaults: DEFAULT_SETTINGS,
      keys: { project: PROJECT_KEY, settings: SETTINGS_KEY },
    };
  }

  CC.createStore = createStore;
  CC.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(typeof window !== 'undefined' ? window : globalThis);
