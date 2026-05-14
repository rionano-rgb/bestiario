import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const { default: sharp } = await import('sharp').catch(() =>
  import('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/lib/index.js'),
);

import {
  archetypes,
  buildVariantKey,
  campaign,
  composeCard,
  createCardSvg,
  createQrSvg,
  energies,
  formatVariantLabel,
  matters,
  ornaments,
} from './src/bestiary.mjs';
import { sendInternalNotification } from './src/notify.mjs';
import {
  ensureDataFiles,
  getCardById,
  getCardArtworkById,
  getCardArtworks,
  getDashboardSnapshot,
  getRecipientByToken,
  getRecipients,
  readArtworkBuffer,
  recordEvent,
  saveCardArtwork,
  saveCard,
  findCardArtwork,
  writeArtworkBuffer,
} from './src/store.mjs';

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(process.cwd(), 'public');
const adminPassword = process.env.BESTIARIO_ADMIN_PASSWORD || 'tailerdarden-2026';
const adminSecret = process.env.ADMIN_COOKIE_SECRET || 'bestiario-lusso-secret';

let initialized = false;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mimeType(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  return 'text/plain; charset=utf-8';
}

function baseUrlFromRequest(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return process.env.BASE_URL || `${proto}://${req.headers.host}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function createAdminCookieValue() {
  return crypto.createHmac('sha256', adminSecret).update(adminPassword).digest('hex');
}

function isAdmin(req) {
  const cookies = parseCookies(req);
  return cookies.bestiario_admin === createAdminCookieValue();
}

function setCookie(res, value) {
  res.setHeader('Set-Cookie', `bestiario_admin=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', 'bestiario_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    return JSON.parse(raw);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  return { raw };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function getUserAgentMeta(req) {
  const userAgent = req.headers['user-agent'] || '';
  const browser = /Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)
    ? 'Safari'
    : /Edg/i.test(userAgent)
      ? 'Edge'
      : /Chrome/i.test(userAgent)
        ? 'Chrome'
        : /Firefox/i.test(userAgent)
          ? 'Firefox'
          : 'Unknown';
  const device = /iPhone/i.test(userAgent)
    ? 'iPhone'
    : /Android/i.test(userAgent)
      ? 'Android'
      : /iPad/i.test(userAgent)
        ? 'iPad'
        : 'Desktop';
  return {
    browser,
    device,
    userAgent,
  };
}

async function trackServerEvent(req, event, recipientToken, extra = {}) {
  await recordEvent({
    id: crypto.randomUUID(),
    event,
    recipientToken,
    timestamp: new Date().toISOString(),
    path: req.url,
    ...getUserAgentMeta(req),
    ...extra,
  });
}

function getCardSelectionFromParams(source) {
  return {
    archetype: source.archetype || source.get?.('archetype') || '',
    matter: source.matter || source.get?.('matter') || '',
    energy: source.energy || source.get?.('energy') || '',
    ornament: source.ornament || source.get?.('ornament') || '',
  };
}

function extensionFromMimeType(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return '';
}

