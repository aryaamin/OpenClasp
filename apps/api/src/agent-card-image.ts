import sharp from 'sharp';
import type { PublicAgentCard } from '../../../packages/protocol/src/index.js';

const shorten = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;

const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character]!;
  });

function capabilityChips(capabilities: string[]) {
  let x = 64;
  return capabilities
    .slice(0, 4)
    .map((capability) => {
      const label = shorten(capability, 25);
      const width = Math.min(250, Math.max(96, label.length * 10 + 32));
      const chip = `<g transform="translate(${x} 430)">
        <rect width="${width}" height="42" rx="8" fill="#ffffff0b" stroke="#ffffff28"/>
        <text x="16" y="27" fill="#ddd4d0" font-size="17">${escapeXml(label)}</text>
      </g>`;
      x += width + 12;
      return chip;
    })
    .join('');
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
  return lines
    .map((line, index) => `<tspan x="220" dy="${index === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`)
    .join('');
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
  const description = card.description || 'Public agent identity on OpenClasp';
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
    <text x="108" y="84" fill="#f04b2d" font-family="Inter,Arial,sans-serif" font-size="27" font-weight="700" letter-spacing="-1">OpenClasp</text>
    <g transform="translate(936 58)">
      <rect width="200" height="42" rx="21" fill="#44d37e0d" stroke="#44d37e88"/>
      <text x="20" y="27" fill="#44d37e" font-family="Inter,Arial,sans-serif" font-size="16">✓ Publisher verified</text>
    </g>
    <g transform="translate(64 165)">
      <rect width="122" height="122" rx="28" fill="#f04b2d1a" stroke="#f04b2d80"/>
      <text x="61" y="78" text-anchor="middle" fill="#ff8068" font-family="Inter,Arial,sans-serif" font-size="42" font-weight="700">${escapeXml(initials || 'AI')}</text>
    </g>
    <text x="220" y="176" fill="#a99e99" font-family="Inter,Arial,sans-serif" font-size="18" letter-spacing="2">${escapeXml(shorten(card.framework, 44).toUpperCase())} · AGENT CARD</text>
    <text x="220" y="246" fill="#f7f2ef" font-family="Inter,Arial,sans-serif" font-size="${nameSize}" font-weight="700" letter-spacing="-2">${escapeXml(name)}</text>
    <text x="220" y="308" fill="#c7bdb8" font-family="Inter,Arial,sans-serif" font-size="24">${descriptionLines(description)}</text>
    <g font-family="Inter,Arial,sans-serif">${capabilityChips(card.capabilities)}</g>
    <line x1="64" y1="540" x2="1136" y2="540" stroke="#ffffff21"/>
    <text x="64" y="582" fill="#8f8580" font-family="Inter,Arial,sans-serif" font-size="16">${escapeXml(publicReference)}</text>
    <text x="1136" y="582" text-anchor="end" fill="#8f8580" font-family="Inter,Arial,sans-serif" font-size="16">Capabilities are self-declared</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
