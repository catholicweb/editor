#!/usr/bin/env node
/**
 * Bulk image import CLI.
 *
 * Compresses every image in a folder to WebP (resized within 1920x1080, ~250KB,
 * min quality 0.6) and writes the results to a local output folder, named with
 * the same media-<sanitized-name>.webp convention the editor uses for uploads.
 * Unlike the editor, no content hash is appended to the filename.
 *
 * Usage:
 *   node docs/.vitepress/import-media.js <inputDir> [outputDir]
 *
 * Reuses the editor's naming logic (relPathForNewMedia) rather than duplicating
 * it, so output stays compatible with what the editor's image picker expects.
 */
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { relPathForNewMedia } from './theme/lib/content-index.js';

const HELP = `Usage:
  node docs/.vitepress/import-media.js <inputDir> [outputDir]

Compresses every image in <inputDir> to WebP (fit within 1920x1080, ~250KB,
min quality 0.6), names each media-<sanitized>.webp (no content hash), and
writes it to [outputDir] (default: ./import-media-output).`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}
const [inputArg, outputArg] = args.filter((a) => !a.startsWith('-'));
if (!inputArg) {
  console.error('Missing <inputDir>');
  console.log(HELP);
  process.exit(1);
}

const INPUT = path.resolve(process.cwd(), inputArg);
const OUTPUT = path.resolve(process.cwd(), outputArg ?? 'import-media-output');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.avif']);

// Mirror the browser's compressToWebP: resize to fit within max bounds (no
// upscale), then binary-search WebP quality toward the target size.
async function compressToWebP(filePath) {
  const targetW = 1920;
  const targetH = 1080;
  const targetBytes = 250 * 1024;
  const minQuality = 0.6;

  const pipeline = sharp(filePath).resize(targetW, targetH, {
    fit: 'inside',
    withoutEnlargement: true,
  });

  // Internal `quality` mirrors the browser's 0-1 scale; sharp's .webp() expects
  // an integer 1-100, so convert at the call site.
  const webp = (q) => pipeline.clone().webp({ quality: Math.round(q * 100) }).toBuffer();

  let quality = 0.92;
  let buf = await webp(quality);

  if (buf.length > targetBytes) {
    let low = minQuality;
    let high = quality;
    for (let i = 0; i < 10; i++) {
      quality = (low + high) / 2;
      buf = await webp(quality);
      if (buf.length > targetBytes) {
        high = quality;
      } else {
        low = quality;
        if (buf.length > targetBytes * 0.9) break;
      }
      if (quality <= minQuality) break;
    }
  }
  return buf;
}

async function main() {
  let entries;
  try {
    entries = (await readdir(INPUT)).sort();
  } catch (err) {
    console.error(`Cannot read input dir "${INPUT}": ${err.message}`);
    process.exit(1);
  }
  await mkdir(OUTPUT, { recursive: true });

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const name of entries) {
    const src = path.join(INPUT, name);
    const info = await stat(src);
    if (!info.isFile()) continue;
    if (!IMAGE_EXT.has(path.extname(name).toLowerCase())) {
      skipped++;
      console.log(`↷ skip ${name} (not an image)`);
      continue;
    }
    try {
      const buf = await compressToWebP(src);
      // Reuse the editor's naming: it sanitizes the base name, forces .webp and
      // yields media-<name>.webp. Empty schema -> default 'media-' prefix. No
      // hashSuffix -> no content hash.
      const relPath = relPathForNewMedia({}, name);
      await writeFile(path.join(OUTPUT, relPath), buf);
      console.log(`✓ ${name} -> ${relPath} (${(buf.length / 1024).toFixed(0)} KB)`);
      processed++;
    } catch (err) {
      failed++;
      console.error(`✗ ${name}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${processed} converted, ${failed} failed, ${skipped} skipped -> ${OUTPUT}`);
}

await main();
