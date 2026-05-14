import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir = process.env.VERCEL
  ? path.join('/tmp', 'bestiario-data')
  : path.join(process.cwd(), 'data');
const recipientsPath = path.join(dataDir, 'recipients.json');
const cardsPath = path.join(dataDir, 'cards.json');
const eventsPath = path.join(dataDir, 'events.json');

const seedDir = path.join(process.cwd(), 'data');
const seedRecipientsPath = path.join(seedDir, 'recipients.json');
const seedCardsPath = path.join(seedDir, 'cards.json');
const seedEventsPath = path.join(seedDir, 'events.json');

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
  for (const [filePath, fallback] of [
    [recipientsPath, []],
    [cardsPath, []],
    [eventsPath, []],
  ]) {
    try {
      await fs.access(filePath);
    } catch {
      const seedPath =
        filePath === recipientsPath
          ? seedRecipientsPath
          : filePath === cardsPath
            ? seedCardsPath
            : seedEventsPath;
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

export async function getDashboardSnapshot() {
  const [recipients, cards, events] = await Promise.all([getRecipients(), getCards(), getEvents()]);
  return { recipients, cards, events };
}
