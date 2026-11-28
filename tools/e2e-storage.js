// Test du stockage (version 4.4) : signatures dans IndexedDB, migration depuis le localStorage,
// capacité au-delà des ~5 Mo du localStorage, et version de pdf.js effectivement utilisée.
// Usage : node tools/serve.js 8765 & node tools/e2e-storage.js <test.pdf> [android|iphone]
const { chromium, devices } = require("playwright");
const [pdf, devName] = process.argv.slice(2);
const dev = devName === "iphone"
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1" }
  : devices["Pixel 7"];
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("✓ " + m); };
const URL0 = "http://localhost:8765/";

/* une « signature » : image PNG encodée (taille réglable) */
const PNG1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const fakeSig = (name, kb) => ({ name, src: "data:image/png;base64," + PNG1, pad: "x".repeat(kb * 1024) });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...dev, locale: "fr-FR" });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  const ready = () => p.waitForFunction(() => window.__storeReady).then(() => p.evaluate(() => window.__storeReady));
  const idb = () => p.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open("lesacapdf-data", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => { const t = r.result.transaction("kv").objectStore("kv"), q = t.getAllKeys(), v = t.getAll();
      v.onsuccess = () => { const o = {}; q.result.forEach((k, i) => o[k] = v.result[i]); r.result.close(); res(o); }; };
    r.onerror = () => rej(r.error);
  }));

  /* 1. données d'une version précédente : signatures dans le localStorage */
  await p.goto(URL0); await ready();
  await p.evaluate(sig => {
    localStorage.setItem("pdfed.profiles", JSON.stringify([{ id: "p1", name: "Mon profil" }]));
    localStorage.setItem("pdfed.current", JSON.stringify("p1"));
    localStorage.setItem("pdfed.sigs.p1", JSON.stringify([sig]));
    localStorage.setItem("pdfed.snips.p1", JSON.stringify([{ id: "t1", text: "Texte enregistré" }]));
  }, fakeSig("ancienne", 2));
  await p.reload(); await ready();
  const db1 = await idb();
  ok(Array.isArray(db1["sigs.p1"]) && db1["sigs.p1"][0].name === "ancienne", "migration : signature copiée dans IndexedDB");
  ok(await p.evaluate(() => localStorage.getItem("pdfed.sigs.p1")) === null, "migration : signature retirée du localStorage");
  ok(await p.evaluate(() => localStorage.getItem("pdfed.snips.p1")) !== null, "les textes enregistrés restent dans le localStorage");
  ok(/1 signature\b/.test(await p.locator("#profList").textContent()), "profil : 1 signature affichée après migration");

  /* 2. capacité : 8 signatures de 1 Mo (8 Mo, au-delà des ~5 Mo du localStorage) */
  await p.evaluate(list => { window.__testSave = list; }, Array.from({ length: 8 }, (_, i) => fakeSig("grande" + i, 1024)));
  /* même chemin que « Enregistrer la signature » : store.set("sigs.<profil>", liste) */
  const saved = await p.evaluate(() => !!window.__appStore && (window.__appStore.set("sigs.p1", window.__testSave), true));
  ok(saved, "accès de test au stockage de l'application");
  await p.waitForTimeout(1500);
  ok(!(await p.locator("#toast.on").count()) || !/pleine/.test(await p.locator("#toast").textContent()), "8 Mo de signatures : pas de message « mémoire pleine »");
  await p.reload(); await ready();
  const db2 = await idb();
  ok(db2["sigs.p1"] && db2["sigs.p1"].length === 8, "8 Mo de signatures conservées après redémarrage");
  ok(/8 signatures/.test(await p.locator("#profList").textContent()), "profil : 8 signatures affichées");

  /* 3. suppression d'un profil : ses signatures disparaissent aussi d'IndexedDB */
  await p.evaluate(() => window.__appStore.remove("sigs.p1"));
  await p.waitForTimeout(500);
  ok(!("sigs.p1" in await idb()), "suppression : signatures effacées d'IndexedDB");

  /* 4. pdf.js : version 6 utilisée, document ouvert */
  if (pdf) {
    await p.setInputFiles("#filePdf", pdf);
    await p.waitForFunction(() => document.querySelectorAll(".page canvas").length > 0, null, { timeout: 20000 });
    const v = await p.evaluate(() => window.__pdfjsVersion && window.__pdfjsVersion());
    ok(/^6\./.test(v || ""), "pdf.js version " + v + " utilisée");
  }

  /* 5. repli : navigateur incapable de charger pdf.js 6 → version 3.11 */
  if (pdf) {
    const ctx2 = await b.newContext({ ...dev, locale: "fr-FR" });
    await ctx2.route("**/vendor/pdfjs/pdf.min.js", r => r.fulfill({ status: 200, contentType: "text/javascript", body: "export const x = ;" }));
    const q = await ctx2.newPage();
    const warn = [];
    q.on("console", m => warn.push(m.text()));
    await q.goto(URL0); await q.setInputFiles("#filePdf", pdf);
    await q.waitForFunction(() => document.querySelectorAll(".page canvas").length > 0, null, { timeout: 20000 });
    const v2 = await q.evaluate(() => window.__pdfjsVersion());
    ok(/^3\.11/.test(v2), "repli automatique sur pdf.js " + v2 + " si la version 6 ne se charge pas");
    await ctx2.close();
  }

  /* 6. politique de sécurité (CSP) : un script injecté dans la page n'est pas exécuté */
  {
    const r = await b.newPage();
    await r.goto(URL0);
    const blocked = await r.evaluate(() => {
      const s = document.createElement("script"); s.textContent = "window.__injecte = 1"; document.head.appendChild(s);
      const i = document.createElement("img"); i.setAttribute("onerror", "window.__injecte2 = 1"); i.src = "data:,x"; document.body.appendChild(i);
      return new Promise(res => setTimeout(() => res(!window.__injecte && !window.__injecte2), 300));
    });
    ok(blocked, "CSP : script en ligne et attribut onerror injectés sont bloqués");
    const ext = await r.evaluate(() => new Promise(res => {
      document.addEventListener("securitypolicyviolation", e => res(/^img-src/.test(e.effectiveDirective)));
      const im = new Image(); im.src = "https://example.com/pixel.png"; setTimeout(() => res(false), 3000); }));
    ok(ext, "CSP : aucune ressource extérieure chargée (image distante bloquée)");
    await r.close();
  }

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
