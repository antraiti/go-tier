'use strict';

const uid = (prefix) => prefix + Math.random().toString(36).slice(2, 10);

const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('gotier', 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('lists', { keyPath: 'id' });
          d.createObjectStore('images', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  return {
    getAllLists: () => tx('lists', 'readonly', (s) => s.getAll()),
    getList: (id) => tx('lists', 'readonly', (s) => s.get(id)),
    putList: (list) => tx('lists', 'readwrite', (s) => { s.put(list); }),
    deleteList: (id) => tx('lists', 'readwrite', (s) => { s.delete(id); }),
    getImage: (id) => tx('images', 'readonly', (s) => s.get(id)),
    getImageKeys: () => tx('images', 'readonly', (s) => s.getAllKeys()),
    putImage: (id, blob) => tx('images', 'readwrite', (s) => { s.put({ id, blob }); }),
    deleteImages: (ids) => tx('images', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); }),
  };
})();

const Store = DB;

const PALETTES = {
  Heat: ['#FF2E4D', '#FF8A1F', '#FFD21F', '#3DDC84', '#2FA8FF', '#9B5CFF'],
  Neon: ['#FF00A8', '#FF5E00', '#FFE600', '#00FF85', '#00D1FF', '#7A5CFF'],
  Classic: ['#FF7F7F', '#FFBF7F', '#FFDF7F', '#FFFF7F', '#BFFF7F', '#7FFF7F'],
  Mono: ['#FFFFFF', '#D4D4D4', '#A3A3A3', '#737373', '#525252', '#3A3A3A'],
  Ice: ['#E6F4FF', '#9ED8FF', '#4DB4FF', '#1F7AFF', '#2A3FCC', '#1B1F66'],
};

function newList(title = 'Untitled list') {
  const names = ['S', 'A', 'B', 'C', 'D', 'F'];
  return {
    id: uid('l'),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tiers: names.map((name, i) => ({ id: uid('r'), name, color: PALETTES.Heat[i], items: [] })),
    pool: [],
    items: {},
    settings: { tileSize: 'M', showNames: false },
  };
}

// Image refs are either IndexedDB blob ids or direct links (http/https/data URLs).
const isLink = (ref) => /^(https?:|data:image\/)/i.test(ref || '');

const Images = {
  urls: new Map(),
  url(id) {
    if (isLink(id)) return id;
    return (id && this.urls.get(id)) || '';
  },
  async preload(ids) {
    const missing = [...new Set(ids)].filter((id) => id && !isLink(id) && !this.urls.has(id));
    await Promise.all(missing.map(async (id) => {
      const rec = await Store.getImage(id);
      if (rec) this.urls.set(id, URL.createObjectURL(rec.blob));
    }));
  },
  async addBlob(blob, id = uid('m')) {
    await Store.putImage(id, blob);
    this.urls.set(id, URL.createObjectURL(blob));
    return id;
  },
  async fromFile(file, maxDim) {
    return this.addBlob(await downscale(file, maxDim));
  },
};

async function downscale(file, maxDim) {
  if (/svg|gif/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    if (scale >= 1 && file.size < 1.5e6) {
      bmp.close();
      return file;
    }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const out = await new Promise((r) => c.toBlob(r, 'image/webp', 0.9));
    return out || file;
  } catch {
    return file;
  }
}

function listImageIds(list) {
  const ids = [];
  Object.values(list.items).forEach((it) => {
    if (it.image) ids.push(it.image);
    ids.push(...it.gallery);
  });
  return ids;
}

// Images are never deleted eagerly (keeps undo safe); orphans are swept on startup.
async function gcImages() {
  const lists = await Store.getAllLists();
  const used = new Set(lists.flatMap(listImageIds));
  const keys = await Store.getImageKeys();
  const orphans = keys.filter((k) => !used.has(k));
  if (orphans.length) await Store.deleteImages(orphans);
}

const blobToDataURL = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function exportListJSON(list) {
  const images = {};
  for (const id of new Set(listImageIds(list).filter((x) => !isLink(x)))) {
    const rec = await Store.getImage(id);
    if (rec) images[id] = await blobToDataURL(rec.blob);
  }
  return JSON.stringify({ format: 'gotier', version: 1, list, images });
}

async function importListJSON(text) {
  const data = JSON.parse(text);
  if (data.format !== 'gotier' || !data.list) throw new Error('Not a gotier export');
  for (const [id, dataUrl] of Object.entries(data.images || {})) {
    const blob = await (await fetch(dataUrl)).blob();
    await Store.putImage(id, blob);
  }
  const list = data.list;
  if (await Store.getList(list.id)) list.id = uid('l');
  list.updatedAt = Date.now();
  await Store.putList(list);
  return list;
}
