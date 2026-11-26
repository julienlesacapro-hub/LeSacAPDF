// Test du diaporama (version 4.3) sur téléphone émulé.
// Usage : node tools/serve.js 8765 & node tools/e2e-show.js <test.pdf (3 pages)> <dossier> [android|iphone]
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path");
const [pdf, outDir, devName] = process.argv.slice(2);
const dev = devName === "iphone"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" }
  : devices["Pixel 7"];
const tag = devName || "android";
fs.mkdirSync(outDir, { recursive: true });
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("✓ " + m); };
const shot = (p, n) => p.screenshot({ path: path.join(outDir, tag + "-show-" + n + ".png") });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, locale: "fr-FR" });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const num = () => p.locator("#showNum").textContent();
  await p.goto("http://localhost:8765/");
  await p.setInputFiles("#filePdf", pdf);
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 3); await p.waitForTimeout(600);
  /* une annotation : elle doit apparaître dans le diaporama */
  const page1 = p.locator(".page").first(), bb = await page1.boundingBox();
  await p.locator(".tool[data-tool=text]").tap();
  await page1.locator(".layer").tap({ position: { x: bb.width * 0.5, y: bb.height * 0.05 } });
  await p.waitForSelector("#shText.on"); await p.locator("#txtArea").fill("Annotation visible en diaporama"); await p.locator("#txtOk").tap();
  await p.waitForTimeout(300);

  ok(!(await p.locator("#btnShow").isVisible()), "élément sélectionné : bouton ▶ masqué (sous la barre de l'élément)");
  await page1.locator(".layer").tap({ position: { x: bb.width * 0.5, y: bb.height * 0.6 } }); await p.waitForTimeout(300);
  ok(await p.locator("#btnShow").isVisible(), "sélection retirée : bouton ▶ visible");
  await p.locator("#btnShow").tap();
  await p.waitForSelector("#pnShow.on #showStage canvas", { timeout: 15000 });
  await p.waitForTimeout(400);
  ok((await num()) === "1 / 3", "diaporama ouvert sur la page 1");
  ok(!(await p.locator("#toast").isVisible()) || await p.evaluate(() => getComputedStyle(document.querySelector("#toast")).visibility === "hidden"),
    "aucun message de l'éditeur par-dessus le diaporama");
  const vp = p.viewportSize(), cv = await p.locator("#showStage canvas").boundingBox();
  ok(cv.width <= vp.width + 1 && cv.height <= vp.height + 1 && (cv.width > vp.width * 0.95 || cv.height > vp.height * 0.95),
    "page entière ajustée à l'écran (" + Math.round(cv.width) + " × " + Math.round(cv.height) + " sur " + vp.width + " × " + vp.height + ")");
  await shot(p, "1-portrait");

  const tapAt = async fx => { await p.locator("#showStage").click({ position: { x: vp.width * fx, y: vp.height * 0.5 } }); await p.waitForTimeout(450); };
  await tapAt(0.85); ok((await num()) === "2 / 3", "toucher à droite : page suivante");
  await tapAt(0.15); ok((await num()) === "1 / 3", "toucher à gauche : page précédente");
  await tapAt(0.5); ok(await p.locator("#pnShow.chrome").count() === 1, "toucher au centre : commandes affichées");
  await shot(p, "2-commandes");
  await p.locator("#showNext").tap(); await p.waitForTimeout(400);
  ok((await num()) === "2 / 3", "bouton suivant");
  /* balayage vers la gauche */
  await p.mouse.move(vp.width * 0.8, vp.height * 0.5); await p.mouse.down();
  await p.mouse.move(vp.width * 0.2, vp.height * 0.5, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(450);
  ok((await num()) === "3 / 3", "balayage vers la gauche : page suivante");
  await tapAt(0.85);
  ok((await num()) === "3 / 3" && /Fin du document/.test(await p.locator("#showMsg").textContent()), "dernière page : message de fin, pas de dépassement");
  await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(400);
  ok((await num()) === "2 / 3", "clavier : flèche gauche");
  await p.keyboard.press(" "); await p.waitForTimeout(400);
  ok((await num()) === "3 / 3", "clavier : espace");

  /* sortie : retour à l'éditeur sur la page regardée */
  await tapAt(0.5); await p.locator("#showClose").tap(); await p.waitForTimeout(800);
  ok(await p.locator("#pnShow.on").count() === 0, "quitter le diaporama");
  ok((await p.locator("#pageNum").textContent()).startsWith("3"), "retour dans l'éditeur sur la page 3");
  ok(await p.locator(".item.txt").count() === 1, "l'annotation est toujours là (le diaporama ne modifie pas le document)");

  /* depuis le menu, et touche Échap */
  await p.locator("#btnMenu").tap(); await p.waitForTimeout(300); await p.locator('#shMenu [data-m="show"]').tap();
  await p.waitForSelector("#pnShow.on #showStage canvas", { timeout: 15000 }); await p.waitForTimeout(300);
  ok((await num()) === "1 / 3", "menu → Diaporama : démarre à la page 1");
  await p.keyboard.press("Escape"); await p.waitForTimeout(700);
  ok(await p.locator("#pnShow.on").count() === 0 && await p.locator(".page").count() === 3, "Échap : retour à l'éditeur, document intact");

  ok(await p.evaluate(() => !!document.fullscreenElement) === false, "plein écran quitté avec le diaporama");

  /* rotation : session sans API plein écran (comme Safari sur iPhone, où l'application installée occupe déjà l'écran) */
  const ctx2 = await b.newContext({ ...dev, viewport: { width: vp.height, height: vp.width }, locale: "fr-FR" });
  await ctx2.addInitScript(() => { Element.prototype.requestFullscreen = undefined; });
  const q = await ctx2.newPage();
  q.on("pageerror", e => errors.push(e.message));
  await q.goto("http://localhost:8765/"); await q.setInputFiles("#filePdf", pdf);
  await q.waitForFunction(() => document.querySelectorAll(".page").length === 3); await q.waitForTimeout(500);
  await q.locator("#btnShow").tap(); await q.waitForSelector("#pnShow.on #showStage canvas"); await q.waitForTimeout(400);
  let c2 = await q.locator("#showStage canvas").boundingBox();
  ok(Math.abs(c2.height - vp.width) <= 2, "paysage : page entière à la hauteur de l'écran (" + Math.round(c2.width) + " × " + Math.round(c2.height) + ")");
  await q.screenshot({ path: path.join(outDir, tag + "-show-3-paysage.png") });
  await q.setViewportSize(vp); await q.waitForTimeout(900);
  c2 = await q.locator("#showStage canvas").boundingBox();
  ok(Math.abs(c2.width - vp.width) <= 2, "rotation en portrait : page redessinée à la largeur de l'écran (" + Math.round(c2.width) + " × " + Math.round(c2.height) + ")");
  await ctx2.close();

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
