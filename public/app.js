(function () {
  const pageType = document.body.dataset.page;

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Richiesta non riuscita');
    }
    return data;
  }

  function initExperience() {
    const payload = window.__BESTIARIO__;
    if (!payload) return;

    const steps = Array.from(document.querySelectorAll('.step'));
    const progressBar = document.querySelector('[data-progress-bar]');
    const startButton = document.querySelector('[data-start]');
    const previewImage = document.querySelector('[data-preview-image]');
    const previewName = document.querySelector('[data-preview-name]');
    const previewTitle = document.querySelector('[data-preview-title]');
    const previewDesc = document.querySelector('[data-preview-description]');
    const heroName = document.querySelector('[data-hero-name]');
    const brandSlots = document.querySelectorAll('[data-brand-slot]');
    const form = document.querySelector('[data-lead-form]');
    const errorBox = document.querySelector('[data-form-error]');
    const hiddenTrap = document.querySelector('[name="website"]');

    const state = {
      step: 0,
      archetype: payload.defaults.archetype,
      matter: payload.defaults.matter,
      energy: payload.defaults.energy,
      ornament: payload.defaults.ornament,
      signatureName: payload.recipient.recipient_name || '',
      roleWord: '',
      customTitle: '',
      tracked: new Set(),
    };

    if (heroName) {
      heroName.textContent = payload.recipient.recipient_name || 'Ospite';
    }
    brandSlots.forEach((node) => {
      node.textContent = payload.recipient.brand;
    });

    function buildPreviewUrl() {
      const params = new URLSearchParams({
        token: payload.recipient.token,
        archetype: state.archetype,
        matter: state.matter,
        energy: state.energy,
        ornament: state.ornament,
        signatureName: state.signatureName || payload.recipient.recipient_name || 'Ospite',
      });
      if (state.roleWord) params.set('roleWord', state.roleWord);
      if (state.customTitle) params.set('customTitle', state.customTitle);
      return `/api/preview.svg?${params.toString()}`;
    }

    function getOption(list, id) {
      return list.find((item) => item.id === id) || list[0];
    }

    function getResolvedTitle() {
      if (state.customTitle.trim()) return state.customTitle.trim();
      const archetype = getOption(payload.options.archetypes, state.archetype);
      const energy = getOption(payload.options.energies, state.energy);
      const base = archetype.article.endsWith("'")
        ? `${archetype.article}${archetype.noun}`
        : `${archetype.article} ${archetype.noun}`;
      return `${base} ${energy.suffix}`.replace(/\s+/g, ' ').trim();
    }

    function getResolvedDescription() {
      const matter = getOption(payload.options.matters, state.matter);
      const energy = getOption(payload.options.energies, state.energy);
      const ornament = getOption(payload.options.ornaments, state.ornament);
      const archetype = getOption(payload.options.archetypes, state.archetype);
      return `Una creatura nata tra ${matter.label.toLowerCase()}, ${energy.label.toLowerCase()} e ${ornament.label.toLowerCase()}. ${archetype.caption}`;
    }

    function syncButtons() {
      document.querySelectorAll('[data-choice]').forEach((button) => {
        const group = button.dataset.group;
        const value = button.dataset.value;
        const selected = state[group] === value;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }

    function updatePreview() {
      if (previewImage) previewImage.src = buildPreviewUrl();
      if (previewName) previewName.textContent = state.signatureName || payload.recipient.recipient_name || 'Ospite';
      if (previewTitle) previewTitle.textContent = getResolvedTitle();
      if (previewDesc) previewDesc.textContent = getResolvedDescription();
    }

    async function track(event, extra) {
      try {
        await postJson('/api/track', {
          event,
          recipientToken: payload.recipient.token,
          ...extra,
        });
      } catch (_) {
        // Deliberately silent in the client.
      }
    }

    async function setStep(nextStep) {
      state.step = Math.max(0, Math.min(steps.length - 1, nextStep));
      steps.forEach((step, index) => {
        step.classList.toggle('is-active', index === state.step);
      });
      const percent = (state.step / (steps.length - 1)) * 100;
      if (progressBar) progressBar.style.width = `${percent}%`;
      const stepNames = ['landing', 'archetipo', 'materia', 'firma', 'anteprima', 'email'];
      const currentKey = stepNames[state.step] || `step_${state.step}`;
      if (!state.tracked.has(currentKey)) {
        state.tracked.add(currentKey);
        await track('step_reached', { step: currentKey });
      }
      updatePreview();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    document.querySelectorAll('[data-choice]').forEach((button) => {
      button.addEventListener('click', async () => {
        const group = button.dataset.group;
        state[group] = button.dataset.value;
        syncButtons();
        updatePreview();
        await track('selection_updated', {
          selectedGroup: group,
          selectedValue: button.dataset.value,
        });
      });
    });

    document.querySelectorAll('[data-input-bind]').forEach((input) => {
      input.addEventListener('input', () => {
        state[input.dataset.inputBind] = input.value;
        updatePreview();
      });
    });

    document.querySelectorAll('[data-next]').forEach((button) => {
      button.addEventListener('click', () => {
        setStep(state.step + 1);
      });
    });

    document.querySelectorAll('[data-back]').forEach((button) => {
      button.addEventListener('click', () => {
        setStep(state.step - 1);
      });
    });

    if (startButton) {
      startButton.addEventListener('click', async () => {
        await track('experience_started', { step: 'landing' });
        setStep(1);
      });
    }

    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorBox.textContent = '';
        const formData = new FormData(form);
        if (hiddenTrap && hiddenTrap.value) {
          errorBox.textContent = 'Invio non valido.';
          return;
        }

        const payloadToSend = {
          recipientToken: payload.recipient.token,
          archetype: state.archetype,
          matter: state.matter,
          energy: state.energy,
          ornament: state.ornament,
          signatureName: state.signatureName || formData.get('name') || payload.recipient.recipient_name,
          roleWord: state.roleWord,
          customTitle: state.customTitle,
          name: String(formData.get('name') || '').trim(),
          email: String(formData.get('email') || '').trim(),
          company: String(formData.get('company') || '').trim(),
          consent: Boolean(formData.get('privacy')),
        };

        try {
          const result = await postJson('/api/submit', payloadToSend);
          window.location.href = `/bestiario/card/${result.cardId}`;
        } catch (error) {
          errorBox.textContent = error.message;
        }
      });
    }

    updatePreview();
    syncButtons();
    setStep(0);
  }

  function initAdmin() {
    document.querySelectorAll('[data-copy-link]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copyLink || '');
          button.textContent = 'Link copiato';
          setTimeout(() => {
            button.textContent = 'Copia link';
          }, 1500);
        } catch (_) {
          button.textContent = 'Copia manuale';
        }
      });
    });
  }

  function initCard() {
    const cta = document.querySelector('[data-track-tailer]');
    if (!cta) return;
    cta.addEventListener('click', async () => {
      try {
        await postJson('/api/track', {
          event: 'tailer_click',
          recipientToken: cta.dataset.token,
          cardId: cta.dataset.cardId,
        });
      } catch (_) {
        // no-op
      }
    });
  }

  if (pageType === 'experience') initExperience();
  if (pageType === 'admin') initAdmin();
  if (pageType === 'card') initCard();
})();
