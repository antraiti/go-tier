'use strict';

// Pointer-based drag & drop. Sources: `.tile[data-id]` (in zones) and `[data-hero]` (focus stage).
// Zones: elements with `.zone[data-zone]` containing a `.tier-items` container.
const Drag = (() => {
  const THRESHOLD = 6;
  let s = null;
  let cb = {};

  function init(root, callbacks) {
    cb = callbacks;
    root.addEventListener('pointerdown', onDown);
  }

  function onDown(e) {
    if (e.button !== 0 || s) return;
    if (e.target.closest('button, input, [data-nodrag]')) return;
    const src = e.target.closest('.tile[data-id], [data-hero]');
    if (!src) return;
    e.preventDefault();
    s = {
      src,
      id: src.dataset.id || src.dataset.hero,
      isHero: src.hasAttribute('data-hero'),
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      started: false, target: null, raf: 0,
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function begin() {
    const r = s.src.getBoundingClientRect();
    const ghost = s.src.cloneNode(true);
    ghost.removeAttribute('data-id');
    ghost.removeAttribute('data-hero');
    ghost.classList.add('ghost');
    ghost.style.viewTransitionName = 'none';
    let w = r.width, h = r.height;
    if (s.isHero) {
      const tile = cb.tileSize();
      w = h = Math.min(r.width, tile * 1.2);
    }
    ghost.style.width = w + 'px';
    ghost.style.height = h + 'px';
    s.offX = s.isHero ? w / 2 : s.x0 - r.left;
    s.offY = s.isHero ? h / 2 : s.y0 - r.top;
    document.body.appendChild(ghost);
    s.ghost = ghost;

    s.ph = document.createElement('div');
    s.ph.className = 'tile is-placeholder';
    if (s.isHero) {
      s.src.classList.add('is-lifted');
    } else {
      s.src.parentNode.insertBefore(s.ph, s.src);
      s.src.classList.add('is-hidden');
      const zone = s.src.closest('.zone');
      s.target = { zone: zone.dataset.zone, index: indexIn(zone, s.ph) };
      zone.classList.add('is-over');
    }
    document.body.classList.add('is-dragging');
    s.started = true;
    loop();
  }

  function tilesOf(container) {
    return [...container.querySelectorAll(':scope > .tile[data-id]:not(.is-hidden)')];
  }

  function indexIn(zone, el) {
    const container = zone.querySelector('.tier-items');
    let i = 0;
    for (const child of container.children) {
      if (child === el) return i;
      if (child.matches('.tile[data-id]:not(.is-hidden)')) i++;
    }
    return i;
  }

  function computeIndex(container, x, y) {
    const tiles = tilesOf(container);
    for (let i = 0; i < tiles.length; i++) {
      const r = tiles[i].getBoundingClientRect();
      if (y < r.top) return i;
      if (y <= r.bottom && x < r.left + r.width / 2) return i;
    }
    return tiles.length;
  }

  function update() {
    s.ghost.style.transform = `translate(${s.x - s.offX}px, ${s.y - s.offY}px)`;
    const el = document.elementFromPoint(s.x, s.y);
    const zone = el && el.closest('.zone');
    const prev = document.querySelector('.zone.is-over');
    if (zone) {
      const container = zone.querySelector('.tier-items');
      const index = computeIndex(container, s.x, s.y);
      const tiles = tilesOf(container);
      const ref = tiles[index] || null;
      if (s.ph.parentNode !== container || s.ph.nextElementSibling !== ref) {
        if (ref) container.insertBefore(s.ph, ref);
        else container.appendChild(s.ph);
      }
      s.target = { zone: zone.dataset.zone, index };
      if (prev !== zone) {
        if (prev) prev.classList.remove('is-over');
        zone.classList.add('is-over');
      }
    } else if (s.isHero) {
      s.ph.remove();
      s.target = null;
      if (prev) prev.classList.remove('is-over');
    }
  }

  function loop() {
    if (!s || !s.started) return;
    const sc = cb.scroller && cb.scroller();
    if (sc) {
      const r = sc.getBoundingClientRect();
      const edge = 70;
      let dy = 0;
      if (s.y < r.top + edge) dy = -Math.ceil((r.top + edge - s.y) / 4);
      else if (s.y > r.bottom - edge) dy = Math.ceil((s.y - (r.bottom - edge)) / 4);
      if (dy) sc.scrollTop += dy;
    }
    update();
    s.raf = requestAnimationFrame(loop);
  }

  function onMove(e) {
    s.x = e.clientX;
    s.y = e.clientY;
    if (!s.started && Math.hypot(s.x - s.x0, s.y - s.y0) > THRESHOLD) begin();
  }

  function teardown() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    cancelAnimationFrame(s.raf);
    document.body.classList.remove('is-dragging');
    document.querySelectorAll('.zone.is-over').forEach((z) => z.classList.remove('is-over'));
    s = null;
  }

  function onUp() {
    const cur = s;
    if (!cur.started) {
      teardown();
      cb.onClick(cur.id, cur.src);
      return;
    }
    cur.started = false;
    teardown();
    swallowClick();
    if (cur.target) {
      cb.onDrop(cur.id, cur.target.zone, cur.target.index, cur.ghost);
    } else {
      flyBack(cur);
    }
  }

  // Browsers dispatch a click on the common ancestor after a drag; ignore it.
  function swallowClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  }

  function onCancel() {
    const cur = s;
    cur.started = false;
    teardown();
    if (cur.ghost) flyBack(cur);
  }

  function flyBack(cur) {
    cur.ph && cur.ph.remove();
    if (!cur.ghost) return;
    const r = cur.src.getBoundingClientRect();
    const from = cur.ghost.style.transform;
    const anim = cur.ghost.animate(
      [{ transform: from }, { transform: `translate(${r.left}px, ${r.top}px)`, width: r.width + 'px', height: r.height + 'px' }],
      { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    anim.onfinish = () => {
      cur.ghost.remove();
      cur.src.classList.remove('is-lifted', 'is-hidden');
    };
  }

  return { init, isDragging: () => !!(s && s.started) };
})();
