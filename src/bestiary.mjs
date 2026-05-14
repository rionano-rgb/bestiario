import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const QRCode = (() => {
  try {
    return require('qrcode-terminal/vendor/QRCode');
  } catch {
    return require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode');
  }
})();
const QRErrorCorrectLevel = (() => {
  try {
    return require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
  } catch {
    return require('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/lib/node_modules/npm/node_modules/qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
  }
})();

export const campaign = {
  name: 'Il Bestiario del Lusso',
  edition: 'Edizione Cavallo di Fuoco 2026',
  signature: 'Creato per Tailer Darden',
};

export const archetypes = [
  {
    id: 'custode',
    label: 'Il Custode',
    noun: 'Custode',
    article: 'Il',
    totem: 'Cavallo',
    caption: 'Vigila su colore, fuoco e memoria.',
  },
  {
    id: 'visionaria',
    label: 'La Visionaria',
    noun: 'Visionaria',
    article: 'La',
    totem: 'Falco',
    caption: 'Riconosce la forma prima che diventi linguaggio.',
  },
  {
    id: 'alchimista',
    label: "L'Alchimista",
    noun: 'Alchimista',
    article: "L'",
    totem: 'Serpente',
    caption: 'Trasforma materia e intuizione in rito.',
  },
  {
    id: 'collezionista',
    label: 'Il Collezionista',
    noun: 'Collezionista',
    article: 'Il',
    totem: 'Pantera',
    caption: 'Sceglie solo ciò che merita di restare.',
  },
  {
    id: 'musa',
    label: 'La Musa',
    noun: 'Musa',
    article: 'La',
    totem: 'Volpe',
    caption: 'Seduce con segni minimi e dettagli assoluti.',
  },
];

export const matters = [
  { id: 'oro', label: 'Oro', accent: '#d5ad63', deep: '#4f3b1f' },
  { id: 'argento', label: 'Argento', accent: '#c3c6cf', deep: '#3f4249' },
  { id: 'pietra', label: 'Pietra', accent: '#7bb0a1', deep: '#163a37' },
  { id: 'smalto', label: 'Smalto', accent: '#a97159', deep: '#351d1a' },
  { id: 'ombra', label: 'Ombra', accent: '#978fb2', deep: '#191626' },
];

export const energies = [
  { id: 'fuoco', label: 'Fuoco', suffix: 'del Fuoco', glow: '#f08a4b' },
  { id: 'notte', label: 'Notte', suffix: 'della Notte', glow: '#6b6d9b' },
  { id: 'acqua', label: 'Acqua', suffix: "dell'Acqua", glow: '#67b2c6' },
  { id: 'luce', label: 'Luce', suffix: 'della Luce', glow: '#f2df9d' },
  { id: 'vento', label: 'Vento', suffix: 'del Vento', glow: '#9eb1d8' },
];

export const ornaments = [
  { id: 'collana', label: 'Collana' },
  { id: 'anello', label: 'Anello' },
  { id: 'amuleto', label: 'Amuleto' },
  { id: 'corona', label: 'Corona' },
  { id: 'spilla', label: 'Spilla' },
];

export function getOption(list, id, fallbackIndex = 0) {
  return list.find((item) => item.id === id) ?? list[fallbackIndex];
}

export function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(text, size = 38) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [''];
  }
  const lines = [];
  let current = words.shift();
  for (const word of words) {
    const next = `${current} ${word}`;
    if (next.length > size) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  lines.push(current);
  return lines;
}