function dataUriFromBuffer(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function resolveArtworkForCard({ token, artworkAssetId = '', variantKey = '' }) {
  if (artworkAssetId) {
    const direct = await getCardArtworkById(artworkAssetId);
    if (direct) return direct;
  }
  if (!token || !variantKey) return null;
  return findCardArtwork({ token, variantKey });
}

async function resolveArtworkDataUri(selection, token, explicitArtworkAssetId = '') {
  const variantKey = buildVariantKey(selection);
  const artwork = await resolveArtworkForCard({
    token,
    artworkAssetId: explicitArtworkAssetId,
    variantKey,
  });
  if (!artwork) {
    return { artwork: null, artworkDataUri: '' };
  }
  const buffer = await readArtworkBuffer(artwork);
  return {
    artwork,
    artworkDataUri: dataUriFromBuffer(buffer, artwork.mimeType),
  };
}

function renderDocument({ title, body, page = 'generic', scriptData = null }) {
  return `<!DOCTYPE html>
  <html lang="it">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <meta name="theme-color" content="#09080c" />
      <link rel="stylesheet" href="/styles.css" />
    </head>
    <body data-page="${escapeHtml(page)}">
      ${body}
      ${scriptData ? `<script>window.__BESTIARIO__ = ${JSON.stringify(scriptData)};</script>` : ''}
      <script src="/app.js" defer></script>
    </body>
  </html>`;
}

function previewPayloadFromSearch(recipient, searchParams) {
  return composeCard(recipient, {
    archetype: searchParams.get('archetype'),
    matter: searchParams.get('matter'),
    energy: searchParams.get('energy'),
    ornament: searchParams.get('ornament'),
    signatureName: searchParams.get('signatureName') || recipient.recipient_name,
    roleWord: searchParams.get('roleWord') || '',
    customTitle: searchParams.get('customTitle') || '',
    displayName: searchParams.get('signatureName') || recipient.recipient_name,
  });
}

function renderHome(recipients, baseUrl) {
  const links = recipients
    .map(
      (recipient) => `
      <div class="stat">
        <span>${escapeHtml(recipient.brand)}</span>
        <strong>${escapeHtml(recipient.recipient_name)}</strong>
        <div class="link-list">
          <a class="link-btn" href="/bestiario/${escapeHtml(recipient.token)}">Apri esperienza</a>
          <a class="link-btn" href="/admin/qr/${escapeHtml(recipient.token)}.svg">QR SVG</a>
          <span class="small-note">${escapeHtml(`${baseUrl}/bestiario/${recipient.token}`)}</span>
        </div>
      </div>`,
    )
    .join('');

  return renderDocument({
    title: 'Bestiario del Lusso',
    body: `
      <main class="home-shell shell">
        <section class="frame home-panel">
          <div class="eyebrow">MVP dimostrativo</div>
          <h1>Bestiario del Lusso</h1>
          <p class="lead">Micro web app mobile-first per experience da QR code, con card finale, raccolta lead, tracciamento eventi e dashboard interna.</p>
          <div class="cta-row">
            <a class="btn" href="/admin">Apri dashboard</a>
            <a class="ghost-btn" href="/privacy">Privacy policy</a>
          </div>
          <div class="stats">
            ${links}
          </div>
        </section>
      </main>`,
  });
}

function renderExperiencePage(recipient) {
  return renderDocument({
    title: `${campaign.name} • ${recipient.brand}`,
    page: 'experience',
    scriptData: {
      recipient: {
        token: recipient.token,
        recipient_name: recipient.recipient_name,
        brand: recipient.brand,
      },
      defaults: {
        archetype: archetypes[0].id,
        matter: matters[0].id,
        energy: energies[0].id,
        ornament: ornaments[0].id,
      },
      options: { archetypes, matters, energies, ornaments },
    },
    body: `
      <main class="hero shell">
        <section class="frame experience-frame">
          <div class="experience-top">
            <div>
              <div class="kicker">${escapeHtml(campaign.name)}</div>
              <div class="brand-line" data-brand-slot>${escapeHtml(recipient.brand)}</div>
            </div>
            <div class="progress"><span data-progress-bar></span></div>
          </div>
          <div class="experience-layout">
            <div class="experience-panel">
              <section class="step is-active">
                <div class="eyebrow">${escapeHtml(campaign.edition)}</div>
                <h1>Benvenuta <span data-hero-name>${escapeHtml(recipient.recipient_name)}</span>.</h1>
                <p class="lead">${escapeHtml(recipient.custom_intro || `Abbiamo immaginato per ${recipient.brand} una piccola creatura del Bestiario del Lusso.`)}</p>
                <p class="lead">Componi il tuo ritratto impossibile in pochi passaggi. Nessun menu, nessuna distrazione: solo una micro esperienza editoriale, pensata per <span data-brand-slot>${escapeHtml(recipient.brand)}</span>.</p>
                <div class="cta-row">
                  <button class="btn" type="button" data-start>Inizia</button>
                </div>
              </section>

              <section class="step">
                <div class="eyebrow">Step 1</div>
                <h2>Scegli l'archetipo che vuoi abitare.</h2>
                <p class="step-copy">Poche opzioni, nessun rumore. Ogni archetipo attiva un tono visivo e un titolo finale diverso.</p>
                <div class="section-stack">
                  <div class="choice-grid">
                    ${archetypes
                      .map(
                        (item) => `
                        <button class="chip-option" type="button" data-choice data-group="archetype" data-value="${escapeHtml(item.id)}">
                          <strong>${escapeHtml(item.label)}</strong>
                          <span>${escapeHtml(item.caption)} Totem: ${escapeHtml(item.totem)}.</span>
                        </button>`,
                      )
                      .join('')}
                  </div>
                </div>
                <div class="step-nav">
                  <button class="nav-btn" type="button" data-variant="secondary" data-back>Indietro</button>
                  <button class="nav-btn" type="button" data-variant="primary" data-next>Continua</button>
                </div>
              </section>

              <section class="step">
                <div class="eyebrow">Step 2</div>
                <h2>Scegli la materia dominante.</h2>
                <p class="step-copy">La materia orienta la tavolozza e il tono della card finale.</p>
                <div class="section-stack">
                  <div class="choice-grid">
                    ${matters
                      .map(
                        (item) => `
                        <button class="chip-option" type="button" data-choice data-group="matter" data-value="${escapeHtml(item.id)}">
                          <strong>${escapeHtml(item.label)}</strong>
                          <span>Una variazione controllata del fondo e delle incisioni tipografiche.</span>
                        </button>`,
                      )
                      .join('')}
                  </div>
                </div>
                <div class="step-nav">
                  <button class="nav-btn" type="button" data-variant="secondary" data-back>Indietro</button>
                  <button class="nav-btn" type="button" data-variant="primary" data-next>Continua</button>
                </div>
              </section>

              <section class="step">
                <div class="eyebrow">Step 3</div>
                <h2>Firma il ritratto.</h2>
                <p class="step-copy">Energia, ornamento e una parola personale bastano per rendere il ritratto percepito come unico.</p>
                <div class="section-stack">
                  <div class="choice-group">
                    <div class="micro-label">Energia</div>
                    <div class="choice-grid">
                      ${energies
                        .map(
                          (item) => `
                          <button class="chip-option" type="button" data-choice data-group="energy" data-value="${escapeHtml(item.id)}">
                            <strong>${escapeHtml(item.label)}</strong>
                            <span>Attiva il bagliore e la formula del titolo finale.</span>
                          </button>`,
                        )
                        .join('')}
                    </div>
                  </div>
                  <div class="choice-group">
                    <div class="micro-label">Segno / ornamento</div>
                    <div class="choice-grid">
                      ${ornaments
                        .map(
                          (item) => `
                          <button class="chip-option" type="button" data-choice data-group="ornament" data-value="${escapeHtml(item.id)}">
                            <strong>${escapeHtml(item.label)}</strong>
                            <span>Un dettaglio simbolico che entra nella descrizione finale.</span>
                          </button>`,
                        )
                        .join('')}
                    </div>
                  </div>
                  <div class="field-grid">
                    <div class="field">
                      <label for="signatureName">Nome in card</label>
                      <input id="signatureName" name="signatureName" data-input-bind="signatureName" value="${escapeHtml(recipient.recipient_name)}" />
                    </div>
                    <div class="field">
                      <label for="roleWord">Titolo personale facoltativo</label>
                      <input id="roleWord" name="roleWord" data-input-bind="roleWord" placeholder="Es. Custode del Colore" />
                    </div>
                  </div>
                  <div class="field">
                    <label for="customTitle">Titolo libero facoltativo</label>
                    <input id="customTitle" name="customTitle" data-input-bind="customTitle" placeholder="Se vuoi, puoi sovrascrivere il titolo generato" />
                  </div>
                </div>
                <div class="step-nav">
                  <button class="nav-btn" type="button" data-variant="secondary" data-back>Indietro</button>
                  <button class="nav-btn" type="button" data-variant="primary" data-next>Anteprima</button>
                </div>
              </section>

              <section class="step">
                <div class="eyebrow">Step 4</div>
                <h2>Il tuo ritratto e quasi pronto.</h2>
                <p class="step-copy">Prima ti mostriamo il valore. Solo dopo ti chiediamo il dato.</p>
                <div class="section-stack">
                  <p class="preview-copy">Hai composto un ritratto che tiene insieme archetipi, materia e segno. Se il tono ti rappresenta, continua e ricevilo in alta definizione.</p>
                </div>
                <div class="step-nav">
                  <button class="nav-btn" type="button" data-variant="secondary" data-back>Indietro</button>
                  <button class="nav-btn" type="button" data-variant="primary" data-next>Ricevi il ritratto</button>
                </div>
              </section>

              <section class="step">
                <div class="eyebrow">Step 5</div>
                <h2>Lascia la tua email.</h2>
                <p class="step-copy">La useremo solo per inviarti il ritratto e raccontarti, se ti interessa, come e nato il progetto.</p>
                <form class="section-stack" data-lead-form>
                  <div class="field-grid">
                    <div class="field">
                      <label for="leadName">Nome</label>
                      <input id="leadName" name="name" value="${escapeHtml(recipient.recipient_name)}" required />
                    </div>
                    <div class="field">
                      <label for="leadEmail">Email</label>
                      <input id="leadEmail" type="email" name="email" value="${escapeHtml(recipient.email_known || '')}" required />
                    </div>
                  </div>
                  <div class="field">
                    <label for="leadCompany">Azienda</label>
                    <input id="leadCompany" name="company" value="${escapeHtml(recipient.brand)}" />
                  </div>
                  <div class="field hidden">
                    <label for="website">Website</label>
                    <input id="website" name="website" />
                  </div>
                  <label class="checkbox">
                    <input type="checkbox" name="privacy" value="yes" required />
                    <span>Acconsento al trattamento dei miei dati per ricevere il Ritratto Impossibile e comunicazioni relative a questo progetto. <a href="/privacy">Privacy policy</a>.</span>
                  </label>
                  <div class="form-error" data-form-error></div>
                  <div class="step-nav">
                    <button class="nav-btn" type="button" data-variant="secondary" data-back>Indietro</button>
                    <button class="nav-btn" type="submit" data-variant="primary">Genera la card finale</button>
                  </div>
                </form>
              </section>
            </div>

            <aside class="preview-panel">
              <div class="preview-card-wrap">
                <div class="eyebrow">Anteprima live</div>
                <div class="preview-card">
                  <img alt="Anteprima del ritratto impossibile" data-preview-image src="/api/preview.svg?token=${escapeHtml(recipient.token)}&archetype=${escapeHtml(archetypes[0].id)}&matter=${escapeHtml(matters[0].id)}&energy=${escapeHtml(energies[0].id)}&ornament=${escapeHtml(ornaments[0].id)}" />
                </div>
                <div class="preview-meta">
                  <strong data-preview-name>${escapeHtml(recipient.recipient_name)}</strong>
                  <div data-preview-title>${escapeHtml(archetypes[0].label)} ${escapeHtml(energies[0].suffix)}</div>
                  <div class="inline-note" data-preview-description></div>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>`,
  });
}

function boolPill(value) {
  return `<span class="pill" data-state="${value ? 'yes' : 'no'}">${value ? 'Si' : 'No'}</span>`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function renderAdmin(snapshot, baseUrl) {
  const { recipients, cards, events, artworks } = snapshot;
  const summaries = recipients.map((recipient) => {
    const recipientEvents = events.filter((item) => item.recipientToken === recipient.token);
    const latestCard = cards.find((item) => item.token === recipient.token) ?? null;
    const opened = recipientEvents.some((item) => item.event === 'qr_opened');
    const started = recipientEvents.some((item) => item.event === 'experience_started');
    const completed = recipientEvents.some((item) => item.event === 'experience_completed');
    const emailCaptured = Boolean(latestCard?.email);
    const firstOpen = recipientEvents.find((item) => item.event === 'qr_opened')?.timestamp;
    const openCount = recipientEvents.filter((item) => item.event === 'qr_opened').length;
    const choices = latestCard
      ? `${latestCard.archetypeLabel} / ${latestCard.matterLabel} / ${latestCard.energyLabel}`
      : '—';
    const followUp = completed ? 'da contattare' : opened ? 'attendere' : 'nessuna azione';

    return {
      recipient,
      latestCard,
      opened,
      started,
      completed,
      emailCaptured,
      firstOpen,
      openCount,
      choices,
      followUp,
    };
  });

  const totalOpened = summaries.filter((item) => item.opened).length;
  const totalCompleted = summaries.filter((item) => item.completed).length;
  const totalLeads = summaries.filter((item) => item.emailCaptured).length;
  const totalArtworks = artworks.length;
  const tableRows = summaries
    .map((item) => {
      const link = `${baseUrl}/bestiario/${item.recipient.token}`;
      const cardLink = item.latestCard ? `${baseUrl}/bestiario/card/${item.latestCard.id}` : '—';
      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.recipient.recipient_name)} ${escapeHtml(item.recipient.recipient_last_name || '')}</strong><br />
            <span class="small-note">${escapeHtml(item.recipient.role || '—')}</span>
          </td>
          <td>${escapeHtml(item.recipient.brand)}</td>
          <td>${boolPill(item.opened)}<br /><span class="small-note">${escapeHtml(`${item.openCount} aperture`)}</span></td>
          <td>${boolPill(item.started)}</td>
          <td>${boolPill(item.completed)}</td>
          <td>${boolPill(item.emailCaptured)}<br /><span class="small-note">${escapeHtml(item.latestCard?.email || '—')}</span></td>
          <td>${escapeHtml(item.choices)}</td>
          <td>${escapeHtml(item.followUp)}</td>
          <td>
            <div class="actions-list">
              <button class="ghost-btn" type="button" data-copy-link data-copy-link="${escapeHtml(link)}">Copia link</button>
              <a class="link-btn" href="/admin/qr/${escapeHtml(item.recipient.token)}.svg" target="_blank" rel="noreferrer">QR SVG</a>
              <a class="link-btn" href="/bestiario/${escapeHtml(item.recipient.token)}" target="_blank" rel="noreferrer">Apri esperienza</a>
              ${item.latestCard ? `<a class="link-btn" href="/bestiario/card/${escapeHtml(item.latestCard.id)}" target="_blank" rel="noreferrer">Apri card</a>` : ''}
            </div>
          </td>
          <td>
            <span class="small-note">Primo open: ${escapeHtml(formatDate(item.firstOpen))}</span><br />
            <span class="small-note">Stato invio: ${escapeHtml(item.recipient.status)}</span><br />
            <span class="small-note">${escapeHtml(cardLink)}</span>
          </td>
        </tr>`;
    })
    .join('');

  const qrBlocks = recipients
    .map(
      (recipient) => `
      <div class="qr-box">
        <img alt="QR ${escapeHtml(recipient.token)}" src="/admin/qr/${escapeHtml(recipient.token)}.svg" />
        <div class="small-note" style="margin-top: 10px;">qr_${escapeHtml(recipient.token)}.svg</div>
      </div>`,
    )
    .join('');

  const artworkCards = artworks.length
    ? artworks
        .map((artwork) => `
      <article class="artwork-card">
        <img alt="${escapeHtml(artwork.originalName)}" src="/api/admin/artwork/${escapeHtml(artwork.id)}" />
        <div class="artwork-card-copy">
          <strong>${escapeHtml(artwork.brand || artwork.token)}</strong>
          <div class="small-note">${escapeHtml(artwork.variantLabel || artwork.variantKey)}</div>
          <div class="small-note">${escapeHtml(artwork.originalName)}</div>
        </div>
      </article>`)
        .join('')
    : '<p class="small-note">Nessun artwork caricato. Qui compariranno le card fine art pre-generate pronte da associare alle varianti.</p>';

  return renderDocument({
    title: 'Admin • Bestiario del Lusso',
    page: 'admin',
    scriptData: {
      recipients: recipients.map((item) => ({
        token: item.token,
        label: `${item.brand} / ${item.recipient_name}`,
        brand: item.brand,
      })),
      options: { archetypes, matters, energies, ornaments },
    },
    body: `
      <main class="admin-shell shell">
        <section class="frame login-panel">
          <div class="eyebrow">Dashboard interna</div>
          <h1>Bestiario del Lusso</h1>
          <p class="lead">Vista minima per destinatari, aperture, completamenti, email raccolte, QR di stampa e archivio artwork fine art pre-generati.</p>
          <div class="cta-row">
            <a class="btn" href="/api/admin/export.csv">Esporta CSV</a>
            <a class="ghost-btn" href="/admin/logout">Esci</a>
          </div>
          <div class="stats">
            <div class="stat"><span>Destinatari</span><strong>${recipients.length}</strong></div>
            <div class="stat"><span>Link aperti</span><strong>${totalOpened}</strong></div>
            <div class="stat"><span>Esperienze completate</span><strong>${totalCompleted}</strong></div>
            <div class="stat"><span>Email raccolte</span><strong>${totalLeads}</strong></div>
            <div class="stat"><span>Artwork fine art</span><strong>${totalArtworks}</strong></div>
          </div>
        </section>

        <section class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Destinatario</th>
                <th>Brand</th>
                <th>Link aperto</th>
                <th>Iniziato</th>
                <th>Completato</th>
                <th>Email</th>
                <th>Scelte</th>
                <th>Follow-up</th>
                <th>Azioni</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </section>

        <section class="frame login-panel" style="margin-top: 24px;">
          <div class="eyebrow">QR pack</div>
          <h2>QR pronti per stampa</h2>
          <p class="info-copy">Ogni SVG punta gia al link univoco del destinatario. Il nome file e coerente con il token e puo essere usato per l'impaginato dell'invio fisico.</p>
          <div class="qr-grid">${qrBlocks}</div>
        </section>

        <section class="frame login-panel" style="margin-top: 24px;">
          <div class="eyebrow">Archivio Fine Art</div>
          <h2>Carica card pre-generate</h2>
          <p class="info-copy">Qui puoi associare un artwork statico a una variante precisa del ritratto. Quando la combinazione esiste, la preview e la card finale useranno quell'immagine invece del rendering astratto.</p>
          <form class="artwork-form" data-artwork-form>
            <div class="field-grid field-grid-wide">
              <div class="field">
                <label for="artworkRecipient">Destinatario / brand</label>
                <select id="artworkRecipient" name="token" data-artwork-token></select>
              </div>
              <div class="field">
                <label for="artworkArchetype">Archetipo</label>
                <select id="artworkArchetype" name="archetype" data-artwork-archetype></select>
              </div>
              <div class="field">
                <label for="artworkMatter">Materia</label>
                <select id="artworkMatter" name="matter" data-artwork-matter></select>
              </div>
              <div class="field">
                <label for="artworkEnergy">Energia</label>
                <select id="artworkEnergy" name="energy" data-artwork-energy></select>
              </div>
              <div class="field">
                <label for="artworkOrnament">Ornamento</label>
                <select id="artworkOrnament" name="ornament" data-artwork-ornament></select>
              </div>
            </div>
            <label class="upload-drop">
              <input type="file" accept="image/png,image/jpeg,image/webp" data-artwork-file />
              <span>Trascina qui la card oppure seleziona un PNG, JPG o WEBP verticale 4:5.</span>
            </label>
            <div class="inline-note" data-artwork-variant></div>
            <div class="form-error" data-artwork-error></div>
            <div class="status-note" data-artwork-status></div>
            <div class="cta-row">
              <button class="btn" type="submit">Carica artwork</button>
            </div>
          </form>
          <div class="artwork-grid">
            ${artworkCards}
          </div>
        </section>
      </main>`,
  });
}

function renderAdminLogin(errorMessage = '') {
  return renderDocument({
    title: 'Admin login',
    body: `
      <main class="admin-shell shell">
        <section class="frame login-panel">
          <div class="eyebrow">Area protetta</div>
          <h1>Accesso admin</h1>
          <p class="lead">Inserisci la password interna per vedere destinatari, eventi, card generate e QR code.</p>
          <form class="form-inline" method="post" action="/admin/login">
            <div class="field">
              <label for="password">Password</label>
              <input id="password" type="password" name="password" required />
            </div>
            ${errorMessage ? `<div class="form-error">${escapeHtml(errorMessage)}</div>` : ''}
            <button class="btn" type="submit">Entra nella dashboard</button>
          </form>
          <p class="small-note" style="margin-top: 18px;">Password di default locale: <strong>${escapeHtml(adminPassword)}</strong>. In produzione conviene impostare <code>BESTIARIO_ADMIN_PASSWORD</code>.</p>
        </section>
      </main>`,
  });
}

function renderCardPage(card) {
  return renderDocument({
    title: `${card.displayName} • ${card.finalTitle}`,
    page: 'card',
    body: `
      <main class="card-shell shell">
        <section class="frame card-panel">
          <div class="eyebrow">${escapeHtml(campaign.name)}</div>
          <h1>${escapeHtml(card.displayName)}</h1>
          <p class="lead">${escapeHtml(card.finalTitle)}. Il ritratto e pronto e puo essere visualizzato o scaricato in formato editoriale 4:5.</p>
          <div class="card-grid" style="margin-top: 28px;">
            <div class="final-card">
              <img alt="Card finale ${escapeHtml(card.displayName)}" src="/api/card/${escapeHtml(card.id)}.png" />
            </div>
            <div class="final-summary">
              <strong>${escapeHtml(card.displayName)}</strong>
              <div>${escapeHtml(card.finalTitle)}</div>
              <div class="card-copy">${escapeHtml(card.description)}</div>
              <div class="subtle-divider"></div>
              <div class="small-note">Brand: ${escapeHtml(card.brand)}</div>
              <div class="small-note">Archetipo: ${escapeHtml(card.archetypeLabel)} / Totem ${escapeHtml(card.totem)}</div>
              <div class="small-note">Materia: ${escapeHtml(card.matterLabel)} / Energia: ${escapeHtml(card.energyLabel)} / Ornamento: ${escapeHtml(card.ornamentLabel)}</div>
              <div class="small-note">Codice card: TD-BDL-${escapeHtml(card.code)}</div>
              <div class="final-actions">
                <a class="btn" href="/api/card/${escapeHtml(card.id)}.png?download=1">Scarica PNG</a>
                <a class="ghost-btn" href="/api/card/${escapeHtml(card.id)}.svg" target="_blank" rel="noreferrer">Apri SVG</a>
              </div>
              <div class="final-actions">
                <a class="link-btn" href="/chi-ha-creato-il-ritratto" data-track-tailer data-token="${escapeHtml(card.token)}" data-card-id="${escapeHtml(card.id)}">Scopri chi ha creato questo ritratto</a>
              </div>
            </div>
          </div>
        </section>
      </main>`,
  });
}

function renderInfoPage() {
  return renderDocument({
    title: 'Tailer Darden',
    body: `
      <main class="info-shell shell">
        <section class="frame info-panel">
          <div class="eyebrow">Tailer Darden</div>
          <h1>Chi ha creato questo ritratto</h1>
          <p class="lead">Tailer Darden immagina oggetti digitali, invii fisici ed esperienze one-to-one per brand che vogliono aprire conversazioni memorabili senza sembrare campagne standard.</p>
          <div class="section-stack">
            <p class="info-copy">Questo MVP nasce per testare un formato semplice ma tracciabile: link personalizzati, interazione breve, output editoriale e follow-up umano di qualita.</p>
            <p class="info-copy">Nel test iniziale il canale digitale non sostituisce il rapporto commerciale: lo rende solo piu naturale, misurabile e piu elegante da riaprire.</p>
          </div>
          <div class="cta-row">
            <a class="btn" href="/">Torna all'indice demo</a>
          </div>
        </section>
      </main>`,
  });
}

function renderPrivacyPage() {
  return renderDocument({
    title: 'Privacy policy',
    body: `
      <main class="info-shell shell">
        <section class="frame info-panel">
          <div class="eyebrow">Privacy</div>
          <h1>Informativa essenziale</h1>
          <div class="section-stack">
            <p class="info-copy">I dati raccolti in questa esperienza sono nome, email, azienda, timestamp del consenso e dati di interazione strettamente necessari a capire se il ritratto e stato aperto o completato.</p>
            <p class="info-copy">L'uso previsto e limitato all'invio del Ritratto Impossibile, al follow-up manuale relativo al progetto e alla misurazione dell'interesse espresso dal destinatario.</p>
            <p class="info-copy">Su richiesta e possibile cancellare i dati raccolti. Per un uso reale in produzione, il testo va verificato dal legale del progetto e adattato al processo GDPR definitivo.</p>
          </div>
        </section>
      </main>`,
  });
}

async function serveStatic(req, res, pathname) {
  const filePath = path.join(publicDir, pathname.replace(/^\/+/, ''));
  try {
    const body = await fs.readFile(filePath);
    send(res, 200, body, {
      'Content-Type': mimeType(filePath),
      'Cache-Control': 'public, max-age=300',
    });
    return true;
  } catch {
    return false;
  }
}

async function serveQrSvg(req, res, token) {
  const recipient = await getRecipientByToken(token);
  if (!recipient) {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }
  const url = `${baseUrlFromRequest(req)}/bestiario/${recipient.token}`;
  const svg = createQrSvg(url, 320);
  send(res, 200, svg, {
    'Content-Type': 'image/svg+xml',
    'Content-Disposition': `inline; filename="qr_${recipient.token}.svg"`,
  });
}

async function serveArtworkImage(res, artwork) {
  const buffer = await readArtworkBuffer(artwork);
  send(res, 200, buffer, {
    'Content-Type': artwork.mimeType,
    'Cache-Control': 'no-store',
  });
}

async function serveCardPng(res, card, download = false, artworkDataUri = '') {
  const svg = createCardSvg(card, { artworkDataUri });
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  send(res, 200, buffer, {
    'Content-Type': 'image/png',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${card.token}_${card.id}.png"`,
    'Cache-Control': 'no-store',
  });
}

