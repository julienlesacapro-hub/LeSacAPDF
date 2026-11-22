// Test des fonctions de la version 4.0 sur téléphone émulé (Chromium).
// Usage : node tools/serve.js 8765 &
//   node tools/e2e-v4.js <test.pdf> <testB.pdf> <photo.jpg> <image.png> <page.html> <doc.docx> <doc.odt> <dossier> [android|iphone]
// Les fichiers produits sont enregistrés dans <dossier> pour être vérifiés par des outils indépendants.
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const [pdfA, pdfB, photo, png, html, docx, odt, outDir, devName] = process.argv.slice(2);
const dev = devName === "iphone"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" }
  : devices["Pixel 7"];
const tag = devName || "android";
fs.mkdirSync(outDir, { recursive: true });
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("✓ " + m); };
const shot = (p, n) => p.screenshot({ path: path.join(outDir, tag + "-v4-" + n + ".png") });
const txt = (f, a) => execFileSync("pdftotext", (a || []).concat([f, "-"])).toString();
/* contenu décompressé de tous les flux d'un PDF (pour chercher un texte dessiné) */
const zlib = require("zlib");
const pdfStreams = f => {
  const buf = fs.readFileSync(f), s = buf.toString("latin1"), re = /stream\r?\n/g; let m, out = "";
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf("endstream", start);
    if (end < 0) break;
    const raw = buf.subarray(start, end);
    try { out += zlib.inflateSync(raw).toString("latin1"); } catch (e) { out += raw.toString("latin1"); }
  }
  return out;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, acceptDownloads: true, locale: "fr-FR" });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error" && !/ERR_FILE_NOT_FOUND|favicon/.test(m.text())) errors.push(m.text()); });
  p.on("dialog", d => { errors.push("boîte de dialogue inattendue : " + d.message()); d.dismiss(); });
  const menu = async m => { await p.locator("#btnMenu").tap(); await p.waitForTimeout(300); await p.locator('#shMenu [data-m="' + m + '"]').tap(); await p.waitForTimeout(350); };
  const save = async (fmt, setup, name) => {
    await p.locator("#btnSave").tap(); await p.waitForTimeout(300);
    await p.locator('#saveFmt [data-f="' + fmt + '"]').tap();
    if (setup) await setup();
    await p.locator("#saveGo").tap();
    await p.waitForSelector("#saveDone:not([hidden])", { timeout: 90000 });
    const info = await p.locator("#doneInfo").textContent();
    const [d] = await Promise.all([p.waitForEvent("download"), p.locator("#doneDl").tap()]);
    const f = path.join(outDir, tag + "-" + name); await d.saveAs(f);
    await p.locator("#doneClose").tap(); await p.waitForTimeout(400);
    return { f, info };
  };
  const open = async f => { await p.setInputFiles("#filePdf", f); await p.waitForFunction(() => document.querySelectorAll(".page").length > 0); await p.waitForTimeout(600); };

  await p.goto("http://localhost:8765/");
  await open(pdfA);

  // --- filigrane
  await p.locator('.tool[data-act=wm]').tap();
  await p.waitForSelector("#shWm.on"); await p.waitForTimeout(300);
  await p.locator("#wmPresets button", { hasText: "Usage exclusivement" }).tap();
  await p.selectOption("#wmPos", "diag");
  await p.locator("#wmOpacity").fill("30");
  await p.waitForTimeout(300);
  await shot(p, "1-filigrane-reglages");
  await p.locator("#wmApply").tap(); await p.waitForTimeout(400);
  ok(await p.locator(".wmk").count() === 3, "filigrane : aperçu sur les 3 pages");
  await shot(p, "2-filigrane-apercu");
  let r = await save("pdf", null, "filigrane.pdf");
  /* pdftotext ignore le texte en diagonale : on cherche le texte (codé en hexadécimal) dans le contenu des pages */
  ok(pdfStreams(r.f).includes(Buffer.from("Usage exclusivement", "latin1").toString("hex").toUpperCase()),
    "filigrane présent dans le PDF enregistré");

  // --- chiffrement (avec le filigrane)
  r = await save("pdf", async () => {
    await p.locator("#encOn").check(); await p.locator("#encPwd").fill("Plongee2026!"); await p.locator("#encPwd2").fill("Plongee2026!");
    await shot(p, "3-mot-de-passe");
  }, "chiffre.pdf");
  ok(/AES-256/.test(r.info), "chiffrement : " + r.info);
  await p.locator("#btnSave").tap(); await p.waitForTimeout(300); await p.locator("#encOn").uncheck(); await p.locator("#saveForm [data-close]").tap(); await p.waitForTimeout(300);

  // --- formats PDF/A, PowerPoint (2 modes), Excel
  r = await save("pdfa", null, "pdfa.pdf"); ok(/PDF\/A-2b/.test(r.info), "PDF/A : " + r.info);
  r = await save("pptx", null, "images.pptx"); ok(/PowerPoint/.test(r.info), "PowerPoint (images) : " + r.info);
  r = await save("pptx", async () => p.locator('input[name=pptMode][value=text]').check(), "texte.pptx"); ok(true, "PowerPoint (texte) : " + r.info);
  r = await save("xlsx", null, "tableau.xlsx"); ok(/feuille/.test(r.info), "Excel : " + r.info);

  // --- censure : rectangle sur la ligne 3 de la page 1, puis résultats de recherche « numéro 12 »
  await p.locator('#shWm').evaluate(() => {});
  await menu("wm"); await p.locator("#wmRemove").tap(); await p.waitForTimeout(300);
  await p.locator('.tool[data-tool=redact]').tap();
  const page1 = p.locator(".page").first(), lb = await page1.locator(".layer").boundingBox();
  const k = lb.width / 595, y3 = (842 - 720 + 2 * 24) * k;   /* ligne 3 : y PDF = 720 - 2*24 */
  await p.mouse.move(lb.x + 45 * k, lb.y + y3 - 12 * k); await p.mouse.down();
  await p.mouse.move(lb.x + 400 * k, lb.y + y3 + 4 * k, { steps: 6 }); await p.mouse.up();
  ok(await p.locator(".item.redact").count() === 1, "censure : zone noire tracée");
  await p.locator("#btnSearch").tap(); await p.locator("#searchInput").fill("numéro 12");
  await p.waitForFunction(() => /\/ 3$/.test(document.querySelector("#searchCount").textContent), null, { timeout: 8000 });
  await p.locator("#searchRedact").tap(); await p.waitForTimeout(300);
  ok(await p.locator(".item.redact").count() === 4, "censure : 3 résultats de recherche noircis");
  await shot(p, "4-censure");
  await p.locator("#searchClose").tap();
  r = await save("pdf", null, "censure.pdf");
  const t = txt(r.f);
  ok(!/numéro 12/.test(t) && !/numéro 3 du/.test(t), "censure définitive : texte supprimé du PDF (pdftotext)");
  ok(execFileSync("pdfinfo", [r.f]).toString().includes("Pages:           3"), "censure : 3 pages conservées");

  // --- comparaison avec la version B
  /* on annule les censures (le document redevient identique à l'original) */
  for (let k2 = 0; k2 < 6 && await p.locator(".item.redact").count(); k2++) { await p.locator("#btnUndo").tap(); await p.waitForTimeout(150); }
  ok(await p.locator(".item.redact").count() === 0, "annuler : censures retirées avant enregistrement");
  await menu("compare");
  await p.waitForSelector("#pnCmp.on").catch(async e => { await shot(p, "erreur-comparaison"); throw e; });
  await p.setInputFiles("#fileCmp", pdfB);
  await p.waitForSelector(".cmp-row", { timeout: 30000 }).catch(async e => { await shot(p, "erreur-comparaison"); throw e; });
  await p.waitForTimeout(800);
  const cnt = await p.locator("#cmpCount").textContent();
  ok(/1 différence/.test(cnt) && await p.locator(".cmp-hl.del").count() === 1 && await p.locator(".cmp-hl.add").count() === 1,
    "comparaison texte : « " + cnt + " », ligne modifiée surlignée des deux côtés");
  await p.locator("#cmpNext").tap(); await p.waitForTimeout(500);
  await shot(p, "5-comparaison-texte");
  await p.locator('#cmpMode [data-m=visual]').tap(); await p.waitForTimeout(1500);
  await shot(p, "6-comparaison-visuelle");
  await p.locator("#pnCmp [data-pclose]").tap(); await p.waitForTimeout(400);

  // --- conversion vers PDF : images, HTML, Word, ODT
  const conv = async (files, label, minPages) => {
    await menu("convert");
    await p.waitForSelector("#shConv.on");
    await p.setInputFiles("#fileConv", files);
    await p.waitForFunction(n => document.querySelectorAll(".page").length >= n && !document.querySelector("#spin.on") && !document.querySelector("#shConv.on"), minPages, { timeout: 60000 });
    await p.waitForTimeout(900);
    const n = await p.locator(".page").count();
    ok(n >= minPages, "conversion " + label + " : " + n + " page(s) — « " + await p.locator("#docTitle").textContent() + " »");
    await shot(p, "7-conversion-" + label);
  };
  await conv([photo, png], "images", 2);
  await conv([html], "html", 1);
  await conv([docx], "word", 1);
  await conv([odt], "odt", 1);
  /* PowerPoint : on reconvertit la présentation « texte » produite plus haut (3 diapositives) */
  await conv([path.join(outDir, tag + "-texte.pptx")], "powerpoint", 3);
  /* anciens formats Office 97-2003 (chemins facultatifs : variables OLD_DOC et OLD_PPT) */
  if (process.env.OLD_DOC) await conv([process.env.OLD_DOC], "word-97", 1);
  if (process.env.OLD_PPT) await conv([process.env.OLD_PPT], "powerpoint-97", 3);
  /* fichier .doc invalide : message explicite, pas de plantage */
  const badDoc = path.join(outDir, "invalide.doc"); fs.writeFileSync(badDoc, "ceci n'est pas un fichier Word");
  await menu("convert"); await p.waitForSelector("#shConv.on");
  await p.setInputFiles("#fileConv", badDoc); await p.waitForTimeout(1500);
  ok(/Aucun fichier n'a pu être converti/.test(await p.locator("#toast").textContent()), "fichier .doc invalide : message explicite");

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
