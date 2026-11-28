// Test de la version 4.8 : commentaires et formes (annotations PDF), champs de formulaire créés,
// en-têtes / pieds de page / numérotation, signets et sommaire, données cachées, lecture à voix
// haute, organiser (page blanche, recadrage, A4). Contrôles indépendants : pdfinfo, pdftotext,
// et un script Python (pikepdf) quand il est disponible.
// Usage : node tools/serve.js 8765 &
//   node tools/e2e-v48.js <dossier fixtures> <dossier résultats> [android|iphone]
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
const out = n => path.join(outDir, tag + "-v48-" + n);
const run = (cmd, args) => execFileSync(cmd, args).toString();
const pageText = (f, n) => run("pdftotext", ["-f", String(n), "-l", String(n), "-layout", f, "-"]);
const sizes = f => run("pdfinfo", ["-f", "1", "-l", "99", f]).split("\n").filter(l => /^Page\s+\d+ size/.test(l))
  .map(l => l.match(/size:\s+([\d.]+) x ([\d.]+)/).slice(1).map(Number));
const cropW = (f, n) => +run("pdfinfo", ["-f", String(n), "-l", String(n), "-box", f]).match(new RegExp("Page\\s+" + n + " CropBox:\\s+([\\d.-]+)\\s+([\\d.-]+)\\s+([\\d.-]+)"))[3];
/* lecture des annotations, champs et signets par pikepdf (indépendant de l'application) */
const PY = process.env.PYTHON || "python3";
let pike = true; try { execFileSync(PY, ["-c", "import pikepdf"]); } catch (e) { pike = false; }
const py = (code, f) => JSON.parse(execFileSync(PY, ["-c", code, f]).toString());

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, acceptDownloads: true, locale: "fr-FR" });
  /* synthèse vocale simulée (le navigateur de test n'a pas de voix) : on enregistre ce qui est lu */
  await ctx.addInitScript(() => {
    delete window.showSaveFilePicker;
    window.__spoken = [];
    const fake = { speaking: false, cancel() {}, pause() {}, resume() {}, getVoices: () => [{ lang: "fr-FR", name: "Test", localService: true }],
      speak(u) { if (!u.text.trim()) return; window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend({}), 30); } };
    Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await p.goto("http://localhost:8765/"); await p.waitForFunction(() => window.__storeReady);
  const menu = async m => { await p.locator("#btnMenu").tap(); await p.waitForTimeout(300); await p.locator('#shMenu [data-m="' + m + '"]').tap(); };
  const open = async f => {
    await p.evaluate(() => { document.querySelector("#docTitle").textContent = ""; });
    await p.setInputFiles("#filePdf", f);
    if (await p.locator("#shAsk.on").count()) await p.locator("#askOk").tap();
    await p.waitForFunction(() => document.querySelector("#docTitle").textContent && document.querySelectorAll(".page canvas").length > 0, null, { timeout: 30000 });
    await p.waitForTimeout(400);
  };
  const save = async name => {
    await p.locator("#btnSave").tap(); await p.waitForTimeout(300);
    await p.locator('#saveFmt [data-f="pdf"]').tap();
    await p.locator('input[name=smode][value=vector]').check();
    await p.locator("#saveGo").tap();
    await p.waitForSelector("#saveDone:not([hidden])", { timeout: 60000 });
    const [d] = await Promise.all([p.waitForEvent("download"), p.locator("#doneDl").tap()]);
    const f = out(name); await d.saveAs(f);
    await p.locator("#doneClose").tap(); await p.waitForTimeout(400);
    return f;
  };
  const layerTap = async (x, y, n) => { const pg = p.locator(".page").nth(n || 0); await pg.locator(".layer").tap({ position: { x, y } }); };
  const dragOn = async (x0, y0, x1, y1, n) => {
    const bb = await p.locator(".page").nth(n || 0).boundingBox();
    await p.mouse.move(bb.x + x0, bb.y + y0); await p.mouse.down(); await p.mouse.move(bb.x + x1, bb.y + y1, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  };
  const pickTool = async (sheet, t) => { await p.locator('.tool[data-act="' + sheet + '"]').tap(); await p.waitForTimeout(250); await p.locator('#sh' + (sheet === "shapes" ? "Shapes" : "Fields") + ' [data-t="' + t + '"]').tap(); await p.waitForTimeout(250); };

  /* ================= 1. commentaires, formes et champs */
  await open(fx("test.pdf"));
  await p.locator("#chkFlatten").evaluate(e => { e.checked = false; });       /* champs d'origine conservés */
  await pickTool("shapes", "arrow"); await dragOn(60, 120, 200, 200);
  await pickTool("shapes", "rect"); await dragOn(220, 100, 330, 160);
  await p.locator('#ctxBar [data-a="comment"]').tap(); await p.waitForSelector("#shText.on");
  await p.locator("#txtArea").fill("Zone à revoir"); await p.locator("#txtOk").tap(); await p.waitForTimeout(300);
  await pickTool("shapes", "line"); await dragOn(40, 260, 300, 262);
  await p.locator('.tool[data-tool="note"]').tap(); await layerTap(300, 60);
  await p.waitForSelector("#shText.on"); await p.locator("#txtArea").fill("À vérifier : montant ?"); await p.locator("#txtOk").tap(); await p.waitForTimeout(300);
  ok(await p.locator(".item.shape").count() === 4, "note, flèche, rectangle et ligne posés");
  await pickTool("fields", "ff-text"); await dragOn(60, 300, 250, 320);
  await pickTool("fields", "ff-check"); await layerTap(280, 310);
  await pickTool("fields", "ff-sig"); await dragOn(60, 340, 250, 390);
  ok(await p.locator(".item.ffield").count() === 3, "champs créés : texte, case, signature");
  let f = await save("commentaires.pdf");
  if (pike) {
    const r = py(`import pikepdf,sys,json
p=pikepdf.open(sys.argv[1]); a=[]
for x in p.pages[0].get('/Annots',[]):
  a.append({'s':str(x.Subtype),'t':str(x.get('/T','')),'c':str(x.get('/Contents','')),'ap':'/AP' in x,'le':[str(v) for v in x.get('/LE',[])],'ft':str(x.get('/FT',''))})
print(json.dumps({'a':a,'f':[str(z.T) for z in p.Root.AcroForm.Fields]}))`, f);
    const sub = s => r.a.filter(x => x.s === s);
    ok(sub("/Text").length === 1 && sub("/Text")[0].c === "À vérifier : montant ?" && sub("/Popup").length === 1, "note : annotation Text + Popup avec son texte (pikepdf)");
    ok(sub("/Square").length === 1 && sub("/Square")[0].c === "Zone à revoir", "rectangle : annotation Square avec son commentaire");
    ok(sub("/Line").length === 2 && sub("/Line").some(x => x.le[1] === "/OpenArrow"), "flèche et ligne : annotations Line (extrémité en flèche)");
    ok(r.a.filter(x => ["/Text", "/Square", "/Line"].includes(x.s)).every(x => x.ap && x.t === "Mon profil"), "chaque annotation a une apparence et un auteur");
    ok(["nom", "accord", "Texte1", "Case1", "Signature1"].every(n => r.f.includes(n)) && r.a.some(x => x.ft === "/Sig"),
      "formulaire : champs d'origine + Texte1, Case1, Signature1 (champ /Sig) : " + r.f.join(", "));
  } else console.log("  (pikepdf absent : contrôle des annotations par l'application seulement)");
  /* relecture : le document enregistré est rouvert, ses commentaires sont listés */
  await open(f);
  await menu("comments"); await p.waitForSelector("#shComments.on"); await p.waitForTimeout(300);
  let list = (await p.locator("#cmtList li").allTextContents()).join(" | ");
  ok(/À vérifier : montant \?/.test(list) && /Zone à revoir/.test(list) && /Mon profil/.test(list), "commentaires relus après réouverture : " + list.slice(0, 90) + "…");
  await p.locator("#shComments .grab").click().catch(() => {}); await p.keyboard.press("Escape").catch(() => {});
  await p.evaluate(() => document.querySelector("#scrim").click());
  ok(await p.locator(".field").count() >= 5, "champs créés remplissables à la réouverture (" + await p.locator(".field").count() + " champs)");
  await open(fx("commente.pdf"));
  await menu("comments"); await p.waitForSelector("#shComments.on"); await p.waitForTimeout(300);
  list = (await p.locator("#cmtList li").allTextContents()).join(" | ");
  ok(/Relecteur Acrobat/.test(list) && /reformuler la ligne 3/.test(list), "commentaire fait dans un autre logiciel lu : « " + list.slice(0, 70) + " »");
  await p.evaluate(() => document.querySelector("#scrim").click());

  /* ================= 2. en-têtes, pieds de page, numéros */
  await open(fx("test.pdf"));
  await menu("hf"); await p.waitForSelector("#shHF.on");
  await p.locator("#hfHead").fill("Dossier {fichier}"); await p.locator("#hfFoot").fill("Confidentiel");
  await p.locator("#hfFootAl").selectOption("left"); await p.locator("#hfNum").selectOption("pageof"); await p.locator("#hfNumAl").selectOption("right");
  await p.locator("#hfSkip").check();
  ok(await p.locator(".hfk").count() === 6, "aperçu : en-tête, pied et numéro sur les pages 2 et 3 (" + await p.locator(".hfk").count() + ")");
  await p.locator("#hfOk").tap(); await p.waitForTimeout(300);
  f = await save("entetes.pdf");
  ok(!/Confidentiel|Page 1 sur/.test(pageText(f, 1)), "page 1 (page de garde) sans en-tête ni numéro");
  ok(/Dossier test/.test(pageText(f, 2)) && /Confidentiel/.test(pageText(f, 2)) && /Page 2 sur 3/.test(pageText(f, 2)) && /Page 3 sur 3/.test(pageText(f, 3)),
    "pages 2 et 3 : « Dossier test », « Confidentiel », « Page 2 sur 3 » (pdftotext)");
  /* après « Organiser », l'en-tête reste un réglage : pas de double impression */
  await menu("organize");
  await p.waitForFunction(() => document.querySelectorAll("#orgGrid .otile canvas").length === 3, null, { timeout: 20000 });
  await p.evaluate(() => { document.querySelector("#toast").textContent = ""; });
  await p.locator('#orgFoot [data-o="apply"]').tap();
  await p.waitForFunction(() => /Document mis à jour/.test(document.querySelector("#toast").textContent), null, { timeout: 30000 });
  f = await save("entetes-organise.pdf");
  ok((pageText(f, 2).match(/Confidentiel/g) || []).length === 1 && (pageText(f, 2).match(/Page 2 sur 3/g) || []).length === 1,
    "après « Organiser » : pied de page et numéro une seule fois (pas de doublon)");

  /* ================= 3. signets et sommaire */
  await open(fx("cmp-a.pdf"));
  await menu("outline"); await p.waitForSelector("#shOutline.on");
  ok(/Compte rendu de la sortie en mer/.test(await p.locator("#olList").textContent()), "sommaire existant (créé par LibreOffice) lu");
  await p.locator("#olDetect").tap();
  await p.waitForSelector("#shAsk.on"); await p.locator("#askOk").tap(); await p.waitForTimeout(800);
  const det = await p.locator("#olList li[data-p]").count();
  ok(det >= 1 && /Compte rendu de la sortie en mer/.test(await p.locator("#olList").textContent()), "titres détectés : " + det + " (« Compte rendu de la sortie en mer »)");
  await p.evaluate(() => { window.__pages = document.querySelectorAll(".page").length; });
  await p.evaluate(() => document.querySelector("#scrim").click());
  await p.locator("#viewer").evaluate(v => v.scrollTo(0, v.scrollHeight));
  await p.waitForTimeout(600);
  await menu("outline"); await p.waitForSelector("#shOutline.on");
  await p.locator("#olAdd").tap(); await p.waitForSelector("#shAsk.on"); await p.locator("#askInput").fill("Conclusion"); await p.locator("#askOk").tap();
  await p.waitForTimeout(500);
  ok(/Conclusion/.test(await p.locator("#olList").textContent()), "signet « Conclusion » ajouté pour la page affichée");
  await p.evaluate(() => document.querySelector("#scrim").click());
  f = await save("signets.pdf");
  if (pike) {
    const o = py(`import pikepdf,sys,json
p=pikepdf.open(sys.argv[1]); out=[]
with p.open_outline() as ol:
  def walk(items):
    for it in items:
      pg = None
      try:
        d = it.destination
        pg = next(i for i, q in enumerate(p.pages) if q.objgen == d[0].objgen)
      except Exception: pass
      out.append([it.title, pg]); walk(it.children)
  walk(ol.root)
print(json.dumps(out))`, f);
    ok(o.some(x => x[0] === "Compte rendu de la sortie en mer" && x[1] === 0) && o.some(x => x[0] === "Conclusion" && x[1] === 1),
      "signets écrits dans le PDF avec leur page (pikepdf) : " + o.map(x => x[0] + " → p. " + (x[1] + 1)).join(" ; "));
  }
  await open(f);
  await menu("outline"); await p.waitForSelector("#shOutline.on");
  ok(/Conclusion/.test(await p.locator("#olList").textContent()), "sommaire relu à la réouverture");
  await p.locator("#olList li[data-p] .olgo").last().tap(); await p.waitForTimeout(900);
  ok((await p.locator("#pageNum").textContent()).startsWith("2"), "toucher un signet : aller à sa page");

  /* ================= 4. données cachées */
  await open(fx("donnees-cachees.pdf"));
  await menu("privacy"); await p.waitForSelector("#shPrivacy.on", { timeout: 20000 });
  const found = await p.locator("#privList").textContent();
  console.log("  inspection : " + found.replace(/\s+/g, " ").slice(0, 400));
  ok(/Jean Secret/.test(found) && /Microsoft Word/.test(found) && /XMP/.test(found) && /Historique/.test(found) && /Pièces jointes/.test(found),
    "inspection : auteur, logiciel, XMP, historique, pièce jointe signalés");
  await p.locator("#privOn").check(); await p.locator("#privOk").tap(); await p.waitForTimeout(300);
  f = await save("nettoye.pdf");
  const info = run("pdfinfo", [f]), raw = fs.readFileSync(f).toString("latin1");
  ok(!/Author|Creator|Producer|Title/.test(info.split("Custom Metadata")[0]) && /Metadata Stream: no/.test(info), "après effacement : ni auteur, ni logiciel, ni titre, ni XMP (pdfinfo)");
  ok(!/Jean Secret|Version 1 auteur|Microsoft Word|notes-privees|Ne pas diffuser/.test(raw) && (raw.match(/%%EOF/g) || []).length === 1,
    "fichier : aucune trace de l'ancien auteur, de la pièce jointe ni de l'historique");
  ok(/Ligne de texte numéro 12/.test(pageText(f, 1)), "contenu des pages intact");

  /* ================= 5. lecture à voix haute */
  await open(fx("test.pdf"));
  await menu("speak");
  await p.waitForFunction(() => window.__spoken.length >= 3, null, { timeout: 10000 });
  ok(/Formulaire de test - page 1/.test((await p.evaluate(() => window.__spoken))[0]) && await p.locator("#ttsBar").isVisible(), "lecture lancée, phrase par phrase : « " + (await p.evaluate(() => window.__spoken[0])).slice(0, 40) + " »");
  ok(await p.locator(".ttshl").count() >= 1, "phrase lue surlignée sur la page");
  await p.locator("#ttsPlay").tap(); const n0 = await p.evaluate(() => window.__spoken.length); await p.waitForTimeout(400);
  ok(await p.evaluate(() => window.__spoken.length) === n0, "pause");
  await p.locator("#ttsRate").tap();
  ok(/1,25/.test(await p.locator("#ttsRate").textContent()), "vitesse × 1,25");
  await p.locator("#ttsStop").tap(); await p.waitForTimeout(200);
  ok(!(await p.locator("#ttsBar").isVisible()) && await p.locator(".ttshl").count() === 0, "arrêt de la lecture");

  /* ================= 6. organiser : page blanche, recadrage, A4 */
  await pickTool("fields", "ff-text"); await dragOn(60, 300, 250, 320);
  await menu("organize");
  await p.waitForFunction(() => document.querySelectorAll("#orgGrid .otile canvas").length === 3, null, { timeout: 20000 });
  await p.locator("#orgGrid .otile").nth(0).click({ position: { x: 20, y: 50 } });
  await p.locator('#orgFoot [data-o="blank"]').tap(); await p.waitForTimeout(400);
  ok(await p.locator("#orgGrid .otile").count() === 4 && /Page blanche/.test(await p.locator("#orgGrid .otile").nth(1).textContent()), "page blanche insérée après la page 1");
  await p.locator("#orgGrid .otile").nth(2).click({ position: { x: 20, y: 50 } });
  await p.locator('#orgFoot [data-o="crop"]').tap(); await p.waitForSelector("#shCrop.on"); await p.waitForTimeout(600);
  await p.locator("#cropAuto").tap(); await p.waitForTimeout(200);
  const autoL = +(await p.locator("#cropL").inputValue());
  ok(autoL > 0, "recadrage automatique des marges blanches (gauche : " + autoL + " %)");
  await p.locator("#cropOk").tap(); await p.waitForTimeout(500);
  await p.evaluate(() => { document.querySelector("#toast").textContent = ""; });
  await p.locator('#orgFoot [data-o="apply"]').tap();
  await p.waitForFunction(() => /Document mis à jour/.test(document.querySelector("#toast").textContent), null, { timeout: 30000 }); await p.waitForTimeout(500);
  f = out("organise.pdf"); fs.writeFileSync(f, Buffer.from(await p.evaluate(() => window.__docBytes())));
  ok(cropW(f, 3) < 595 * 0.95 && /Ligne de texte numéro 1/.test(pageText(f, 3)), "page 3 recadrée (largeur visible " + Math.round(cropW(f, 3)) + " pt sur 595), texte conservé");
  ok(pageText(f, 2).trim() === "", "page 2 blanche");
  ok(await p.locator(".item.ffield").count() === 1 && await p.locator(".page").first().locator(".item.ffield").count() === 1,
    "champ créé conservé sur sa page après réorganisation");
  await menu("organize");
  await p.waitForFunction(() => document.querySelectorAll("#orgGrid .otile canvas").length === 4, null, { timeout: 20000 });
  await p.locator('#orgFoot [data-o="a4"]').tap(); await p.waitForTimeout(400);
  await p.evaluate(() => { document.querySelector("#toast").textContent = ""; });
  await p.locator('#orgFoot [data-o="apply"]').tap();
  await p.waitForFunction(() => /Document mis à jour/.test(document.querySelector("#toast").textContent), null, { timeout: 30000 })
    .catch(async e => { console.log("  message : " + await p.locator("#toast").textContent(), errors); throw e; });
  await p.waitForTimeout(500);
  f = out("a4.pdf"); fs.writeFileSync(f, Buffer.from(await p.evaluate(() => window.__docBytes())));
  const sz = sizes(f);
  ok(sz.length === 4 && sz.every(s => Math.abs(s[0] - 595.28) < 1 && Math.abs(s[1] - 841.89) < 1), "toutes les pages au format A4 (pdfinfo) : " + sz.map(s => s.map(Math.round).join("×")).join(", "));
  ok(/Ligne de texte numéro 1/.test(pageText(f, 3)), "texte conservé dans la page mise au format A4");
  await p.locator("#btnUndo").tap();
  await p.waitForFunction(() => document.querySelectorAll(".page").length === 4, null, { timeout: 20000 }); await p.waitForTimeout(300);
  ok(true, "annuler la mise au format A4");

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
