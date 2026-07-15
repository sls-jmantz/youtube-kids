const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'linux') process.exit(0);

const electronBinary = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron');
const electronInstallScript = path.join(__dirname, '..', 'node_modules', 'electron', 'install.js');
if (!fs.existsSync(electronBinary)) {
  if (!fs.existsSync(electronInstallScript)) {
    console.error('Electron package is missing. Run `npm install` first.');
    process.exit(1);
  }
  console.error('Electron runtime is missing. Downloading it now...');
  try {
    execFileSync(process.execPath, [electronInstallScript], { stdio: 'inherit' });
  } catch (error) {
    console.error('Electron runtime download failed. Try `npm run electron:install` or remove `node_modules` and run `npm install` again.');
    console.error(error.message);
    process.exit(1);
  }
  if (!fs.existsSync(electronBinary)) {
    console.error('Electron runtime is still missing after download. Try `npm run electron:install`.');
    process.exit(1);
  }
}

let output = '';
try {
  output = execFileSync('ldd', [electronBinary], { encoding: 'utf8' });
} catch (error) {
  console.error('Could not check Electron Linux dependencies with `ldd`.');
  console.error(error.message);
  process.exit(1);
}

const missingLibraries = output.split('\n')
  .map((line) => line.match(/^\s*(\S+)\s+=>\s+not found\s*$/)?.[1])
  .filter(Boolean);

if (missingLibraries.length === 0) process.exit(0);

const ubuntuPackages = [
  'libatk1.0-0',
  'libatk-bridge2.0-0',
  'libatspi2.0-0',
  'libcairo2',
  'libcups2',
  'libgtk-3-0',
  'libnss3',
  'libpango-1.0-0',
  'libxcomposite1',
  'libxdamage1',
  'libxfixes3',
  'libxrandr2',
  'libxss1',
  'libasound2t64',
  'libgbm1',
  'libdrm2',
  'libxkbcommon0',
];

console.error('Electron cannot start because Linux desktop libraries are missing:');
for (const library of missingLibraries) console.error(`- ${library}`);
console.error('');
console.error('On Ubuntu/Debian, install the common Electron runtime dependencies:');
console.error(`sudo apt install ${ubuntuPackages.join(' ')}`);
console.error('For .deb packaging, also install `binutils` for the `ar` executable.');
console.error('');
console.error(`Detected platform: ${os.type()} ${os.release()} ${os.arch()}`);
process.exit(1);
