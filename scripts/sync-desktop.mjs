/* Copia i moduli condivisi nella cartella dell'app desktop.
   La copia serve per avere tutti gli asset sotto desktop/web, così
   l'app packaged e l'anteprima nel browser usano gli stessi percorsi. */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(root, 'desktop', 'web', 'vendor');

const js = ['00-core.js', '05-template.js', '10-store.js', '20-map.js', '30-editor.js', '40-export.js', '50-import.js'];
const css = ['00-base.css', '10-editor.css', '20-map.css', '30-dialogs.css'];

await mkdir(join(web, 'js'), { recursive: true });
await mkdir(join(web, 'css'), { recursive: true });

for (const name of js) {
  await copyFile(join(root, 'src', 'js', name), join(web, 'js', name));
}
for (const name of css) {
  await copyFile(join(root, 'src', 'css', name), join(web, 'css', name));
}

console.log('Moduli condivisi copiati in desktop/web/vendor (' + js.length + ' JS, ' + css.length + ' CSS).');
