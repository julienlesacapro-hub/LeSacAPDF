// Génère le logo et les icônes de l'application.
// Base : design/sac-source.jpg (illustration du sac) dont les coins noirs
// sont remplis par tools/fill-corners.py (-> design/sac-plein.png). On y ajoute un
// fichier PDF qui sort à moitié de l'ouverture du sac.
// Usage : python3 tools/fill-corners.py && node tools/make-icons.js
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const dir = path.join(__dirname, "..", "www", "icons");
const design = path.join(__dirname, "..", "design");
const src = "data:image/png;base64," + fs.readFileSync(path.join(design, "sac-plein.png")).toString("base64");

/* Bord supérieur du panneau avant du sac (mesuré sur l'image source, 1024 px) :
   tout ce qui est sous cette courbe repasse devant la feuille. */
const FRONT = "M290 427 Q512 489 734 427 L760 1024 L264 1024 Z";

const sheet = `
  <g transform="rotate(-6 512 330)">
    <path d="M392 150h184l56 56v300H392z" fill="#FFFFFF"/>
    <path d="M576 150v56h56z" fill="#D5DCE6"/>
    <rect x="421" y="215" width="198" height="92" rx="16" fill="#E5484D"/>
    <g transform="translate(421 215) scale(1.5) translate(-196 -134)" fill="none" stroke="#FFFFFF"
       stroke-width="9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M215 182v-34h12a10 10 0 0 1 0 20h-12"/>
      <path d="M251 182v-34h8a17 17 0 0 1 0 34z"/>
      <path d="M294 182v-34h18M294 164h14"/>
    </g>
    <g stroke="#C3CCD8" stroke-width="11" stroke-linecap="round">
      <path d="M420 350h180M420 386h140M420 422h170"/>
    </g>
  </g>`;

/* composition commune ; « clip » = coins arrondis de l'image source */
const art = `
  <defs>
    <clipPath id="front"><path d="${FRONT}"/></clipPath>
    <clipPath id="round"><rect x="0" y="0" width="1024" height="1024" rx="230"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1D3D63"/><stop offset=".5" stop-color="#1C3456"/><stop offset="1" stop-color="#182A45"/>
    </linearGradient>
    <filter id="feather"><feGaussianBlur stdDeviation="28"/></filter>
    <mask id="fade2"><rect x="14" y="14" width="996" height="996" rx="220" fill="#fff" filter="url(#feather)"/></mask>
    <mask id="fade"><rect x="40" y="40" width="944" height="944" rx="200" fill="#fff" filter="url(#feather)"/></mask>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  <g>
    <image href="${src}" width="1024" height="1024"/>
    <!-- ombre portée de la feuille sur la doublure -->
    <path d="M392 170h240v300H392z" transform="rotate(-6 512 330) translate(10 10)" fill="#000" opacity=".28" filter="url(#soft)"/>
    ${sheet}
    <!-- ombre de l'ouverture sur la feuille -->
    <path d="M300 418 Q512 480 724 418" fill="none" stroke="#5a3a1a" stroke-width="22" opacity=".35" filter="url(#soft)"/>
    <image href="${src}" width="1024" height="1024" clip-path="url(#front)"/>
  </g>`;

const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">';
const svg = (variant) => {
  if (variant === "rounded") return head + `<g clip-path="url(#round)">${art}</g></svg>`;
  if (variant === "full") return head + art.replace(/<g>[\s\S]*<\/g>\s*$/, "") +
    `<rect width="1024" height="1024" fill="url(#bg)"/><g mask="url(#fade2)">${art.replace(/<defs>[\s\S]*<\/defs>/, "")}</g></svg>`;
  /* maskable : le dessin tient dans la zone de sécurité (cercle de 80 %),
     sur un dégradé du même bleu, bords fondus */
  return head + art.replace(/<g>[\s\S]*<\/g>\s*$/, "") +
    `<rect width="1024" height="1024" fill="url(#bg)"/>
    <g transform="translate(512 512) scale(.84) translate(-512 -512)" mask="url(#fade)">${art.replace(/<defs>[\s\S]*<\/defs>/, "")}</g></svg>`;
};

const jobs = [
  ["rounded", 1024, "../../design/logo-1024.png"], ["rounded", 192, "icon-192.png"], ["rounded", 512, "icon-512.png"],
  ["rounded", 32, "favicon-32.png"], ["maskable", 192, "maskable-192.png"], ["maskable", 512, "maskable-512.png"],
  ["full", 180, "apple-touch-icon.png"], ["full", 1024, "../../design/icone-pleine-1024.png"]
];
(async () => {
  const b = await chromium.launch();
  for (const [v, size, out] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(v).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.waitForTimeout(50);
    await p.screenshot({ path: path.join(dir, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await p.close();
    console.log(out);
  }
  await b.close();
})();
