"""Prova automatica dei metodi Python dell'app desktop (senza finestra)."""

from __future__ import annotations

import base64
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "desktop"))

base = tempfile.mkdtemp(prefix="cartina-test-")
os.environ["CARTINA_DATA_DIR"] = base

import app as appmod  # noqa: E402

api = appmod.Api()
errors = []


def check(label, condition, extra=""):
    status = "OK " if condition else "FAIL"
    print(f"{status} {label} {extra}")
    if not condition:
        errors.append(label)


info = api.app_info()
check("app_info", info.get("ok") and info.get("classesDir"), info.get("classesDir"))

created = api.create_class("1A Prova")
check("create_class", created.get("ok") and created.get("file"), created.get("file"))
file = created["file"]

state = {
    "version": 1,
    "className": "1A Prova",
    "layout": [[2, 2], [1, 1]],
    "students": [{"id": "s_a", "name": "Rossi Mario"}, {"id": "s_b", "name": "Bianchi Anna"}],
    "seats": {"0:0:0": "s_a"},
}
payload = {"app": "cartina-di-classe", "version": 1, "savedAt": appmod.now_iso(), "data": state}
saved = api.save_class(file, json.loads(json.dumps(payload)))
check("save_class", saved.get("ok"), saved.get("modified"))

loaded = api.load_class(file)
check("load_class", loaded.get("ok") and loaded["payload"]["data"]["students"][0]["name"] == "Rossi Mario")

renamed = api.rename_class(file, "1A Prova Rinominata")
check("rename_class", renamed.get("ok") and renamed.get("name") == "1A Prova Rinominata")
loaded = api.load_class(file)
check("rename persisted", loaded["payload"]["data"]["className"] == "1A Prova Rinominata")

duplicated = api.duplicate_class(file)
check("duplicate_class", duplicated.get("ok") and duplicated.get("file"), duplicated.get("file"))
dup_file = duplicated.get("file")
dup_loaded = api.load_class(dup_file)
dup_state = dup_loaded["payload"]["data"]
check("duplicate indipendente", dup_state["students"][0]["id"] != "s_a")

listing = api.list_classes()
names = [item["name"] for item in listing["classes"]]
check("list_classes", listing.get("ok") and len(listing["classes"]) == 2, names)
check("list capacity", any(item["capacity"] == 6 for item in listing["classes"]))

settings = {"theme": "dark", "textSize": 24}
check("settings_save", api.settings_save(settings).get("ok"))
check("settings_load", api.settings_load().get("settings") == settings)

# export_bytes con un piccolo contenuto PNG finto
tiny = base64.b64encode(b"\x89PNG\r\n\x1a\nfinto").decode("ascii")
exported = api.export_bytes("prova.png", tiny)
check("export_bytes", exported.get("ok") and Path(exported["path"]).exists(), exported.get("path"))
again = api.export_bytes("prova.png", tiny)
check("export_bytes dedup", again.get("filename") != exported.get("filename"), again.get("filename"))

# I file non validi devono restituire un errore, non sollevare eccezioni
bad = api.load_class("..\\..\\etc\\passwd")
check("traversal bloccato", bad.get("ok") is False and "non valido" in bad.get("error", ""), bad.get("error"))

missing = api.load_class("inesistente.json")
check("file mancante", missing.get("ok") is False, missing.get("error"))

invalid = api.save_class(file, {"niente": "data"})
check("payload non valido", invalid.get("ok") is False, invalid.get("error"))

deleted = api.delete_class(dup_file)
check("delete_class", deleted.get("ok"))
check("delete_class sposta nel cestino", (Path(base) / "Cestino").glob("*.json").__next__() is not None)

# una classe corrotta non deve rompere l'elenco; le classi stanno
# direttamente nella cartella files, quindi il file va lì
broken = Path(base) / "rotto.json"
broken.write_text("{ non json", encoding="utf-8")
listing = api.list_classes()
check("list_classes tollera file corrotti", listing.get("ok") and len(listing["classes"]) == 1, len(listing["classes"]))
# impostazioni.json, nella stessa cartella, non è una classe
check("impostazioni esclusa", all(item["file"] != "impostazioni.json" for item in listing["classes"]))

check("diagnostica scritta", (Path(base) / "diagnostica.log").exists())

print()
print("Cartella di prova:", base)
if errors:
    print("Moduli con errori:", len(errors))
    shutil.rmtree(base, ignore_errors=True)
    sys.exit(1)
print("Tutti i controlli superati.")
shutil.rmtree(base, ignore_errors=True)
