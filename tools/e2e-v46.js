// Test de la version 4.6 : PDF protégés par mot de passe, lecture seule, annulation étendue,
// numéro de version et avis de mise à jour. Les PDF enregistrés sont contrôlés par pdfinfo / pdftotext.
// Usage : node tools/serve.js 8765 &
//   node tools/e2e-v46.js <dossier fixtures> <dossier résultats> [android|iphone]
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
const info = (f, pw) => execFileSync("pdfinfo", (pw ? ["-upw", pw] : []).concat([f])).toString();
const text = f => execFileSync("pdftotext", [f, "-"]).toString();
const VER = require(path.join(__dirname, "..", "package.json")).version;   /* version courante de l'application */

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, acceptDownloads: true, locale: "fr-FR" });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto("http://localhost:8765/"); await p.waitForFunction(() => window.__storeReady);
  const toastTxt = () => p.locator("#toast").textContent();
  const pages = () => p.locator(".page").count();
  const menu = async m => { await p.locator("#btnMenu").tap(); await p.waitForTimeout(300); await p.locator('#shMenu [data-m="' + m + '"]').tap(); };

  /* --- version */
  ok((await p.locator("#docSub").textContent()).startsWith("Tout faire · version " + VER), "sous le titre : « " + await p.locator("#docSub").textContent() + " »");
  ok((await p.locator(".owner").textContent()).includes("version " + VER), "bas de l'accueil : numéro de version");
  ok(await p.locator("#shNews.on").count() === 0, "première installation : pas d'avis de mise à jour");
  await p.evaluate(() => localStorage.setItem("pdfed.lastVersion", "4.5.0"));
  await p.reload(); await p.waitForSelector("#shNews.on", { timeout: 5000 });
  ok((await p.locator("#newsSub").textContent()).includes("4.5.0 → version " + VER) && await p.locator("#newsList li").count() >= 3,
    "après mise à jour : avis « " + await p.locator("#newsSub").textContent() + " » et nouveautés");
  await p.locator("#newsOk").tap(); await p.waitForTimeout(400);
  await p.reload(); await p.waitForTimeout(800);
  ok(await p.locator("#shNews.on").count() === 0, "avis affiché une seule fois");

  /* --- PDF protégés : un mot de passe par niveau de chiffrement */
  const clearToast = () => p.evaluate(() => { document.querySelector("#toast").textContent = ""; });
  const openLocked = async (file, pw) => {
    await clearToast();
    await p.setInputFiles("#filePdf", fx(file));
    await p.waitForSelector("#shAsk.on", { timeout: 10000 });
    ok(await p.locator("#askInput").getAttribute("type") === "password", file + " : mot de passe demandé (saisie masquée)");
    await p.locator("#askInput").fill(pw); await p.locator("#askOk").tap();
  };
  for (const [file, pw] of [["chiffre-r2-rc4.pdf", "secret"], ["chiffre-r3-rc4.pdf", "secret"], ["chiffre-r4-aes.pdf", "secret"],
                            ["chiffre-r6-aes256.pdf", "sécurité"], ["chiffre-libreoffice.pdf", "lo2026"]]) {
    await openLocked(file, pw);
    await p.waitForFunction(() => /déverrouillé/.test(document.querySelector("#toast").textContent), null, { timeout: 20000 });
    ok(await pages() > 0, file + " : déverrouillé et ouvert (" + await pages() + " page(s))");
  }
  /* mauvais mot de passe, puis abandon */
  await clearToast();
  await p.setInputFiles("#filePdf", fx("chiffre-r6-aes256.pdf"));
  await p.waitForSelector("#shAsk.on"); await p.locator("#askInput").fill("faux"); await p.locator("#askOk").tap();
  await p.waitForFunction(() => /incorrect/.test(document.querySelector("#askSub").textContent) && document.querySelector("#shAsk.on"), null, { timeout: 10000 })
    .catch(async e => { console.log("DIAG", await p.locator("#askSub").textContent(), await p.locator("#shAsk.on").count(), await p.locator("#toast").textContent()); throw e; });
  ok(true, "mauvais mot de passe : « Mot de passe incorrect » et nouvelle demande");
  await p.locator("#askCancel").tap(); await p.waitForTimeout(500);
  ok((await p.locator("#docTitle").textContent()) === "chiffre-libreoffice", "abandon : le document précédent reste ouvert");

  /* le mot de passe propriétaire ouvre aussi le document */
  await openLocked("chiffre-r4-aes.pdf", "proprio");
  await p.waitForFunction(() => /déverrouillé/.test(document.querySelector("#toast").textContent), null, { timeout: 20000 });
  ok(true, "mot de passe propriétaire accepté");

  /* modification, enregistrement : PDF non chiffré, contenu et champ conservés */
  await openLocked("chiffre-r6-aes256.pdf", "sécurité");
  await p.waitForFunction(() => /déverrouillé/.test(document.querySelector("#toast").textContent), null, { timeout: 20000 });
  await p.locator(".field[type=text]").first().fill("Claire Dubois");
  const save = async (name, setup) => {
    await p.locator("#btnSave").tap(); await p.waitForTimeout(300);
    await p.locator('#saveFmt [data-f="pdf"]').tap();
    if (setup) await setup();
    await p.locator("#saveGo").tap();
    await p.waitForSelector("#saveDone:not([hidden])", { timeout: 60000 });
    const [d] = await Promise.all([p.waitForEvent("download"), p.locator("#doneDl").tap()]);
    const f = path.join(outDir, tag + "-v46-" + name + ".pdf"); await d.saveAs(f);
    await p.locator("#doneClose").tap(); await p.waitForTimeout(400);
    return f;
  };
  let f = await save("deverrouille");
  ok(/Encrypted:\s+no/.test(info(f)) && /Pages:\s+3/.test(info(f)), "enregistré sans mot de passe, 3 pages (pdfinfo)");
  ok(/Ligne de texte numéro 12/.test(text(f)) && /Claire Dubois/.test(text(f)), "contenu et champ rempli présents (pdftotext)");
  f = await save("reprotege", async () => { await p.locator("#encOn").check(); await p.locator("#encPwd").fill("nouveau"); await p.locator("#encPwd2").fill("nouveau").catch(() => {}); });
  ok(/Encrypted:\s+yes/.test(info(f, "nouveau")), "ré-enregistré protégé par un nouveau mot de passe (pdfinfo)");
  await p.reload(); await p.waitForTimeout(900);
  const rec = await p.locator("#recentList").textContent();
  ok(!/chiffre-r6/.test(rec), "document déverrouillé absent des documents récents (non conservé en clair)");

  /* --- modification interdite par l'auteur : lecture seule, ou mot de passe propriétaire */
  await clearToast();
  await p.setInputFiles("#filePdf", fx("restreint.pdf"));
  await p.waitForSelector("#shAsk.on", { timeout: 10000 });
  ok(/interdit la modification/.test(await p.locator("#askSub").textContent()), "PDF restreint : l'interdiction de l'auteur est signalée");
  await p.locator("#askCancel").tap();
  await p.waitForFunction(() => document.querySelectorAll(".page canvas").length > 0, null, { timeout: 20000 });
  ok(/lecture seule/.test(await toastTxt()), "« Lire seulement » : document ouvert en lecture seule");
  await p.locator(".tool[data-tool=text]").tap(); await p.waitForTimeout(300);
  ok(/Lecture seule/.test(await toastTxt()), "lecture seule : outil d'annotation refusé");
  await p.locator("#btnSave").tap(); await p.waitForTimeout(300);
  ok(await p.locator("#shSave.on").count() === 0, "lecture seule : enregistrement refusé");
  ok(await p.locator(".field").first().isDisabled(), "lecture seule : champs non modifiables");
  await clearToast();
  await p.setInputFiles("#filePdf", fx("restreint.pdf"));
  await p.waitForSelector("#shAsk.on"); await p.locator("#askInput").fill("proprio"); await p.locator("#askOk").tap();
  await p.waitForFunction(() => /déverrouillé/.test(document.querySelector("#toast").textContent), null, { timeout: 20000 });
  ok(await p.locator(".field").first().isEnabled(), "mot de passe propriétaire : document modifiable");

  /* --- annulation étendue */
  await p.setInputFiles("#filePdf", fx("test.pdf"));
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 3); await p.waitForTimeout(500);
  const fld = p.locator(".field[type=text]").first();
  await fld.tap(); await fld.pressSequentially("Paul", { delay: 20 });
  await p.locator(".field[type=checkbox]").first().check();
  await p.locator("#btnUndo").tap(); await p.waitForTimeout(400);
  ok(!(await p.locator(".field[type=checkbox]").first().isChecked()) && await p.locator(".field[type=text]").first().inputValue() === "Paul",
    "annuler : case décochée, texte conservé");
  await p.locator("#btnUndo").tap(); await p.waitForTimeout(400);
  ok(await p.locator(".field[type=text]").first().inputValue() === "", "annuler : saisie du champ annulée en une étape");
  await menu("redo"); await p.waitForTimeout(400);
  ok(await p.locator(".field[type=text]").first().inputValue() === "Paul", "rétablir : saisie rétablie");

  /* annotation, puis suppression d'une page dans « Organiser » */
  const pg1 = p.locator(".page").first(), bb = await pg1.boundingBox();
  await p.locator(".tool[data-tool=check]").tap();
  await pg1.locator(".layer").tap({ position: { x: bb.width * 0.8, y: bb.height * 0.3 } });
  ok(await p.locator(".item").count() === 1, "annotation posée");
  await menu("organize");
  await p.waitForFunction(() => document.querySelectorAll("#orgGrid .otile canvas").length === 3, null, { timeout: 20000 });
  await p.locator("#orgGrid .otile").nth(1).click({ position: { x: 20, y: 50 } });
  await p.locator('#orgFoot [data-o="del"]').tap(); await p.waitForTimeout(300);
  await p.locator('#orgFoot [data-o="apply"]').tap();
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 2, null, { timeout: 20000 });
  ok(true, "organiser : page 2 supprimée, document de 2 pages");
  await p.locator("#btnUndo").tap();
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 3, null, { timeout: 20000 }); await p.waitForTimeout(400);
  ok(await p.locator(".item").count() === 1 && await p.locator(".field[type=text]").first().inputValue() === "Paul",
    "annuler : 3 pages retrouvées, avec l'annotation et le champ rempli");
  await menu("redo");
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 2, null, { timeout: 20000 });
  ok(true, "rétablir : suppression de la page rétablie");
  await p.locator("#btnUndo").tap();
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 3, null, { timeout: 20000 }); await p.waitForTimeout(300);

  /* rotation d'une page (page 3, sans annotation) */
  await p.locator(".page").nth(2).scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
  const r0 = await p.locator(".page").nth(2).boundingBox();
  await menu("rotate"); await p.waitForTimeout(800);
  const r1 = await p.locator(".page").nth(2).boundingBox();
  ok(r1.width > r1.height, "page 3 pivotée (paysage)");
  await p.locator("#btnUndo").tap(); await p.waitForTimeout(900);
  const r2 = await p.locator(".page").nth(2).boundingBox();
  ok(r2.height > r2.width && Math.abs(r2.width - r0.width) < 2, "annuler : rotation annulée");

  /* bouton « retour » du téléphone : ferme la fenêtre du dessus, sans quitter l'application */
  await p.locator("#btnMenu").tap(); await p.waitForSelector("#shMenu.on");
  await p.goBack({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(400);
  ok(await p.locator("#shMenu.on").count() === 0 && /localhost/.test(p.url()), "retour : menu fermé, application toujours ouverte");
  await p.locator("#btnMenu").tap(); await p.waitForSelector("#shMenu.on");
  await p.locator('#shMenu [data-m="recents"]').tap(); await p.waitForSelector("#shRecents.on");
  await p.goBack({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(400);
  ok(await p.locator(".sheet.on").count() === 0 && /localhost/.test(p.url()) && await p.locator(".page").count() === 3,
    "retour après une fenêtre remplacée par une autre : fermée, document toujours ouvert");

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
