const fs = require('node:fs');
const path = require('node:path');

const distDir = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexPath)) throw new Error('dist/index.html is missing. Run `npm run build`.');

const html = fs.readFileSync(indexPath, 'utf8');
const assetReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((reference) => reference.includes('assets/'));

if (assetReferences.length === 0) throw new Error('Built app does not reference any renderer assets.');

for (const reference of assetReferences) {
  if (!reference.startsWith('./assets/')) {
    throw new Error(`Packaged renderer asset must use a relative path: ${reference}`);
  }
  const assetPath = path.join(distDir, reference.slice(2));
  if (!fs.existsSync(assetPath)) throw new Error(`Built renderer asset is missing: ${reference}`);
}

console.log(`Verified ${assetReferences.length} packaged renderer assets.`);
