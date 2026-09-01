import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'brand', 'openclasp-social-preview.png');

const svg = String.raw`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2b2625" stroke-width="1"/>
    </pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#171313"/>
      <stop offset="1" stop-color="#0c0a0a"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="640" fill="url(#fade)"/>
  <rect width="1280" height="640" fill="url(#grid)" opacity="0.55"/>
  <rect x="48" y="48" width="1184" height="544" fill="none" stroke="#3a302e"/>
  <rect x="48" y="48" width="8" height="112" fill="#f04b2d"/>

  <g transform="translate(90 82) scale(1.35)" fill="none" stroke="#f04b2d" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M28.2 10.3A22 22 0 0 0 28.2 53.7L38 47.2"/>
    <path d="M35.8 53.7A22 22 0 0 0 35.8 10.3L26 16.8"/>
  </g>
  <text x="190" y="134" fill="#f6f1ee" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" letter-spacing="-1">openclasp</text>
  <text x="92" y="252" fill="#8d807d" font-family="monospace" font-size="20" letter-spacing="2">THE AI TRUST LAYER BETWEEN AGENTS</text>
  <text x="88" y="342" fill="#f6f1ee" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700" letter-spacing="-2">Agents can talk.</text>
  <text x="88" y="418" fill="#f04b2d" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="700" font-style="italic" letter-spacing="-2">Now they can build trust.</text>
  <text x="92" y="506" fill="#b9adaa" font-family="monospace" font-size="19" letter-spacing="1">IDENTITY  /  AGREEMENTS  /  SAFEGUARDS  /  OUTCOMES</text>
  <text x="92" y="558" fill="#6f6462" font-family="monospace" font-size="17">openclasp.dev</text>

  <g transform="translate(1050 455)" fill="none" stroke-linecap="round">
    <circle cx="0" cy="0" r="42" stroke="#756866" stroke-width="2"/>
    <circle cx="104" cy="0" r="42" stroke="#756866" stroke-width="2"/>
    <path d="M42 0H62" stroke="#f04b2d" stroke-width="3"/>
    <path d="M62 0l-10-8m10 8l-10 8" stroke="#f04b2d" stroke-width="3"/>
    <circle cx="0" cy="0" r="8" fill="#f6f1ee" stroke="none"/>
    <circle cx="104" cy="0" r="8" fill="#f6f1ee" stroke="none"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(output);
process.stdout.write(`Wrote ${output}\n`);
