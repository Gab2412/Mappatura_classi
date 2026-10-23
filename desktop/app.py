"""Cartina di Classe — applicazione desktop.

Finestra nativa (WebView2) + gestione dei file delle classi in una cartella
portatile accanto all'eseguibile. Nessuna installazione richiesta.
"""

from __future__ import annotations

import base64
import functools
import json
import os
import re
import shutil
import sys
import threading
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

import webview

APP_NAME = "Cartina di Classe"
APP_VERSION = "2.5"
MAX_IMPORT_BYTES = 12 * 1024 * 1024
DEFAULT_LAYOUT = [[2, 2, 2], [2, 2, 2], [2, 2, 2]]


# ---------------------------------------------------------------------------
# Percorsi
# ---------------------------------------------------------------------------

def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def executable_dir() -> Path:
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def web_dir() -> Path:
    if is_frozen():
        return Path(getattr(sys, "_MEIPASS")) / "web"
    return Path(__file__).resolve().parent / "web"


def _writable_dir(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".scrittura-test"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        return True
    except OSError:
        return False


def data_dir() -> Path:
    override = os.environ.get("CARTINA_DATA_DIR")
    if override:
        path = Path(override).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    portable = executable_dir() / "files"
    if _writable_dir(portable):
        return portable

    # Se il programma è su un supporto protetto da scrittura, non perdiamo
    # il lavoro: usiamo una cartella utente, segnalandolo nell'interfaccia.
    fallback = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Cartina di Classe" / "files"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def previous_portable_dir() -> Path:
    """Vecchia cartella dati delle versioni precedenti alla 2.4."""
    return executable_dir() / "CartinaClassi"


def migrate_old_data(new_root: Path, old_root: Path) -> None:
    """Copia una tantum i dati della vecchia cartella ``CartinaClassi``
    nella nuova cartella ``files``. La vecchia cartella resta intatta."""

    def copy_file(source: Path, target: Path) -> bool:
        try:
            if not target.exists():
                shutil.copy2(source, target)
                return True
        except OSError:
            pass
        return False

    def probe_log(message: str) -> None:
        try:
            with (new_root / "diagnostica.log").open("a", encoding="utf-8") as handle:
                handle.write(now_iso() + "  MIGRAZIONE  " + message + "\n")
        except OSError:
            pass

    if not old_root.is_dir() or not new_root.is_dir():
        return
    copied = 0

    # Classi: prima nella sottocartella Classi, poi direttamente nella radice.
    seen = set()
    for folder in (old_root / "Classi", old_root):
        if not folder.is_dir() or folder == new_root:
            continue
        for path in sorted(folder.glob("*.json")):
            if path.name.lower() == "impostazioni.json" or path.name in seen:
                continue
            if copy_file(path, new_root / path.name):
                seen.add(path.name)
                copied += 1

    exports_old = old_root / "Esportazioni"
    if exports_old.is_dir():
        new_exports = new_root / "Esportazioni"
        new_exports.mkdir(parents=True, exist_ok=True)
        for path in sorted(exports_old.iterdir()):
            if path.is_file() and copy_file(path, new_exports / path.name):
                copied += 1

    impos_old = old_root / "impostazioni.json"
    if impos_old.is_file():
        copy_file(impos_old, new_root / "impostazioni.json")

    if copied:
        probe_log(f"copiati {copied} file da {old_root}")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def slugify(text: str) -> str:
    text = str(text or "").strip()
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return (text[:60] or "classe").lower()


def as_text(value) -> str:
    return value if isinstance(value, str) else ""


class Api:
    """Metodi richiamabili dall'interfaccia con ``window.pywebview.api``."""

    def __init__(self) -> None:
        self.window = None
        self._lock = threading.RLock()
        self.root = data_dir()
        self.classes = self.root
        self.exports = self.root / "Esportazioni"
        self.trash = self.root / "Cestino"
        for folder in (self.root, self.exports, self.trash):
            folder.mkdir(parents=True, exist_ok=True)
        migrate_old_data(self.root, previous_portable_dir())
        self._log("Avvio " + APP_VERSION + " · dati in " + str(self.root))
        self._wrap_public_methods()

    def _wrap_public_methods(self) -> None:
        """Trasforma ogni metodo pubblico in una chiamata che non solleva
        eccezioni verso l'interfaccia: in caso di errore restituisce
        ``{"ok": False, "error": "..."}``."""

        def guard(function):
            @functools.wraps(function)
            def wrapper(*args, **kwargs):
                try:
                    return function(self, *args, **kwargs)
                except Exception as exc:  # noqa: BLE001 - confine con l'interfaccia
                    self._log("ERRORE " + function.__name__ + ": " + repr(exc))
                    return {"ok": False, "error": str(exc)}

            return wrapper

        for name in list(dir(type(self))):
            if name.startswith("_"):
                continue
            function = getattr(type(self), name, None)
            if callable(function):
                setattr(self, name, guard(function))

    # Attributi interni: non fanno parte dell'interfaccia JavaScript.
    # Vengono nascosti da ``dir()`` perché pywebview esplora ricorsivamente
    # gli attributi pubblici e, incontrando l'oggetto finestra (.NET) e i
    # percorsi ``Path``, impiegherebbe moltissimo tempo prima di rendere
    # disponibile l'API all'interfaccia.
    _PRIVATE_ATTRS = ("window", "root", "classes", "exports", "trash")

    def __dir__(self):
        return [name for name in super().__dir__() if name not in self._PRIVATE_ATTRS]

    # -- utilità ---------------------------------------------------------

    def _log(self, message: str) -> None:
        try:
            path = self.root / "diagnostica.log"
            if path.exists() and path.stat().st_size > 300_000:
                path.unlink()
            with path.open("a", encoding="utf-8") as handle:
                handle.write(now_iso() + "  " + str(message)[:4000] + "\n")
        except OSError:
            pass

    def _class_path(self, filename: str) -> Path:
        name = Path(str(filename or "")).name
        if not name or not name.lower().endswith(".json"):
            raise ValueError("File di classe non valido.")
        return self.classes / name

    def _unique_path(self, filename: str) -> Path:
        candidate = self.classes / filename
        if not candidate.exists():
            return candidate
        stem = candidate.stem
        for n in range(2, 9999):
            candidate = self.classes / f"{stem}-{n}.json"
            if not candidate.exists():
                return candidate
        return self.classes / f"{stem}-{uuid.uuid4().hex[:6]}.json"

    def _read_payload(self, path: Path) -> dict:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("Il file non contiene una classe valida.")
        data = raw.get("data")
        if not isinstance(data, dict):
            data = raw
        if not isinstance(data.get("layout"), list):
            raise ValueError("Il file non contiene una disposizione dei banchi.")
        return raw if isinstance(raw.get("data"), dict) else {"data": raw}

    def _write_payload(self, path: Path, payload: dict) -> None:
        payload["app"] = "cartina-di-classe"
        payload.setdefault("version", 1)
        payload["modifiedAt"] = now_iso()
        payload["savedAt"] = payload["modifiedAt"]
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    def _summary(self, payload: dict, filename: str, modified: str) -> dict:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        layout = data.get("layout") if isinstance(data.get("layout"), list) else []
        seats = data.get("seats") if isinstance(data.get("seats"), dict) else {}
        students = data.get("students") if isinstance(data.get("students"), list) else []
        capacity = 0
        for row in layout:
            if isinstance(row, list):
                for value in row:
                    try:
                        capacity += max(0, int(value))
                    except (TypeError, ValueError):
                        pass
        return {
            "file": filename,
            "name": as_text(data.get("className")) or "Classe senza nome",
            "students": len(students),
            "capacity": capacity,
            "assigned": len([v for v in seats.values() if isinstance(v, str) and v]),
            "modified": modified,
        }

    # -- metodi API ------------------------------------------------------

    def app_info(self) -> dict:
        return {
            "ok": True,
            "version": APP_VERSION,
            "dataDir": str(self.root),
            "classesDir": str(self.classes),
            "exportsDir": str(self.exports),
            "isPortable": str(self.root).startswith(str(executable_dir())),
        }

    def list_classes(self) -> dict:
        with self._lock:
            items = []
            for path in sorted(self.classes.glob("*.json")):
                if path.name.lower() == "impostazioni.json":
                    continue
                try:
                    payload = self._read_payload(path)
                    modified = as_text(payload.get("modifiedAt")) or as_text(payload.get("savedAt"))
                    if not modified:
                        modified = datetime.fromtimestamp(
                            path.stat().st_mtime, timezone.utc
                        ).replace(microsecond=0).isoformat()
                    items.append(self._summary(payload, path.name, modified))
                except Exception as exc:
                    self._log("File ignorato " + path.name + ": " + repr(exc))
            items.sort(key=lambda item: item["modified"], reverse=True)
            return {"ok": True, "classes": items, "dataDir": str(self.root)}

    def create_class(self, name: str) -> dict:
        with self._lock:
            clean = re.sub(r"\s+", " ", str(name or "")).strip()[:80] or "Nuova classe"
            filename = slugify(clean) + "-" + uuid.uuid4().hex[:6] + ".json"
            path = self._unique_path(filename)
            payload = {
                "app": "cartina-di-classe",
                "version": 1,
                "data": {
                    "version": 1,
                    "className": clean,
                    "layout": DEFAULT_LAYOUT,
                    "students": [],
                    "seats": {},
                },
            }
            self._write_payload(path, payload)
            return {
                "ok": True,
                "file": path.name,
                "payload": payload,
                "class": self._summary(payload, path.name, payload["modifiedAt"]),
            }

    def load_class(self, filename: str) -> dict:
        with self._lock:
            path = self._class_path(filename)
            if not path.exists():
                return {"ok": False, "error": "La classe non esiste più nella cartella."}
            payload = self._read_payload(path)
            return {"ok": True, "file": path.name, "payload": payload}

    def save_class(self, filename: str, payload: dict) -> dict:
        with self._lock:
            path = self._class_path(filename)
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
                return {"ok": False, "error": "Dati della classe non validi."}
            self._write_payload(path, payload)
            return {"ok": True, "file": path.name, "modified": payload["modifiedAt"]}

    def delete_class(self, filename: str) -> dict:
        with self._lock:
            path = self._class_path(filename)
            if not path.exists():
                return {"ok": True, "trash": None}
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            target = self.trash / f"{path.stem}-{stamp}.json"
            shutil.move(str(path), str(target))
            return {"ok": True, "trash": target.name}

    def rename_class(self, filename: str, name: str) -> dict:
        """Rinomina il contenuto; il nome del file resta stabile e leggibile."""
        with self._lock:
            clean = re.sub(r"\s+", " ", str(name or "")).strip()[:80]
            if not clean:
                return {"ok": False, "error": "Il nome della classe non può essere vuoto."}
            path = self._class_path(filename)
            if not path.exists():
                return {"ok": False, "error": "La classe non esiste più nella cartella."}
            payload = self._read_payload(path)
            payload.setdefault("data", {})["className"] = clean
            self._write_payload(path, payload)
            return {"ok": True, "file": path.name, "name": clean}

    def duplicate_class(self, filename: str) -> dict:
        with self._lock:
            source = self._class_path(filename)
            if not source.exists():
                return {"ok": False, "error": "La classe non esiste più nella cartella."}
            payload = self._read_payload(source)
            data = payload.setdefault("data", {})
            data["className"] = (as_text(data.get("className")) or "Classe") + " (copia)"
            target = self._unique_path(slugify(data["className"]) + "-" + uuid.uuid4().hex[:6] + ".json")
            # Nuovi identificativi, così le due classi restano indipendenti.
            id_map = {}
            for student in data.get("students", []):
                if isinstance(student, dict) and student.get("id"):
                    new_id = "s_" + uuid.uuid4().hex[:12]
                    id_map[student["id"]] = new_id
                    student["id"] = new_id
            seats = data.get("seats")
            if isinstance(seats, dict):
                data["seats"] = {k: id_map.get(v, v) for k, v in seats.items()}
            self._write_payload(target, payload)
            return {
                "ok": True,
                "file": target.name,
                "class": self._summary(payload, target.name, payload["modifiedAt"]),
            }

    def settings_load(self) -> dict:
        with self._lock:
            path = self.root / "impostazioni.json"
            if not path.exists():
                return {"ok": True, "settings": {}}
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
                return {"ok": True, "settings": value if isinstance(value, dict) else {}}
            except Exception:
                return {"ok": True, "settings": {}}

    def settings_save(self, settings: dict) -> dict:
        with self._lock:
            if not isinstance(settings, dict):
                return {"ok": False, "error": "Impostazioni non valide."}
            path = self.root / "impostazioni.json"
            tmp = path.with_name(path.name + ".tmp")
            tmp.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, path)
            return {"ok": True}

    def import_dialog(self) -> dict:
        if self.window is None:
            return {"ok": False, "error": "Finestra non disponibile."}
        result = self.window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=(
                "Excel o CSV (*.xlsx;*.xlsm;*.csv;*.txt)",
                "Tutti i file (*.*)",
            ),
        )
        if not result:
            return {"ok": False, "cancelled": True}
        path = Path(result[0] if isinstance(result, (list, tuple)) else result)
        if not path.exists():
            return {"ok": False, "error": "File non trovato."}
        if path.stat().st_size > MAX_IMPORT_BYTES:
            return {"ok": False, "error": "Il file è troppo grande (massimo 12 MB)."}
        return {
            "ok": True,
            "name": path.name,
            "base64": base64.b64encode(path.read_bytes()).decode("ascii"),
        }

    def import_project_dialog(self) -> dict:
        if self.window is None:
            return {"ok": False, "error": "Finestra non disponibile."}
        result = self.window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=("Cartina di Classe (*.json)", "Tutti i file (*.*)"),
        )
        if not result:
            return {"ok": False, "cancelled": True}
        path = Path(result[0] if isinstance(result, (list, tuple)) else result)
        try:
            payload = self._read_payload(path)
        except Exception as exc:
            return {"ok": False, "error": "File non valido: " + str(exc)}
        with self._lock:
            data = payload.setdefault("data", {})
            name = as_text(data.get("className")) or path.stem
            target = self._unique_path(slugify(name) + "-" + uuid.uuid4().hex[:6] + ".json")
            self._write_payload(target, payload)
            return {
                "ok": True,
                "file": target.name,
                "payload": payload,
                "class": self._summary(payload, target.name, payload["modifiedAt"]),
            }

    def export_bytes(self, filename: str, base64_data: str) -> dict:
        with self._lock:
            raw_name = Path(str(filename or "cartina")).name
            stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", raw_name).strip() or "cartina"
            path = self.exports / stem
            if path.exists():
                for n in range(2, 9999):
                    candidate = self.exports / (Path(stem).stem + f"-{n}" + Path(stem).suffix)
                    if not candidate.exists():
                        path = candidate
                        break
            try:
                path.write_bytes(base64.b64decode(base64_data, validate=True))
            except Exception as exc:
                return {"ok": False, "error": "Impossibile scrivere il file: " + str(exc)}
            return {"ok": True, "path": str(path), "filename": path.name}

    def print_bytes(self, filename: str, base64_data: str) -> dict:
        saved = self.export_bytes(filename, base64_data)
        if not saved.get("ok"):
            return saved
        path = saved["path"]
        try:
            os.startfile(path, "print")  # type: ignore[attr-defined]
            return {"ok": True, "path": path, "printed": True}
        except OSError:
            try:
                os.startfile(path)  # type: ignore[attr-defined]
                return {
                    "ok": True,
                    "path": path,
                    "printed": False,
                    "message": "Il file è stato aperto: usa Stampa dal programma di visualizzazione immagini.",
                }
            except OSError as exc:
                return {"ok": False, "error": "Non è stato possibile aprire il file: " + str(exc)}

    def open_folder(self, kind: str = "classes") -> dict:
        folder = self.exports if kind == "exports" else self.classes
        folder.mkdir(parents=True, exist_ok=True)
        try:
            os.startfile(str(folder))  # type: ignore[attr-defined]
            return {"ok": True, "path": str(folder)}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}

    def open_path(self, path: str) -> dict:
        """Apre un file, ma solo se si trova nelle cartelle dell'app."""
        try:
            target = Path(str(path or "")).resolve()
        except (OSError, ValueError) as exc:
            return {"ok": False, "error": str(exc)}
        allowed = False
        for folder in (self.exports, self.classes, self.root):
            try:
                base = folder.resolve()
            except OSError:
                continue
            if target == base or base in target.parents:
                allowed = True
                break
        if not allowed or not target.is_file():
            return {"ok": False, "error": "File non disponibile."}
        try:
            os.startfile(str(target))  # type: ignore[attr-defined]
            return {"ok": True, "path": str(target)}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}

    def set_title(self, text: str) -> dict:
        if self.window is not None:
            clean = str(text or "").strip()
            self.window.set_title(APP_NAME + (" — " + clean if clean else ""))
        return {"ok": True}

    def confirm(self, title: str, message: str) -> bool:
        if self.window is None:
            return False
        return bool(self.window.create_confirmation_dialog(str(title), str(message)))

    def message(self, title: str, message: str) -> bool:
        if self.window is None:
            return False
        self.window.create_message_dialog(str(title), str(message))
        return True

    def log_client(self, message: str) -> dict:
        self._log("CLIENT " + str(message)[:2000])
        return {"ok": True}

    def open_log(self) -> dict:
        path = self.root / "diagnostica.log"
        try:
            if not path.exists():
                path.write_text("Nessun messaggio registrato.\n", encoding="utf-8")
            os.startfile(str(path))  # type: ignore[attr-defined]
            return {"ok": True, "path": str(path)}
        except OSError as exc:
            return {"ok": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# Avvio
# ---------------------------------------------------------------------------

def main() -> None:
    api = Api()

    index = web_dir() / "index.html"
    if not index.exists():
        raise SystemExit("Interfaccia non trovata: " + str(index))

    window = webview.create_window(
        APP_NAME,
        str(index) + "?desktop=1",
        js_api=api,
        width=1500,
        height=940,
        min_size=(980, 640),
        background_color="#070d18",
        text_select=True,
        zoomable=True,
        confirm_close=False,
    )
    api.window = window

    storage = api.root / ".webview"
    try:
        storage.mkdir(parents=True, exist_ok=True)
    except OSError:
        storage = None

    debug = "--debug" in sys.argv or os.environ.get("CARTINA_DEBUG") == "1"
    webview.start(
        http_server=True,
        private_mode=False,
        storage_path=str(storage) if storage else None,
        debug=debug,
        gui="edgechromium",
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        try:
            (data_dir() / "errore-avvio.log").write_text(traceback.format_exc(), encoding="utf-8")
        except OSError:
            pass
        raise
