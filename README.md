<p align="center">
  <img src="desktop/icona.png" width="64" alt="Icona di Cartina di Classe">
</p>

<h1 align="center">Cartina di Classe</h1>

<p align="center">
  <strong>La pianta dei posti, senza cloud.</strong><br>
  Crea la cartina, sistema gli alunni e stampa.<br>
  I file restano nella tua cartella.
</p>

<p align="center">
  <a href="https://Gab2412.github.io/Mappatura_classi/"><b>Apri l'app online</b></a>
  &nbsp;·&nbsp;
  <a href="docs/CartinaDiClasse.exe">Scarica l'exe · Windows</a>
  &nbsp;·&nbsp;
  <a href="GUIDA.md">Guida completa</a>
</p>

<p align="center"><sub><b>v2.4</b> · Chrome / Edge · Windows · HTML portatile</sub></p>

<p align="center">
  <img src="docs/app.png" alt="Schermata di Cartina di Classe: mappa dei banchi di una classe e elenco degli alunni" width="100%">
</p>

> **In breve.** Apri l'app, scegli una cartella, crea la classe. Nessun account, nessun cloud, nessun dato inviato: le classi sono file JSON che puoi copiare, backuppare e passare a un collega.

## Cos'è

Cartina di Classe è un'app per docenti: disegna la pianta dei banchi, assegna gli alunni, esporta un PNG pronto per la stampa. È pensata per essere leggibile e usabile anche con poca vista, senza rinunciare a un'interfaccia semplice.

## In 30 secondi

1. **Apri l'app** e scegli una cartella. Lì nasce `files/`, con tutto quello che serve.
2. **Crea la classe**: nome, aula, alunni. La procedura guidata prepara i banchi e li riempie in ordine alfabetico.
3. **Stampa o condividi**: un PNG A4 per il muro, oppure il file JSON della classe da passare a un collega.

## Cosa ci trovi

- **Mappa vista dal docente**: lavagna in basso, posti numerati, file e colonne etichettate.
- **Alunni sempre A→Z**: l'elenco resta ordinato anche quando aggiungi o incolli nomi in disordine.
- **Import da Excel o CSV**: porta dentro elenco e disposizione dei banchi, con un'anteprima prima di applicare.
- **Stampa e immagini**: PNG chiaro per la stampa, scuro per lo schermo, anche in formato A4 orizzontale. [Guarda un esempio](docs/anteprima.png).
- **Accessibilità**: testi da 16 a 32 px, temi chiaro/scuro, contrasto alto e tutti i comandi da tastiera.
- **Classi multiple**: apri, duplica, rinomina, elimina e recupera dal cestino.
- **Niente installazioni**: un exe per Windows o un solo file HTML da aprire con Chrome o Edge.

## I tuoi file restano tuoi

```
files/
  <classe>.json       una classe, un file leggibile
  Esportazioni/       PNG, modelli e file di stampa
  Cestino/            classi eliminate, recuperabili
  impostazioni.json   tema e preferenze
```

Per un **backup** copia tutta la cartella `files`. Per passare una classe a un collega, condividi il singolo `.json` (o usa **Apri file…** dall'app). Non c'è nessun account, nessun server e nessun dato che esce dal computer.

## Quale versione

| Versione | Come | Quando conviene |
| --- | --- | --- |
| **Online** | [Apri l'app](https://Gab2412.github.io/Mappatura_classi/) | La più comoda: apri il browser, scegli la cartella e lavora. |
| **HTML portatile** | [`docs/app.html`](docs/app.html) · dalla pagina online **Scarica .html** | Un solo file da portare su una chiavetta o su un computer senza Python. |
| **Windows .exe** | [Scarica `CartinaDiClasse.exe`](docs/CartinaDiClasse.exe) | Finestra propria e cartella `files` creata accanto all'app. |

Le versioni sono archiviate anche nelle **[Release](https://github.com/Gab2412/Mappatura_classi/releases)**.

> **Browser.** Per scegliere e scrivere in una cartella locale servono **Chrome** o **Edge**. Firefox e Safari non hanno questa funzione: l'app si apre, ma non può salvare i file. È un limite del browser, non dell'app.

## Sviluppo

Servono Node.js 18+ per la build HTML e Python 3.14 con `pywebview`, `pythonnet`, `PyInstaller` e `Pillow` per l'exe.

```bash
node scripts/build.mjs                            # HTML in dist/ e docs/
powershell -ExecutionPolicy Bypass -File desktop\build.ps1   # exe Windows
node --test tests/core.test.mjs                   # test del modello dati
python desktop/test_api.py                        # test del backend
```

La cartella `docs/` è il sito pubblicato. La landing è [Gab2412.github.io/Mappatura_classi](https://Gab2412.github.io/Mappatura_classi/), l'app è su `/app.html`; l'exe e il modello Excel sono i download. Pages pubblica `docs/` dal branch `main` (`.nojekyll` incluso).

Tutti i dettagli su comandi, struttura, import, stampa e accessibilità sono nella **[guida completa](GUIDA.md)**.

---

<p align="center"><sub>Nessun account. Nessun cloud. Nessun tracciamento.</sub></p>
