#!/usr/bin/env node
// Regenerate .output/public/index.html with correct asset hashes.
// TanStack Start / Nitro emits hashed assets but no index.html.
// Tauri v2 needs one at the frontendDist root.
const fs = require('fs');
const path = require('path');

const outDir = '.output/public';
const assetsDir = path.join(outDir, 'assets');

if (!fs.existsSync(assetsDir)) {
  console.error('ERROR: assets dir not found at', assetsDir);
  process.exit(1);
}

const entries = fs.readdirSync(assetsDir);
const indexJs = entries.find(f => /^index-[a-zA-Z0-9-]+\.js$/.test(f));
const stylesCss = entries.find(f => /^styles-[a-zA-Z0-9]+\.css$/.test(f));

if (!indexJs) {
  console.error('ERROR: no index JS found in', assetsDir);
  console.error('Available files:', entries.filter(f => f.endsWith('.js')).slice(0, 5));
  process.exit(1);
}

const cssTag = stylesCss
  ? '\n    <link rel="stylesheet" href="/assets/' + stylesCss + '" />'
  : '';

const html = '<!DOCTYPE html>\n' +
  '<html lang="en">\n' +
  '  <head>\n' +
  '    <meta charset="UTF-8" />\n' +
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
  '    <title>Foundry</title>\n' +
  '    <link rel="icon" href="/favicon.ico" />' + cssTag + '\n' +
  '  </head>\n' +
  '  <body>\n' +
  '    <div id="root"></div>\n' +
  '    <script type="module" src="/assets/' + indexJs + '"></script>\n' +
  '  </body>\n' +
  '</html>';

fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
console.log('index.html updated -> /assets/' + indexJs + (stylesCss ? ' + ' + stylesCss : ''));
