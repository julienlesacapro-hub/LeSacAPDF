// Test de bout en bout sur un téléphone émulé (Chromium).
// Usage : node tools/serve.js 8765 & node tools/e2e-test.js <fichier.pdf> <dossier-captures> [appareil]
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const [pdfPath, outDir, devName] = process.argv.slice(2);
const URL = "http://localhost:8765/";
const dev = devName === "iphone"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" }
  : devices["Pixel 7"];
fs.mkdirSync(outDir, { recursive: true });
const shot = (p, n) => p.screenshot({ path: path.join(outDir, (devName || "android") + "-" + n + ".png") });
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("✓ " + m); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, acceptDownloads: true, locale: "fr-FR" });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });  // absent sur mobile
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto(URL);
  await p.waitForTimeout(400);
  await shot(p, "1-accueil");
  ok(await p.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active)), "mode hors ligne (service worker actif)");

  await p.setInputFiles("#filePdf", pdfPath);
  await p.waitForFunction(() => document.querySelectorAll(".page").length > 0);
  await p.waitForTimeout(900);
  ok(await p.locator(".page").count() === 3, "3 pages affichées");
  ok(await p.locator(".field").count() === 2, "2 champs de formulaire détectés");
  await shot(p, "2-document");

  // champ de formulaire
  await p.locator("input.field[type=text]").fill("Jeanne Martin");
  await p.locator("input.field[type=checkbox]").check();

  // outil texte
  const page1 = p.locator(".page").first();
  const bb = await page1.boundingBox();
  await p.locator('.tool[data-tool=text]').tap();
  await page1.locator(".layer").tap({ position: { x: bb.width * 0.55, y: bb.height * 0.06 } });
  await p.waitForSelector("#shText.on");
  await p.waitForTimeout(350);
  await shot(p, "3-saisie-texte");
  await p.locator("#txtArea").fill("Bonjour depuis le téléphone");
  await p.locator("#txtOk").tap();
  await p.waitForTimeout(350);
  ok(await p.locator(".item.txt").count() === 1, "texte ajouté");
  ok(await p.locator("#ctxBar").isVisible(), "barre contextuelle affichée");
  await p.locator('#ctxBar [data-a=bigger]').tap();
  await p.locator('#ctxBar [data-a=bold]').tap();
  await shot(p, "4-texte-selectionne");

  // coches (outil qui reste actif)
  await p.locator('.tool[data-tool=check]').tap();
  await page1.locator(".layer").tap({ position: { x: 30, y: bb.height * 0.2 } });
  await page1.locator(".layer").tap({ position: { x: 30, y: bb.height * 0.25 } });
  ok(await p.locator(".item svg path").count() === 2, "2 coches ajoutées");
  await p.locator("#hintDone").tap();

  // signature
  await p.locator('.tool[data-act=sign]').tap();
  await p.waitForSelector("#shNewSig.on");
  await p.waitForTimeout(450);
  const pad = await p.locator("#sigPad").boundingBox();
  await p.mouse.move(pad.x + 40, pad.y + 120); await p.mouse.down();
  for (let i = 0; i <= 30; i++) await p.mouse.move(pad.x + 40 + i * 9, pad.y + 120 - Math.sin(i / 3) * 40);
  await p.mouse.up();
  await shot(p, "5-signature");
  await p.locator("#sigName").fill("Ma signature");
  await p.locator("#sigSave").tap();
  await p.waitForTimeout(700);
  ok(await p.locator("#hintBar").isVisible(), "placement de la signature proposé");
  await page1.locator(".layer").tap({ position: { x: bb.width * 0.7, y: bb.height * 0.82 } });
  await p.waitForTimeout(300);
  ok(await p.locator(".item img").count() === 1, "signature posée");
  await shot(p, "6-signature-posee");

  // stylo
  await p.locator('.tool[data-tool=pen]').tap();
  const lb = await page1.locator(".layer").boundingBox();
  await p.mouse.move(lb.x + 40, lb.y + lb.height * 0.4); await p.mouse.down();
  for (let i = 0; i < 20; i++) await p.mouse.move(lb.x + 40 + i * 8, lb.y + lb.height * 0.4 + (i % 2) * 6);
  await p.mouse.up();
  ok(await p.locator(".item.stroke").count() === 1, "trait de stylo ajouté");
  await shot(p, "7-stylo");
  await p.locator("#hintDone").tap();

  // annuler / rétablir
  await p.locator("#btnUndo").tap();
  ok(await p.locator(".item.stroke").count() === 0, "annuler");
  await p.locator("#btnRedo").tap();
  ok(await p.locator(".item.stroke").count() === 1, "rétablir");

  // menu + pages
  await p.locator("#btnMenu").tap();
  await p.waitForTimeout(350);
  await shot(p, "8-menu");
  await p.locator('#shMenu [data-m=pages]').tap();
  await p.waitForTimeout(800);
  ok(await p.locator(".thumb").count() === 3, "aperçu des pages");
  await shot(p, "9-pages");
  await p.locator(".thumb").nth(0).tap();
  await p.waitForTimeout(400);

  // pincer pour zoomer (deux doigts, via le protocole Chrome)
  const w0 = (await page1.boundingBox()).width;
  const cdp = await ctx.newCDPSession(p);
  const vb = await p.locator("#viewer").boundingBox();
  const cx = vb.x + vb.width / 2, cy = vb.y + 250;
  const pts = d => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(40) });
  for (let d = 50; d <= 120; d += 10) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(d) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(500);
  const w1 = (await page1.boundingBox()).width;
  ok(w1 > w0 * 2, "zoom au pincement (" + Math.round(w0) + " → " + Math.round(w1) + " px)");
  await shot(p, "8b-zoom");
  await p.locator("#btnMenu").tap(); await p.waitForTimeout(300);
  await p.locator('#shMenu [data-m=fit]').tap(); await p.waitForTimeout(300);
  ok(Math.abs((await page1.boundingBox()).width - w0) < 2, "ajuster à la largeur");

  // enregistrement
  await p.locator("#btnSave").tap();
  await p.waitForTimeout(350);
  await shot(p, "10-enregistrer");
  await p.locator("#saveGo").tap();
  await p.waitForSelector("#saveDone:not([hidden])");
  await shot(p, "11-pret");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator("#doneDl").tap()]);
  const out = path.join(outDir, (devName || "android") + "-resultat.pdf");
  await dl.saveAs(out);
  ok(fs.statSync(out).size > 1000, "PDF téléchargé (" + fs.statSync(out).size + " octets)");
  await p.locator("#doneClose").tap();

  // version allégée
  await p.locator("#btnSave").tap();
  await p.locator('input[name=smode][value=small]').check();
  await p.locator("#saveTarget").fill("0.3");
  await p.locator("#saveGray").check();
  await p.locator("#saveGo").tap();
  await p.waitForSelector("#saveDone:not([hidden])", { timeout: 60000 });
  console.log("  allégé :", await p.locator("#doneInfo").textContent());
  const [dl2] = await Promise.all([p.waitForEvent("download"), p.locator("#doneDl").tap()]);
  const out2 = path.join(outDir, (devName || "android") + "-resultat-allege.pdf");
  await dl2.saveAs(out2);
  ok(fs.statSync(out2).size > 1000, "PDF allégé téléchargé (" + fs.statSync(out2).size + " octets)");

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
