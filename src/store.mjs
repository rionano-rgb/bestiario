import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = process.env.VERCEL
  ? path.join('/tmp', 'bestiario-data')
  : path.join(process.cwd(), 'data');
const recipientsPath = path.join(dataDir, 'recipients.json');
const cardsPath = path.join(dataDir, 'cards.json');
const eventsPath = path.join(dataDir, 'events.json');
const artworksPath = path.join(dataDir, 'card-artworks.json');
const artworksDir = path.join(dataDir, 'artworks');

const seedDir = path.join(process.cwd(), 'data');
const seedRecipientsPath = path.join(seedDir, 'recipients.json');
const seedCardsPath = path.join(seedDir, 'cards.json');
const seedEventsPath = path.join(seedDir, 'events.json');
const seedArtworksPath = path.join(seedDir, 'card-artworks.json');

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(artworksDir, { recursive: true });
  for (const [filePath, fallback] of [
    [recipientsPath, []],
    [cardsPath, []],
    [eventsPath, []],
    [artworksPath, []],
  ]) {
    try {
      await fs.access(filePath);
    } catch {
      const seedPath =
        filePath === recipientsPath
          ? seedRecipientsPath
          : filePath === cardsPath
            ? seedCardsPath
            : filePath === eventsPath
              ? seedEventsPath
              : seedArtworksPath;
      try {
        const seedRaw = await fs.readFile(seedPath, 'utf8');
        await fs.writeFile(filePath, seedRaw, 'utf8');
      } catch {
        await writeJson(filePath, fallback);
      }
    }
  }
}

export async function getRecipients() {
  return readJson(recipientsPath, []);
}

export async function getRecipientByToken(token) {
  const recipients = await getRecipients();
  return recipients.find((item) => item.token === token) ?? null;
}

export async function getCards() {
  return readJson(cardsPath, []);
}

export async function getCardById(id) {
  const cards = await getCards();
  return cards.find((item) => item.id === id) ?? null;
}

export async function saveCard(card) {
  const cards = await getCards();
  const nextCards = [card, ...cards.filter((item) => item.id !== card.id)];
  await writeJson(cardsPath, nextCards);
}

export async function getEvents() {
  return readJson(eventsPath, []);
}

export async function recordEvent(event) {
  const events = await getEvents();
  events.unshift(event);
  await writeJson(eventsPath, events.slice(0, 5000));
}

export async function getCardArtworks() {
  return readJson(artworksPath, []);
}

export async function getCardArtworkById(id) {
  const artworks = await getCardArtworks();
  return artworks.find((item) => item.id === id) ?? null;
}

export async function findCardArtwork({ token, variantKey }) {
  const artworks = await getCardArtworks();
  return artworks.find((item) => item.token === token && item.variantKey === variantKey) ?? null;
}

export async function saveCardArtwork(artwork) {
  const artworks = await getCardArtworks();
  const nextArtworks = [
    artwork,
    ...artworks.filter((item) => item.id !== artwork.id && !(item.token === artwork.token && item.variantKey === artwork.variantKey)),
  ];
  await writeJson(artworksPath, nextArtworks);
}

export function getArtworkFilePath(storedFileName) {
  return path.join(artworksDir, storedFileName);
}

export async function writeArtworkBuffer(storedFileName, buffer) {
  const filePath = getArtworkFilePath(storedFileName);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readArtworkBuffer(artwork) {
  return fs.readFile(getArtworkFilePath(artwork.storedFileName));
}

export async function getDashboardSnapshot() {
  const [recipients, cards, events, artworks] = await Promise.all([
    getRecipients(),
    getCards(),
    getEvents(),
    getCardArtworks(),
  ]);
  return { recipients, cards, events, artworks };
}
