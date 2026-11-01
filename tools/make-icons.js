// Génère les icônes PNG de l'application à partir de www/icons/logo.svg.
// Usage : node tools/make-icons.js   (nécessite Playwright + Chromium)
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const dir = path.join(__dirname, "..", "www", "icons");
const src = fs.readFileSync(path.join(dir, "logo.svg"), "utf8");

// fond plein (iOS et Android appliquent leur propre masque)
const full = src.replace('rx="112"', 'rx="0"');
// variante « maskable » : le dessin tient dans la zone de sécurité (cercle de 80 %)
const mask = full.replace('<g id="mark">', '<g id="mark" transform="translate(256 262) scale(.8) translate(-256 -258)">');
fs.writeFileSync(path.join(dir, "logo-full.svg"), full);
fs.writeFileSync(path.join(dir, "logo-maskable.svg"), mask);

const jobs = [
  ["logo.svg", 192, "icon-192.png"], ["logo.svg", 512, "icon-512.png"],
  ["logo-maskable.svg", 192, "maskable-192.png"], ["logo-maskable.svg", 512, "maskable-512.png"],
  ["logo-full.svg", 180, "apple-touch-icon.png"], ["logo.svg", 32, "favicon-32.png"],
  ["logo-full.svg", 1024, "icon-1024.png"], ["logo-maskable.svg", 1024, "maskable-1024.png"]
];
(async () => {
  const b = await chromium.launch();
  for (const [file, size, out] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const svg = fs.readFileSync(path.join(dir, file), "utf8");
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: path.join(dir, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await p.close();
    console.log(out);
  }
  await b.close();
})();
