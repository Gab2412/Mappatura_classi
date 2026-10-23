import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const xlsx = readFileSync(resolve(root, 'assets/Modello_Planimetria_Classi.xlsx'));
const base64 = xlsx.toString('base64');
const header = '/* Generato da scripts/embed-template.mjs — non modificare a mano. */\n';
const body = 'window.CC = window.CC || {};\nwindow.CC.TEMPLATE_XLSX_B64 = ' + JSON.stringify(base64) + ';\n';
writeFileSync(resolve(root, 'src/js/05-template.js'), header + body, 'utf8');
console.log('Embedded template:', base64.length, 'base64 chars');