function motifSvg(archetypeId, matterColor, glowColor) {
  const stroke = `stroke="${matterColor}" stroke-opacity="0.75" fill="none"`;
  const glowStroke = `stroke="${glowColor}" stroke-opacity="0.85" fill="none"`;
  switch (archetypeId) {
    case 'custode':
      return `
        <g ${stroke} stroke-width="3.5">
          <path d="M540 330c-104 28-177 116-189 229 102-27 175-113 189-229Z"/>
          <path d="M540 330c104 28 177 116 189 229-102-27-175-113-189-229Z"/>
          <path d="M540 365v292"/>
        </g>
        <g ${glowStroke} stroke-width="2">
          <circle cx="540" cy="639" r="108"/>
        </g>
      `;
    case 'visionaria':
      return `
        <g ${stroke} stroke-width="3">
          <path d="M290 625c71-117 160-186 250-212 97 26 186 95 250 212-109-35-192-53-250-53-58 0-141 18-250 53Z"/>
          <path d="M540 388l109 177-109 66-109-66 109-177Z"/>
        </g>
        <g ${glowStroke} stroke-width="2">
          <path d="M360 744c44-37 103-56 180-56s136 19 180 56"/>
        </g>
      `;
    case 'alchimista':
      return `
        <g ${stroke} stroke-width="3">
          <path d="M432 314c127 34 167 103 121 209-46 107-18 172 82 197"/>
          <path d="M647 343c-127 34-167 103-121 209 46 107 18 172-82 197"/>
          <circle cx="540" cy="537" r="146"/>
        </g>
        <g ${glowStroke} stroke-width="2">
          <path d="M454 537c28-25 56-38 86-38 30 0 58 13 86 38"/>
        </g>
      `;
    case 'collezionista':
      return `
        <g ${stroke} stroke-width="3">
          <path d="M392 706c-24-104 6-211 83-293 50 49 75 108 75 177 0 68-26 130-78 186-28-20-54-43-80-70Z"/>
          <path d="M688 706c24-104-6-211-83-293-50 49-75 108-75 177 0 68 26 130 78 186 28-20 54-43 80-70Z"/>
          <path d="M462 807c25-20 51-30 78-30s53 10 78 30"/>
        </g>
        <g ${glowStroke} stroke-width="2">
          <circle cx="452" cy="509" r="18"/>
          <circle cx="628" cy="509" r="18"/>
        </g>
      `;
    default:
      return `
        <g ${stroke} stroke-width="3">
          <path d="M380 744c74-193 132-333 160-333 29 0 86 140 160 333"/>
          <path d="M430 719c36-56 73-84 110-84s74 28 110 84"/>
          <path d="M540 414c-76 81-141 141-194 181 88 11 153 31 194 60 41-29 106-49 194-60-53-40-118-100-194-181Z"/>
        </g>
        <g ${glowStroke} stroke-width="2">
          <path d="M475 339c21 20 43 30 65 30s44-10 65-30"/>
        </g>
      `;
  }
}

function joinArticle(article, noun) {
  return article.endsWith("'") ? `${article}${noun}` : `${article} ${noun}`;
}

function titleCaseTitle(archetype, energy, overrideWord = '') {
  if (overrideWord) {
    return overrideWord.trim();
  }
  return `${joinArticle(archetype.article, archetype.noun)} ${energy.suffix}`.replace(/\s+/g, ' ').trim();
}

export function composeCard(recipient, rawInput = {}) {
  const archetype = getOption(archetypes, rawInput.archetype);
  const matter = getOption(matters, rawInput.matter);
  const energy = getOption(energies, rawInput.energy);
  const ornament = getOption(ornaments, rawInput.ornament);
  const displayName = (rawInput.displayName || recipient.recipient_name || 'Ospite').trim();
  const signatureName = (rawInput.signatureName || displayName).trim();
  const roleWord = (rawInput.roleWord || '').trim();
  const customTitle = (rawInput.customTitle || '').trim();
  const finalTitle = customTitle || titleCaseTitle(archetype, energy, roleWord);
  const description = [
    `Una creatura nata tra ${matter.label.toLowerCase()}, ${energy.label.toLowerCase()} e ${ornament.label.toLowerCase()}.`,
    `${archetype.caption} Per ${recipient.brand}, nell'edizione 2026 del progetto.`,
  ].join(' ');

  return {
    id: rawInput.id || `card_${crypto.randomUUID().slice(0, 8)}`,
    code: rawInput.code || crypto.randomUUID().slice(0, 8).toUpperCase(),
    createdAt: rawInput.createdAt || new Date().toISOString(),
    token: recipient.token,
    recipientName: recipient.recipient_name,
    brand: recipient.brand,
    campaign: recipient.campaign,
    displayName,
    signatureName,
    roleWord,
    finalTitle,
    description,
    archetypeId: archetype.id,
    matterId: matter.id,
    energyId: energy.id,
    ornamentId: ornament.id,
    archetypeLabel: archetype.label,
    matterLabel: matter.label,
    energyLabel: energy.label,
    ornamentLabel: ornament.label,
    totem: archetype.totem,
    email: rawInput.email || '',
    company: rawInput.company || recipient.brand,
    consent: Boolean(rawInput.consent),
    consentAt: rawInput.consentAt || '',
  };
}

