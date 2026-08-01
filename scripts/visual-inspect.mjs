#!/usr/bin/env node
/**
 * Launches the real Karn Forge Electron app via Playwright and takes a
 * screenshot, so an agent (or a human) can visually confirm a UI change
 * without alt-tabbing to the app. Not a test suite — no assertions.
 *
 * Usage:
 *   node scripts/visual-inspect.mjs --dev [--wait 1000] [--out path.png]
 *   node scripts/visual-inspect.mjs --prod [--wait 1000] [--out path.png]
 *
 * --dev  attaches to the already-running `vite` dev server (localhost:5173).
 *        Requires `npm run dev` running in another terminal.
 * --prod builds the renderer first, then launches against the built bundle.
 *        Self-contained, slower (runs `vite build` each time).
 */
import { _electron as electron } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = { mode: null, wait: 0, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dev') args.mode = 'development';
    else if (a === '--prod') args.mode = 'production';
    else if (a === '--wait') args.wait = Number(argv[++i]) || 0;
    else if (a === '--out') args.out = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode) {
    console.error('Usage: node scripts/visual-inspect.mjs --dev|--prod [--wait ms] [--out path.png]');
    process.exit(1);
  }

  if (args.mode === 'production') {
    console.log('Building renderer (vite build)...');
    execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  } else {
    console.log('Attaching to dev server at http://localhost:5173 (make sure `npm run dev` is running)...');
  }

  const outDir = path.join(rootDir, 'scripts', '.inspect-out');
  mkdirSync(outDir, { recursive: true });
  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(outDir, `inspect-${Date.now()}.png`);

  const app = await electron.launch({
    args: ['.'],
    cwd: rootDir,
    env: { ...process.env, NODE_ENV: args.mode },
  });

  const consoleLines = [];
  const errorLines = [];

  const window = await app.firstWindow();
  window.on('console', (msg) => {
    const line = `[console:${msg.type()}] ${msg.text()}`;
    consoleLines.push(line);
    if (msg.type() === 'error') errorLines.push(line);
  });
  window.on('pageerror', (err) => {
    errorLines.push(`[pageerror] ${err.message}`);
  });

  await window.waitForLoadState('domcontentloaded');
  if (args.wait > 0) await window.waitForTimeout(args.wait);

  await window.screenshot({ path: outPath });
  await app.close();

  console.log(`\nScreenshot saved: ${outPath}`);
  if (errorLines.length) {
    console.log(`\n${errorLines.length} console error(s):`);
    for (const line of errorLines) console.log('  ' + line);
  } else {
    console.log('No console errors.');
  }
}

main().catch((err) => {
  console.error('visual-inspect failed:', err);
  process.exit(1);
});
