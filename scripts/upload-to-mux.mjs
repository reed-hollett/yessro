#!/usr/bin/env node
/**
 * Upload all converted clips to Mux and generate a manifest with playback URLs.
 *
 * Usage:
 *   MUX_TOKEN_ID=xxx MUX_TOKEN_SECRET=yyy node scripts/upload-to-mux.mjs
 *
 * Or create a .env file with those values.
 */

import Mux from '@mux/mux-node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const CLIPS_DIR = path.join(PROJECT_DIR, 'public', 'clips');
const MANIFEST_PATH = path.join(CLIPS_DIR, 'manifest.json');

const TOKEN_ID = process.env.MUX_TOKEN_ID;
const TOKEN_SECRET = process.env.MUX_TOKEN_SECRET;

if (!TOKEN_ID || !TOKEN_SECRET) {
  console.error('Missing MUX_TOKEN_ID or MUX_TOKEN_SECRET environment variables.');
  console.error('Usage: MUX_TOKEN_ID=xxx MUX_TOKEN_SECRET=yyy node scripts/upload-to-mux.mjs');
  process.exit(1);
}

const mux = new Mux({ tokenId: TOKEN_ID, tokenSecret: TOKEN_SECRET });

// Get all mp4 files in the clips directory
const clips = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.mp4')).sort();
console.log(`Found ${clips.length} clips to upload\n`);

const manifest = [];

// Upload one at a time to avoid rate limits
for (let i = 0; i < clips.length; i++) {
  const filename = clips[i];
  try {
    // Create a direct upload URL
    const upload = await mux.video.uploads.create({
      new_asset_settings: {
        playback_policy: ['public'],
      },
      cors_origin: '*',
    });

    // Upload the file
    const filePath = path.join(CLIPS_DIR, filename);
    const fileData = fs.readFileSync(filePath);

    await fetch(upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: fileData,
    });

    console.log(`[${i + 1}/${clips.length}] UPLOADED: ${filename}`);
    manifest.push({ filename, uploadId: upload.id });

    // Small delay between uploads to respect rate limits
    await new Promise(r => setTimeout(r, 1000));
  } catch (err) {
    console.error(`[${i + 1}/${clips.length}] FAILED: ${filename} — ${err.message}`);
  }
}

console.log(`\nWaiting for assets to be ready...`);

// Poll until all uploads resolve to assets with playback IDs
const playbackUrls = [];

for (const item of manifest) {
  let attempts = 0;
  while (attempts < 60) {
    const upload = await mux.video.uploads.retrieve(item.uploadId);

    if (upload.asset_id) {
      const asset = await mux.video.assets.retrieve(upload.asset_id);

      if (asset.status === 'ready') {
        const playbackId = asset.playback_ids?.[0]?.id;
        if (playbackId) {
          // Mux stream URL — use low latency mp4 rendition
          const url = `https://stream.mux.com/${playbackId}/medium.mp4`;
          playbackUrls.push(url);
          console.log(`READY: ${item.filename} → ${url}`);
        }
        break;
      } else if (asset.status === 'errored') {
        console.error(`ERROR: ${item.filename} — asset errored`);
        break;
      }
    }

    attempts++;
    await new Promise(r => setTimeout(r, 5000)); // wait 5s between polls
  }

  if (attempts >= 60) {
    console.error(`TIMEOUT: ${item.filename} — gave up after 5 minutes`);
  }
}

// Write manifest
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(playbackUrls, null, 2));
console.log(`\nDone! ${playbackUrls.length} clips uploaded.`);
console.log(`Manifest written to: ${MANIFEST_PATH}`);
