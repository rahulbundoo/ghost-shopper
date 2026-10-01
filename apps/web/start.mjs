await import('../../scripts/preflight.mjs');
if (!process.exitCode) {
  process.argv[2] = './build/server/index.js';
  await import('./node_modules/@react-router/serve/bin.js');
}
