/**
 * Species Mixer — Landing Page
 *
 * Handles the landing page only (/species/mixer/):
 *   - MapLibre map showing UK with ECharts effectScatter markers for each mix
 *   - Recent mixes sidebar with hover-highlight on map markers
 *   - Name wizard modal → POST create → redirect to editor sub-page
 *
 * The full editor logic lives in species-mixer.js and runs on /species/mixer/<id>/.
 */

'use strict';

class SpeciesMixerLanding {

  static CATEGORY_COLOURS = {
    tree:       '#2E7D32',
    shrub:      '#7CB342',
    wildflower: '#7B1FA2',
    grass:      '#F57C00',
    fern:       '#C0CA33',
    moss:       '#78909C',
    fungi:      '#D84315',
    other:      '#616161',
  };

  constructor(config) {
    this.config = config;
    this.mixes  = [];
    this.map    = null;
    this._chart = null;
    this._hoveredId = null;
    this._mapReady   = false;
    this._mixesReady = false;

    this.map = initMixerMap({
      onLoad: () => {
        this._mapReady = true;
        this._tryRenderMarkers();
      },
    });

    new MixerSplitPane();  // restores saved divider position; no resize callbacks needed on landing

    this._initEvents();
    this._loadMixes();
  }

  // ── Events ───────────────────────────────────────────────────────────────

