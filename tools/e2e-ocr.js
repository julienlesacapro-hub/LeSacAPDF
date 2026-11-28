// Test du texte sélectionnable (version 4.5) : conversions avec couche de texte, OCR des images,
// du scanner et d'un document ouvert (menu). Les PDF produits sont lus par pdftotext (outil indépendant).
// Usage : node tools/serve.js 8765 &
//   node tools/e2e-ocr.js <dossier fixtures> <dossier résultats> [android|iphone]
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
const norm = s => s.replace(/\s+/g, " ");
const pdfText = f => norm(execFileSync("pdftotext", ["-layout", f, "-"]).toString());
const LONG = { timeout: 240000 };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, acceptDownloads: true, locale: "fr-FR" });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto("http://localhost:8765/"); await p.waitForFunction(() => window.__storeReady);

  const save = async name => {
    const f = path.join(outDir, tag + "-ocr-" + name + ".pdf");
    fs.writeFileSync(f, Buffer.from(await p.evaluate(() => window.__docBytes()))); return f;
  };
  const convert = async (files, ocr) => {
    await p.evaluate(o => { document.querySelector("#convOcr").checked = o; }, ocr);
    await p.evaluate(() => { document.querySelector("#docTitle").textContent = ""; });
    await p.setInputFiles("#fileConv", files.map(fx));
    await p.waitForFunction(t => document.querySelector("#docTitle").textContent === t && !document.querySelector("#spin").classList.contains("on"),
      files[0].replace(/\.[^.]+$/, "") + (files.length > 1 ? " et autres" : ""), LONG);
    await p.waitForFunction(() => document.querySelectorAll(".page canvas").length > 0, null, LONG);
  };
  const search = async q => {
    if (!(await p.locator("#searchBar").isVisible())) await p.locator("#btnSearch").tap();
    await p.locator("#searchInput").fill(q);
    await p.waitForTimeout(1200);
    const c = await p.locator("#searchCount").textContent();
    return /\/\s*(\d+)/.test(c) ? +RegExp.$1 : 0;
  };
  const closeSearch = async () => { if (await p.locator("#searchBar").isVisible()) await p.locator("#searchClose").tap(); };

  /* 1. Word, ODT, HTML, Excel, PowerPoint : texte sélectionnable sans OCR */
  await convert(["doc.docx"], false);
  let t = pdfText(await save("word"));
  ok(t.includes("Compte rendu de plongée") && t.includes("Port-Cros"), "Word → PDF : texte sélectionnable (« Compte rendu de plongée »)");
  ok(t.includes("éèàçù") && t.includes("17 °C"), "Word → PDF : accents et symboles conservés");
  ok(await search("Port-Cros") >= 1, "Word → PDF : recherche dans le document converti");
  await closeSearch();
  await convert(["doc.odt"], false);
  ok(pdfText(await save("odt")).trim().length > 40, "ODT → PDF : texte sélectionnable");
  await convert(["page.html"], false);
  t = pdfText(await save("html"));
  ok(t.includes("Compte rendu HTML") && t.includes("45,00 €"), "HTML → PDF : texte sélectionnable");
  ok(!t.includes("ne doit pas s'exécuter"), "HTML → PDF : le texte d'un script n'est pas repris");
  await convert(["tableau.xlsx"], false);
  ok(pdfText(await save("excel")).trim().length > 20, "Excel → PDF : texte des cellules sélectionnable");
  await convert(["ancien.ppt"], false);
  ok(pdfText(await save("ppt")).trim().length > 20, "PowerPoint 97 → PDF : texte sélectionnable");

  /* 2. image : sans OCR pas de texte, avec OCR texte reconnu */
  await convert(["image-texte.jpg"], false);
  ok(pdfText(await save("image-sans")).trim() === "", "image → PDF sans OCR : aucun texte");
  const t0 = Date.now();
  await convert(["image-texte.jpg"], true);
  t = pdfText(await save("image-ocr"));
  ok(t.includes("ATTESTATION DE PRÉSENCE") && t.includes("secourisme") && t.includes("Claire Dubois"),
    "image → PDF avec OCR : texte reconnu (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
  ok(await search("secourisme") === 1, "OCR : mot trouvé par la recherche");
  await closeSearch();

  /* 3. OCR depuis le menu, sur un document ouvert : les annotations sont conservées */
  await convert(["image-texte.jpg"], false);
  const pg = p.locator(".page").first(), bb = await pg.boundingBox();
  await p.locator(".tool[data-tool=check]").tap();
  await pg.locator(".layer").tap({ position: { x: bb.width * 0.9, y: bb.height * 0.9 } });
  const items = await p.locator(".item").count();
  ok(items === 1, "annotation posée avant l'OCR");
  await p.locator("#btnMenu").tap(); await p.waitForTimeout(300);
  await p.locator('#shMenu [data-m="ocr"]').tap();
  await p.waitForFunction(() => /mots reconnus/.test(document.querySelector("#toast").textContent), null, LONG);
  ok(true, "menu → Reconnaître le texte : « " + await p.locator("#toast").textContent() + " »");
  ok(await p.locator(".item").count() === items, "annotation conservée après l'OCR");
  t = pdfText(await save("menu"));
  ok(t.includes("Toulon") && t.includes("octobre 2026"), "menu OCR : texte présent dans le document");
  await p.locator("#btnMenu").tap(); await p.waitForTimeout(300);
  await p.locator('#shMenu [data-m="ocr"]').tap();
  await p.waitForFunction(() => /déjà du texte/.test(document.querySelector("#toast").textContent), null, LONG);
  ok(true, "deuxième passage : « rien à reconnaître »");

  /* 4. scanner : photo de biais, redressée, texte reconnu */
  await p.locator("#btnMenu").tap(); await p.waitForTimeout(300);
  await p.locator('#shMenu [data-m="scan"]').tap();
  await p.waitForSelector("#shScanSrc.on");
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.locator("#scGal").tap()]);
  await fc.setFiles(fx("photo-doc.jpg"));
  await p.waitForSelector("#pnScan.on"); await p.waitForTimeout(700);
  await p.locator("#scCropOk").tap();
  await p.waitForSelector("#scFxTools:not([hidden])"); await p.waitForTimeout(500);
  ok(await p.locator("#scOcr").isChecked(), "scanner : option « Reconnaître le texte » cochée par défaut");
  await p.locator("#scDone").tap();
  /* une annotation est en cours : confirmation demandée avant de créer le PDF */
  await p.waitForSelector("#shAsk.on", { timeout: 10000 });
  ok(await p.locator("#pnScan.on").count() === 1, "scanner : confirmation demandée avant de remplacer le document annoté");
  await p.locator("#askOk").tap();
  await p.waitForFunction(() => /^Scan/.test(document.querySelector("#docTitle").textContent), null, LONG);
  t = pdfText(await save("scan"));
  ok(/FACTURE/.test(t) && (t.match(/prestation/g) || []).length >= 15, "scanner : facture reconnue (« FACTURE », " +
    (t.match(/prestation/g) || []).length + " lignes « prestation » sur 18)");
  ok(await search("120,00") >= 15, "scanner : montants trouvés par la recherche");
  await closeSearch();

  /* 5. exports du scan reconnu : PDF/A-2a avec texte, Word avec texte modifiable */
  const exp = async (fmt, name) => {
    await p.locator("#btnSave").tap(); await p.waitForTimeout(300);
    await p.locator('#saveFmt [data-f="' + fmt + '"]').tap();
    await p.locator("#saveGo").tap();
    await p.waitForSelector("#saveDone:not([hidden])", LONG);
    const info = await p.locator("#doneInfo").textContent();
    const [d] = await Promise.all([p.waitForEvent("download"), p.locator("#doneDl").tap()]);
    const f = path.join(outDir, tag + "-ocr-" + name); await d.saveAs(f);
    await p.locator("#doneClose").tap(); await p.waitForTimeout(400);
    return { f, info };
  };
  let r = await exp("pdfa", "scan-pdfa.pdf");
  ok(/PDF\/A-2a · \d+ mots/.test(r.info) && /prestation/.test(pdfText(r.f)), "scan reconnu → PDF/A-2a avec texte : " + r.info);
  r = await exp("docx", "scan.docx");
  const docXml = execFileSync("unzip", ["-p", r.f, "word/document.xml"]).toString();
  ok(/FACTURE/.test(docXml) && (docXml.match(/prestation/g) || []).length >= 15, "scan reconnu → Word : texte modifiable");

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
