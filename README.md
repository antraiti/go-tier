# go-tier

A minimal, bold tier list maker built for video. Dark, flat, high-contrast, and out of the way so the list is the star.

**Live:** https://antraiti.github.io/go-tier/

Everything runs in the browser. There's no account and no server, and your lists are saved locally on your device.

## Features

- **Custom lists:** any number of lists, each with its own tiers.
- **Custom tiers:** rename, reorder, add, and remove tiers, and pick each tier's color (swatches, a custom color picker, or one-click palettes).
- **Drag and drop:** unranked items sit below the list; drag them into tiers or reorder within a tier.
- **Dashboard view:** click any item to open it big. The tiers collapse into a side rail and the main area shows the item's extra images. Drag the item's tile onto a tier (or press `1`–`9`) to rank it and return to the list.
- **Images by upload or link:** upload files, paste or drop images, or use image links (paste an image address, drag an image in from another tab, or add many at once with **+ Links**).
- **Clean mode for recording:** press `H` to hide every control.
- **Undo/redo** and **import/export** of lists as `.json`.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `H` | Toggle clean mode (hide UI) |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `1`–`9` | In dashboard view: rank the item into that tier |
| `←` / `→` | In dashboard view: previous / next item |
| `Esc` | Close dialog, dashboard view, or clean mode |
| `Ctrl+V` | Paste images or image links |

## Adding images

- **Upload:** use **+ Upload**, drop files onto the page, or paste an image from the clipboard.
- **Link:** use **+ Links** and paste one image link per line. To name an item, put the name before its link:

  ```
  McDonald's https://example.com/mcdonalds-logo.png
  Burger King https://example.com/bk-logo.png
  ```

  Use direct image links (right-click an image → **Copy image address**). Linked images load from the original site, so they need an internet connection and can break if that site removes them. Upload anything you can't afford to lose.

In the dashboard view, **Edit** lets you rename an item, change its tile image, choose fill or fit, and add or remove extra images.

## Where data lives

Lists and uploaded images are stored in your browser's IndexedDB, which means:

- Data is per browser and per site. Lists made from a local copy won't appear on the live site, and vice versa.
- Clearing site data in your browser deletes your lists.
- Use **Export** on the lists page (or in the **Tiers** panel) to back up a list or move it to another browser. Exports include uploaded images; linked images are saved as links.

## Running locally

No build step and no dependencies. Open `index.html` in a browser:

```powershell
start index.html
```

Or serve the folder if you prefer a local URL:

```powershell
python -m http.server 5173
# then open http://localhost:5173
```

## Deploying

The site is served by GitHub Pages straight from the `main` branch root. Every push to `main` redeploys automatically within a minute or two. `.nojekyll` tells Pages to serve the files as-is.

## Project structure

```
index.html      App shell
css/app.css     All styles
js/store.js     IndexedDB storage, image handling, import/export
js/demo.js      Sample "Fast Food" list created on first run
js/dnd.js       Pointer-based drag and drop
js/app.js       UI, state, and interactions
```
