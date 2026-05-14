function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  );
}

export async function sendInternalNotification({ card, recipient, baseUrl }) {
  const webhookUrl = process.env.BESTIARIO_INTERNAL_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, reason: 'not_configured' };
  }

  const headers = {
    'Content-Type': 'application/json',
  };

  if (process.env.BESTIARIO_INTERNAL_WEBHOOK_BEARER) {
    headers.Authorization = `Bearer ${process.env.BESTIARIO_INTERNAL_WEBHOOK_BEARER}`;
  }

  const payload = {
    project: 'Bestiario del Lusso',
    event: 'experience_completed',
    recipient: compact({
      name: `${recipient.recipient_name} ${recipient.recipient_last_name || ''}`.trim(),
      brand: recipient.brand,
      role: recipient.role,
      token: recipient.token,
    }),
    choices: {
      archetype: card.archetypeLabel,
      creature: card.totem,
      matter: card.matterLabel,
      energy: card.energyLabel,
      ornament: card.ornamentLabel,
      title: card.finalTitle,
    },
    lead: compact({
      displayName: card.displayName,
      email: card.email,
      company: card.company,
      consentAt: card.consentAt,
    }),
    links: {
      experience: `${baseUrl}/bestiario/${recipient.token}`,
      card: `${baseUrl}/bestiario/card/${card.id}`,
      png: `${baseUrl}/api/card/${card.id}.png`,
    },
    message: `${card.displayName} / ${card.brand} ha completato l'esperienza.`,
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Webhook failed with ${response.status}${body ? `: ${body}` : ''}`);
  }

  return { ok: true };
}
