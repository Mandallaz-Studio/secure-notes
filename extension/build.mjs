/**
 * Construit l'extension de navigateur dans `extension/dist` (Chrome, Edge,
 * Firefox : un seul paquet Manifest V3).
 *
 *   npm run extension
 *
 * Comme la page de lecture, elle reprend le serveur et le site de lecture de
 * `.env.local` (ou de l'environnement) : EXPO_PUBLIC_SUPABASE_URL,
 * EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_SHARE_BASE_URL. Le code du
 * protocole est celui de l'app (`src/share/handoff.ts`), libsodium compris.
 */
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist');

/** Variables `EXPO_PUBLIC_*` : environnement d'abord, puis `.env.local`, puis `.env`. */
async function publicEnv() {
  const values = {};
  for (const file of ['.env', '.env.local']) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
      const match = /^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (name.startsWith('EXPO_PUBLIC_') && value !== undefined) values[name] = value;
  }
  return values;
}

const env = await publicEnv();
const site = (env.EXPO_PUBLIC_SHARE_BASE_URL ?? '').trim();
if (!/^https:\/\/[^/?#\s]+\/?$/.test(site)) {
  console.error(
    'EXPO_PUBLIC_SHARE_BASE_URL doit désigner le site de lecture (https://…) : les notes reçues s’y ouvrent.',
  );
  process.exit(1);
}

const define = {};
for (const name of [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_SHARE_BASE_URL',
]) {
  define[`process.env.${name}`] = JSON.stringify(env[name] ?? '');
}

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'fonts'), { recursive: true });
await mkdir(join(out, 'icons'), { recursive: true });

await build({
  entryPoints: { popup: join(here, 'src/popup.ts'), options: join(here, 'src/options.ts') },
  outdir: out,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120', 'firefox128'],
  minify: true,
  legalComments: 'external',
  tsconfig: join(root, 'tsconfig.json'),
  // Même repli que la page de lecture et les tests : libsodium en WebAssembly.
  alias: { 'react-native-libsodium': 'libsodium-wrappers' },
  // Branches Node de libsodium, jamais prises dans un navigateur.
  external: ['crypto', 'path', 'fs'],
  define: { ...define, 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

const manifest = JSON.parse(await readFile(join(here, 'static/manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
manifest.version = pkg.version;
await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const file of ['popup.html', 'options.html', 'styles.css']) {
  await copyFile(join(here, 'static', file), join(out, file));
}

const fonts = [
  ['ibm-plex-sans/400Regular', 'IBMPlexSans_400Regular.ttf'],
  ['ibm-plex-sans/500Medium', 'IBMPlexSans_500Medium.ttf'],
  ['ibm-plex-sans/600SemiBold', 'IBMPlexSans_600SemiBold.ttf'],
  ['ibm-plex-mono/400Regular', 'IBMPlexMono_400Regular.ttf'],
];
for (const [dir, file] of fonts) {
  await copyFile(join(root, 'node_modules/@expo-google-fonts', dir, file), join(out, 'fonts', file));
}

// Icônes réduites depuis assets/images/icon.png (convert icon.png -resize NxN -strip N.png).
for (const size of [16, 32, 48, 128]) {
  await copyFile(join(here, 'static/icons', `${size}.png`), join(out, 'icons', `${size}.png`));
}

console.log(`Extension construite dans ${out} (site de lecture : ${site}).`);
