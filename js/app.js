'use strict';

(() => {
  const SIZES = { S: 72, M: 100, L: 132, XL: 168 };
  const SWATCHES = [...new Set([...PALETTES.Heat, ...PALETTES.Neon, '#FFFFFF', '#A3A3A3', '#525252', '#1F7AFF'])];

  const $app = document.getElementById('app');
  const fileInput = document.getElementById('file-input');

  const state = {
    view: 'library',
    lists: [],
    list: null,
    focusId: null,
    editItem: false,
    drawer: false,
    swatchFor: null,
    lightbox: null,
    linkModal: null,
    clean: false,
    undo: [],
    redo: [],
  };
  let fileTarget = 'items';

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel) => $app.querySelector(sel);
  // no-referrer helps with hosts that block hotlinking based on the Referer header.
  const imgTag = (ref) => `<img src="${esc(Images.url(ref))}" alt="" draggable="false" referrerpolicy="no-referrer">`;

  let toastTimer = 0;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  function inkFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.36 ? '#0a0a0a' : '#ffffff';
  }

  function labelScale(name) {
    const n = [...name].length;
    if (n <= 2) return 1;
    if (n <= 4) return 0.68;
    if (n <= 8) return 0.44;
    return 0.32;
  }

  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h3"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  function transition(update) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) {
      update();
      return Promise.resolve();
    }
    return document.startViewTransition(update).finished.catch(() => {});
  }

  async function settleImages(root) {
    const imgs = [...(root || $app).querySelectorAll('.stage img, .tier img')];
    await Promise.race([
      Promise.all(imgs.map((i) => i.decode().catch(() => {}))),
      new Promise((r) => setTimeout(r, 180)),
    ]);
  }

  // ---------- persistence ----------
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    const list = state.list;
    saveTimer = setTimeout(() => {
      list.updatedAt = Date.now();
      Store.putList(list);
    }, 250);
  }
  function flushSave() {
    if (!saveTimer || !state.list) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    state.list.updatedAt = Date.now();
    return Store.putList(state.list);
  }

  function snapshot() {
    const L = state.list;
    return JSON.stringify({ tiers: L.tiers, pool: L.pool, items: L.items });
  }
  function pushHistory() {
    state.undo.push(snapshot());
    if (state.undo.length > 100) state.undo.shift();
    state.redo = [];
  }
  function restore(snap) {
    Object.assign(state.list, JSON.parse(snap));
    if (state.focusId && !state.list.items[state.focusId]) state.focusId = null;
    save();
  }
  function undo() {
    if (!state.undo.length) return;
    state.redo.push(snapshot());
    restore(state.undo.pop());
    transition(renderBoard);
  }
  function redo() {
    if (!state.redo.length) return;
    state.undo.push(snapshot());
    restore(state.redo.pop());
    transition(renderBoard);
  }

  // ---------- model ops ----------
  function detach(id) {
    const L = state.list;
    L.pool = L.pool.filter((x) => x !== id);
    L.tiers.forEach((t) => { t.items = t.items.filter((x) => x !== id); });
  }
  function moveItem(id, zone, index) {
    detach(id);
    const L = state.list;
    const arr = zone === 'pool' ? L.pool : L.tiers.find((t) => t.id === zone).items;
    arr.splice(index == null ? arr.length : index, 0, id);
  }
  const allItemIds = () => [...state.list.tiers.flatMap((t) => t.items), ...state.list.pool];
  const tierOf = (id) => state.list.tiers.find((t) => t.items.includes(id));

  // ---------- theme / chrome ----------
  function applyChrome() {
    document.documentElement.classList.toggle('clean', state.clean);
  }
  function toggleClean() {
    state.clean = !state.clean;
    transition(applyChrome);
  }

  // ---------- library ----------
  async function showLibrary() {
    await flushSave();
    state.view = 'library';
    state.list = null;
    state.focusId = null;
    state.drawer = false;
    state.lightbox = null;
    state.linkModal = null;
    state.lists = (await Store.getAllLists()).sort((a, b) => b.updatedAt - a.updatedAt);
    await Images.preload(state.lists.flatMap((l) => Object.values(l.items).map((i) => i.image)));
    render();
  }

  function libraryHTML() {
    const cards = state.lists.map((l) => {
      const count = Object.keys(l.items).length;
      const rows = l.tiers.slice(0, 6).map((t) => `
        <div class="mini-row">
          <span class="mini-label" style="background:${t.color};color:${inkFor(t.color)}">${esc(t.name)}</span>
          <span class="mini-items">${t.items.slice(0, 8).map((id) => {
            const it = l.items[id];
            const url = it && Images.url(it.image);
            return url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : '<i></i>';
          }).join('')}</span>
        </div>`).join('');
      return `
        <article class="card" data-act="open" data-id="${l.id}">
          <div class="card-preview">${rows}</div>
          <div class="card-body">
            <h2>${esc(l.title)}</h2>
            <p>${count} item${count === 1 ? '' : 's'} · ${l.tiers.length} tiers</p>
          </div>
          <div class="card-actions">
            <button class="btn sm" data-act="dup">Duplicate</button>
            <button class="btn sm" data-act="export">Export</button>
            <button class="btn sm danger" data-act="delete">Delete</button>
          </div>
        </article>`;
    }).join('');
    return `
      <div class="screen library">
        <header class="topbar">
          <div class="brand">gotier</div>
          <div class="spacer"></div>
          <button class="btn" data-act="import">Import</button>
          <button class="btn primary" data-act="new-list">+ New list</button>
        </header>
        <main class="lib">
          <div class="lib-grid">
            ${cards}
            <button class="card card-new" data-act="new-list"><span>+</span>New list</button>
          </div>
        </main>
      </div>`;
  }

  // ---------- board ----------
  async function openList(id) {
    const list = await Store.getList(id);
    if (!list) {
      location.hash = '#/';
      return;
    }
    list.settings = Object.assign({ tileSize: 'M', showNames: false }, list.settings);
    await Images.preload(listImageIds(list));
    state.view = 'board';
    state.list = list;
    state.focusId = null;
    state.editItem = false;
    state.drawer = false;
    state.lightbox = null;
    state.linkModal = null;
    state.undo = [];
    state.redo = [];
    render();
  }

  function boardScreenHTML() {
    const L = state.list;
    return `
      <div class="screen board-screen">
        <header class="topbar">
          <button class="btn icon" data-act="home" title="All lists">${ICON.back}</button>
          <input class="title-input" data-field="list-title" value="${esc(L.title)}" spellcheck="false" aria-label="List title">
          <div class="spacer"></div>
          <button class="btn icon" data-act="undo" title="Undo (Ctrl+Z)">${ICON.undo}</button>
          <button class="btn icon" data-act="redo" title="Redo (Ctrl+Shift+Z)">${ICON.redo}</button>
          <button class="btn" data-act="settings">Tiers</button>
          <button class="btn" data-act="clean" title="Hide UI for recording (H)">${ICON.eye}<span>Clean</span></button>
        </header>
        <main class="board"></main>
        <button class="clean-exit" data-act="clean" title="Show UI (H)">${ICON.eye}</button>
        <div class="drawer-host"></div>
        <div class="modal-host"></div>
        <div class="lightbox-host"></div>
      </div>`;
  }

  function tileHTML(item, focus) {
    const L = state.list;
    const isCur = focus && focus.id === item.id;
    const url = Images.url(item.image);
    return `<div class="tile${item.fit === 'contain' ? ' fit-contain' : ''}${isCur ? ' is-current' : ''}" data-id="${item.id}" data-name="${esc(item.name)}" style="view-transition-name:${isCur ? 'none' : 't-' + item.id}" title="${esc(item.name)}">
      ${url ? imgTag(item.image) : `<span class="tile-text">${esc(item.name)}</span>`}
      ${L.settings.showNames && url ? `<span class="tile-name">${esc(item.name)}</span>` : ''}
    </div>`;
  }

  function tierHTML(t, i, focus) {
    const L = state.list;
    return `
      <div class="tier zone" data-zone="${t.id}" style="--tier:${t.color};--tier-ink:${inkFor(t.color)};--label-scale:${labelScale(t.name)};view-transition-name:r-${t.id}">
        <div class="tier-label" ${focus ? '' : 'data-act="edit-tier"'}>
          <span>${esc(t.name)}</span>
          ${focus && i < 9 ? `<kbd>${i + 1}</kbd>` : ''}
        </div>
        <div class="tier-items">${t.items.map((id) => tileHTML(L.items[id], focus)).join('')}</div>
      </div>`;
  }

  function poolHTML() {
    const L = state.list;
    return `
      <section class="pool zone" data-zone="pool" style="view-transition-name:pool">
        <div class="pool-head">
          <span class="pool-title">Unranked</span>
          <span class="pool-count">${L.pool.length}</span>
          <div class="spacer"></div>
          <button class="btn sm" data-act="add-text">+ Text</button>
          <button class="btn sm" data-act="add-links">+ Links</button>
          <button class="btn sm primary" data-act="add-files">+ Upload</button>
        </div>
        <div class="tier-items pool-items">
          ${L.pool.map((id) => tileHTML(L.items[id], null)).join('')}
          ${L.pool.length ? '' : '<div class="pool-empty">Drop or paste images or image links here, or use Upload / Links above.</div>'}
        </div>
      </section>`;
  }

  function stageHTML(item) {
    const L = state.list;
    const order = allItemIds();
    const idx = order.indexOf(item.id);
    const tier = tierOf(item.id);
    const url = Images.url(item.image);
    const gallery = item.gallery.filter((id) => Images.url(id));
    const n = gallery.length;
    const gClass = n >= 5 ? 'g-many' : 'g-' + n;
    const editing = state.editItem;
    const keys = Math.min(L.tiers.length, 9);
    return `
      <section class="stage${n ? '' : ' is-solo'}${editing ? ' is-editing' : ''}" style="view-transition-name:stage">
        <div class="stage-head">
          <div class="hero tile${item.fit === 'contain' ? ' fit-contain' : ''}" data-hero="${item.id}" data-name="${esc(item.name)}" style="view-transition-name:t-${item.id}" title="Drag to a tier">
            ${url ? imgTag(item.image) : `<span class="tile-text">${esc(item.name)}</span>`}
          </div>
          <div class="stage-title">
            <div class="stage-meta">
              ${tier ? `<span class="chip" style="background:${tier.color};color:${inkFor(tier.color)}">${esc(tier.name)}</span>` : '<span class="chip chip-muted">Unranked</span>'}
              <span class="stage-hint">Drag the tile to a tier${keys ? ` · or press 1–${keys}` : ''}</span>
            </div>
            <h1>${esc(item.name)}</h1>
          </div>
          <div class="stage-nav">
            <button class="btn icon" data-act="prev" title="Previous (←)">${ICON.left}</button>
            <span class="stage-count">${idx + 1}/${order.length}</span>
            <button class="btn icon" data-act="next" title="Next (→)">${ICON.right}</button>
            <button class="btn${editing ? ' primary' : ''}" data-act="edit-item">${editing ? 'Done' : 'Edit'}</button>
            <button class="btn icon" data-act="close-focus" title="Back (Esc)">${ICON.close}</button>
          </div>
        </div>
        ${editing ? `
        <div class="edit-panel">
          <label class="field"><span>Name</span><input class="input" data-field="item-name" value="${esc(item.name)}" spellcheck="false"></label>
          <div class="field"><span>Tile image</span>
            <div class="btn-row">
              <div class="seg">
                <button data-act="item-fit" data-fit="cover" class="${item.fit !== 'contain' ? 'on' : ''}">Fill</button>
                <button data-act="item-fit" data-fit="contain" class="${item.fit === 'contain' ? 'on' : ''}">Fit</button>
              </div>
              <button class="btn" data-act="item-replace-image">Upload</button>
              <button class="btn" data-act="item-replace-link">Link</button>
            </div>
          </div>
          <div class="field"><span>Extra images</span>
            <div class="btn-row">
              <button class="btn" data-act="item-add-images">Upload</button>
              <button class="btn" data-act="item-add-links">Links</button>
            </div>
          </div>
          <div class="spacer"></div>
          <button class="btn danger" data-act="item-delete">Delete item</button>
        </div>` : ''}
        ${n ? `
        <div class="gallery ${gClass}">
          ${gallery.map((id, i) => `
            <figure class="g-cell" data-act="lightbox" data-index="${i}">
              ${imgTag(id)}
              ${editing ? `<div class="g-tools">
                <button class="btn sm" data-act="gallery-main" data-img="${esc(id)}">Use as tile</button>
                <button class="btn sm icon danger" data-act="gallery-remove" data-img="${esc(id)}" title="Remove">${ICON.close}</button>
              </div>` : ''}
            </figure>`).join('')}
        </div>` : `
        <div class="gallery-empty">
          <p>Add extra images for <b>${esc(item.name)}</b></p>
          <div class="btn-row">
            <button class="btn" data-act="item-add-images">Upload</button>
            <button class="btn" data-act="item-add-links">Paste links</button>
          </div>
          <p class="hint">or drop / paste images and image links anywhere</p>
        </div>`}
      </section>`;
  }

  function renderBoard() {
    const board = $('.board');
    if (!board) return;
    const L = state.list;
    const focus = state.focusId ? L.items[state.focusId] : null;
    if (!focus) state.focusId = null;
    board.classList.toggle('is-focus', !!focus);
    board.style.setProperty('--tile', SIZES[L.settings.tileSize] + 'px');
    board.innerHTML = `
      <section class="tiers">${L.tiers.map((t, i) => tierHTML(t, i, focus)).join('')}</section>
      ${focus ? stageHTML(focus) : poolHTML()}`;
    $('[data-act="undo"]').disabled = !state.undo.length;
    $('[data-act="redo"]').disabled = !state.redo.length;
  }

  // ---------- overlays ----------
  function drawerBodyHTML() {
    const L = state.list;
    return `
      <div class="tier-edits">
        ${L.tiers.map((t, i) => `
          <div class="tier-edit" data-tier="${t.id}">
            <button class="chip-btn" data-act="tier-swatch" style="background:${t.color}" title="Color"></button>
            <input class="input" data-field="tier-name" value="${esc(t.name)}" spellcheck="false">
            <button class="btn icon sm" data-act="tier-up" ${i === 0 ? 'disabled' : ''} title="Move up">${ICON.up}</button>
            <button class="btn icon sm" data-act="tier-down" ${i === L.tiers.length - 1 ? 'disabled' : ''} title="Move down">${ICON.down}</button>
            <button class="btn icon sm danger" data-act="tier-delete" title="Delete tier">${ICON.close}</button>
          </div>
          ${state.swatchFor === t.id ? `
          <div class="swatches" data-tier="${t.id}">
            ${SWATCHES.map((c) => `<button class="swatch${c.toLowerCase() === t.color.toLowerCase() ? ' on' : ''}" data-act="set-color" data-color="${c}" style="background:${c}"></button>`).join('')}
            <label class="swatch custom" title="Custom color"><input type="color" data-field="tier-color" value="${t.color}"></label>
          </div>` : ''}`).join('')}
      </div>
      <button class="btn block" data-act="tier-add">+ Add tier</button>
      <h3>Palette</h3>
      <div class="palettes">
        ${Object.entries(PALETTES).map(([k, cols]) => `
          <button class="palette" data-act="palette" data-palette="${k}">
            <span class="palette-strip">${cols.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
            <span>${k}</span>
          </button>`).join('')}
      </div>
      <h3>Display</h3>
      <div class="row"><span>Tile size</span>
        <div class="seg">${Object.keys(SIZES).map((s) => `<button data-act="tile-size" data-size="${s}" class="${L.settings.tileSize === s ? 'on' : ''}">${s}</button>`).join('')}</div>
      </div>
      <div class="row"><span>Show names on image tiles</span>
        <button class="toggle${L.settings.showNames ? ' on' : ''}" data-act="show-names" aria-label="Show names"><i></i></button>
      </div>
      <h3>Data</h3>
      <button class="btn block" data-act="export-list">Export list (.json)</button>
      <button class="btn block danger" data-act="reset">Move everything back to unranked</button>`;
  }

  function renderDrawer() {
    const host = $('.drawer-host');
    if (!host) return;
    if (!state.drawer) {
      host.innerHTML = '';
      return;
    }
    const body = host.querySelector('.drawer-body');
    if (body) {
      body.innerHTML = drawerBodyHTML();
      return;
    }
    host.innerHTML = `
      <div class="scrim" data-act="close-drawer"></div>
      <aside class="drawer">
        <header class="drawer-head"><h2>Tiers &amp; settings</h2><button class="btn icon" data-act="close-drawer">${ICON.close}</button></header>
        <div class="drawer-body">${drawerBodyHTML()}</div>
      </aside>`;
  }

  function renderLightbox() {
    const host = $('.lightbox-host');
    if (!host) return;
    const item = state.focusId && state.list.items[state.focusId];
    if (!state.lightbox || !item) {
      host.innerHTML = '';
      state.lightbox = null;
      return;
    }
    const gallery = item.gallery.filter((id) => Images.url(id));
    const i = (state.lightbox.index + gallery.length) % gallery.length;
    state.lightbox.index = i;
    host.innerHTML = `
      <div class="lightbox" data-act="close-lightbox">
        <img src="${esc(Images.url(gallery[i]))}" alt="" referrerpolicy="no-referrer">
        <span class="lightbox-count">${i + 1}/${gallery.length}</span>
      </div>`;
  }

  // ---------- link modal ----------
  const LINK_MODES = {
    items: {
      title: 'Add items from links',
      hint: 'One image link per line. Put a name before a link to name the item, e.g. <code>McDonald\'s https://…/logo.png</code>. Tip: right-click an image → <b>Copy image address</b>.',
      cta: 'Add items',
    },
    gallery: {
      title: 'Add extra image links',
      hint: 'One image link per line. Tip: right-click an image → <b>Copy image address</b>.',
      cta: 'Add images',
    },
    replace: {
      title: 'Tile image from link',
      hint: 'Paste a direct link to an image.',
      cta: 'Use image',
    },
  };

  function openLinkModal(mode) {
    state.linkModal = { mode, text: '', error: '' };
    renderModal();
    const f = $('[data-field="links"]');
    if (f) f.focus();
  }
  function closeLinkModal() {
    state.linkModal = null;
    renderModal();
  }

  function renderModal() {
    const host = $('.modal-host');
    if (!host) return;
    const m = state.linkModal;
    if (!m) {
      host.innerHTML = '';
      return;
    }
    const cfg = LINK_MODES[m.mode];
    const single = m.mode === 'replace';
    host.innerHTML = `
      <div class="scrim" data-act="close-modal"></div>
      <div class="modal" role="dialog" aria-label="${cfg.title}">
        <header class="modal-head"><h2>${cfg.title}</h2><button class="btn icon" data-act="close-modal">${ICON.close}</button></header>
        <p class="modal-hint">${cfg.hint}</p>
        ${single
          ? `<input class="input" data-field="links" placeholder="https://…" spellcheck="false" value="${esc(m.text)}">`
          : `<textarea class="input" data-field="links" placeholder="https://…" spellcheck="false" wrap="off">${esc(m.text)}</textarea>`}
        <div class="link-previews"></div>
        ${m.error ? `<p class="modal-error">${esc(m.error)}</p>` : ''}
        <footer class="modal-foot">
          <span class="modal-count"></span>
          <div class="spacer"></div>
          <button class="btn" data-act="close-modal">Cancel</button>
          <button class="btn primary" data-act="submit-links">${cfg.cta}</button>
        </footer>
      </div>`;
    updateLinkPreviews();
  }

  let previewTimer = 0;
  function updateLinkPreviews() {
    const m = state.linkModal;
    const box = $('.link-previews');
    if (!m || !box) return;
    let entries = parseLinks(m.text);
    if (m.mode === 'replace') entries = entries.slice(0, 1);
    const showNames = m.mode === 'items';
    box.innerHTML = entries.slice(0, 40).map((e) => `
      <div class="link-thumb" title="${esc(e.url)}">
        <img src="${esc(e.url)}" alt="" referrerpolicy="no-referrer">
        ${showNames ? `<span>${esc(e.name || nameFromUrl(e.url) || 'Untitled')}</span>` : ''}
      </div>`).join('');
    const count = $('.modal-count');
    if (count) count.textContent = entries.length ? `${entries.length} link${entries.length === 1 ? '' : 's'}` : '';
  }

  const URL_RE = /(https?:\/\/[^\s"'<>]+|data:image\/[a-z0-9+.-]+;base64,[a-z0-9+/=]+)/gi;
  function parseLinks(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      const urls = [...line.matchAll(URL_RE)];
      if (!urls.length) return;
      if (urls.length > 1) {
        urls.forEach((u) => out.push({ line: u[0], url: u[0], name: '' }));
        return;
      }
      const u = urls[0];
      const name = (line.slice(0, u.index) + ' ' + line.slice(u.index + u[0].length))
        .replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/g, '').trim();
      out.push({ line, url: u[0], name });
    });
    return out;
  }

  function nameFromUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'data:') return '';
      let seg = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      seg = seg.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/^\d+px-/, '').replace(/[_+-]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!/[a-z]/i.test(seg) || seg.length > 40 || /[0-9a-f]{12,}/i.test(seg.replace(/ /g, ''))) return '';
      return seg;
    } catch {
      return '';
    }
  }

  function probe(url, ms = 12000) {
    return new Promise((resolve) => {
      const im = new Image();
      im.referrerPolicy = 'no-referrer';
      const timer = setTimeout(() => done(false), ms);
      function done(ok) {
        clearTimeout(timer);
        im.onload = im.onerror = null;
        resolve(ok);
      }
      im.onload = () => done(true);
      im.onerror = () => done(false);
      im.src = url;
    });
  }

  // Adds links after checking they load as images. Returns the entries that failed.
  async function addLinks(entries, mode, zone = 'pool') {
    const L = state.list;
    if (mode === 'replace') entries = entries.slice(0, 1);
    const target = mode === 'items' ? null : L.items[state.focusId];
    const results = await Promise.all(entries.map((e) => probe(e.url)));
    const ok = entries.filter((_, i) => results[i]);
    const bad = entries.filter((_, i) => !results[i]);
    if (!ok.length || state.list !== L) return bad;
    if (mode === 'items') {
      pushHistory();
      const arr = zone === 'pool' ? L.pool : (L.tiers.find((t) => t.id === zone) || {}).items || L.pool;
      ok.forEach((e) => {
        const name = e.name || nameFromUrl(e.url) || 'Item ' + (Object.keys(L.items).length + 1);
        const item = { id: uid('i'), name, image: e.url, gallery: [], fit: 'cover' };
        L.items[item.id] = item;
        arr.push(item.id);
      });
    } else {
      if (!target || !L.items[target.id]) return bad;
      if (mode === 'gallery') target.gallery.push(...ok.map((e) => e.url));
      else target.image = ok[0].url;
    }
    save();
    renderBoard();
    return bad;
  }

  async function addLinksWithToast(entries, mode, zone) {
    toast(`Loading ${entries.length} link${entries.length === 1 ? '' : 's'}…`);
    const bad = await addLinks(entries, mode, zone);
    const added = entries.length - bad.length;
    if (bad.length) toast(`${bad.length} link${bad.length === 1 ? '' : 's'} didn't load as an image. Use a direct image link (right-click → Copy image address).`);
    else toast(`Added ${added} image${added === 1 ? '' : 's'}`);
  }

  function render() {
    applyChrome();
    if (state.view === 'library') {
      $app.innerHTML = libraryHTML();
      return;
    }
    $app.innerHTML = boardScreenHTML();
    renderBoard();
    renderDrawer();
    renderModal();
    renderLightbox();
  }

  // ---------- focus mode ----------
  function openFocus(id) {
    const tile = $app.querySelector(`.tile[data-id="${id}"]`);
    if (tile) tile.style.viewTransitionName = 't-' + id;
    transition(async () => {
      state.focusId = id;
      state.editItem = false;
      renderBoard();
      await settleImages();
    });
  }
  function closeFocus() {
    transition(async () => {
      state.focusId = null;
      state.editItem = false;
      renderBoard();
      await settleImages();
    });
  }
  function stepFocus(dir) {
    const order = allItemIds();
    if (!order.length) return;
    const i = order.indexOf(state.focusId);
    const next = order[(i + dir + order.length) % order.length];
    transition(async () => {
      state.focusId = next;
      state.editItem = false;
      renderBoard();
      await settleImages();
    });
  }
  function assignFocused(tierId) {
    const id = state.focusId;
    if (!id) return;
    pushHistory();
    moveItem(id, tierId);
    save();
    transition(async () => {
      state.focusId = null;
      state.editItem = false;
      renderBoard();
      await settleImages();
    });
  }

  // ---------- drag callbacks ----------
  function onDrop(id, zone, index, ghost) {
    pushHistory();
    moveItem(id, zone, index);
    save();
    const hero = $('[data-hero]');
    if (hero) hero.style.viewTransitionName = 'none';
    ghost.style.viewTransitionName = 't-' + id;
    transition(async () => {
      ghost.remove();
      state.focusId = null;
      state.editItem = false;
      renderBoard();
      await settleImages();
    });
  }

  function onTileClick(id, el) {
    if (el.hasAttribute('data-hero')) return;
    if (state.focusId === id) return;
    openFocus(id);
  }

  // ---------- items ----------
  function nameFromFile(file, fallbackIndex) {
    const base = (file.name || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (!base || /^image$/i.test(base)) return 'Item ' + fallbackIndex;
    return base;
  }

  async function addItemsFromFiles(files, zone = 'pool') {
    const L = state.list;
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    pushHistory();
    const target = zone === 'pool' ? L.pool : (L.tiers.find((t) => t.id === zone) || {}).items || L.pool;
    for (const f of imgs) {
      const image = await Images.fromFile(f, 800);
      const item = { id: uid('i'), name: nameFromFile(f, Object.keys(L.items).length + 1), image, gallery: [], fit: 'cover' };
      L.items[item.id] = item;
      target.push(item.id);
    }
    save();
    renderBoard();
  }

  async function addGalleryFiles(files) {
    const item = state.list.items[state.focusId];
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    if (!item || !imgs.length) return;
    for (const f of imgs) item.gallery.push(await Images.fromFile(f, 2000));
    save();
    renderBoard();
  }

  async function replaceTileImage(files) {
    const item = state.list.items[state.focusId];
    const f = [...files].find((x) => x.type.startsWith('image/'));
    if (!item || !f) return;
    item.image = await Images.fromFile(f, 800);
    save();
    renderBoard();
  }

  function pickFiles(kind) {
    fileTarget = kind;
    fileInput.multiple = kind !== 'replace';
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (!files.length) return;
    if (fileTarget === 'gallery') addGalleryFiles(files);
    else if (fileTarget === 'replace') replaceTileImage(files);
    else addItemsFromFiles(files);
  });

  function addTextItem() {
    const L = state.list;
    pushHistory();
    const item = { id: uid('i'), name: 'New item', image: null, gallery: [], fit: 'cover' };
    L.items[item.id] = item;
    L.pool.push(item.id);
    save();
    state.focusId = item.id;
    state.editItem = true;
    renderBoard();
    const input = $('[data-field="item-name"]');
    if (input) { input.focus(); input.select(); }
  }

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const fileSafe = (s) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'tier-list';

  // ---------- actions ----------
  const actions = {
    async 'new-list'() {
      const l = newList();
      await Store.putList(l);
      location.hash = '#/list/' + l.id;
    },
    open(el) { location.hash = '#/list/' + el.dataset.id; },
    async dup(el) {
      const src = state.lists.find((l) => l.id === el.closest('[data-id]').dataset.id);
      const copy = structuredClone(src);
      copy.id = uid('l');
      copy.title = src.title + ' copy';
      copy.createdAt = copy.updatedAt = Date.now();
      await Store.putList(copy);
      showLibrary();
    },
    async export(el) {
      const l = state.lists.find((x) => x.id === el.closest('[data-id]').dataset.id);
      download(fileSafe(l.title) + '.gotier.json', await exportListJSON(l));
    },
    async delete(el) {
      const l = state.lists.find((x) => x.id === el.closest('[data-id]').dataset.id);
      if (!confirm(`Delete “${l.title}”? This can't be undone.`)) return;
      await Store.deleteList(l.id);
      await gcImages();
      showLibrary();
    },
    import() {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = async () => {
        try {
          const l = await importListJSON(await inp.files[0].text());
          location.hash = '#/list/' + l.id;
        } catch (err) {
          alert('Import failed: ' + err.message);
        }
      };
      inp.click();
    },
    async home() {
      await flushSave();
      location.hash = '#/';
    },
    undo, redo,
    reset() {
      if (!confirm('Move every item back to unranked?')) return;
      const L = state.list;
      pushHistory();
      L.pool = [...L.tiers.flatMap((t) => t.items), ...L.pool];
      L.tiers.forEach((t) => { t.items = []; });
      save();
      state.focusId = null;
      transition(renderBoard);
    },
    settings() { state.drawer = true; renderDrawer(); },
    'edit-tier'() { state.drawer = true; renderDrawer(); },
    'close-drawer'() { state.drawer = false; state.swatchFor = null; renderDrawer(); },
    clean: toggleClean,
    'add-files'() { pickFiles('items'); },
    'add-links'() { openLinkModal('items'); },
    'item-add-links'() { openLinkModal('gallery'); },
    'item-replace-link'() { openLinkModal('replace'); },
    'close-modal': closeLinkModal,
    async 'submit-links'(el) {
      const m = state.linkModal;
      const entries = parseLinks(m.text);
      if (!entries.length) {
        m.error = 'No links found. Paste links that start with http:// or https://';
        renderModal();
        return;
      }
      el.disabled = true;
      el.textContent = 'Checking…';
      const bad = await addLinks(entries, m.mode);
      if (state.linkModal !== m) return;
      if (!bad.length) {
        closeLinkModal();
        return;
      }
      m.text = bad.map((e) => e.line).join('\n');
      m.error = `${bad.length} link${bad.length === 1 ? '' : 's'} didn't load as an image and ${bad.length === 1 ? 'is' : 'are'} left above. Make sure it's a direct image link (right-click an image → Copy image address).`;
      renderModal();
    },
    'add-text': addTextItem,
    'close-focus': closeFocus,
    prev() { stepFocus(-1); },
    next() { stepFocus(1); },
    'edit-item'() { state.editItem = !state.editItem; renderBoard(); },
    'item-fit'(el) {
      state.list.items[state.focusId].fit = el.dataset.fit;
      save();
      renderBoard();
    },
    'item-replace-image'() { pickFiles('replace'); },
    'item-add-images'() { pickFiles('gallery'); },
    'item-delete'() {
      const item = state.list.items[state.focusId];
      if (!confirm(`Delete “${item.name}”?`)) return;
      pushHistory();
      detach(item.id);
      delete state.list.items[item.id];
      save();
      closeFocus();
    },
    'gallery-remove'(el) {
      const item = state.list.items[state.focusId];
      item.gallery = item.gallery.filter((x) => x !== el.dataset.img);
      save();
      renderBoard();
    },
    'gallery-main'(el) {
      state.list.items[state.focusId].image = el.dataset.img;
      save();
      renderBoard();
    },
    lightbox(el) {
      if (state.editItem) return;
      state.lightbox = { index: +el.dataset.index };
      renderLightbox();
    },
    'close-lightbox'() { state.lightbox = null; renderLightbox(); },
    'tier-swatch'(el) {
      const id = el.closest('[data-tier]').dataset.tier;
      state.swatchFor = state.swatchFor === id ? null : id;
      renderDrawer();
    },
    'set-color'(el) {
      const t = state.list.tiers.find((x) => x.id === el.closest('[data-tier]').dataset.tier);
      t.color = el.dataset.color;
      save();
      renderDrawer();
      renderBoard();
    },
    'tier-up'(el) { moveTier(el, -1); },
    'tier-down'(el) { moveTier(el, 1); },
    'tier-delete'(el) {
      const L = state.list;
      const t = L.tiers.find((x) => x.id === el.closest('[data-tier]').dataset.tier);
      if (t.items.length && !confirm(`Delete tier “${t.name}”? Its ${t.items.length} item(s) go back to unranked.`)) return;
      pushHistory();
      L.pool.push(...t.items);
      L.tiers = L.tiers.filter((x) => x !== t);
      save();
      renderDrawer();
      transition(renderBoard);
    },
    'tier-add'() {
      const L = state.list;
      const color = PALETTES.Heat[L.tiers.length % PALETTES.Heat.length];
      L.tiers.push({ id: uid('r'), name: 'New', color, items: [] });
      save();
      renderDrawer();
      transition(renderBoard);
      const inputs = $app.querySelectorAll('[data-field="tier-name"]');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    },
    palette(el) {
      const cols = PALETTES[el.dataset.palette];
      pushHistory();
      state.list.tiers.forEach((t, i) => { t.color = cols[Math.min(i, cols.length - 1)]; });
      save();
      renderDrawer();
      transition(renderBoard);
    },
    'tile-size'(el) {
      state.list.settings.tileSize = el.dataset.size;
      save();
      renderDrawer();
      transition(renderBoard);
    },
    'show-names'() {
      state.list.settings.showNames = !state.list.settings.showNames;
      save();
      renderDrawer();
      renderBoard();
    },
    async 'export-list'() {
      await flushSave();
      download(fileSafe(state.list.title) + '.gotier.json', await exportListJSON(state.list));
    },
  };

  function moveTier(el, dir) {
    const L = state.list;
    const i = L.tiers.findIndex((x) => x.id === el.closest('[data-tier]').dataset.tier);
    const j = i + dir;
    if (j < 0 || j >= L.tiers.length) return;
    [L.tiers[i], L.tiers[j]] = [L.tiers[j], L.tiers[i]];
    save();
    renderDrawer();
    transition(renderBoard);
  }

  $app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el && state.view === 'board' && state.focusId) {
      const tierEl = e.target.closest('.tier');
      if (tierEl && !e.target.closest('.tile')) assignFocused(tierEl.dataset.zone);
      return;
    }
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, e);
  });

  $app.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (!f || !state.list) return;
    const L = state.list;
    if (f === 'list-title') {
      L.title = e.target.value;
      save();
    } else if (f === 'tier-name') {
      L.tiers.find((t) => t.id === e.target.closest('[data-tier]').dataset.tier).name = e.target.value;
      save();
      renderBoard();
    } else if (f === 'tier-color') {
      const t = L.tiers.find((x) => x.id === e.target.closest('[data-tier]').dataset.tier);
      t.color = e.target.value;
      const chip = $app.querySelector(`.tier-edit[data-tier="${t.id}"] .chip-btn`);
      if (chip) chip.style.background = t.color;
      save();
      renderBoard();
    } else if (f === 'item-name') {
      const item = L.items[state.focusId];
      item.name = e.target.value;
      const h1 = $('.stage-title h1');
      if (h1) h1.textContent = item.name;
      save();
    } else if (f === 'links' && state.linkModal) {
      state.linkModal.text = e.target.value;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(updateLinkPreviews, 250);
    }
  });

  // Broken links show the item name (tiles) or a placeholder instead of a broken-image icon.
  document.addEventListener('error', (e) => {
    if (!(e.target instanceof HTMLImageElement)) return;
    const host = e.target.closest('.tile, .g-cell, .link-thumb');
    if (host) host.classList.add('is-broken');
  }, true);

  $app.addEventListener('change', (e) => {
    if (e.target.dataset.field === 'item-name') renderBoard();
  });

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input, textarea, [contenteditable]');
    if (e.key === 'Escape') {
      if (typing && !state.linkModal) { e.target.blur(); return; }
      if (state.linkModal) return closeLinkModal();
      if (state.lightbox) return actions['close-lightbox']();
      if (state.drawer) return actions['close-drawer']();
      if (state.editItem) { state.editItem = false; return renderBoard(); }
      if (state.focusId) return closeFocus();
      if (state.clean) return toggleClean();
      return;
    }
    if (state.linkModal && e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target.matches('input[data-field="links"]'))) {
      e.preventDefault();
      const btn = $('[data-act="submit-links"]');
      if (btn && !btn.disabled) actions['submit-links'](btn);
      return;
    }
    if (typing || state.linkModal || state.view !== 'board' || Drag.isDragging()) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      return redo();
    }
    if (mod || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') return toggleClean();
    if (state.lightbox) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        state.lightbox.index += e.key === 'ArrowLeft' ? -1 : 1;
        renderLightbox();
      }
      return;
    }
    if (!state.focusId) return;
    if (e.key === 'ArrowLeft') return stepFocus(-1);
    if (e.key === 'ArrowRight') return stepFocus(1);
    if (/^[1-9]$/.test(e.key)) {
      const t = state.list.tiers[+e.key - 1];
      if (t) assignFocused(t.id);
    }
  });

  // ---------- paste & drop (files or image links) ----------
  document.addEventListener('paste', (e) => {
    if (state.view !== 'board' || state.linkModal || e.target.closest?.('input, textarea')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      if (state.focusId) addGalleryFiles(files);
      else addItemsFromFiles(files);
      return;
    }
    const links = parseLinks(e.clipboardData?.getData('text') || '');
    if (!links.length) return;
    e.preventDefault();
    addLinksWithToast(links, state.focusId ? 'gallery' : 'items');
  });

  // Dragging an image from another browser tab usually provides its URL rather than a file.
  function droppedLinks(dt) {
    const html = dt.getData('text/html');
    const img = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (img) return parseLinks(img[1].replace(/&amp;/g, '&'));
    return parseLinks(dt.getData('text/uri-list') || dt.getData('text/plain'));
  }

  const hasDropData = (e) => {
    const types = [...(e.dataTransfer?.types || [])];
    return types.includes('Files') || types.includes('text/uri-list');
  };
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!hasDropData(e) || state.view !== 'board') return;
    dragDepth++;
    document.documentElement.classList.add('file-over');
  });
  document.addEventListener('dragleave', (e) => {
    if (!hasDropData(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.documentElement.classList.remove('file-over');
  });
  document.addEventListener('dragover', (e) => {
    if (hasDropData(e)) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    if (!hasDropData(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.documentElement.classList.remove('file-over');
    if (state.view !== 'board') return;
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    const links = files.length ? [] : droppedLinks(e.dataTransfer);
    if (!files.length && !links.length) return;
    const tierEl = e.target.closest && e.target.closest(state.focusId ? '.tier' : '.zone');
    const zone = tierEl ? tierEl.dataset.zone : 'pool';
    if (state.focusId && !tierEl) {
      if (files.length) addGalleryFiles(files);
      else addLinksWithToast(links, 'gallery');
      return;
    }
    if (files.length) addItemsFromFiles(files, zone);
    else addLinksWithToast(links, 'items', zone);
  });

  // ---------- boot ----------
  Drag.init($app, {
    onClick: onTileClick,
    onDrop,
    tileSize: () => SIZES[state.list.settings.tileSize],
    scroller: () => (state.focusId ? $('.tiers') : $('.board')),
  });

  async function route() {
    const m = location.hash.match(/^#\/list\/(\w+)/);
    if (m) await openList(m[1]);
    else await showLibrary();
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

  async function init() {
    applyChrome();
    await gcImages().catch(() => {});
    route();
  }

  init();
})();