export function createCardSvg(card, { preview = false } = {}) {
  const matter = getOption(matters, card.matterId);
  const energy = getOption(energies, card.energyId);
  const titleLines = wrapText(card.finalTitle.toUpperCase(), 18);
  const descriptionLines = wrapText(card.description, 42);
  const footerLabel = preview ? 'ANTEPRIMA DINAMICA' : 'RITRATTO IMPOSSIBILE';
  const subtitleLabel = preview ? 'Versione di composizione' : `${campaign.edition} / Tailer Darden`;
  const encodedName = escapeXml(card.displayName.toUpperCase());
  const encodedBrand = escapeXml(card.brand.toUpperCase());
  const encodedTotem = escapeXml(card.totem.toUpperCase());
  const titleTspans = titleLines
    .map((line, index) => `<tspan x="94" dy="${index === 0 ? 0 : 72}">${escapeXml(line)}</tspan>`)
    .join('');
  const descriptionTspans = descriptionLines
    .map((line, index) => `<tspan x="94" dy="${index === 0 ? 0 : 28}">${escapeXml(line)}</tspan>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" x2="100%" y1="0%" y2="100%">
      <stop offset="0%" stop-color="#09080c"/>
      <stop offset="45%" stop-color="${matter.deep}"/>
      <stop offset="100%" stop-color="#07070a"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="${energy.glow}" stop-opacity="0.58"/>
      <stop offset="45%" stop-color="${energy.glow}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${energy.glow}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grain" width="14" height="14" patternUnits="userSpaceOnUse">
      <path d="M0 0h14v14H0z" fill="transparent"/>
      <circle cx="1" cy="7" r="0.8" fill="rgba(255,255,255,0.08)"/>
      <circle cx="8" cy="2" r="0.7" fill="rgba(255,255,255,0.05)"/>
      <circle cx="12" cy="11" r="0.65" fill="rgba(255,255,255,0.06)"/>
    </pattern>
    <filter id="blur" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="38"/>
    </filter>
  </defs>
  <rect width="1080" height="1350" fill="url(#bg)"/>
  <rect width="1080" height="1350" fill="url(#grain)" opacity="0.5"/>
  <circle cx="540" cy="556" r="285" fill="url(#glow)" filter="url(#blur)"/>
  <rect x="42" y="42" width="996" height="1266" rx="42" fill="none" stroke="rgba(216, 184, 115, 0.48)" stroke-width="1.6"/>
  <rect x="64" y="64" width="952" height="1222" rx="36" fill="none" stroke="rgba(216, 184, 115, 0.24)" stroke-width="1"/>
  <path d="M94 171h892" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
  <path d="M94 1118h892" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
  ${motifSvg(card.archetypeId, matter.accent, energy.glow)}
  <text x="94" y="128" fill="rgba(255,255,255,0.78)" style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 24px; letter-spacing: 5px;">IL BESTIARIO DEL LUSSO</text>
  <text x="94" y="247" fill="#f7f1e7" style="font-family: Georgia, 'Times New Roman', serif; font-size: 112px; letter-spacing: 1px;">${encodedName}</text>
  <text x="94" y="340" fill="rgba(255,255,255,0.86)" style="font-family: Georgia, 'Times New Roman', serif; font-size: 63px; letter-spacing: 0.5px;">${titleTspans}</text>
  <text x="94" y="938" fill="rgba(255,255,255,0.64)" style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 22px; letter-spacing: 4px;">${escapeXml(footerLabel)}</text>
  <text x="94" y="975" fill="rgba(255,255,255,0.9)" style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 28px;">${descriptionTspans}</text>
  <text x="94" y="1158" fill="rgba(255,255,255,0.82)" style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 24px; letter-spacing: 3px;">${encodedBrand} / ${encodedTotem}</text>
  <text x="94" y="1200" fill="rgba(255,255,255,0.62)" style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 20px; letter-spacing: 3px;">${escapeXml(subtitleLabel.toUpperCase())}</text>
  <text x="986" y="1200" text-anchor="end" fill="${matter.accent}" style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 18px; letter-spacing: 3px;">TD-BDL-${escapeXml(card.code)}</text>
  <text x="986" y="1276" text-anchor="end" fill="rgba(255,255,255,0.58)" style="font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 16px; letter-spacing: 2px;">${escapeXml(card.matterLabel)} • ${escapeXml(card.energyLabel)} • ${escapeXml(card.ornamentLabel)}</text>
</svg>`;
}

export function createQrSvg(content, size = 320) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(content);
  qr.make();

  const cells = qr.modules;
  const count = qr.getModuleCount();
  const margin = 4;
  const pixel = Math.floor(size / (count + margin * 2));
  const actualSize = pixel * (count + margin * 2);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${actualSize}" height="${actualSize}" viewBox="0 0 ${actualSize} ${actualSize}" shape-rendering="crispEdges">`,
    `<rect width="${actualSize}" height="${actualSize}" fill="#f8f2e7"/>`,
  ];

  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!cells[row][col]) continue;
      const x = (col + margin) * pixel;
      const y = (row + margin) * pixel;
      parts.push(`<rect x="${x}" y="${y}" width="${pixel}" height="${pixel}" fill="#111111"/>`);
    }
  }

  parts.push('</svg>');
  return parts.join('');
}