function buildCsv(snapshot, baseUrl) {
  const rows = [
    [
      'recipient_name',
      'brand',
      'token',
      'link',
      'opened',
      'started',
      'completed',
      'email',
      'choices',
      'follow_up',
    ],
  ];

  for (const recipient of snapshot.recipients) {
    const events = snapshot.events.filter((item) => item.recipientToken === recipient.token);
    const latestCard = snapshot.cards.find((item) => item.token === recipient.token) ?? null;
    const opened = events.some((item) => item.event === 'qr_opened');
    const started = events.some((item) => item.event === 'experience_started');
    const completed = events.some((item) => item.event === 'experience_completed');
    const followUp = completed ? 'da contattare' : opened ? 'attendere' : 'nessuna azione';
    const choices = latestCard
      ? `${latestCard.archetypeLabel} / ${latestCard.matterLabel} / ${latestCard.energyLabel}`
      : '';
    rows.push([
      recipient.recipient_name,
      recipient.brand,
      recipient.token,
      `${baseUrl}/bestiario/${recipient.token}`,
      opened ? 'yes' : 'no',
      started ? 'yes' : 'no',
      completed ? 'yes' : 'no',
      latestCard?.email || '',
      choices,
      followUp,
    ]);
  }

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

export async function handleRequest(req, res) {
  if (!initialized) {
    await ensureDataFiles();
    initialized = true;
  }

  try {
    const url = new URL(req.url, baseUrlFromRequest(req));
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/favicon.ico') {
      send(res, 204, '');
      return;
    }

    if (pathname === '/styles.css' || pathname === '/app.js') {
      await serveStatic(req, res, pathname);
      return;
    }

    if (pathname === '/') {
      const recipients = await getRecipients();
      send(res, 200, renderHome(recipients, baseUrlFromRequest(req)), {
        'Content-Type': 'text/html; charset=utf-8',
      });
      return;
    }

    if (pathname === '/privacy') {
      send(res, 200, renderPrivacyPage(), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }

    if (pathname === '/chi-ha-creato-il-ritratto') {
      send(res, 200, renderInfoPage(), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }

    if (pathname === '/admin' && req.method === 'GET') {
      if (!isAdmin(req)) {
        send(res, 200, renderAdminLogin(), { 'Content-Type': 'text/html; charset=utf-8' });
        return;
      }
      const snapshot = await getDashboardSnapshot();
      send(res, 200, renderAdmin(snapshot, baseUrlFromRequest(req)), {
        'Content-Type': 'text/html; charset=utf-8',
      });
      return;
    }

    if (pathname === '/admin/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.password !== adminPassword) {
        send(res, 401, renderAdminLogin('Password non corretta.'), {
          'Content-Type': 'text/html; charset=utf-8',
        });
        return;
      }
      setCookie(res, createAdminCookieValue());
      send(res, 302, 'Redirect', { Location: '/admin' });
      return;
    }

    if (pathname === '/admin/logout') {
      clearCookie(res);
      send(res, 302, 'Redirect', { Location: '/admin' });
      return;
    }

    if (pathname.startsWith('/admin/qr/') && pathname.endsWith('.svg')) {
      if (!isAdmin(req)) {
        send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const token = pathname.replace('/admin/qr/', '').replace(/\.svg$/, '');
      await serveQrSvg(req, res, token);
      return;
    }

    if (pathname === '/api/admin/export.csv') {
      if (!isAdmin(req)) {
        send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const snapshot = await getDashboardSnapshot();
      const csv = buildCsv(snapshot, baseUrlFromRequest(req));
      send(res, 200, csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="bestiario-dashboard.csv"',
      });
      return;
    }

    if (pathname.startsWith('/api/admin/artwork/')) {
      if (!isAdmin(req)) {
        send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const artworkId = pathname.replace('/api/admin/artwork/', '');
      const artwork = await getCardArtworkById(artworkId);
      if (!artwork) {
        send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      await serveArtworkImage(res, artwork);
      return;
    }

    if (pathname === '/api/admin/upload-artwork' && req.method === 'POST') {
      if (!isAdmin(req)) {
        sendJson(res, 403, { error: 'Accesso negato.' });
        return;
      }
      const body = await readBody(req);
      const recipient = await getRecipientByToken(body.token);
      if (!recipient) {
        sendJson(res, 404, { error: 'Destinatario non trovato.' });
        return;
      }

      const selection = getCardSelectionFromParams(body);
      if (!selection.archetype || !selection.matter || !selection.energy || !selection.ornament) {
        sendJson(res, 400, { error: 'La variante della card e incompleta.' });
        return;
      }

      const dataUrl = String(body.dataUrl || '');
      const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
      if (!match) {
        sendJson(res, 400, { error: 'Carica un PNG, JPG o WEBP valido.' });
        return;
      }

      const mimeType = match[1];
      const extension = extensionFromMimeType(mimeType);
      if (!extension) {
        sendJson(res, 400, { error: 'Formato immagine non supportato.' });
        return;
      }

      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length) {
        sendJson(res, 400, { error: 'Il file caricato e vuoto.' });
        return;
      }
      if (buffer.length > 12 * 1024 * 1024) {
        sendJson(res, 400, { error: 'Il file supera il limite di 12 MB.' });
        return;
      }

      const metadata = await sharp(buffer).metadata().catch(() => null);
      if (!metadata?.width || !metadata?.height) {
        sendJson(res, 400, { error: 'Il file immagine non e leggibile.' });
        return;
      }

      const artworkId = `art_${crypto.randomUUID().slice(0, 8)}`;
      const storedFileName = `${artworkId}.${extension}`;
      await writeArtworkBuffer(storedFileName, buffer);

      const variantKey = buildVariantKey(selection);
      const artwork = {
        id: artworkId,
        token: recipient.token,
        brand: recipient.brand,
        recipientName: recipient.recipient_name,
        archetypeId: selection.archetype,
        matterId: selection.matter,
        energyId: selection.energy,
        ornamentId: selection.ornament,
        variantKey,
        variantLabel: formatVariantLabel({
          archetypeId: selection.archetype,
          matterId: selection.matter,
          energyId: selection.energy,
          ornamentId: selection.ornament,
        }),
        originalName: String(body.fileName || 'artwork').slice(0, 180),
        storedFileName,
        mimeType,
        byteSize: buffer.length,
        width: metadata.width,
        height: metadata.height,
        uploadedAt: new Date().toISOString(),
      };
      await saveCardArtwork(artwork);
      await recordEvent({
        id: crypto.randomUUID(),
        event: 'artwork_uploaded',
        recipientToken: recipient.token,
        timestamp: new Date().toISOString(),
        artworkId: artwork.id,
        variantKey,
      });

      sendJson(res, 200, {
        ok: true,
        artwork: {
          id: artwork.id,
          token: artwork.token,
          variantLabel: artwork.variantLabel,
          previewUrl: `/api/admin/artwork/${artwork.id}`,
        },
      });
      return;
    }

    if (pathname === '/api/track' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.recipientToken || !body.event) {
        sendJson(res, 400, { error: 'Evento incompleto.' });
        return;
      }
      await recordEvent({
        id: crypto.randomUUID(),
        event: body.event,
        recipientToken: body.recipientToken,
        cardId: body.cardId || '',
        step: body.step || '',
        selectedGroup: body.selectedGroup || '',
        selectedValue: body.selectedValue || '',
        timestamp: new Date().toISOString(),
        ...getUserAgentMeta(req),
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/submit' && req.method === 'POST') {
      const body = await readBody(req);
      const recipient = await getRecipientByToken(body.recipientToken);
      if (!recipient) {
        sendJson(res, 404, { error: 'Destinatario non trovato.' });
        return;
      }
      const email = String(body.email || '').trim();
      const name = String(body.name || '').trim();
      if (!name) {
        sendJson(res, 400, { error: 'Inserisci il nome.' });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(res, 400, { error: 'Inserisci una email valida.' });
        return;
      }
      if (!body.consent) {
        sendJson(res, 400, { error: 'Il consenso privacy e richiesto.' });
        return;
      }

      const selection = getCardSelectionFromParams(body);
      const variantKey = buildVariantKey(selection);
      const artwork = await resolveArtworkForCard({
        token: recipient.token,
        variantKey,
      });

      const card = composeCard(recipient, {
        archetype: selection.archetype,
        matter: selection.matter,
        energy: selection.energy,
        ornament: selection.ornament,
        variantKey,
        artworkAssetId: artwork?.id || '',
        signatureName: body.signatureName || name,
        displayName: body.name || recipient.recipient_name,
        roleWord: body.roleWord || '',
        customTitle: body.customTitle || '',
        email,
        company: body.company || recipient.brand,
        consent: true,
        consentAt: new Date().toISOString(),
      });

      await saveCard(card);
      await recordEvent({
        id: crypto.randomUUID(),
        event: 'experience_completed',
        recipientToken: recipient.token,
        cardId: card.id,
        timestamp: new Date().toISOString(),
        selected_creature: card.totem,
        selected_archetype: card.archetypeLabel,
        selected_matter: card.matterLabel,
        selected_energy: card.energyLabel,
        selected_ornament: card.ornamentLabel,
        title: card.finalTitle,
        email,
        ...getUserAgentMeta(req),
      });
      await recordEvent({
        id: crypto.randomUUID(),
        event: 'email_captured',
        recipientToken: recipient.token,
        cardId: card.id,
        timestamp: new Date().toISOString(),
        email,
      });

      let notification = { ok: false, reason: 'not_attempted' };
      try {
        notification = await sendInternalNotification({
          card,
          recipient,
          baseUrl: baseUrlFromRequest(req),
        });
        await recordEvent({
          id: crypto.randomUUID(),
          event: notification.ok ? 'internal_notification_sent' : 'internal_notification_skipped',
          recipientToken: recipient.token,
          cardId: card.id,
          timestamp: new Date().toISOString(),
          reason: notification.reason || '',
        });
      } catch (error) {
        notification = { ok: false, reason: error.message };
        await recordEvent({
          id: crypto.randomUUID(),
          event: 'internal_notification_failed',
          recipientToken: recipient.token,
          cardId: card.id,
          timestamp: new Date().toISOString(),
          error: error.message,
        });
      }

      sendJson(res, 200, {
        ok: true,
        cardId: card.id,
        notification,
      });
      return;
    }

    if (pathname === '/api/preview.svg') {
      const token = url.searchParams.get('token');
      const recipient = token ? await getRecipientByToken(token) : null;
      if (!recipient) {
        send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const card = previewPayloadFromSearch(recipient, url.searchParams);
      const selection = getCardSelectionFromParams(url.searchParams);
      const { artworkDataUri } = await resolveArtworkDataUri(selection, recipient.token);
      const svg = createCardSvg(card, { preview: true, artworkDataUri });
      send(res, 200, svg, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return;
    }

    if (pathname.startsWith('/api/card/')) {
      const identifier = pathname.replace('/api/card/', '');
      if (identifier.endsWith('.svg')) {
        const cardId = identifier.replace(/\.svg$/, '');
        const card = await getCardById(cardId);
        if (!card) {
          send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
          return;
        }
        const { artworkDataUri } = await resolveArtworkDataUri({
          archetype: card.archetypeId,
          matter: card.matterId,
          energy: card.energyId,
          ornament: card.ornamentId,
        }, card.token, card.artworkAssetId);
        send(res, 200, createCardSvg(card, { artworkDataUri }), { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
        return;
      }
      if (identifier.endsWith('.png')) {
        const cardId = identifier.replace(/\.png$/, '');
        const card = await getCardById(cardId);
        if (!card) {
          send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
          return;
        }
        const download = url.searchParams.get('download') === '1';
        const { artworkDataUri } = await resolveArtworkDataUri({
          archetype: card.archetypeId,
          matter: card.matterId,
          energy: card.energyId,
          ornament: card.ornamentId,
        }, card.token, card.artworkAssetId);
        await serveCardPng(res, card, download, artworkDataUri);
        return;
      }
    }

    if (pathname === '/bestiario' && url.searchParams.get('id')) {
      const token = url.searchParams.get('id');
      const recipient = await getRecipientByToken(token);
      if (!recipient) {
        send(res, 404, 'Destinatario non trovato', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      await trackServerEvent(req, 'qr_opened', recipient.token);
      send(res, 200, renderExperiencePage(recipient), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }

    if (pathname.startsWith('/bestiario/card/')) {
      const cardId = pathname.replace('/bestiario/card/', '');
      const card = await getCardById(cardId);
      if (!card) {
        send(res, 404, 'Card non trovata', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      await trackServerEvent(req, 'card_viewed', card.token, { cardId: card.id });
      send(res, 200, renderCardPage(card), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }

    if (pathname.startsWith('/bestiario/')) {
      const token = pathname.replace('/bestiario/', '');
      const recipient = await getRecipientByToken(token);
      if (!recipient) {
        send(res, 404, 'Destinatario non trovato', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      await trackServerEvent(req, 'qr_opened', recipient.token);
      send(res, 200, renderExperiencePage(recipient), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }

    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Errore interno.' });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  await ensureDataFiles();
  initialized = true;
  server.listen(port, () => {
    console.log(`Bestiario del Lusso running on http://localhost:${port}`);
  });
}