  _initEvents() {
    // "New Mix" button in sidebar
    document.getElementById('landing-new-mix-btn')
      ?.addEventListener('click', () => this._openNameWizard());

    // Name wizard modal — enable confirm only when input non-empty
    const nameInput  = document.getElementById('new-mix-name-input');
    const confirmBtn = document.getElementById('confirm-new-mix-btn');
    if (nameInput && confirmBtn) {
      nameInput.addEventListener('input', () => {
        confirmBtn.disabled = !nameInput.value.trim();
      });
      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !confirmBtn.disabled) this._confirmNewMix();
      });
      confirmBtn.addEventListener('click', () => this._confirmNewMix());
    }

    // Auto-focus name input when modal opens
    document.getElementById('newMixModal')
      ?.addEventListener('shown.bs.modal', () => {
        document.getElementById('new-mix-name-input')?.focus();
      });
  }

  // ── Mixes ─────────────────────────────────────────────────────────────────

  async _loadMixes() {
    try {
      const resp = await fetch(this.config.apiUrls.mixes);
      const data = await resp.json();
      this.mixes = data.mixes || [];
    } catch {
      this.mixes = [];
    }
    this._renderCards();
    this._mixesReady = true;
    this._tryRenderMarkers();
  }

  _tryRenderMarkers() {
    if (this._mapReady && this._mixesReady) this._renderMarkers();
  }

  // ── Cards ─────────────────────────────────────────────────────────────────

  _renderCards() {
    const list = document.getElementById('landing-mixes-list');
    if (!list) return;

    if (!this.mixes.length) {
      list.innerHTML = `
        <div class="text-center text-muted py-5 small">
          <i class="bi bi-collection" style="font-size:2rem;opacity:.35;"></i>
          <p class="mt-3 mb-0">No mixes yet.</p>
          <p class="mb-0">Click <strong>New Mix</strong> to get started.</p>
        </div>
        ${this._newCardHTML()}
      `;
      this._bindNewCard();
      return;
    }

    const cards = this.mixes.map(m => this._cardHTML(m)).join('');
    list.innerHTML = cards + this._newCardHTML();

    list.querySelectorAll('.mixer-landing-mix-card[data-mix-id]').forEach(card => {
      const id = parseInt(card.dataset.mixId, 10);
      const url = this.config.editorBaseUrl + id + '/';
      card.addEventListener('click',      () => { window.location.href = url; });
      card.addEventListener('keydown',    e => { if (e.key === 'Enter') window.location.href = url; });
      card.addEventListener('mouseenter', () => this._onHover(id, true));
      card.addEventListener('mouseleave', () => this._onHoverOut(true));
      card.addEventListener('focusin',    () => this._onHover(id, true));
      card.addEventListener('focusout',   () => this._onHoverOut(true));
    });

    this._bindNewCard();
  }

  _cardHTML(m) {
    const ago    = this._timeAgo(m.updated_at);
    const name   = this._esc(m.name || 'Untitled');
    const loc    = m.location_name ? `· ${this._esc(this._trunc(m.location_name, 28))}` : '';
    const count  = m.item_count != null ? `${m.item_count} species` : '';
    const goalBadges = this._goalBadges(m);
    return `
      <div class="mixer-landing-mix-card" data-mix-id="${m.id}" role="button" tabindex="0"
           aria-label="Open ${name}">
        <div class="mixer-landing-mix-card__name">${name}</div>
        <div class="mixer-landing-mix-card__meta">${count} ${loc} · ${ago}</div>
        ${goalBadges ? `<div class="d-flex flex-wrap gap-1 mt-1">${goalBadges}</div>` : ''}
      </div>`;
  }

  _goalBadges(m) {
    const badges = [];
    const G = {
      erosion_control:    ['Erosion',      'bg-success'],
      pollinator:         ['Pollinator',   'bg-danger'],
      carbon_sequestration: ['Carbon',     'bg-info'],
      wildlife_habitat:   ['Wildlife',     'bg-warning'],
      biodiversity:       ['Biodiversity', 'bg-primary'],
    };
    for (const [key, [label, cls]] of Object.entries(G)) {
      if ((m.goals?.[key] ?? 0) >= 60) {
        badges.push(`<span class="badge ${cls} bg-opacity-10 text-body-secondary" style="font-size:.7rem;">${label}</span>`);
      }
    }
    return badges.join('');
  }

  _newCardHTML() {
    return `
      <div class="mixer-landing-mix-card mixer-landing-new-card" id="landing-new-mix-dashed"
           role="button" tabindex="0" aria-label="Create new mix">
        <i class="bi bi-plus-circle" style="font-size:1.4rem;"></i>
        <div class="small mt-1">New Mix</div>
      </div>`;
  }

  _bindNewCard() {
    const el = document.getElementById('landing-new-mix-dashed');
    el?.addEventListener('click',   () => this._openNameWizard());
    el?.addEventListener('keydown', e => { if (e.key === 'Enter') this._openNameWizard(); });
  }

  // ── Map markers (MapLibre native markers + CSS pulse) ────────────────────

  _renderMarkers() {
    if (!this.map) return;

    // Remove any existing markers
    this._clearMarkers();

    const mixesWithCoords = this.mixes.filter(m => m.latitude != null && m.longitude != null);
    if (!mixesWithCoords.length) return;

    this._markers = mixesWithCoords.map(m => {
      const el = document.createElement('div');
      el.className = 'mix-map-marker';
      el.dataset.mixId = m.id;

      el.addEventListener('mouseenter', () => this._onHover(m.id, false));
      el.addEventListener('mouseleave', () => this._onHoverOut(false));
      el.addEventListener('click', () => {
        window.location.href = this.config.editorBaseUrl + m.id + '/';
      });

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([m.longitude, m.latitude])
        .addTo(this.map);

      return { mixId: m.id, marker, el };
    });
  }

  _clearMarkers() {
    (this._markers || []).forEach(({ marker }) => marker.remove());
    this._markers = [];
  }

  _onHover(mixId, updateCards = true) {
    this._hoveredId = mixId;
    if (updateCards) {
      document.querySelectorAll('.mixer-landing-mix-card[data-mix-id]').forEach(c => {
        c.classList.toggle('is-hovered', parseInt(c.dataset.mixId, 10) === mixId);
      });
    }
    // Highlight the matching marker
    (this._markers || []).forEach(({ mixId: id, el }) => {
      el.classList.toggle('is-hovered', id === mixId);
    });
  }

  _onHoverOut(updateCards = true) {
    this._hoveredId = null;
    if (updateCards) {
      document.querySelectorAll('.mixer-landing-mix-card.is-hovered').forEach(c => c.classList.remove('is-hovered'));
    }
    (this._markers || []).forEach(({ el }) => el.classList.remove('is-hovered'));
  }

  // ── Name wizard ───────────────────────────────────────────────────────────

  _openNameWizard() {
    const input    = document.getElementById('new-mix-name-input');
    const confirmBtn = document.getElementById('confirm-new-mix-btn');
    if (input)      input.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
    const modal = document.getElementById('newMixModal');
    if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  async _confirmNewMix() {
    const input    = document.getElementById('new-mix-name-input');
    const confirmBtn = document.getElementById('confirm-new-mix-btn');
    const name = input?.value.trim();
    if (!name) return;

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating…';
    }

    try {
      const resp = await fetch(this.config.apiUrls.createMix, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-CSRFToken':      this.config.csrfToken,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ name }),
      });
      const data = await resp.json();

      if (data.mix_id) {
        // Navigate to the editor sub-page for this mix
        window.location.href = this.config.editorBaseUrl + data.mix_id + '/';
      } else {
        this._showToast(data.error || 'Failed to create mix', 'danger');
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Create Mix';
        }
      }
    } catch (err) {
      this._showToast('Failed to create mix: ' + err.message, 'danger');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Create Mix';
      }
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  _showToast(msg, type = 'info') {
    const id   = 'sm-toast-' + Date.now();
    const html = `
      <div id="${id}" class="toast align-items-center text-bg-${type} border-0 show" role="alert">
        <div class="d-flex">
          <div class="toast-body">${this._esc(msg)}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>`;
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      document.body.appendChild(container);
    }
    container.insertAdjacentHTML('beforeend', html);
    const el = document.getElementById(id);
    el?.addEventListener('hidden.bs.toast', () => el.remove());
    setTimeout(() => bootstrap.Toast.getOrCreateInstance(el)?.hide(), 4000);
  }

  _trunc(str, n) { return str.length > n ? str.slice(0, n - 1) + '…' : str; }
  _esc(s)  { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  _timeAgo(iso) {
    if (!iso) return '';
    const diff = Math.round((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  if (window.speciesMixerConfig) {
    window._mixerLanding = new SpeciesMixerLanding(window.speciesMixerConfig);
  }
});
