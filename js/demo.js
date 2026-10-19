'use strict';

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

const Demo = (() => {
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svgBlob = (svg) => new Blob([svg], { type: 'image/svg+xml' });

  function lines(text, max) {
    if (text.length <= max) return [text];
    const words = text.split(' ');
    const out = [];
    let cur = '';
    words.forEach((w) => {
      if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else { cur = cur ? cur + ' ' + w : w; }
    });
    if (cur) out.push(cur);
    return out;
  }

  function textBlock(text, cx, cy, size, fill, max) {
    const ls = lines(text.toUpperCase(), max);
    const lh = size * 0.95;
    const top = cy - ((ls.length - 1) * lh) / 2;
    return ls.map((l, i) => `<text x="${cx}" y="${top + i * lh}" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="${size}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${xml(l)}</text>`).join('');
  }

  function logo(name, bg, fg) {
    const longest = Math.max(...lines(name.toUpperCase(), 9).map((l) => l.length));
    const size = Math.min(150, 520 / Math.max(longest, 3));
    return svgBlob(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="${bg}"/><rect x="40" y="40" width="432" height="432" fill="none" stroke="${fg}" stroke-width="10" opacity=".35"/>${textBlock(name, 256, 256, size, fg, 9)}</svg>`);
  }

  function photo(label, bg, fg, i) {
    const shapes = [
      `<circle cx="1000" cy="160" r="260" fill="${fg}" opacity=".18"/>`,
      `<rect x="760" y="420" width="520" height="520" fill="${fg}" opacity=".16" transform="rotate(18 1000 680)"/>`,
      `<circle cx="180" cy="720" r="300" fill="${fg}" opacity=".14"/>`,
      `<rect x="-80" y="-80" width="420" height="420" fill="${fg}" opacity=".14" transform="rotate(-12 130 130)"/>`,
    ];
    const longest = Math.max(...lines(label.toUpperCase(), 14).map((l) => l.length));
    const size = Math.min(150, 1250 / Math.max(longest, 6));
    return svgBlob(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800"><rect width="1200" height="800" fill="${bg}"/>${shapes[i % shapes.length]}${textBlock(label, 600, 400, size, fg, 14)}</svg>`);
  }

  const shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
  };

  const DATA = [
    ["McDonald's", '#DA291C', '#FFC72C', ['Big Mac', 'Fries', 'McNuggets', 'McFlurry']],
    ['Burger King', '#F5EBDC', '#D62300', ['Whopper', 'Onion Rings', 'Chicken Fries']],
    ["Wendy's", '#E2203D', '#FFFFFF', ['Baconator', 'Frosty', 'Spicy Nuggets']],
    ['Taco Bell', '#702082', '#FFFFFF', ['Crunchwrap', 'Baja Blast', 'Cheesy Gordita Crunch', 'Nachos Bell Grande', 'Chalupa']],
    ['Chick-fil-A', '#E51636', '#FFFFFF', ['Chicken Sandwich', 'Waffle Fries', 'Nuggets']],
    ['Five Guys', '#C8102E', '#FFFFFF', ['Cheeseburger', 'Cajun Fries']],
    ['In-N-Out', '#FFFFFF', '#E32C2C', ['Double-Double', 'Animal Fries']],
    ['Popeyes', '#F26722', '#FFFFFF', ['Chicken Sandwich', 'Biscuits', 'Red Beans']],
    ['KFC', '#A3080C', '#FFFFFF', ['Bucket', 'Famous Bowl']],
    ['Subway', '#008C15', '#FFC600', ['Footlong', 'Cookies']],
    ['Shake Shack', '#1F1F1F', '#6CB33F', ['ShackBurger', 'Crinkle Fries', 'Black & White Shake']],
    ["Arby's", '#D71921', '#FFFFFF', ['Roast Beef', 'Curly Fries']],
  ];

  async function seed() {
    const list = newList('Fast Food');
    for (const [name, bg, fg, foods] of DATA) {
      const image = uid('m');
      await Store.putImage(image, logo(name, bg, fg));
      const gallery = [];
      for (let i = 0; i < foods.length; i++) {
        const id = uid('m');
        const base = bg === '#FFFFFF' || bg === '#F5EBDC' ? fg : bg;
        await Store.putImage(id, photo(foods[i], shade(base, i % 2 ? -0.35 : -0.15), '#FFFFFF', i));
        gallery.push(id);
      }
      const item = { id: uid('i'), name, image, gallery, fit: 'cover' };
      list.items[item.id] = item;
    }
    const ids = Object.keys(list.items);
    const byName = (n) => ids.find((id) => list.items[id].name === n);
    const placed = { 0: ['In-N-Out', 'Chick-fil-A'], 1: ['Five Guys', 'Popeyes'], 2: ["Wendy's"], 4: ['Subway'] };
    Object.entries(placed).forEach(([ti, names]) => { list.tiers[ti].items = names.map(byName); });
    const used = new Set(Object.values(placed).flat().map(byName));
    list.pool = ids.filter((id) => !used.has(id));
    await Store.putList(list);
    return list;
  }

  return { seed };
})();
