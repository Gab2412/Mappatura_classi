/* Costruisce il file unico dist/Cartina-di-Classe.html partendo dalla stessa
   interfaccia dell'app desktop (desktop/web): così la versione HTML e quella
   .exe condividono UI, logica e fogli di stile, con un solo file da consegnare. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const base = resolve(root, 'desktop', 'web');
const entry = resolve(base, 'index.html');
const distDir = resolve(root, 'dist');
const docsDir = resolve(root, 'docs');
mkdirSync(distDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

// Anche da un clone pulito: i moduli condivisi vengono copiati prima della build.
execFileSync(process.execPath, [resolve(root, 'scripts', 'sync-desktop.mjs')], { stdio: 'inherit' });

let html = readFileSync(entry, 'utf8');

const cssBlocks = [];
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*>/g, (match, href) => {
  if (/^https?:/.test(href)) throw new Error('Risorsa esterna non consentita: ' + href);
  const file = resolve(base, href);
  const content = readFileSync(file, 'utf8');
  cssBlocks.push({ href, content });
  return '<!--CSS:' + href + '-->';
});

const jsBlocks = [];
html = html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (match, srcPath) => {
  if (/^https?:/.test(srcPath)) throw new Error('Risorsa esterna non consentita: ' + srcPath);
  const file = resolve(base, srcPath);
  let content = readFileSync(file, 'utf8');
  content = content.replace(/<\/script/gi, '<\\/script');
  jsBlocks.push({ src: srcPath, content });
  return '<!--JS:' + srcPath + '-->';
});

// Sostituisce i segnaposto nell'ordine originale.
html = html.replace(/<!--CSS:([^>]+)-->/g, (m, href) => {
  const block = cssBlocks.find((x) => x.href === href);
  return '<style data-source="' + href + '">\n' + block.content + '\n</style>';
});
html = html.replace(/<!--JS:([^>]+)-->/g, (m, srcPath) => {
  const block = jsBlocks.find((x) => x.src === srcPath);
  return '<script data-source="' + srcPath + '">\n' + block.content + '\n</script>';
});

const banner = '<!--\n  Cartina di Classe — applicazione portatile in un solo file.\n' +
  '  Nessuna installazione, nessun account, nessuna connessione di rete.\n' +
  '  Tutti i dati restano nella cartella scelta («files»).\n' +
  '  Generata il ' + new Date().toISOString() + '\n-->\n';
html = html.replace('<!doctype html>', '<!doctype html>\n' + banner);

// I namespace XML standard (SVG, OOXML, XLink) non sono risorse di rete:
// vengono ignorati nel controllo, così il file resta verificabile come offline.
const KNOWN_NAMESPACES = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
  'http://schemas.openxmlformats.org/',
  'http://schemas.microsoft.com/',
  'http://purl.org/',
];
const urls = html.match(/https?:\/\/[^\s"'<>)]+/g) || [];
const unknown = Array.from(new Set(urls)).filter((url) => !KNOWN_NAMESPACES.some((ns) => url.startsWith(ns)));
if (unknown.length) {
  console.warn('ATTENZIONE: il file generato contiene URL non previsti: ' + unknown.slice(0, 5).join(', '));
  if (unknown.length > 5) console.warn('… e altri ' + (unknown.length - 5) + ' URL.');
}
if (/<link[^>]+href="https?:/.test(html) || /<script[^>]+src="https?:/.test(html)) {
  console.warn('ATTENZIONE: il file generato richiama risorse esterne.');
}

const out = resolve(distDir, 'Cartina-di-Classe.html');
writeFileSync(out, html, 'utf8');
copyFileSync(resolve(root, 'assets/Modello_Planimetria_Classi.xlsx'), resolve(distDir, 'Modello_Planimetria_Classi.xlsx'));

// La cartella docs/ è il sito pubblicato: landing + app + download.
const docsHtml = resolve(docsDir, 'app.html');
writeFileSync(docsHtml, html, 'utf8');
copyFileSync(resolve(root, 'assets/Modello_Planimetria_Classi.xlsx'), resolve(docsDir, 'Modello_Planimetria_Classi.xlsx'));

const exe = resolve(distDir, 'CartinaDiClasse.exe');
let exeCopied = false;
if (existsSync(exe)) {
  try {
    copyFileSync(exe, resolve(docsDir, 'CartinaDiClasse.exe'));
    exeCopied = true;
  } catch (error) {
    console.warn('Exe non copiato in docs/ (forse è in esecuzione): ' + error.message);
  }
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('Sorgente: ' + entry);
console.log('Creato ' + out);
console.log('Aggiornato ' + docsHtml);
if (exeCopied) console.log('Aggiornato ' + resolve(docsDir, 'CartinaDiClasse.exe'));
console.log('Dimensioni: ' + kb(statSync(out).size));
console.log('CSS inclusi: ' + cssBlocks.length + ', script inclusi: ' + jsBlocks.length);
