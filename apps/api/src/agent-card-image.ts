import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createElement, type CSSProperties, type ReactNode } from 'react';
import satori from 'satori';
import sharp from 'sharp';
import type { PublicAgentCard } from '../../../packages/protocol/src/index.js';

const shorten = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;

interface CapabilityChip {
  label: string;
  width: number;
  x: number;
}

function capabilityChips(capabilities: string[]): CapabilityChip[] {
  let x = 64;
  return capabilities.slice(0, 4).map((capability) => {
    const label = shorten(capability, 25);
    const width = Math.min(250, Math.max(96, label.length * 10 + 32));
    const chip = { label, width, x };
    x += width + 12;
    return chip;
  });
}

function descriptionLines(value: string) {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || (current.length + word.length + 1 > 66 && lines.length < 2)) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length > 2) lines.length = 2;
  if (lines[1] && lines[1].length > 66) lines[1] = shorten(lines[1], 66);
  return lines;
}

const absolute = (style: CSSProperties): CSSProperties => ({
  position: 'absolute',
  display: 'flex',
  ...style,
});

let geistFonts: Array<{
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: 'normal';
}> | null = null;

function loadGeistFonts() {
  if (geistFonts) return geistFonts;
  const require = createRequire(import.meta.url);
  const generatedFontDirectory = join(process.cwd(), '.openclasp-build', 'agent-card-fonts');
  const fontDirectory = existsSync(generatedFontDirectory)
    ? generatedFontDirectory
    : join(dirname(require.resolve('geist/font/sans')), 'fonts/geist-sans');
  geistFonts = [
    {
      name: 'Geist',
      data: readFileSync(join(fontDirectory, 'Geist-Regular.ttf')),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'Geist',
      data: readFileSync(join(fontDirectory, 'Geist-Bold.ttf')),
      weight: 700,
      style: 'normal',
    },
  ];
  return geistFonts;
}

async function renderTextLayer({
  card,
  chips,
  description,
  initials,
  name,
  nameSize,
  publicReference,
}: {
  card: PublicAgentCard;
  chips: CapabilityChip[];
  description: string[];
  initials: string;
  name: string;
  nameSize: number;
  publicReference: string;
}) {
  const children: ReactNode[] = [
    createElement(
      'div',
      {
        key: 'brand',
        style: absolute({
          left: 108,
          top: 58,
          color: '#f04b2d',
          fontSize: 27,
          fontWeight: 700,
          letterSpacing: -1,
          lineHeight: 1,
        }),
      },
      'OpenClasp',
    ),
    createElement(
      'div',
      {
        key: 'verified',
        style: absolute({
          left: 978,
          top: 69,
          color: '#44d37e',
          fontSize: 16,
          lineHeight: 1,
        }),
      },
      'Publisher verified',
    ),
    createElement(
      'div',
      {
        key: 'initials',
        style: absolute({
          left: 64,
          top: 165,
          width: 122,
          height: 122,
          alignItems: 'center',
          justifyContent: 'center',
          color: '#ff8068',
          fontSize: 42,
          fontWeight: 700,
        }),
      },
      initials || 'AI',
    ),
    createElement(
      'div',
      {
        key: 'framework',
        style: absolute({
          left: 220,
          top: 160,
          color: '#a99e99',
          fontSize: 18,
          letterSpacing: 2,
          lineHeight: 1,
        }),
      },
      `${shorten(card.framework, 44).toUpperCase()} · AGENT CARD`,
    ),
    createElement(
      'div',
      {
        key: 'name',
        style: absolute({
          left: 220,
          top: 196,
          color: '#f7f2ef',
          fontSize: nameSize,
          fontWeight: 700,
          letterSpacing: -2,
          lineHeight: 1,
        }),
      },
      name,
    ),
    ...description.map((line, index) =>
      createElement(
        'div',
        {
          key: `description-${index}`,
          style: absolute({
            left: 220,
            top: 287 + index * 34,
            color: '#c7bdb8',
            fontSize: 24,
            lineHeight: 1,
          }),
        },
        line,
      ),
    ),
    ...chips.map((chip) =>
      createElement(
        'div',
        {
          key: `chip-${chip.x}`,
          style: absolute({
            left: chip.x + 16,
            top: 442,
            color: '#ddd4d0',
            fontSize: 17,
            lineHeight: 1,
          }),
        },
        chip.label,
      ),
    ),
    createElement(
      'div',
      {
        key: 'reference',
        style: absolute({
          left: 64,
          top: 568,
          color: '#8f8580',
          fontSize: 16,
          lineHeight: 1,
        }),
      },
      publicReference,
    ),
    createElement(
      'div',
      {
        key: 'disclaimer',
        style: absolute({
          right: 64,
          top: 568,
          color: '#8f8580',
          fontSize: 16,
          lineHeight: 1,
        }),
      },
      'Capabilities are self-declared',
    ),
  ];

  return satori(
    createElement(
      'div',
      {
        style: {
          position: 'relative',
          display: 'flex',
          width: 1200,
          height: 630,
          fontFamily: 'Geist',
        },
      },
      ...children,
    ),
    { width: 1200, height: 630, fonts: loadGeistFonts() },
  );
}

export async function renderAgentCardImage(card: PublicAgentCard) {
  const initials = card.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  const publicReference = shorten(card.profileUrl ?? card.cardUrl, 88);
  const name = shorten(card.name, 42);
  const nameSize = name.length > 30 ? 50 : 62;
  const description = descriptionLines(card.description || 'Public agent identity on OpenClasp');
  const chips = capabilityChips(card.capabilities);
  const textLayer = await renderTextLayer({
    card,
    chips,
    description,
    initials,
    name,
    nameSize,
    publicReference,
  });
  const textContent = textLayer.slice(textLayer.indexOf('>') + 1, textLayer.lastIndexOf('</svg>'));
  const chipBackgrounds = chips
    .map(
      ({ width, x }) =>
        `<rect x="${x}" y="430" width="${width}" height="42" rx="8" fill="#ffffff0b" stroke="#ffffff28"/>`,
    )
    .join('');
  const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0c0a0a"/>
        <stop offset="0.62" stop-color="#17100e"/>
        <stop offset="1" stop-color="#2a120d"/>
      </linearGradient>
      <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(1030 120) rotate(140) scale(430 340)">
        <stop stop-color="#f04b2d" stop-opacity="0.2"/>
        <stop offset="1" stop-color="#f04b2d" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#background)"/>
    <rect width="1200" height="630" fill="url(#glow)"/>
    <path d="M64 66h18l10 10-10 10H64l-10-10 10-10Z" fill="none" stroke="#f04b2d" stroke-width="4"/>
    <rect x="936" y="58" width="200" height="42" rx="21" fill="#44d37e0d" stroke="#44d37e88"/>
    <path d="M954 79l5 5 9-11" fill="none" stroke="#44d37e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="64" y="165" width="122" height="122" rx="28" fill="#f04b2d1a" stroke="#f04b2d80"/>
    ${chipBackgrounds}
    <line x1="64" y1="540" x2="1136" y2="540" stroke="#ffffff21"/>
    ${textContent}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
