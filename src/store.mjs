import fs from 'node:fs/promises';
import path from 'node:path';

const useBlobStorage = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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
const cardsBlobPath = 'bestiario/data/cards.json';
const eventsBlobPath = 'bestiario/data/events.json';
const artworksBlobPath = 'bestiario/data/card-artworks.json';
const artworkFilesBlobPrefix = 'bestiario/artworks/files';

let blobApiPromise = null;

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

async function getBlobApi() {
  if (!useBlobStorage) return null;
  blobApiPromise ??= import('@vercel/blob');
  return blobApiPromise;
}

async function readBlobJson(blobPath, fallback) {
  try {
    const blobApi = await getBlobApi();
    const { blobs } = await blobApi.list({ prefix: blobPath, limit: 10 });
    const blob = blobs.find((item) => item.pathname === blobPath) ?? blobs[0];
    if (!blob?.url) {
      return fallback;
    }
    const response = await fetch(blob.url, { cache: 'no-store' });
    if (!response.ok) {
      return fallback;
    }
    return response.json();
  } catch {
    return fallback;
  }
}

async function writeBlobJson(blobPath, value) {
  const blobApi = await getBlobApi();
  await blobApi.put(blobPath, JSON.stringify(value, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
  });
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
  if (useBlobStorage) {
    return readBlobJson(cardsBlobPath, []);
  }
  return readJson(cardsPath, []);
}

export async function getCardById(id) {
  const cards = await getCards();
  return cards.find((item) => item.id === id) ?? null;
}

export async function saveCard(card) {
  const cards = await getCards();
  const nextCards = [card, ...cards.filter((item) => item.id !== card.id)];
  if (useBlobStorage) {
    await writeBlobJson(cardsBlobPath, nextCards);
    return;
  }
  await writeJson(cardsPath, nextCards);
}

export async function getEvents() {
  if (useBlobStorage) {
    return readBlobJson(eventsBlobPath, []);
  }
  return readJson(eventsPath, []);
}

export async function recordEvent(event) {
  const events = await getEvents();
  events.unshift(event);
  const nextEvents = events.slice(0, 5000);
  if (useBlobStorage) {
    await writeBlobJson(eventsBlobPath, nextEvents);
    return;
  }
  await writeJson(eventsPath, nextEvents);
}

export async function getCardArtworks() {
  if (useBlobStorage) {
    return readBlobJson(artworksBlobPath, []);
  }
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
  if (useBlobStorage) {
    await writeBlobJson(artworksBlobPath, nextArtworks);
    return;
  }
  await writeJson(artworksPath, nextArtworks);
}

export function getArtworkFilePath(storedFileName) {
  return path.join(artworksDir, storedFileName);
}

export async function writeArtworkBuffer(storedFileName, buffer, mimeType = 'application/octet-stream') {
  if (useBlobStorage) {
    const blobApi = await getBlobApi();
    const blob = await blobApi.put(`${artworkFilesBlobPrefix}/${storedFileName}`, buffer, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: mimeType,
      cacheControlMaxAge: 31536000,
    });
    return {
      blobPath: blob.pathname,
      blobUrl: blob.url,
    };
  }
  const filePath = getArtworkFilePath(storedFileName);
  await fs.writeFile(filePath, buffer);
  return { filePath };
}

export async function readArtworkBuffer(artwork) {
  if (artwork.blobUrl) {
    const response = await fetch(artwork.blobUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Unable to read artwork blob: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
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
