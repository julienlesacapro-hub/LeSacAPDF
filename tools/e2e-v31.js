// Test des fonctions de la version 3.1 sur téléphone émulé (Chromium).
// Usage : node tools/serve.js 8765 &
//         node tools/e2e-v31.js <test.pdf (3 pages)> <annexe.pdf (2 pages)> <photo.jpg> <dossier> [android|iphone]
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const [pdfA, pdfB, photo, outDir, devName] = process.argv.slice(2);
const dev = devName === "iphone"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" }
  : devices["Pixel 7"];
const tag = devName || "android";
fs.mkdirSync(outDir, { recursive: true });
const shot = (p, n) => p.screenshot({ path: path.join(outDir, tag + "-v31-" + n + ".png") });
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("✓ " + m); };
const pdfText = f => execFileSync("pdftotext", ["-layout", f, "-"]).toString();
const pages = f => +/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [f]).toString())[1];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, acceptDownloads: true, locale: "fr-FR" });
  await ctx.addInitScript(() => {
    delete window.showSaveFilePicker;
    window.print = () => { window.__printed = document.querySelectorAll("#printArea img").length; };
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const menu = async m => { await p.locator("#btnMenu").tap(); await p.waitForTimeout(300); await p.locator('#shMenu [data-m="' + m + '"]').tap(); };
  const dl = async (name) => {
    const [d] = await Promise.all([p.waitForEvent("download"), p.locator("#doneDl").tap()]);
    const f = path.join(outDir, tag + "-" + name + ".pdf"); await d.saveAs(f); return f;
  };
  const tile = i => p.locator("#orgGrid .otile").nth(i);
  const tapTile = i => tile(i).click({ position: { x: 20, y: 50 } });

  await p.goto("http://localhost:8765/");
  ok((await p.locator(".owner").textContent()).includes("© 2026 LESACA Julien"), "mention © 2026 LESACA Julien");
  await p.setInputFiles("#filePdf", pdfA);
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 3);
  await p.waitForTimeout(600);
  const page1 = p.locator(".page").first(), bb = await page1.boundingBox();

  // --- tampon
  await p.locator('.tool[data-act=stamp]').tap();
  await p.waitForSelector("#shStamps.on"); await p.waitForTimeout(300);
  await shot(p, "1-tampons");
  await p.locator("#stampList .stampbtn").first().tap();
  await p.waitForTimeout(350);
  await page1.locator(".layer").tap({ position: { x: bb.width * 0.7, y: bb.height * 0.9 } });
  ok(await p.locator(".item.stamp").count() === 1, "tampon « Lu et approuvé » daté posé");
  await p.locator('#ctxBar [data-a=bigger]').tap();
  await shot(p, "2-tampon-pose");

  // --- recherche
  await p.locator("#btnSearch").tap();
  await p.locator("#searchInput").fill("numéro 12");
  await p.waitForFunction(() => /\/ 3$/.test(document.querySelector("#searchCount").textContent), null, { timeout: 8000 });
  ok(await p.locator(".hit").count() >= 1, "recherche : 3 résultats (« " + await p.locator("#searchCount").textContent() + " »)");
  await p.locator("#searchNext").tap();
  ok((await p.locator("#searchCount").textContent()).startsWith("2 /"), "recherche : résultat suivant");
  await shot(p, "3-recherche");
  await p.locator("#searchInput").fill("numero 12");   // sans accent
  await p.waitForFunction(() => /\/ 3$/.test(document.querySelector("#searchCount").textContent), null, { timeout: 8000 });
  ok(true, "recherche insensible aux accents");
  await p.locator("#searchClose").tap();

  // --- impression
  await menu("print");
  await p.waitForFunction(() => window.__printed !== undefined, null, { timeout: 20000 });
  ok(await p.evaluate(() => window.__printed) === 3, "impression : 3 pages préparées pour l'impression");

  // --- scinder : pages 3 puis 1
  await menu("split");
  await p.waitForFunction(() => document.querySelectorAll("#orgGrid .otile canvas").length === 3);
  await p.waitForTimeout(700);
  await tapTile(2); await tapTile(0);
  ok((await tile(2).locator(".ord").textContent()) === "1" && (await tile(0).locator(".ord").textContent()) === "2", "scinder : ordre de sélection 1-2 affiché");
  await shot(p, "4-scinder");
  await p.locator('#orgFoot [data-o=extract]').tap();
  await p.waitForSelector("#saveDone:not([hidden])");
  const fSplit = await dl("extrait");
  const tSplit = pdfText(fSplit);
  ok(pages(fSplit) === 2 && tSplit.indexOf("page 3") < tSplit.indexOf("page 1"), "scinder : nouveau PDF de 2 pages, page 3 puis page 1");
  ok(/Lu et approuv/.test(tSplit), "le tampon est intégré au document extrait");
  await p.locator("#doneClose").tap(); await p.waitForTimeout(400);

  // --- organiser : glisser, supprimer, pivoter, dupliquer
  await p.locator("#pnOrg [data-pclose]").tap(); await p.waitForTimeout(400);
  await menu("organize");
  await p.waitForFunction(() => document.querySelectorAll("#orgGrid .otile canvas").length === 3);
  await p.waitForTimeout(600);
  const h = await tile(2).locator(".ohd").boundingBox(), t0 = await tile(0).boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(h.x + (t0.x + 20 - h.x) * i / 12, h.y + (t0.y + 60 - h.y) * i / 12);
  await p.mouse.up(); await p.waitForTimeout(300);
  ok((await tile(0).locator(".onum").textContent()) === "p. 3", "organiser : page 3 glissée en première position");
  await tapTile(1);                          // ancienne page 1
  await p.locator('#orgFoot [data-o=del]').tap();
  ok(await p.locator("#orgGrid .otile").count() === 2, "organiser : page supprimée");
  await tapTile(0);
  await p.locator('#orgFoot [data-o=rotate]').tap();
  await p.locator('#orgFoot [data-o=dup]').tap();
  ok(await p.locator("#orgGrid .otile").count() === 3, "organiser : page pivotée puis dupliquée");
  await p.waitForTimeout(500);
  await shot(p, "5-organiser");
  await p.locator('#orgFoot [data-o=apply]').tap();
  await p.waitForFunction(() => !document.querySelector("#pnOrg.on") && [...document.querySelectorAll(".page")].some(e => e.offsetWidth > e.offsetHeight), null, { timeout: 15000 }).catch(() => {});
  const dims = await p.evaluate(() => [...document.querySelectorAll(".page")].map(e => e.offsetWidth > e.offsetHeight ? "paysage" : "portrait"));
  ok(dims[0] === "paysage" && dims[1] === "paysage" && dims[2] === "portrait", "organiser : appliqué au document (" + dims.join(", ") + ")");

  // --- fusionner avec un 2e PDF
  await menu("merge");
  await p.waitForFunction(() => document.querySelectorAll("#orgGrid .otile").length === 3);
  await p.setInputFiles("#fileMerge", pdfB);
  await p.waitForFunction(() => document.querySelectorAll("#orgGrid .otile").length === 5, null, { timeout: 15000 });
  await p.waitForTimeout(800);
  ok((await tile(4).locator(".onum").textContent()) === "B · p. 2", "fusionner : pages du 2e document ajoutées (A/B)");
  await shot(p, "6-fusion");
  await tile(3).locator(".oeye").tap();
  await p.waitForSelector("#pnPreview.on"); await p.waitForTimeout(600);
  await shot(p, "7-apercu");
  await p.locator("#pvSel").tap();
  ok((await p.locator("#pvSel").textContent()).includes("n° 1"), "aperçu en grand + sélection depuis l'aperçu");
  await p.locator("#pnPreview [data-pclose]").tap(); await p.waitForTimeout(400);
  await p.locator('#orgFoot [data-o=none]').tap();
  await p.locator('#orgFoot [data-o=build]').tap();
  await p.waitForSelector("#saveDone:not([hidden])");
  const fMerge = await dl("fusion");
  ok(pages(fMerge) === 5 && /Annexe page 2/.test(pdfText(fMerge)), "fusionner : PDF de 5 pages créé");
  await p.locator("#doneOpen").tap();
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 5, null, { timeout: 15000 });
  ok(true, "PDF fusionné ouvert dans l'éditeur");

  // --- scanner
  await menu("scan");
  await p.waitForSelector("#shScanSrc.on");
  await shot(p, "8-scan-source");
  await p.setInputFiles("#fileScanGal", photo);
  await p.waitForSelector("#pnScan.on"); await p.waitForTimeout(700);
  // déplace le coin haut-gauche
  const hd = await p.locator(".schd").first().boundingBox();
  await p.mouse.move(hd.x + 22, hd.y + 22); await p.mouse.down(); await p.mouse.move(hd.x + 60, hd.y + 50); await p.mouse.up();
  await shot(p, "9-scan-cadrage");
  await p.locator("#scCropOk").tap();
  await p.waitForSelector("#scFxTools:not([hidden])"); await p.waitForTimeout(600);
  await shot(p, "10-scan-document");
  await p.locator('#scFx [data-fx=bw]').tap(); await p.waitForTimeout(600);
  await shot(p, "11-scan-nb");
  await p.locator("#scDone").tap();
  await p.waitForFunction(() => /^Scan/.test(document.querySelector("#docTitle").textContent), null, { timeout: 20000 });
  ok(await p.locator(".page").count() === 1, "scanner : PDF d'une page créé et ouvert");
  await p.waitForTimeout(500);
  await shot(p, "12-scan-pdf");

  // --- documents récents (après rechargement)
  await p.reload(); await p.waitForTimeout(900);
  const nRec = await p.locator("#recentList .chip").count();
  ok(nRec >= 3, "documents récents sur l'accueil (" + nRec + ")");
  await shot(p, "13-accueil-recents");
  await p.locator("#recentList .chip").nth(1).tap();
  await p.waitForFunction(() => document.querySelectorAll(".page").length > 0, null, { timeout: 15000 });
  ok(true, "document récent rouvert : « " + await p.locator("#docTitle").textContent() + " »");

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
