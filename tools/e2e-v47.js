// Test de la version 4.7 : allègement (images seules, texte net), diaporama (défilement
// automatique, boucle, pointeur laser, chronomètre) et comparaison mot par mot.
// Les PDF allégés sont contrôlés par pdfinfo, pdffonts, pdfimages et pdftotext.
// Usage : node tools/serve.js 8765 &
//   node tools/e2e-v47.js <dossier fixtures> <dossier résultats> [android|iphone]
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const [F, outDir, devName] = process.argv.slice(2);
const dev = devName === "iphone"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1" }
  : devices["Pixel 7"];
const tag = devName || "android";
fs.mkdirSync(outDir, { recursive: true });
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("✓ " + m); };
const fx = n => path.join(F, n);
const run = (cmd, args) => execFileSync(cmd, args).toString();
const out = n => path.join(outDir, tag + "-v47-" + n);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, acceptDownloads: true, locale: "fr-FR" });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto("http://localhost:8765/"); await p.waitForFunction(() => window.__storeReady);
  const menu = async m => { await p.locator("#btnMenu").tap(); await p.waitForTimeout(300); await p.locator('#shMenu [data-m="' + m + '"]').tap(); };
  const open = async f => {
    await p.evaluate(() => { document.querySelector("#docTitle").textContent = ""; });
    await p.setInputFiles("#filePdf", f);
    await p.waitForFunction(() => document.querySelector("#docTitle").textContent && document.querySelectorAll(".page canvas").length > 0, null, { timeout: 30000 });
    await p.waitForTimeout(400);
  };

  /* ================= 1. allègement : images recompressées, texte intact */
  /* PDF lourd fabriqué dans le navigateur : photo JPEG 2400×1800, image PNG 1600×1200, texte */
  const heavy = await p.evaluate(async () => {
    const L = PDFLib, doc = await L.PDFDocument.create(), f = await doc.embedFont(L.StandardFonts.Helvetica);
    const photo = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#2a6"); g.addColorStop(1, "#c53"); x.fillStyle = g; x.fillRect(0, 0, w, h);
      const d = x.getImageData(0, 0, w, h); let s = 7;
      for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const n = (s % 60) - 30; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
      x.putImageData(d, 0, 0);
      for (let i = 0; i < 40; i++) { x.fillStyle = "hsl(" + i * 9 + ",60%,50%)"; x.beginPath(); x.arc((i * 397) % w, (i * 211) % h, 40 + (i * 13) % 120, 0, 7); x.fill(); }
      return c; };
    const blob = (c, t, q) => new Promise(r => c.toBlob(async bb => r(new Uint8Array(await bb.arrayBuffer())), t, q));
    const jpg = await doc.embedJpg(await blob(photo(2400, 1800), "image/jpeg", 0.95));
    const png = await doc.embedPng(await blob(photo(1600, 1200), "image/png"));
    for (let i = 0; i < 3; i++) {
      const pg = doc.addPage([595, 842]);
      pg.drawText("Rapport de test - page " + (i + 1), { x: 50, y: 790, size: 20, font: f });
      for (let l = 0; l < 12; l++) pg.drawText("Texte net numero " + (l + 1) + " : il doit rester selectionnable.", { x: 50, y: 760 - l * 16, size: 10, font: f });
      if (i === 0) pg.drawImage(jpg, { x: 50, y: 80, width: 495, height: 371 });
      if (i === 1) pg.drawImage(png, { x: 50, y: 80, width: 495, height: 371 });
    }
    return Array.from(await doc.save());
  });
  fs.writeFileSync(out("lourd.pdf"), Buffer.from(heavy));
  const save = async (name, targetMo, gray) => {
    await p.locator("#btnSave").tap(); await p.waitForTimeout(300);
    await p.locator('#saveFmt [data-f="pdf"]').tap();
    await p.locator('input[name=smode][value=small]').check();
    await p.locator("#saveTarget").fill(String(targetMo));
    await p.locator("#saveGray").setChecked(!!gray);
    await p.locator("#saveGo").tap();
    await p.waitForSelector("#saveDone:not([hidden])", { timeout: 180000 });
    const info = await p.locator("#doneInfo").textContent();
    const [d] = await Promise.all([p.waitForEvent("download"), p.locator("#doneDl").tap()]);
    const f = out(name); await d.saveAs(f);
    await p.locator("#doneClose").tap(); await p.waitForTimeout(400);
    return { f, info, size: fs.statSync(f).size };
  };
  await open(out("lourd.pdf"));
  const src = fs.statSync(out("lourd.pdf")).size;
  let r = await save("allege.pdf", 0.5);
  ok(r.size <= 0.5 * 1024 * 1024, "allègement : " + (src / 1048576).toFixed(2) + " Mo → " + Math.round(r.size / 1024) + " Ko (limite 0,5 Mo)");
  ok(/texte net/.test(r.info), "message : « " + r.info + " »");
  ok(/Helvetica/.test(run("pdffonts", [r.f])), "police conservée : texte toujours vectoriel (pdffonts)");
  ok(/Texte net numero 12/.test(run("pdftotext", [r.f, "-"])), "texte sélectionnable (pdftotext)");
  const imgs = run("pdfimages", ["-list", r.f]).split("\n").filter(l => /^\s+\d+\s+\d+\s+image/.test(l));
  ok(imgs.length === 2 && imgs.every(l => /jpeg/.test(l)), "les 2 images (JPEG et PNG d'origine) recompressées en JPEG (pdfimages)");
  r = await save("allege-gris.pdf", 0.5, true);
  ok(r.size <= 0.5 * 1024 * 1024 && /Helvetica/.test(run("pdffonts", [r.f])), "images en niveaux de gris : " + Math.round(r.size / 1024) + " Ko, texte vectoriel");

  /* dernier recours : contenu vectoriel trop lourd pour la limite → pages en images, signalé */
  const vect = await p.evaluate(async () => {
    const L = PDFLib, doc = await L.PDFDocument.create(), pg = doc.addPage([595, 842]);
    let s = 3; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 30000; i++) pg.drawLine({ start: { x: rnd() * 595, y: rnd() * 842 }, end: { x: rnd() * 595, y: rnd() * 842 }, thickness: 0.2 });
    return Array.from(await doc.save());
  });
  fs.writeFileSync(out("vectoriel.pdf"), Buffer.from(vect));
  await open(out("vectoriel.pdf"));
  r = await save("vectoriel-allege.pdf", 0.3);
  ok(r.size <= 0.3 * 1024 * 1024 && /converties en images/.test(r.info), "dernier recours signalé : « " + r.info + " »");

  /* ================= 2. diaporama */
  await open(fx("test.pdf"));
  await p.locator("#btnShow").tap();
  await p.waitForSelector("#pnShow.on #showStage canvas", { timeout: 15000 }); await p.waitForTimeout(400);
  const num = () => p.locator("#showNum").textContent();
  ok(await p.locator("#pnShow.chrome #showCtl").count() === 1, "commandes du diaporama affichées (lecture, durée, boucle, laser)");
  /* durée : 3 s */
  for (let k = 0; k < 8 && (await p.locator("#showDelay").textContent()) !== "3 s"; k++) { await p.locator("#showDelay").tap(); await p.waitForTimeout(80); }
  ok((await p.locator("#showDelay").textContent()) === "3 s", "durée par page réglée à 3 s");
  await p.locator("#showAuto").tap();
  ok(await p.locator("#showAuto").getAttribute("aria-pressed") === "true", "défilement automatique lancé");
  await p.waitForFunction(() => document.querySelector("#showNum").textContent === "2 / 3", null, { timeout: 5000 });
  ok(true, "page 2 affichée automatiquement après 3 s");
  await p.waitForFunction(() => document.querySelector("#showNum").textContent === "3 / 3", null, { timeout: 5000 });
  await p.waitForFunction(() => document.querySelector("#showAuto").getAttribute("aria-pressed") === "false", null, { timeout: 5000 });
  ok(/Fin du diaporama/.test(await p.locator("#showMsg").textContent()), "dernière page : défilement arrêté, « Fin du diaporama »");
  ok(/^0:0[5-9]$|^0:1\d$/.test(await p.locator("#showClock").textContent()), "chronomètre : « " + await p.locator("#showClock").textContent() + " »");
  /* boucle */
  await p.locator("#showStage").click({ position: { x: 200, y: 400 } }).catch(() => {});
  await p.evaluate(() => document.querySelector("#pnShow").classList.add("chrome"));
  await p.locator("#showLoop").tap(); await p.locator("#showAuto").tap();
  await p.waitForFunction(() => document.querySelector("#showNum").textContent === "1 / 3", null, { timeout: 5000 });
  ok(true, "boucle : retour à la page 1 après la dernière");
  await p.keyboard.press("a"); await p.waitForTimeout(200);
  ok(await p.locator("#showAuto").getAttribute("aria-pressed") === "false", "touche A : pause");
  /* pointeur laser */
  await p.locator("#showLaser").tap(); await p.waitForTimeout(200);
  ok(await p.locator("#pnShow.laser").count() === 1, "pointeur laser activé");
  const vp = p.viewportSize(), before = await num();
  await p.mouse.move(vp.width * 0.8, vp.height * 0.5); await p.mouse.down();
  await p.mouse.move(vp.width * 0.6, vp.height * 0.45, { steps: 8 });
  const lit = await p.evaluate(() => { const c = document.querySelector("#showLaserCv"), x = c.getContext("2d");
    const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 3] > 100) n++; return n; });
  await p.mouse.up(); await p.waitForTimeout(300);
  ok(lit > 50, "le point laser suit le doigt (" + lit + " pixels rouges dessinés)");
  await p.locator("#showStage").click({ position: { x: vp.width * 0.72, y: vp.height * 0.3 } });
  await p.waitForTimeout(400);
  ok((await num()) === before, "laser actif : toucher la page ne change pas de page");
  await p.keyboard.press("l"); await p.waitForTimeout(200);
  ok(await p.locator("#pnShow.laser").count() === 0, "touche L : laser désactivé");
  await p.keyboard.press("b"); await p.waitForTimeout(150);
  ok(await p.locator("#showBlack").isVisible(), "touche B : écran noir");
  await p.keyboard.press("b");
  await p.keyboard.press("Escape"); await p.waitForTimeout(600);
  ok(await p.locator("#pnShow.on").count() === 0, "quitter le diaporama");

  /* ================= 3. comparaison mot par mot */
  await open(fx("cmp-a.pdf"));
  await menu("compare");
  await p.waitForSelector("#pnCmp.on");
  await p.setInputFiles("#fileCmp", fx("cmp-b.pdf"));
  await p.waitForSelector(".cmp-row", { timeout: 30000 }); await p.waitForTimeout(600);
  ok(/^6 différences/.test(await p.locator("#cmpCount").textContent()),
    "6 différences trouvées (« " + await p.locator("#cmpCount").textContent() + " »), le paragraphe inséré ne décale rien");
  await p.locator("#cmpListBtn").tap(); await p.waitForTimeout(200);
  const list = (await p.locator("#cmpList li").allTextContents()).map(t => t.replace(/\s+/g, " ").trim());
  const has = re => list.some(t => re.test(t));
  ok(has(/Port-Cros\. → Porquerolles\./), "mot remplacé : « Port-Cros. → Porquerolles. »");
  ok(has(/^p\. 1 15 → 12$/), "chiffre changé dans une phrase : « 15 → 12 » (le reste de la ligne n'est pas signalé)");
  ok(has(/supprimé : courant faible,/), "mots supprimés : « courant faible, »");
  ok(has(/ajouté : Retour au port à 17 h\./), "mots ajoutés en fin de phrase");
  ok(has(/ajouté : Paragraphe ajouté/), "paragraphe ajouté");
  ok(has(/p\. 2 très réussie, → satisfaisante,/), "page 2 : « très réussie, → satisfaisante, »");
  ok(await p.locator(".cmp-hl.del:not(.line)").count() >= 4 && await p.locator(".cmp-hl.add:not(.line)").count() >= 10,
    "mots surlignés sur les pages (A : " + await p.locator(".cmp-hl.del:not(.line)").count() + ", B : " + await p.locator(".cmp-hl.add:not(.line)").count() + ")");
  await p.locator("#cmpList li").nth(5).tap(); await p.waitForTimeout(600);
  ok(/Différence 6 sur 6/.test(await p.locator("#cmpCount").textContent()), "toucher une ligne de la liste : aller à la différence");
  await p.locator("#pnCmp [data-pclose]").tap(); await p.waitForTimeout(400);

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
