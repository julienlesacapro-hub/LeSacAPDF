/* =========================================================================
   LeSacAPDF — remplissage de formulaires, texte, images et signatures.
   Version mobile (Android / iPhone) de l'éditeur PDF.
   100 % local : aucun fichier ne quitte l'appareil.
   © 2026 LESACA Julien — Tous droits réservés.
   ========================================================================= */
(function () {
"use strict";

const APP_VERSION = "4.3.0";

/* Lien de la page de don de l'association PROMEDNAV.
   À RENSEIGNER : tant qu'il est vide, le bouton « Faire un don » affiche
   « Le lien de don sera activé prochainement ». */
const DON_URL = "";
pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

/* ---------------------------------------------------------------- outils */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (id, cls) => '<svg' + (cls ? ' class="' + cls + '"' : "") + '><use href="#i-' + id + '"/></svg>';
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
              (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function toast(msg, ms) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), ms || 2600);
}
function busy(on, txt) {
  $("#spinTxt").textContent = txt || "Chargement…";
  $("#spin").classList.toggle("on", !!on);
}
const memStore = {};
const store = {
  get(k, d) { if (k in memStore) return memStore[k];
    try { const v = JSON.parse(localStorage.getItem("pdfed." + k)); if (v != null) return v; } catch (e) {}
    return d; },
  set(k, v) { memStore[k] = v;
    try { localStorage.setItem("pdfed." + k, JSON.stringify(v)); } catch (e) {
    toast("Mémoire de l'application pleine : conservé jusqu'à la fermeture.", 5000); } }
};
const CSS_FONT = { Helvetica: "Helvetica,Arial,sans-serif", Times: '"Times New Roman",Times,serif',
                   Courier: '"Courier New",Courier,monospace' };
const COLORS = ["#111111", "#15307a", "#c0392b", "#0a6b2f"];
const MARK_COLORS = ["#ffe14d", "#7be08a", "#ff9ecb", "#8fd3ff"];

/* -------------------------------------------------- profils utilisateurs
   Chaque utilisateur possède ses signatures, ses blocs de texte et ses
   préférences. Les données restent sur l'appareil.                        */
const PREF_DEF = { font: "Helvetica", size: 11, color: "#111111", bold: false, italic: false,
                   penColor: "#15307a", markColor: "#0a6b2f", crossColor: "#111111",
                   hiColor: "#ffe14d", circleColor: "#c0392b", circleThick: 1.6, flatten: true };
let PREF = Object.assign({}, PREF_DEF);

const Prof = {
  id: null,
  list() { return store.get("profiles", []); },
  key(k) { return k + "." + Prof.id; },
  name() { const p = Prof.list().find(x => x.id === Prof.id); return p ? p.name : ""; },

  init() {
    let list = store.get("profiles", null);
    if (!list || !list.length) {
      list = [{ id: "p1", name: "Mon profil" }];
      store.set("profiles", list);
      const oldSigs = store.get("sigs", null), oldSnips = store.get("snips", null);
      if (oldSigs) store.set("sigs.p1", oldSigs);
      if (oldSnips) store.set("snips.p1", oldSnips);
    }
    const cur = store.get("current", null);
    Prof.use(list.some(p => p.id === cur) ? cur : list[0].id);
  },

  use(id) {
    Prof.id = id;
    store.set("current", id);
    PREF = Object.assign({}, PREF_DEF, store.get(Prof.key("pref"), {}));
    $("#chkFlatten").checked = PREF.flatten !== false;
    $("#menuProf").textContent = Prof.name();
    Prof.render();
    Sigs.render(); Snips.render();
  },

  savePref() { store.set(Prof.key("pref"), PREF); },

  add(name) {
    const list = Prof.list();
    const id = "p" + Date.now().toString(36);
    list.push({ id, name });
    store.set("profiles", list);
    store.set("sigs." + id, []); store.set("snips." + id, []);
    Prof.use(id);
  },

  rename(name) {
    const list = Prof.list();
    const p = list.find(x => x.id === Prof.id);
    if (!p) return;
    p.name = name;
    store.set("profiles", list);
    Prof.use(Prof.id);
  },

  remove() {
    let list = Prof.list();
    if (list.length < 2) { toast("Il faut conserver au moins un utilisateur."); return; }
    list = list.filter(x => x.id !== Prof.id);
    ["sigs.", "snips.", "pref."].forEach(p => {
      delete memStore[p + Prof.id];
      try { localStorage.removeItem("pdfed." + p + Prof.id); } catch (e) {}
    });
    store.set("profiles", list);
    Prof.use(list[0].id);
  },

  render() {
    const host = $("#profList"); host.innerHTML = "";
    for (const p of Prof.list()) {
      const b = document.createElement("button");
      b.className = "chip" + (p.id === Prof.id ? " on" : "");
      const n = store.get("sigs." + p.id, []).length, t = store.get("snips." + p.id, []).length;
      b.innerHTML = icon("user") + '<span class="t"><b>' + esc(p.name) + "</b><small>" +
        n + " signature" + (n > 1 ? "s" : "") + " · " + t + " texte" + (t > 1 ? "s" : "") + "</small></span>";
      b.onclick = () => { Prof.use(p.id); toast("Utilisateur : " + p.name); };
      host.appendChild(b);
    }
  },

  exportAll() {
    const data = { app: "editeur-pdf", version: 1, profiles: Prof.list(), current: Prof.id, data: {} };
    for (const p of data.profiles) {
      data.data[p.id] = { sigs: store.get("sigs." + p.id, []), snips: store.get("snips." + p.id, []),
                          pref: store.get("pref." + p.id, {}) };
    }
    const name = "lesacapdf-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
    shareOrSave(new Blob([JSON.stringify(data)], { type: "application/json" }), name, "application/json");
  },

  importAll(json) {
    let d;
    try { d = JSON.parse(json); } catch (e) { toast("Fichier illisible."); return; }
    if (!d || d.app !== "editeur-pdf" || !Array.isArray(d.profiles)) {
      toast("Ce fichier n'est pas une sauvegarde de l'éditeur."); return;
    }
    const list = Prof.list();
    for (const p of d.profiles) {
      let id = p.id;
      if (list.some(x => x.id === id)) id = id + "b" + Date.now().toString(36).slice(-3);
      list.push({ id, name: p.name + (id === p.id ? "" : " (importé)") });
      const src = (d.data || {})[p.id] || {};
      store.set("sigs." + id, src.sigs || []);
      store.set("snips." + id, src.snips || []);
      store.set("pref." + id, src.pref || {});
    }
    store.set("profiles", list);
    Prof.use(list[list.length - 1].id);
    toast(d.profiles.length + " configuration(s) restaurée(s).");
  }
};

/* ---------------------------------------------------------------- état */
const S = {
  doc: null,          // document pdf.js
  bytes: null,        // copie des octets d'origine (pour pdf-lib)
  name: "document.pdf",
  pages: [],          // {num,view,rot,pw,ph,dw,dh,el,canvas,layer,page,task}
  scale: 1,
  tool: "select",
  items: [],          // annotations
  fields: [],         // champs AcroForm détectés
  values: {},         // valeurs saisies dans les champs AcroForm
  sel: null,
  pending: null,      // élément en attente de placement (signature, image, texte)
  undo: [], redo: [],
  cur: 0,             // page courante (index)
  out: null           // dernier PDF fabriqué {bytes,name}
};

/* =============================================================== feuilles
   Une seule feuille ouverte à la fois. Le bouton « retour » d'Android la
   ferme (entrée d'historique dédiée).                                     */
let curSheet = null;
function openSheet(id) {
  const el = $("#" + id);
  if (curSheet && curSheet !== el) curSheet.classList.remove("on");
  else if (!curSheet) { try { history.pushState({ sheet: 1 }, ""); } catch (e) {} }
  curSheet = el;
  el.classList.add("on");
  el.scrollTop = 0;
  $("#scrim").classList.add("on");
}
function hideSheet() {
  if (!curSheet) return;
  const el = curSheet;
  curSheet = null;
  el.classList.remove("on");
  $("#scrim").classList.remove("on");
  if (el.id === "shNewSig") $("#sigPad").dataset.ready = "";
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  if (el._onclose) { const f = el._onclose; el._onclose = null; f(); }
}
/* un seul « retour » à la fois : un second history.back() avant le popstate
   ferait quitter l'application */
let backPending = false;
function closeSheet() {
  if (!curSheet) return;
  if (history.state && history.state.sheet) {               /* popstate -> hideSheet */
    if (backPending) return;
    backPending = true; history.back();
  } else hideSheet();
}
window.addEventListener("popstate", () => { backPending = false; if (curSheet) hideSheet(); else hidePanel(); });

/* panneaux plein écran (organiser, aperçu, scanner), empilables */
const panels = [];
function openPanel(id) {
  const el = $("#" + id);
  if (panels.includes(el)) return;
  try { history.pushState({ panel: 1 }, ""); } catch (e) {}
  panels.push(el);
  el.classList.add("on");
}
function hidePanel() {
  const el = panels.pop();
  if (!el) return;
  el.classList.remove("on");
  if (el._onclose) { const f = el._onclose; el._onclose = null; f(); }
}
function closePanel() {
  if (!panels.length) return;
  if (history.state && history.state.panel) { if (backPending) return; backPending = true; history.back(); }
  else hidePanel();
}

/* glisser la feuille vers le bas pour la fermer */
function bindSheetDrag(sh) {
  let y0 = null, dy = 0;
  sh.addEventListener("touchstart", e => {
    if (sh.scrollTop > 0 || e.touches.length > 1) { y0 = null; return; }
    const t = e.target;
    if (t.closest("canvas,input,textarea,.chips,.thumbs,.tools")) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  sh.addEventListener("touchmove", e => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { sh.style.transition = "none"; sh.style.transform = "translateY(" + dy + "px)"; }
  }, { passive: true });
  sh.addEventListener("touchend", () => {
    if (y0 == null) return;
    sh.style.transition = ""; sh.style.transform = "";
    if (dy > 90) closeSheet();
    y0 = null;
  });
}

/* ============================================================== ouverture */
async function openFile(file) {
  if (!file) return false;
  if (!/\.pdf$/i.test(file.name || "") && file.type !== "application/pdf") {
    toast("Ce fichier n'est pas un PDF."); return false;
  }
  return openBytes(new Uint8Array(await file.arrayBuffer()), file.name || "document.pdf");
}

/* ouvre un PDF à partir de ses octets (fichier, document récent, scan, fusion…) */
async function openBytes(bytes, name, opt) {
  opt = opt || {};
  if (!opt.force && S.items.length && !(await ask("Ouvrir un autre document ?",
      "Les annotations non enregistrées du document actuel seront perdues.", null))) return false;
  busy(true, "Lecture du PDF…");
  try {
    const doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    if (S.doc) { try { S.doc.destroy(); } catch (e) {} }
    S.doc = doc;
    S.bytes = bytes.slice(0);                      // copie intacte pour l'export
    S.name = name || "document.pdf";
    S.srcSize = bytes.length;
    S.items = []; S.fields = []; S.values = {}; S.undo = []; S.redo = []; S.sel = null; S.cur = 0;
    S.pending = null; setTool("select");
    S.wm = null;
    Search.reset();
    $("#empty").hidden = true;
    document.body.classList.add("has-doc");
    await buildPages();
    await readFormFields();
    fitWidth(true);
    render();
    $("#btnSave").disabled = false; $("#btnShare").disabled = false;
    $("#pagePill").hidden = false;
    $("#docTitle").textContent = S.name.replace(/\.pdf$/i, "");
    updateSub();
    updatePill();
    updateUndo();
    document.title = S.name + " — LeSacAPDF";
    $("#viewer").scrollTo(0, 0);
    if (!opt.noRecent) Recents.addCurrent();
    return true;
  } catch (e) {
    console.error(e);
    const pw = e && e.name === "PasswordException";
    toast(pw ? "Ce PDF est protégé par un mot de passe : il ne peut pas être modifié ici."
             : "Impossible d'ouvrir ce PDF : " + (e && e.message ? e.message : e), 6000);
    return false;
  } finally { busy(false); }
}

function updateSub() {
  if (!S.doc) return;
  const n = S.doc.numPages;
  let t = n + " page" + (n > 1 ? "s" : "");
  if (S.fields.length) t += " · formulaire (" + S.fields.length + " champ" + (S.fields.length > 1 ? "s" : "") + ")";
  $("#docSub").textContent = t;
}

async function buildPages() {
  S.pages = [];
  for (let i = 1; i <= S.doc.numPages; i++) {
    const page = await S.doc.getPage(i);
    const view = page.view.slice();                    // [x1,y1,x2,y2]
    const rot = ((page.rotate % 360) + 360) % 360;
    const vp = page.getViewport({ scale: 1, rotation: rot });
    S.pages.push({
      num: i, page, view, rot,
      pw: view[2] - view[0], ph: view[3] - view[1],
      dw: vp.width, dh: vp.height,
      el: null, canvas: null, layer: null, task: null
    });
  }
}

/* ------------------------------------------------- rendu des pages (canvas) */
function render() {
  const host = $("#pages");
  host.innerHTML = "";
  for (const p of S.pages) {
    const d = document.createElement("div");
    d.className = "page";
    d.style.width = (p.dw * S.scale) + "px";
    d.style.height = (p.dh * S.scale) + "px";
    d.dataset.page = p.num;
    const cv = document.createElement("canvas");
    const layer = document.createElement("div");
    layer.className = "layer";
    const lab = document.createElement("div");
    lab.className = "pagelabel";
    lab.textContent = p.num + " / " + S.pages.length;
    d.append(cv, layer, lab);
    host.appendChild(d);
    p.el = d; p.canvas = cv; p.layer = layer;
    p.painted = false; p.at = 0;
    bindLayer(p);
  }
  observePages();
  renderItems();
  renderFields();
  Search.render();
  WM.render();
}

/* Les pages ne sont dessinées que lorsqu'elles approchent de l'écran, et
   libérées quand elles s'en éloignent : indispensable sur téléphone. */
let pageObs = null;
function observePages() {
  if (pageObs) pageObs.disconnect();
  pageObs = new IntersectionObserver(list => {
    for (const e of list) {
      const p = S.pages[+e.target.dataset.page - 1];
      if (!p) continue;
      if (e.isIntersecting) paint(p); else unpaint(p);
    }
  }, { root: $("#viewer"), rootMargin: "900px 300px" });
  for (const p of S.pages) pageObs.observe(p.el);
}

function cancelTask(p) {
  if (p.task) { try { p.task.cancel(); } catch (e) {} p.task = null; }
}

function unpaint(p) {
  if (!p.painted && !p.task) return;
  cancelTask(p);
  p.canvas.width = 1; p.canvas.height = 1;      /* libère la mémoire image */
  p.painted = false;
  try { p.page.cleanup(); } catch (e) {}
}

/* Safari iOS refuse les canvas trop grands (≈16 Mpx) et limite la mémoire
   totale des canvas : on plafonne chaque page. */
const MAX_PX = isIOS ? 5e6 : 9e6;
function paint(p) {
  if (!p.el) return;
  if (p.painted && p.at === S.scale && p.atRot === p.rot) return;
  let k = S.scale * Math.min(window.devicePixelRatio || 1, 2.5);
  const area = p.dw * p.dh * k * k;
  if (area > MAX_PX) k *= Math.sqrt(MAX_PX / area);
  const vp = p.page.getViewport({ scale: k, rotation: p.rot });
  cancelTask(p);
  const cv = p.canvas;
  cv.width = Math.floor(vp.width);
  cv.height = Math.floor(vp.height);
  cv.style.width = (p.dw * S.scale) + "px";
  cv.style.height = (p.dh * S.scale) + "px";
  p.task = p.page.render({ canvasContext: cv.getContext("2d"), viewport: vp });
  const at = S.scale, rot = p.rot;
  p.task.promise.then(() => { p.painted = true; p.at = at; p.atRot = rot; p.task = null; },
                      () => { p.task = null; });
}

function repaintAll() {
  for (const p of S.pages) {
    if (!p.el) continue;
    p.el.style.width = (p.dw * S.scale) + "px";
    p.el.style.height = (p.dh * S.scale) + "px";
    p.canvas.style.width = (p.dw * S.scale) + "px";
    p.canvas.style.height = (p.dh * S.scale) + "px";
    p.painted = false;
  }
  observePages();                               /* redessine ce qui est visible */
  renderItems(); renderFields(); Search.render(); WM.render();
}

let thumbObs = null;
function buildThumbs() {
  const host = $("#thumbs");
  host.innerHTML = "";
  if (thumbObs) thumbObs.disconnect();
  thumbObs = new IntersectionObserver(list => {
    for (const e of list) {
      if (!e.isIntersecting) continue;
      const p = S.pages[+e.target.dataset.page - 1];
      if (!p || e.target._done) continue;
      e.target._done = true;
      const cv = e.target.querySelector("canvas");
      const vp = p.page.getViewport({ scale: 180 / p.dw, rotation: p.rot });
      cv.width = vp.width; cv.height = vp.height;
      p.page.render({ canvasContext: cv.getContext("2d"), viewport: vp })
        .promise.catch(() => { e.target._done = false; });
    }
  }, { root: $("#shPages"), rootMargin: "300px 0px" });

  for (const p of S.pages) {
    const d = document.createElement("button");
    d.className = "thumb" + (p.num - 1 === S.cur ? " on" : "");
    d.dataset.page = p.num;
    const cv = document.createElement("canvas");
    const vp = p.page.getViewport({ scale: 1, rotation: p.rot });
    cv.width = 1; cv.height = 1;
    cv.style.aspectRatio = vp.width + " / " + vp.height;
    const tag = document.createElement("span"); tag.textContent = p.num;
    d.append(cv, tag);
    host.appendChild(d);
    d.onclick = () => { closeSheet(); goPage(p.num - 1); };
    thumbObs.observe(d);
  }
}
function goPage(i) {
  const p = S.pages[i]; if (!p) return;
  const v = $("#viewer");
  v.scrollTo({ top: p.el.offsetTop - 10, behavior: "smooth" });
}

/* ============================================ champs de formulaire AcroForm */
async function readFormFields() {
  let n = 0;
  for (const p of S.pages) {
    let annots = [];
    try { annots = await p.page.getAnnotations({ intent: "display" }); } catch (e) {}
    const vp = p.page.getViewport({ scale: 1, rotation: p.rot });
    for (const a of annots) {
      if (a.subtype !== "Widget" || !a.fieldName) continue;
      if (a.fieldType === "Btn" && a.pushButton) continue;
      const r = pdfjsLib.Util.normalizeRect(vp.convertToViewportRectangle(a.rect));
      const f = {
        name: a.fieldName, type: a.fieldType, page: p.num - 1,
        x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1],
        multiline: !!a.multiLine, options: a.options || [],
        radio: !!a.radioButton, check: !!a.checkBox,
        exportValue: a.buttonValue, size: a.defaultAppearanceData
          ? (a.defaultAppearanceData.fontSize || 0) : 0
      };
      if (S.values[f.name] === undefined) {
        S.values[f.name] = a.fieldValue != null ? a.fieldValue : (f.check || f.radio ? "Off" : "");
      }
      S.fields.push(f); n++;
    }
  }
  $("#flatRow").hidden = !n;
  if (n) toast(n + " champ" + (n > 1 ? "s" : "") + " à remplir détecté" + (n > 1 ? "s" : "") +
               " : touchez les zones bleues.", 4000);
}

function renderFields() {
  $$(".field").forEach(e => e.remove());
  for (const f of S.fields) {
    const p = S.pages[f.page]; if (!p || !p.layer) continue;
    let el;
    if (f.check || f.radio) {
      el = document.createElement("input");
      el.type = f.radio ? "radio" : "checkbox";
      if (f.radio) el.name = "rg_" + f.name;
      el.checked = f.radio ? S.values[f.name] === f.exportValue
                           : (S.values[f.name] && S.values[f.name] !== "Off");
      el.onchange = () => {
        S.values[f.name] = el.checked ? (f.exportValue || "Yes") : "Off";
      };
    } else if (f.options && f.options.length) {
      el = document.createElement("select");
      for (const o of f.options) {
        const op = document.createElement("option");
        op.value = o.exportValue != null ? o.exportValue : o;
        op.textContent = o.displayValue != null ? o.displayValue : o;
        el.appendChild(op);
      }
      el.value = S.values[f.name] || "";
      el.onchange = () => S.values[f.name] = el.value;
    } else {
      el = document.createElement(f.multiline ? "textarea" : "input");
      if (!f.multiline) el.type = "text";
      el.value = S.values[f.name] || "";
      el.oninput = () => S.values[f.name] = el.value;
      el.setAttribute("autocomplete", "off");
    }
    el.className = "field";
    el.title = f.name;
    el.style.left = (f.x * S.scale) + "px";
    el.style.top = (f.y * S.scale) + "px";
    if (f.check || f.radio) {
      const s = Math.min(f.w, f.h) * S.scale;
      el.style.width = s + "px"; el.style.height = s + "px";
    } else {
      el.style.width = (f.w * S.scale) + "px";
      el.style.height = (f.h * S.scale) + "px";
      el.style.fontSize = ((f.size || Math.min(12, f.h * 0.66)) * S.scale) + "px";
    }
    p.layer.appendChild(el);
  }
}

/* ==================================================== annotations : modèle */
function snapshot() {
  S.undo.push(JSON.stringify(S.items));
  if (S.undo.length > 60) S.undo.shift();
  S.redo.length = 0;
  updateUndo();
}
function updateUndo() {
  $("#btnUndo").disabled = !S.undo.length;
  $("#btnRedo").disabled = !S.redo.length;
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(S.items));
  S.items = JSON.parse(S.undo.pop());
  S.sel = null; renderItems(); showProps(); updateUndo();
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(S.items));
  S.items = JSON.parse(S.redo.pop());
  S.sel = null; renderItems(); showProps(); updateUndo();
}

function measure(it) {
  const c = measure._c || (measure._c = document.createElement("canvas").getContext("2d"));
  c.font = (it.italic ? "italic " : "") + (it.bold ? "bold " : "") +
           it.size + "px " + CSS_FONT[it.font];
  let w = 0;
  for (const l of String(it.text).split("\n")) w = Math.max(w, c.measureText(l || " ").width);
  it.w = Math.max(w + 2, 8);
  it.h = String(it.text).split("\n").length * it.size * 1.2;
}

function newText(page, x, y, text) {
  return { type: "text", page, x, y: y - PREF.size * 0.55, text,
    size: PREF.size, font: PREF.font, color: PREF.color,
    bold: !!PREF.bold, italic: !!PREF.italic };
}

function addItem(it) {
  snapshot();
  it.id = uid();
  S.items.push(it);
  renderItems();
  select(it.id);
  return it;
}
function removeItem(id) {
  snapshot();
  S.items = S.items.filter(i => i.id !== id);
  if (S.sel === id) S.sel = null;
  renderItems(); showProps();
}
function getSel() { return S.items.find(i => i.id === S.sel); }
function select(id) {
  S.sel = id;
  $$(".item").forEach(e => e.classList.toggle("sel", e.dataset.id === id));
  showProps();
}

/* -------------------------------------------- annotations : rendu DOM */
function renderItems() {
  $$(".item").forEach(e => e.remove());
  for (const it of S.items) {
    const p = S.pages[it.page]; if (!p || !p.layer) continue;
    const el = document.createElement("div");
    el.className = "item" + (it.type === "text" ? " txt" : "") + (S.sel === it.id ? " sel" : "");
    el.dataset.id = it.id;

    if (it.type === "text") {
      el.textContent = it.text;
      el.style.color = it.color;
      el.style.fontFamily = CSS_FONT[it.font];
      el.style.fontWeight = it.bold ? "700" : "400";
      el.style.fontStyle = it.italic ? "italic" : "normal";
    } else if (it.type === "image") {
      const img = document.createElement("img"); img.src = it.src; img.alt = ""; el.appendChild(img);
    } else if (it.type === "stamp") {
      el.classList.add("stamp");
      el.appendChild(stampSvg(it));
    } else if (it.type === "check" || it.type === "cross") {
      el.appendChild(markSvg(it));
    } else if (it.type === "circle") {
      el.appendChild(circleSvg(it));
    } else if (it.type === "pen" || it.type === "marker") {
      el.appendChild(strokeSvg(it));
      el.classList.add("stroke");
    } else if (it.type === "mask") {
      el.style.background = it.color || "#ffffff";
    } else if (it.type === "redact") {
      el.classList.add("redact");
    }

    let hd = null;
    if (it.type !== "pen" && it.type !== "marker") {
      hd = document.createElement("div"); hd.className = "hd";
      el.append(hd);
    }
    place(el, it);
    p.layer.appendChild(el);
    bindItem(el, it, hd);
  }
}

function place(el, it) {
  const s = S.scale;
  el.style.left = (it.x * s) + "px";
  el.style.top = (it.y * s) + "px";
  if (it.type === "text") {
    el.style.fontSize = (it.size * s) + "px";
  } else {
    el.style.width = (it.w * s) + "px";
    el.style.height = (it.h * s) + "px";
  }
  if (it.type === "circle" || it.type === "stamp") {   // le dessin suit la taille exacte
    const old = el.querySelector("svg");
    if (old) el.replaceChild(it.type === "circle" ? circleSvg(it) : stampSvg(it), old);
  }
}

const NS = "http://www.w3.org/2000/svg";
function markSvg(it) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", it.type === "check" ? "M12 54 L40 82 L88 16" : "M15 15 L85 85 M85 15 L15 85");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", it.color);
  path.setAttribute("stroke-width", "12");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

function circleSvg(it) {
  const w = Math.max(it.w, 2), h = Math.max(it.h, 2), t = it.thick || 1.6;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + w + " " + h);
  svg.setAttribute("preserveAspectRatio", "none");
  const e = document.createElementNS(NS, "ellipse");
  e.setAttribute("cx", w / 2); e.setAttribute("cy", h / 2);
  e.setAttribute("rx", Math.max(0.5, w / 2 - t / 2));
  e.setAttribute("ry", Math.max(0.5, h / 2 - t / 2));
  e.setAttribute("fill", "none");
  e.setAttribute("stroke", it.color);
  e.setAttribute("stroke-width", t);
  svg.appendChild(e);
  return svg;
}

function strokeSvg(it) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + Math.max(it.w, 1) + " " + Math.max(it.h, 1));
  const pl = document.createElementNS(NS, "polyline");
  pl.setAttribute("points", it.pts.map(p => (p[0] - it.x) + "," + (p[1] - it.y)).join(" "));
  pl.setAttribute("fill", "none");
  pl.setAttribute("stroke", it.color);
  pl.setAttribute("stroke-width", it.thick);
  pl.setAttribute("stroke-linecap", "round");
  pl.setAttribute("stroke-linejoin", "round");
  if (it.type === "marker") { pl.setAttribute("opacity", "0.4"); }
  svg.appendChild(pl);
  return svg;
}

/* ------------------------------------- annotations : glisser / redimensionner */
function bindItem(el, it, hd) {
  el.addEventListener("pointerdown", ev => {
    if (ev.target === hd || !ev.isPrimary) return;
    ev.stopPropagation();
    const wasSel = S.sel === it.id;
    select(it.id);
    const p = S.pages[it.page];
    const start = { x: ev.clientX, y: ev.clientY, ix: it.x, iy: it.y, moved: false };
    try { el.setPointerCapture(ev.pointerId); } catch (e) {}
    const move = e => {
      const dx = (e.clientX - start.x) / S.scale, dy = (e.clientY - start.y) / S.scale;
      if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      if (!start.moved) { snapshot(); start.moved = true; }
      it.x = clamp(start.ix + dx, -it.w + 8, p.dw - 8);
      it.y = clamp(start.iy + dy, -it.h + 8, p.dh - 8);
      place(el, it);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      /* second appui sur un texte déjà sélectionné : modification */
      if (!start.moved && wasSel && it.type === "text") editTextSheet(it);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
  el.addEventListener("click", ev => ev.stopPropagation());
  if (it.type === "text") el.addEventListener("dblclick", () => editTextSheet(it));

  if (hd) hd.addEventListener("pointerdown", ev => {
    ev.stopPropagation(); ev.preventDefault();
    select(it.id); snapshot();
    const start = { x: ev.clientX, y: ev.clientY, w: it.w, h: it.h, s: it.size };
    try { hd.setPointerCapture(ev.pointerId); } catch (e) {}
    const move = e => {
      const dx = (e.clientX - start.x) / S.scale, dy = (e.clientY - start.y) / S.scale;
      if (it.type === "text" || it.type === "stamp") {
        it.size = clamp(Math.round((start.s * (1 + dx / Math.max(start.w, 40))) * 10) / 10, 4, 96);
        it.type === "stamp" ? measureStamp(it) : measure(it);
      } else {
        const r = start.w / start.h;
        it.w = Math.max(6, start.w + dx);
        it.h = it.lockRatio ? it.w / r : Math.max(6, start.h + dy);
      }
      place(el, it);
    };
    const up = () => {
      hd.removeEventListener("pointermove", move);
      hd.removeEventListener("pointerup", up);
      hd.removeEventListener("pointercancel", up);
      showProps();
    };
    hd.addEventListener("pointermove", move);
    hd.addEventListener("pointerup", up);
    hd.addEventListener("pointercancel", up);
  });
}

/* ------------------------------------------- saisie / modification de texte */
let txtMode = null;   /* {kind:"new", page, x, y} | {kind:"edit", it} | {kind:"snip"} */
function textSheet(mode, title, value, withName) {
  txtMode = mode;
  $("#txtTitle").textContent = title;
  $("#txtNameRow").hidden = !withName;
  $("#txtName").value = "";
  const ta = $("#txtArea");
  ta.value = value || "";
  openSheet("shText");
  /* focus dans le même geste : indispensable pour ouvrir le clavier sur iPhone */
  (withName ? $("#txtName") : ta).focus();
  if (!withName) { try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {} }
}
function editTextSheet(it) { textSheet({ kind: "edit", it }, "Modifier le texte", it.text, false); }

function textOk() {
  const t = $("#txtArea").value.replace(/\r/g, "");
  const m = txtMode;
  if (!m) return closeSheet();
  if (m.kind === "snip") {
    if (!t.trim()) { toast("Le texte est vide."); return; }
    const l = Snips.all();
    l.push({ name: $("#txtName").value.trim() || t.split("\n")[0].slice(0, 28), text: t });
    Snips.save(l);
    closeSheet();
    toast("Texte enregistré.");
    return;
  }
  closeSheet();
  if (m.kind === "new") {
    if (!t.trim()) return;
    const it = newText(m.page, m.x, m.y, t);
    measure(it);
    addItem(it);
  } else if (m.kind === "edit") {
    const it = m.it;
    if (t === it.text) return;
    if (!t.trim()) { removeItem(it.id); return; }
    snapshot(); it.text = t; measure(it); renderItems(); showProps();
  }
}

/* ================================================= interactions sur la page */
let stroke = null;      /* tracé en cours, annulable si un 2e doigt se pose */
function layerPos(p, ev) {
  const r = p.layer.getBoundingClientRect();
  return [(ev.clientX - r.left) / S.scale, (ev.clientY - r.top) / S.scale];
}
function bindLayer(p) {
  /* outils « glissés » : stylo, surligneur, masque */
  p.layer.addEventListener("pointerdown", ev => {
    if (!ev.isPrimary || pinch) return;
    if (ev.target.classList.contains("field") || ev.target.closest(".item")) return;
    S.cur = p.num - 1;
    if (S.pending) return;
    const [x, y] = layerPos(p, ev);
    if (S.tool === "mask" || S.tool === "redact") { ev.preventDefault(); dragRect(p, ev, x, y, S.tool); }
    else if (S.tool === "pen" || S.tool === "marker") { ev.preventDefault(); drawStroke(p, ev, x, y); }
  });
  /* outils « touchés » : un appui bref (pas de défilement) */
  p.layer.addEventListener("click", ev => {
    if (ev.target.classList.contains("field") || ev.target.closest(".item")) return;
    const [x, y] = layerPos(p, ev);
    S.cur = p.num - 1;
    if (S.pending) { placePending(p, x, y); return; }
    switch (S.tool) {
      case "select":
        select(null); break;
      case "text":
        setTool("select");
        textSheet({ kind: "new", page: p.num - 1, x, y }, "Nouveau texte", "", false);
        break;
      case "check": case "cross": {
        const s = 14;
        addItem({ type: S.tool, page: p.num - 1, x: x - s / 2, y: y - s / 2, w: s, h: s,
          color: S.tool === "check" ? PREF.markColor : PREF.crossColor, lockRatio: true });
        select(null);
        /* l'outil reste actif : pratique pour cocher plusieurs cases */
        break;
      }
      case "circle": {
        const w = 84, h = 26;
        addItem({ type: "circle", page: p.num - 1, x: x - w / 2, y: y - h / 2, w, h,
          color: PREF.circleColor, thick: PREF.circleThick });
        setTool("select");
        break;
      }
    }
  });
}

function dragRect(p, ev, x0, y0, kind) {
  const ghost = document.createElement("div");
  ghost.style.cssText = "position:absolute;background:" + (kind === "redact" ? "#000" : "#fff") + ";outline:1.5px dashed #2D6CDF;";
  p.layer.appendChild(ghost);
  const r = p.layer.getBoundingClientRect();
  let x1 = x0, y1 = y0;
  const move = e => {
    x1 = (e.clientX - r.left) / S.scale; y1 = (e.clientY - r.top) / S.scale;
    ghost.style.left = (Math.min(x1, x0) * S.scale) + "px";
    ghost.style.top = (Math.min(y1, y0) * S.scale) + "px";
    ghost.style.width = (Math.abs(x1 - x0) * S.scale) + "px";
    ghost.style.height = (Math.abs(y1 - y0) * S.scale) + "px";
  };
  const end = ok => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", upH);
    window.removeEventListener("pointercancel", cancelH);
    ghost.remove();
    stroke = null;
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    if (ok && w > 4 && h > 4) {
      addItem({ type: kind === "redact" ? "redact" : "mask", page: p.num - 1, x: Math.min(x1, x0), y: Math.min(y1, y0), w, h,
        color: kind === "redact" ? "#000000" : "#ffffff" });
      setTool("select");
    }
  };
  const upH = () => end(true), cancelH = () => end(false);
  stroke = { cancel: cancelH };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", upH);
  window.addEventListener("pointercancel", cancelH);
}

function drawStroke(p, ev, x0, y0) {
  const marker = S.tool === "marker";
  const it = { id: uid(), type: S.tool, page: p.num - 1, pts: [[x0, y0]],
    color: marker ? (PREF.hiColor || "#ffe14d") : (PREF.penColor || "#15307a"), thick: marker ? 14 : 1.6,
    x: x0, y: y0, w: 1, h: 1 };
  const r = p.layer.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "item stroke"; el.dataset.id = it.id;
  el.style.left = "0px"; el.style.top = "0px";
  el.style.width = (p.dw * S.scale) + "px"; el.style.height = (p.dh * S.scale) + "px";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + p.dw + " " + p.dh);
  const pl = document.createElementNS(NS, "polyline");
  pl.setAttribute("fill", "none"); pl.setAttribute("stroke", it.color);
  pl.setAttribute("stroke-width", it.thick); pl.setAttribute("stroke-linecap", "round");
  pl.setAttribute("stroke-linejoin", "round");
  if (marker) pl.setAttribute("opacity", "0.4");
  svg.appendChild(pl); el.appendChild(svg); p.layer.appendChild(el);

  const move = e => {
    if (!e.isPrimary) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of (evs.length ? evs : [e])) {
      const x = (ce.clientX - r.left) / S.scale, y = (ce.clientY - r.top) / S.scale;
      const last = it.pts[it.pts.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 0.8) continue;
      it.pts.push([x, y]);
    }
    pl.setAttribute("points", it.pts.map(q => q[0] + "," + q[1]).join(" "));
  };
  const end = ok => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", upH);
    window.removeEventListener("pointercancel", cancelH);
    el.remove();
    stroke = null;
    if (!ok || it.pts.length < 2) return;
    const xs = it.pts.map(q => q[0]), ys = it.pts.map(q => q[1]);
    it.x = Math.min.apply(null, xs); it.y = Math.min.apply(null, ys);
    it.w = Math.max(1, Math.max.apply(null, xs) - it.x);
    it.h = Math.max(1, Math.max.apply(null, ys) - it.y);
    snapshot(); S.items.push(it); renderItems();
  };
  const upH = () => end(true), cancelH = () => end(false);
  stroke = { cancel: cancelH };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", upH);
  window.addEventListener("pointercancel", cancelH);
}

function placePending(p, x, y) {
  const pd = S.pending;
  S.pending = null;
  if (pd.kind === "image") {
    const w = pd.w || 160, h = w * (pd.ratio || 0.4);
    addItem({ type: "image", page: p.num - 1, x: x - w / 2, y: y - h / 2, w, h,
      src: pd.src, lockRatio: true });
  } else if (pd.kind === "stamp") {
    const it = { type: "stamp", page: p.num - 1, x, y, lines: pd.lines, size: PREF.stampSize || 12,
                 color: PREF.stampColor || "#c0392b" };
    measureStamp(it);
    it.x = x - it.w / 2; it.y = y - it.h / 2;
    addItem(it);
  } else if (pd.kind === "text") {
    const it = newText(p.num - 1, x, y, pd.text);
    measure(it);
    addItem(it);
  }
  setTool("select");
}

function setPending(pd, msg) {
  if (!S.doc) { toast("Ouvrez d'abord un PDF."); return; }
  S.pending = pd;
  setTool("select", true);
  showHint(msg);
}

/* ================================================ barre contextuelle (ctx) */
function showProps() {
  const bar = $("#ctxBar");
  const it = getSel();
  if (!it || S.tool !== "select" || S.pending) { bar.hidden = true; bar.innerHTML = ""; document.body.classList.remove("has-sel"); return; }
  const b = (act, html, cls, label) => '<button class="cb ' + (cls || "") + '" data-a="' + act + '"' +
    (label ? ' aria-label="' + label + '"' : "") + ">" + html + "</button>";
  const sep = '<span class="sep"></span>';
  const dots = cur => COLORS.map(c => '<button class="cb" data-a="color" data-c="' + c + '" aria-label="Couleur">' +
    '<span class="dot' + ((cur || "").toLowerCase() === c ? " on" : "") + '" style="background:' + c + '"></span></button>').join("");
  let h = "";
  if (it.type === "text") {
    h += b("edit", icon("edit") + "Modifier") + sep;
    h += b("smaller", icon("minus"), "", "Plus petit") + '<span class="val">' + (Math.round(it.size * 2) / 2) + "</span>" +
         b("bigger", icon("plus"), "", "Plus grand") + sep;
    h += b("bold", "<b>G</b>", it.bold ? "on" : "", "Gras") + b("italic", "<i>I</i>", it.italic ? "on" : "", "Italique");
    h += b("font", '<span style="font-family:' + CSS_FONT[it.font].replace(/"/g, "'") + '">Aa</span>', "", "Police") + sep;
    h += dots(it.color) + sep;
  } else if (it.type === "stamp") {
    h += dots(it.color) + sep + b("smaller", icon("minus"), "", "Plus petit") +
         '<span class="val">' + (Math.round(it.size * 2) / 2) + "</span>" + b("bigger", icon("plus"), "", "Plus grand") + sep;
  } else if (it.type === "check" || it.type === "cross") {
    h += dots(it.color) + sep + b("smaller", icon("minus"), "", "Plus petit") + b("bigger", icon("plus"), "", "Plus grand") + sep;
  } else if (it.type === "circle") {
    h += dots(it.color) + sep + b("thin", icon("minus"), "", "Plus fin") +
         '<span class="val">' + (it.thick || 1.6) + "</span>" + b("thick", icon("plus"), "", "Plus épais") + sep;
  } else if (it.type === "image") {
    h += b("smaller", icon("minus"), "", "Plus petit") + b("bigger", icon("plus"), "", "Plus grand") + sep;
  }
  h += b("dup", icon("copy"), "", "Dupliquer") + b("del", icon("trash"), "danger", "Supprimer");
  bar.innerHTML = h;
  bar.hidden = false;
  document.body.classList.add("has-sel");   /* la barre recouvre ▶ et le compteur de pages : on les masque */
}

function ctxAction(a, el) {
  const it = getSel(); if (!it) return;
  const keep = () => {
    if (it.type === "text") {
      PREF.font = it.font; PREF.size = it.size; PREF.color = it.color;
      PREF.bold = it.bold; PREF.italic = it.italic;
    } else if (it.type === "check") PREF.markColor = it.color;
    else if (it.type === "cross") PREF.crossColor = it.color;
    else if (it.type === "circle") { PREF.circleColor = it.color; PREF.circleThick = it.thick; }
    else if (it.type === "stamp") { PREF.stampColor = it.color; PREF.stampSize = it.size; }
    Prof.savePref();
  };
  const scaleBox = k => {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    it.w = Math.max(6, it.w * k); it.h = Math.max(6, it.h * k);
    it.x = cx - it.w / 2; it.y = cy - it.h / 2;
  };
  switch (a) {
    case "edit": editTextSheet(it); return;
    case "del": removeItem(it.id); return;
    case "dup": {
      const c = JSON.parse(JSON.stringify(it));
      c.id = uid(); c.x += 12; c.y += 12;
      if (c.pts) c.pts = c.pts.map(q => [q[0] + 12, q[1] + 12]);
      snapshot(); S.items.push(c); renderItems(); select(c.id);
      return;
    }
    case "color": snapshot(); it.color = el.dataset.c; break;
    case "bold": snapshot(); it.bold = !it.bold; measure(it); break;
    case "italic": snapshot(); it.italic = !it.italic; measure(it); break;
    case "font": {
      snapshot();
      const f = ["Helvetica", "Times", "Courier"];
      it.font = f[(f.indexOf(it.font) + 1) % 3]; measure(it);
      toast("Police : " + it.font, 1200);
      break;
    }
    case "smaller": case "bigger": {
      snapshot();
      if (it.type === "text") { it.size = clamp(it.size + (a === "bigger" ? 1 : -1), 4, 96); measure(it); }
      else if (it.type === "stamp") {
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
        it.size = clamp(it.size + (a === "bigger" ? 1 : -1), 5, 60); measureStamp(it);
        it.x = cx - it.w / 2; it.y = cy - it.h / 2;
      }
      else scaleBox(a === "bigger" ? 1.15 : 1 / 1.15);
      break;
    }
    case "thin": case "thick":
      snapshot(); it.thick = clamp(Math.round(((it.thick || 1.6) + (a === "thick" ? 0.4 : -0.4)) * 10) / 10, 0.4, 12); break;
  }
  keep();
  renderItems(); showProps(); updateUndo();
}

/* ============================================================ outils / zoom */
const HINTS = {
  text: "Touchez la page à l'endroit du texte",
  check: "Touchez chaque case à cocher",
  cross: "Touchez chaque case à marquer d'une croix",
  circle: "Touchez le mot ou la zone à entourer",
  pen: "Dessinez avec le doigt",
  marker: "Passez le doigt sur le texte à surligner",
  mask: "Tracez un rectangle sur la zone à cacher",
  redact: "Tracez un rectangle sur ce qui doit disparaître définitivement"
};
function setTool(t, keepPending) {
  if (!keepPending) S.pending = null;
  S.tool = t;
  if (t !== "select") S.sel = null;
  $$(".tool[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t && !S.pending));
  document.body.classList.toggle("drawing", t === "pen" || t === "marker" || t === "mask" || t === "redact");
  if (t === "redact" && !S.redactInfo) {
    S.redactInfo = true;
    toast("Censure : les zones noires seront définitivement supprimées à l'enregistrement (la page concernée devient une image).", 6000);
  }
  document.body.classList.toggle("placing", t !== "select" || !!S.pending);
  if (t !== "select") $$(".item").forEach(e => e.classList.remove("sel"));
  if (t === "select" && !S.pending) hideHint();
  else if (t !== "select") showHint(HINTS[t], t);
  showProps();
}
function showHint(msg, tool) {
  const bar = $("#hintBar");
  let extra = "";
  if (tool === "pen" || tool === "marker") {
    const list = tool === "pen" ? COLORS : MARK_COLORS;
    const cur = tool === "pen" ? PREF.penColor : PREF.hiColor;
    extra = list.map(c => '<button class="hc" data-c="' + c + '" style="background:transparent;padding:0 2px">' +
      '<span class="dot' + (c === cur ? " on" : "") + '" style="display:block;width:22px;height:22px;background:' + c + '"></span></button>').join("");
  }
  $("#hintTxt").innerHTML = esc(msg);
  $$("#hintBar .hc").forEach(e => e.remove());
  if (extra) $("#hintDone").insertAdjacentHTML("beforebegin", extra);
  $$("#hintBar .hc").forEach(btn => btn.onclick = () => {
    if (tool === "pen") PREF.penColor = btn.dataset.c; else PREF.hiColor = btn.dataset.c;
    Prof.savePref(); showHint(msg, tool);
  });
  $("#hintDone").textContent = S.pending ? "Annuler" : "Terminé";
  bar.hidden = false;
}
function hideHint() { $("#hintBar").hidden = true; }

function setScale(v) {
  S.scale = clamp(v, 0.2, 5);
  repaintAll();
}
function fitWidth(silent) {
  if (!S.pages.length) return;
  const w = $("#viewer").clientWidth - 24;
  const maxW = Math.max.apply(null, S.pages.map(p => p.dw));
  const s = clamp(w / maxW, 0.2, 2.2);
  if (silent) S.scale = s; else setScale(s);
}

/* -------------------------------------------- pincer pour zoomer (2 doigts) */
let pinch = null;
function initPinch() {
  const v = $("#viewer"), host = $("#pages");
  const mid = (a, b) => [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  v.addEventListener("touchstart", e => {
    if (e.touches.length !== 2 || !S.doc) return;
    if (stroke) stroke.cancel();
    const r = v.getBoundingClientRect();
    const [mx, my] = mid(e.touches[0], e.touches[1]);
    pinch = { d0: dist(e.touches[0], e.touches[1]), mx: mx - r.left, my: my - r.top, x0: mx, y0: my,
              sl: v.scrollLeft, st: v.scrollTop, k: 1, dx: 0, dy: 0 };
    host.style.transformOrigin = (pinch.sl + pinch.mx) + "px " + (pinch.st + pinch.my) + "px";
    host.classList.add("pinch");
  }, { passive: true });
  v.addEventListener("touchmove", e => {
    if (!pinch || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const [mx, my] = mid(e.touches[0], e.touches[1]);
    pinch.k = clamp(dist(e.touches[0], e.touches[1]) / pinch.d0, 0.2 / S.scale, 5 / S.scale);
    pinch.dx = mx - pinch.x0; pinch.dy = my - pinch.y0;
    host.style.transform = "translate(" + pinch.dx + "px," + pinch.dy + "px) scale(" + pinch.k + ")";
  }, { passive: false });
  const end = e => {
    if (!pinch || e.touches.length >= 2) return;
    const pz = pinch; pinch = null;
    host.style.transform = ""; host.classList.remove("pinch");
    if (Math.abs(pz.k - 1) < 0.02 && Math.hypot(pz.dx, pz.dy) < 2) return;
    const s0 = S.scale;
    setScale(s0 * pz.k);
    const k = S.scale / s0;
    v.scrollLeft = (pz.sl + pz.mx) * k - pz.mx - pz.dx;
    v.scrollTop = (pz.st + pz.my) * k - pz.my - pz.dy;
  };
  v.addEventListener("touchend", end);
  v.addEventListener("touchcancel", end);
  /* Safari : empêche le zoom de toute l'interface */
  ["gesturestart", "gesturechange"].forEach(n => document.addEventListener(n, e => e.preventDefault()));
  /* ordinateur : Ctrl + molette */
  v.addEventListener("wheel", e => {
    if (!e.ctrlKey || !S.doc) return;
    e.preventDefault();
    setScale(S.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
}

/* ============================================================ signatures */
const Sigs = {
  all: () => store.get(Prof.key("sigs"), []),
  save(list) { store.set(Prof.key("sigs"), list); Sigs.render(); Prof.render(); },
  render() {
    for (const hostId of ["#sigList", "#sigList2"]) {
      const host = $(hostId); host.innerHTML = "";
      const list = Sigs.all();
      if (!list.length) {
        host.innerHTML = '<div class="empty-note">Aucune signature pour l\'instant. ' +
          "Créez-la une fois : elle restera disponible sur cet appareil.</div>";
        continue;
      }
      list.forEach((s, i) => {
        const d = document.createElement("div"); d.className = "chip"; d.setAttribute("role", "button");
        d.innerHTML = '<img alt="" src="' + s.src + '"><span class="t"><b>' + esc(s.name) + "</b></span>" +
          '<button class="x" aria-label="Supprimer">' + icon("trash") + "</button>";
        d.querySelector(".x").onclick = async ev => {
          ev.stopPropagation();
          if (!(await ask("Supprimer « " + s.name + " » ?", "Cette signature sera effacée de l'appareil.", null))) return;
          const l = Sigs.all(); l.splice(i, 1); Sigs.save(l);
        };
        d.onclick = () => Sigs.use(s);
        host.appendChild(d);
      });
    }
  },
  use(s) {
    if (!S.doc) { toast("Ouvrez d'abord un PDF."); return; }
    const im = new Image();
    im.onload = () => {
      closeSheet();
      setPending({ kind: "image", src: s.src, w: 150, ratio: im.height / im.width },
                 "Touchez l'endroit où placer la signature");
    };
    im.src = s.src;
  }
};

function initSigSheet() {
  const pad = $("#sigPad");
  let ctx = null, drawing = false, last = null, imported = null, color = "#15307a";

  const sw = $("#sigColors");
  ["#15307a", "#111111", "#1d4ed8"].forEach(c => {
    const b = document.createElement("button");
    b.innerHTML = '<span class="dot' + (c === color ? " on" : "") + '" style="background:' + c + '"></span>';
    b.onclick = () => { color = c; $$(".dot", sw).forEach(d => d.classList.toggle("on", d.style.background === b.firstChild.style.background)); };
    sw.appendChild(b);
  });

  function fitPad() {
    const r = pad.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr);
    ctx = pad.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = ctx.lineCap = "round";
    pad.dataset.ready = "1";
  }
  const pos = e => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  pad.addEventListener("pointerdown", e => {
    if (!pad.dataset.ready) fitPad();
    try { pad.setPointerCapture(e.pointerId); } catch (er) {}
    drawing = true; last = pos(e);
    ctx.beginPath(); ctx.arc(last[0], last[1], $("#sigW").value / 2, 0, 7);
    ctx.fillStyle = color; ctx.fill();
  });
  pad.addEventListener("pointermove", e => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    ctx.strokeStyle = color;
    ctx.lineWidth = +$("#sigW").value;
    for (const ce of (evs.length ? evs : [e])) {
      const p = pos(ce);
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      last = p;
    }
  });
  ["pointerup", "pointercancel"].forEach(ev => pad.addEventListener(ev, () => drawing = false));
  $("#sigClear").onclick = () => { if (ctx) ctx.clearRect(0, 0, pad.width, pad.height); };
  window.addEventListener("resize", () => { if ($("#shNewSig").classList.contains("on")) fitPad(); });

  $$("#sigTabs button").forEach(b => b.onclick = () => {
    $$("#sigTabs button").forEach(x => x.classList.toggle("on", x === b));
    $$("#shNewSig .pane").forEach(p => p.classList.toggle("on", p.dataset.pane === b.dataset.tab));
    if (b.dataset.tab === "draw") setTimeout(fitPad, 30);
  });

  $("#sigPick").onclick = () => $("#fileSig").click();
  $("#fileSig").onchange = e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      imported = await downscale(rd.result, 1600);
      refreshPrev();
      if (!$("#sigName").value) $("#sigName").value = (f.name || "").replace(/\.[^.]+$/, "").slice(0, 30);
    };
    rd.readAsDataURL(f);
  };
  const refreshPrev = async () => {
    if (!imported) return;
    $("#sigThrV").textContent = $("#sigThr").value;
    const out = $("#sigTrans").checked
      ? await cleanSignature(imported, +$("#sigThr").value) : imported;
    $("#sigPrev").src = out;
    $("#sigPrev").dataset.out = out;
  };
  $("#sigThr").oninput = refreshPrev;
  $("#sigTrans").onchange = refreshPrev;

  Sigs.openNew = () => {
    $("#sigName").value = "";
    imported = null; $("#sigPrev").removeAttribute("src"); delete $("#sigPrev").dataset.out;
    $$("#sigTabs button")[0].click();
    openSheet("shNewSig");
    setTimeout(() => { fitPad(); }, 320);
  };
  $("#btnNewSig").onclick = Sigs.openNew;

  $("#sigSave").onclick = () => {
    const useDraw = $("#sigTabs .on").dataset.tab === "draw";
    let src;
    if (useDraw) {
      src = pad.dataset.ready ? trimCanvas(pad) : null;
      if (!src) { toast("Signez d'abord dans le cadre."); return; }
    } else {
      src = $("#sigPrev").dataset.out || imported;
      if (!src) { toast("Choisissez une image."); return; }
    }
    const list = Sigs.all();
    const s = { name: $("#sigName").value.trim() || ("Signature " + (list.length + 1)), src };
    list.push(s);
    Sigs.save(list);
    closeSheet();
    toast("Signature enregistrée.");
    if (S.doc) setTimeout(() => Sigs.use(s), 350);
  };
}

/* réduit une image trop grande (photos de téléphone : 12 Mpx et plus) */
function downscale(src, max) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k >= 1) { res(src); return; }
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      res(/^data:image\/png/i.test(src) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => res(src);
    img.src = src;
  });
}

/* rend le fond blanc transparent, puis recadre sur le tracé */
function cleanSignature(src, thr) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const max = 1400, k = Math.min(1, max / Math.max(img.width, img.height));
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0, c.width, c.height);
      const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
      const lo = thr * 0.45;
      for (let i = 0; i < a.length; i += 4) {
        const lum = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
        let al = lum >= thr ? 0 : (lum <= lo ? 255 : Math.round(255 * (thr - lum) / (thr - lo)));
        a[i + 3] = Math.min(a[i + 3], al);
        if (al > 0) { const f = 0.75; a[i] *= f; a[i + 1] *= f; a[i + 2] *= f; }
      }
      x.putImageData(d, 0, 0);
      res(trimCanvas(c) || c.toDataURL("image/png"));
    };
    img.onerror = () => res(src);
    img.src = src;
  });
}

/* recadre un canvas sur ses pixels non transparents */
function trimCanvas(cv) {
  const x = cv.getContext("2d");
  const d = x.getImageData(0, 0, cv.width, cv.height).data;
  let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) for (let X = 0; X < cv.width; X++) {
    if (d[(y * cv.width + X) * 4 + 3] > 8) {
      if (X < x0) x0 = X; if (X > x1) x1 = X;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(cv.width - 1, x1 + pad); y1 = Math.min(cv.height - 1, y1 + pad);
  const o = document.createElement("canvas");
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d").drawImage(cv, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL("image/png");
}

/* ======================================================= blocs de texte */
const Snips = {
  all: () => store.get(Prof.key("snips"), []),
  save(l) { store.set(Prof.key("snips"), l); Snips.render(); Prof.render(); },
  render() {
    for (const hostId of ["#snipList", "#snipList2"]) {
      const host = $(hostId); host.innerHTML = "";
      const list = Snips.all();
      if (!list.length) {
        host.innerHTML = '<div class="empty-note">Enregistrez ici les textes que vous réutilisez ' +
          "(en-tête, adresse, RPPS…).</div>";
        continue;
      }
      list.forEach((s, i) => {
        const d = document.createElement("div"); d.className = "chip"; d.setAttribute("role", "button");
        d.innerHTML = '<span class="t"><b>' + esc(s.name) + "</b><small>" + esc(s.text.replace(/\n/g, " · ")) +
          '</small></span><button class="x" aria-label="Supprimer">' + icon("trash") + "</button>";
        d.querySelector(".x").onclick = async ev => {
          ev.stopPropagation();
          if (!(await ask("Supprimer « " + s.name + " » ?", "", null))) return;
          const l = Snips.all(); l.splice(i, 1); Snips.save(l);
        };
        d.onclick = () => {
          if (!S.doc) { toast("Ouvrez d'abord un PDF."); return; }
          closeSheet();
          setPending({ kind: "text", text: s.text }, "Touchez l'endroit où placer « " + s.name + " »");
        };
        host.appendChild(d);
      });
    }
  },
  openNew() { textSheet({ kind: "snip" }, "Nouveau texte enregistré", "", true); }
};

/* ============================================================ export PDF */
const WINANSI_EXTRA = new Set([0x20AC,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,0x2030,0x0160,0x2039,0x0152,0x017D,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,0x0161,0x203A,0x0153,0x017E,0x0178]);
const clean = s => String(s).split("").map(function (c) { var k = c.charCodeAt(0);
  return (k >= 0x20 && k <= 0xFF) || k === 10 || WINANSI_EXTRA.has(k) ? c : "?"; }).join("");

function hexRgb(h, PDFLib) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h || "#000000");
  if (!m) return PDFLib.rgb(0, 0, 0);
  return PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}
function mapPt(dx, dy, g) {
  switch (g.rot) {
    case 90:  return [dy + g.x1, dx + g.y1];
    case 180: return [g.pw - dx + g.x1, dy + g.y1];
    case 270: return [g.pw - dy + g.x1, g.ph - dx + g.y1];
    default:  return [dx + g.x1, g.ph - dy + g.y1];
  }
}

async function drawItems(doc, page, items, g, fonts) {
  const L = window.PDFLib;
  const { degrees, LineCapStyle } = L;
  const rot = degrees(g.rot);
  for (const it of items) {
    if (it.type === "mask" || it.type === "redact") {
      const a = mapPt(it.x, it.y + it.h, g);
      page.drawRectangle({ x: a[0], y: a[1], width: it.w, height: it.h,
        color: hexRgb(it.color || "#ffffff", L), rotate: rot });
    } else if (it.type === "image") {
      const img = await embed(doc, it.src);
      if (!img) continue;
      const a = mapPt(it.x, it.y + it.h, g);
      page.drawImage(img, { x: a[0], y: a[1], width: it.w, height: it.h, rotate: rot });
    } else if (it.type === "text") {
      const f = await getFont(doc, fonts, it);
      const lines = String(it.text).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        const a = mapPt(it.x, it.y + i * it.size * 1.2 + it.size * 0.856, g);
        page.drawText(clean(lines[i]), { x: a[0], y: a[1], size: it.size, font: f,
          color: hexRgb(it.color, L), rotate: rot });
      }
    } else if (it.type === "stamp") {
      const f = await getFont(doc, fonts, { font: "Helvetica", bold: true });
      const col = hexRgb(it.color, L), m = stampMetrics(it);
      const a = mapPt(it.x + m.bw / 2, it.y + it.h - m.bw / 2, g);
      page.drawRectangle({ x: a[0], y: a[1], width: it.w - m.bw, height: it.h - m.bw,
        borderColor: col, borderWidth: m.bw, rotate: rot });
      it.lines.forEach((line, i) => {
        const t = clean(line), tw = f.widthOfTextAtSize(t, it.size);
        const b = mapPt(it.x + (it.w - tw) / 2, it.y + m.tp + it.size * 0.86 + i * it.size * 1.2, g);
        page.drawText(t, { x: b[0], y: b[1], size: it.size, font: f, color: col, rotate: rot });
      });
    } else if (it.type === "circle") {
      const c = mapPt(it.x + it.w / 2, it.y + it.h / 2, g);
      const swap = g.rot === 90 || g.rot === 270;
      page.drawEllipse({ x: c[0], y: c[1],
        xScale: Math.max(0.5, (swap ? it.h : it.w) / 2 - (it.thick || 1.6) / 2),
        yScale: Math.max(0.5, (swap ? it.w : it.h) / 2 - (it.thick || 1.6) / 2),
        borderWidth: it.thick || 1.6, borderColor: hexRgb(it.color, L) });
    } else if (it.type === "check" || it.type === "cross") {
      const w = it.w, h = it.h, th = Math.max(0.8, Math.min(w, h) * 0.12);
      const col = hexRgb(it.color, L);
      const P = (rx, ry) => mapPt(it.x + rx * w, it.y + ry * h, g);
      const seg = (p1, p2) => page.drawLine({ start: { x: p1[0], y: p1[1] },
        end: { x: p2[0], y: p2[1] }, thickness: th, color: col,
        lineCap: LineCapStyle.Round });
      if (it.type === "check") {
        seg(P(0.12, 0.54), P(0.40, 0.82));
        seg(P(0.40, 0.82), P(0.88, 0.16));
      } else {
        seg(P(0.15, 0.15), P(0.85, 0.85));
        seg(P(0.85, 0.15), P(0.15, 0.85));
      }
    } else if (it.type === "pen" || it.type === "marker") {
      const col = hexRgb(it.color, L);
      const op = it.type === "marker" ? 0.4 : 1;
      for (let i = 1; i < it.pts.length; i++) {
        const p1 = mapPt(it.pts[i - 1][0], it.pts[i - 1][1], g);
        const p2 = mapPt(it.pts[i][0], it.pts[i][1], g);
        page.drawLine({ start: { x: p1[0], y: p1[1] }, end: { x: p2[0], y: p2[1] },
          thickness: it.thick, color: col, opacity: op, lineCap: LineCapStyle.Round });
      }
    }
  }
}

const embedCache = new WeakMap();
async function embed(doc, src) {
  let m = embedCache.get(doc);
  if (!m) { m = new Map(); embedCache.set(doc, m); }
  if (m.has(src)) return m.get(src);
  const bin = Uint8Array.from(atob(src.split(",")[1]), c => c.charCodeAt(0));
  let img = null;
  try { img = /^data:image\/jpe?g/i.test(src) ? await doc.embedJpg(bin) : await doc.embedPng(bin); }
  catch (e) {
    /* format non pris en charge par pdf-lib (HEIC, WebP…) : conversion en PNG */
    try {
      const png = await toPng(src);
      img = await doc.embedPng(Uint8Array.from(atob(png.split(",")[1]), c => c.charCodeAt(0)));
    } catch (e2) { console.warn("image non intégrée", e2); }
  }
  m.set(src, img);
  return img;
}
function toPng(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      res(c.toDataURL("image/png"));
    };
    img.onerror = rej;
    img.src = src;
  });
}
async function getFont(doc, fonts, it) {
  const F = window.PDFLib.StandardFonts;
  const table = {
    Helvetica: [F.Helvetica, F.HelveticaBold, F.HelveticaOblique, F.HelveticaBoldOblique],
    Times: [F.TimesRoman, F.TimesRomanBold, F.TimesRomanItalic, F.TimesRomanBoldItalic],
    Courier: [F.Courier, F.CourierBold, F.CourierOblique, F.CourierBoldOblique]
  };
  const idx = (it.bold ? 1 : 0) + (it.italic ? 2 : 0);
  const nm = (table[it.font] || table.Helvetica)[idx];
  if (!fonts[nm]) fonts[nm] = await doc.embedFont(nm);
  return fonts[nm];
}

/* pdf-lib 1.17.1 : après form.flatten(), les pages gardent des références
   vers les widgets supprimés (le PDF reste lisible mais est signalé comme
   abîmé par certains lecteurs). On retire ces références orphelines. */
function pruneDangling(doc) {
  const L = window.PDFLib, ctx = doc.context;
  const dead = o => o instanceof L.PDFRef && !ctx.lookup(o);
  const seen = new Set();
  const walk = o => {
    if (!o || seen.has(o)) return;
    seen.add(o);
    if (o instanceof L.PDFStream) { walk(o.dict); return; }
    if (o instanceof L.PDFDict) {
      for (const [k, v] of o.entries()) { if (dead(v)) o.delete(k); else walk(v); }
    } else if (o instanceof L.PDFArray) {
      for (let i = o.size() - 1; i >= 0; i--) { const v = o.get(i); if (dead(v)) o.remove(i); else walk(v); }
    }
  };
  for (const [, obj] of ctx.enumerateIndirectObjects()) walk(obj);
  walk(ctx.trailerInfo && ctx.trailerInfo.Root && ctx.lookup(ctx.trailerInfo.Root));
}

async function buildVector(opt) {
  const sansAnnotations = !!(opt && opt.skipItems);
  const L = window.PDFLib;
  const doc = await L.PDFDocument.load(S.bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();

  if (S.fields.length) {
    let form = null;
    try { form = doc.getForm(); } catch (e) {}
    if (form) {
      for (const f of S.fields) {
        const v = S.values[f.name];
        try {
          if (f.check) { const c = form.getCheckBox(f.name);
            (v && v !== "Off") ? c.check() : c.uncheck(); }
          else if (f.radio) { if (v && v !== "Off") form.getRadioGroup(f.name).select(v); }
          else if (f.options && f.options.length) { if (v) form.getDropdown(f.name).select(v); }
          else { form.getTextField(f.name).setText(clean(v || "")); }
        } catch (e) { console.warn("champ « " + f.name + " » :", e.message); }
      }
      if ((opt && opt.flatten) || $("#chkFlatten").checked || (!sansAnnotations && hasRedactions())) {
        try { form.flatten(); await doc.flush(); pruneDangling(doc); } catch (e) { console.warn(e); }
      }
    }
  }

  const fonts = {};
  for (let i = 0; i < S.pages.length; i++) {
    const p = S.pages[i], items = S.items.filter(it => it.page === i);
    if (p.rot !== ((p.page.rotate % 360) + 360) % 360) {
      try { pages[i].setRotation(L.degrees(p.rot)); } catch (e) {}
    }
    if (sansAnnotations) continue;
    const g = { x1: p.view[0], y1: p.view[1], pw: p.pw, ph: p.ph, rot: p.rot };
    if (items.length) await drawItems(doc, pages[i], items, g, fonts);
    if (S.wm) await WM.draw(doc, pages[i], g, i, fonts);
  }
  const saved = await doc.save({ useObjectStreams: false });
  /* censure définitive : pages concernées remplacées par une image noircie */
  return (!sansAnnotations && hasRedactions()) ? burnRedactions(saved) : saved;
}

/* ---------------------------------------------- allègement du document
   Chaque page est rendue en image puis compressée en JPEG jusqu'à tenir
   dans le budget qui lui revient. Les annotations restent vectorielles. */
const yieldChan = typeof MessageChannel === "function" ? new MessageChannel() : null;
const yieldQ = [];
if (yieldChan) yieldChan.port1.onmessage = () => { const f = yieldQ.shift(); if (f) f(); };
function yieldUI() {
  if (!yieldChan) return new Promise(r => setTimeout(r, 0));
  return new Promise(r => { yieldQ.push(r); yieldChan.port2.postMessage(0); });
}

const Mo = 1024 * 1024;
const fmtMo = b => b < Mo ? Math.round(b / 1024) + " Ko"
  : (b / Mo).toFixed(b < 10 * Mo ? 2 : 1).replace(".", ",") + " Mo";

function toGray(cx, cv) {
  const d = cx.getImageData(0, 0, cv.width, cv.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const v = (a[i] * 299 + a[i + 1] * 587 + a[i + 2] * 114) / 1000;
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  cx.putImageData(d, 0, 0);
}

async function fitPage(src, tmp, budget, hint) {
  const enc = (scale, q) => new Promise(res => {
    if (scale >= 0.999) { src.toBlob(res, "image/jpeg", q); return; }
    tmp.width = Math.max(120, Math.round(src.width * scale));
    tmp.height = Math.max(120, Math.round(src.height * scale));
    const c = tmp.getContext("2d");
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
    c.fillStyle = "#fff"; c.fillRect(0, 0, tmp.width, tmp.height);
    c.drawImage(src, 0, 0, tmp.width, tmp.height);
    tmp.toBlob(res, "image/jpeg", q);
  });
  let s = hint ? hint.s : 1, q = hint ? hint.q : 0.74, n = 0;
  let b = await enc(s, q);
  while (b.size > budget && n < 4) {
    const r = budget / b.size;
    if (q > 0.44 && r > 0.5) q = Math.max(0.42, q * (0.55 + 0.45 * r));
    else { s = Math.max(0.32, s * Math.sqrt(Math.min(0.95, r * 1.25)));
           q = Math.max(0.42, q * 0.95); }
    b = await enc(s, q); n++;
  }
  if (n === 0 && hint && b.size < budget * 0.45 && (q < 0.74 || s < 1)) {
    const s2 = Math.min(1, s * 1.25), q2 = Math.min(0.74, q * 1.1);
    const b2 = await enc(s2, q2);
    if (b2.size <= budget) { return { blob: b2, s: s2, q: q2 }; }
  }
  return { blob: b, s, q };
}

async function buildSmall(targetBytes, gray) {
  const L = window.PDFLib;
  let src = null;
  try {
    const plein = await buildVector();
    if (!gray && plein.length <= targetBytes) return { bytes: plein, mode: "vector" };
    const base = await buildVector({ skipItems: true });
    src = await pdfjsLib.getDocument({ data: base, isEvalSupported: false }).promise;
  } catch (e) { console.warn("base vectorielle indisponible, pages d'origine :", e); }

  const n = S.pages.length;
  const perPage = targetBytes / n;
  /* résolution plafonnée sur iPhone (mémoire des canvas limitée) */
  const dpi = Math.min(isIOS ? 160 : 200, perPage > 500000 ? 200 : perPage > 150000 ? 165 : 140);
  const out = await L.PDFDocument.create();
  const fonts = {};
  let reste = targetBytes * 0.93 - 1400 * n;
  if (reste < 30000) reste = targetBytes * 0.85;

  const cv = document.createElement("canvas");
  const cx = cv.getContext("2d", { alpha: false });
  const tmp = document.createElement("canvas");
  for (const p of S.pages) { cancelTask(p); }

  let hint = null;
  for (let i = 0; i < n; i++) {
    busy(true, "Allègement — page " + (i + 1) + " sur " + n + "…");
    await yieldUI();
    const p = S.pages[i];
    const page = src ? await src.getPage(i + 1) : p.page;
    const vp = src ? page.getViewport({ scale: dpi / 72 })
                   : page.getViewport({ scale: dpi / 72, rotation: p.rot });
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cx, viewport: vp, intent: "print" }).promise;
    if (gray) toGray(cx, cv);
    { const kk = cv.width / p.dw; cx.fillStyle = "#000";
      for (const it of S.items.filter(x => x.type === "redact" && x.page === i)) cx.fillRect(it.x * kk - 1, it.y * kk - 1, it.w * kk + 2, it.h * kk + 2); }
    const r = await fitPage(cv, tmp, Math.max(9000, reste / (n - i)), hint);
    hint = { s: r.s, q: r.q };
    const img = await out.embedJpg(new Uint8Array(await r.blob.arrayBuffer()));
    const pg = out.addPage([p.dw, p.dh]);
    pg.drawImage(img, { x: 0, y: 0, width: p.dw, height: p.dh });
    await drawItems(out, pg, S.items.filter(it => it.page === i && it.type !== "redact"),
      { x1: 0, y1: 0, pw: p.dw, ph: p.dh, rot: 0 }, fonts);
    if (S.wm) await WM.draw(out, pg, { x1: 0, y1: 0, pw: p.dw, ph: p.dh, rot: 0 }, i, fonts);
    reste -= r.blob.size;
    try { page.cleanup(); } catch (e) {}
    if (!src) { try { p.page.cleanup(); } catch (e) {} p.painted = false; }
  }
  cv.width = cv.height = tmp.width = tmp.height = 1;
  busy(true, "Finalisation du PDF…");
  await yieldUI();
  if (src) { try { await src.destroy(); } catch (e) {} }
  return { bytes: await out.save(), mode: "small" };
}

/* ------------------------------------------------ partage / enregistrement */
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
/* doit être appelé directement depuis un appui (exigence de Safari) */
async function shareOrSave(blob, name, type) {
  try {
    const file = new File([blob], name, { type: type || blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "aborted";
    console.warn("partage impossible :", e);
  }
  download(blob, name);
  toast("Fichier téléchargé : " + name, 4000);
  return "downloaded";
}

async function makePdf(mode, targetBytes, gray) {
  busy(true, "Fabrication du PDF…");
  await new Promise(r => setTimeout(r, 30));
  try {
    let bytes, note = "";
    if (mode === "small") {
      const r = await buildSmall(targetBytes, gray);
      bytes = r.bytes;
      note = r.mode === "vector" ? "Déjà sous la limite : qualité d'origine conservée." : "";
    } else {
      bytes = await buildVector();
    }
    const trop = mode === "small" && bytes.length > targetBytes;
    if (trop) note = "Limite non atteinte : essayez les niveaux de gris.";
    return { bytes, note };
  } finally {
    busy(false);
    if (S.doc && mode === "small") observePages();
  }
}

/* intent : "share" (bouton Partager) ou "save" (bouton Enregistrer) */
function openSave(intent) {
  if (!S.doc) return;
  S.intent = intent === "share" ? "share" : "save";
  const share = S.intent === "share";
  syncFmt();
  $("#saveForm").hidden = false; $("#saveDone").hidden = true;
  $("#saveName").value = S.name.replace(/\.pdf$/i, "") + " - rempli";
  $("#saveSrc").textContent = S.pages.length + " page" + (S.pages.length > 1 ? "s" : "") +
    (S.srcSize ? " · " + fmtMo(S.srcSize) + " à l'origine" : "");
  syncSmall();
  openSheet("shSave");
}
/* écran « PDF prêt » : l'action demandée passe en premier */
function setDoneMode(intent) {
  const sh = $("#doneShare"), dl = $("#doneDl"), save = intent === "save";
  sh.className = (save ? "ghost" : "primary") + " wide";
  dl.className = (save ? "primary" : "ghost") + " wide";
  sh.innerHTML = icon("share") + (save ? "Partager" : "Partager ou enregistrer");
  dl.innerHTML = icon("save") + (save ? "Enregistrer le fichier" : "Télécharger");
  if (save) sh.before(dl); else dl.before(sh);
}
/* format choisi : PDF (par défaut), image, Word, ODT ou texte */
function curFmt() { const b = $("#saveFmt .on"); return b ? b.dataset.f : "pdf"; }
function syncFmt() {
  const f = curFmt(), share = S.intent === "share";
  const label = { pdf: "le PDF", pdfa: "en PDF/A", img: "en image", docx: "en Word", odt: "en ODT", pptx: "en PowerPoint",
                  xlsx: "en Excel", txt: "en texte" }[f];
  $("#saveTitle").textContent = (share ? "Partager " : "Enregistrer ") + label;
  $("#saveGo").textContent = share ? "Préparer le partage" : (f === "pdf" ? "Créer le PDF" : "Créer le fichier");
  $("#pdfOpts").hidden = f !== "pdf";
  $("#imgOpts").hidden = f !== "img";
  $("#txtOpts").hidden = !(f === "docx" || f === "odt" || f === "txt");
  $("#txtImgRow").hidden = f === "txt";
  $("#pdfaOpts").hidden = f !== "pdfa";
  $("#pptOpts").hidden = f !== "pptx";
  $("#xlsxOpts").hidden = f !== "xlsx";
  $("#encRow").hidden = f !== "pdf";
  $("#encBox").hidden = f !== "pdf" || !$("#encOn").checked;
  /* le nom saisi perd une éventuelle extension : elle est ajoutée selon le format */
  $("#saveName").value = $("#saveName").value.replace(/\.(pdf|png|jpe?g|docx|odt|txt|zip|pptx|xlsx)$/i, "");
}
function syncSmall() {
  const small = $$('input[name=smode]').find(r => r.checked).value === "small";
  $("#smallOpts").classList.toggle("off", !small);
}

/* ------------------------------------------- petite boîte de dialogue */
function ask(title, sub, value) {
  return new Promise(res => {
    const sh = $("#shAsk"), inp = $("#askInput");
    $("#askTitle").textContent = title;
    $("#askSub").textContent = sub || "";
    $("#askSub").hidden = !sub;
    inp.hidden = value === null;
    inp.value = value || "";
    $("#askOk").textContent = value === null ? "Confirmer" : "Valider";
    let done = false;
    const finish = v => { if (done) return; done = true; res(v); };
    sh._onclose = () => finish(null);
    openSheet("shAsk");
    if (value !== null) { inp.focus(); try { inp.select(); } catch (e) {} }
    $("#askOk").onclick = () => { const v = value === null ? true : inp.value.trim(); finish(v); closeSheet(); };
    $("#askCancel").onclick = () => closeSheet();
    inp.onkeydown = e => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); $("#askOk").click(); }
    };
  });
}

/* --------------------------------------------------- installation (PWA) */
let installEvt = null;
function initInstall() {
  const can = () => !isStandalone();
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); installEvt = e;
    $("#btnInstallHint").hidden = !can();
  });
  window.addEventListener("appinstalled", () => { installEvt = null; $("#btnInstallHint").hidden = true; toast("Application installée."); });
  if (isIOS && can()) $("#btnInstallHint").hidden = false;
  $("#menuInstall").hidden = !can();
  const run = async () => {
    if (installEvt) {
      closeSheet();
      installEvt.prompt();
      try { await installEvt.userChoice; } catch (e) {}
      installEvt = null;
      return;
    }
    $("#instBody").innerHTML = isIOS
      ? '<ol class="steps"><li>Ouvrez cette page dans <b>Safari</b>.</li>' +
        "<li>Touchez le bouton <b>Partager</b> " + icon("share") + " en bas de l'écran.</li>" +
        "<li>Choisissez <b>Sur l'écran d'accueil</b>, puis <b>Ajouter</b>.</li></ol>" +
        '<p class="sub" style="margin-top:12px">L\'icône de LeSacAPDF apparaîtra avec vos autres applications ; elle fonctionne même sans connexion.</p>'
      : '<ol class="steps"><li>Ouvrez le menu du navigateur <b>⋮</b> (Chrome, Edge, Samsung Internet…).</li>' +
        "<li>Choisissez <b>Installer l'application</b> ou <b>Ajouter à l'écran d'accueil</b>.</li></ol>" +
        '<p class="sub" style="margin-top:12px">Une fois installée, l\'application fonctionne sans connexion et apparaît dans « Ouvrir avec » / « Partager » pour vos PDF.</p>';
    openSheet("shInstall");
  };
  $("#btnInstallHint").onclick = run;
  return run;
}

/* -------------------------------------------- fichiers reçus d'autres apps */
async function receiveShared() {
  /* Android : PDF partagé vers l'application (Web Share Target) */
  if (/[?&]shared=1/.test(location.search) && "caches" in window) {
    try {
      const c = await caches.open("sac-shared");
      const r = await c.match("shared-file");
      if (r) {
        const blob = await r.blob();
        const name = decodeURIComponent(r.headers.get("X-Name") || "document.pdf");
        await c.delete("shared-file");
        openFile(new File([blob], name, { type: "application/pdf" }));
      }
    } catch (e) { console.warn(e); }
    history.replaceState(null, "", location.pathname);
  }
  /* « Ouvrir avec » (File Handling API, ordinateur) */
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async params => {
      if (!params.files || !params.files.length) return;
      openFile(await params.files[0].getFile());
    });
  }
}

/* ================================================================ clavier
   iPhone : le clavier virtuel recouvre les feuilles du bas ; on les remonte. */
function initKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const upd = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", (kb > 60 ? kb : 0) + "px");
  };
  vv.addEventListener("resize", upd);
  vv.addEventListener("scroll", upd);
}

/* =====================================================================
   VERSION 3.1 — tampons, recherche, documents récents, impression,
   organiser / scinder / fusionner, scanner.
   ===================================================================== */
const fmtDate = d => String(d.getDate()).padStart(2, "0") + "/" +
  String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
const fmtTime = d => String(d.getHours()).padStart(2, "0") + "h" + String(d.getMinutes()).padStart(2, "0");

/* ------------------------------------------------------------- tampons */
const STAMPS = ["Lu et approuvé", "Bon pour accord", "Copie conforme à l'original", "Reçu le", "Payé", "Validé",
                "Refusé", "Annulé", "Vu", "Urgent", "Confidentiel", "Duplicata"];
const STAMP_COLORS = ["#c0392b", "#1d4ed8", "#0a6b2f", "#111111"];

function stampMetrics(it) {
  return { bw: Math.max(0.8, it.size * 0.13), tp: it.size * 0.45, pad: it.size * 0.7 };
}
function measureStamp(it) {
  const c = measure._c || (measure._c = document.createElement("canvas").getContext("2d"));
  c.font = "bold " + it.size + "px Helvetica,Arial,sans-serif";
  let w = 0;
  for (const l of it.lines) w = Math.max(w, c.measureText(l).width);
  const m = stampMetrics(it);
  it.w = w + 2 * m.pad;
  it.h = it.lines.length * it.size * 1.2 + 2 * m.tp;
}
function stampSvg(it) {
  const m = stampMetrics(it);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + it.w + " " + it.h);
  const r = document.createElementNS(NS, "rect");
  r.setAttribute("x", m.bw / 2); r.setAttribute("y", m.bw / 2);
  r.setAttribute("width", it.w - m.bw); r.setAttribute("height", it.h - m.bw);
  r.setAttribute("fill", "none"); r.setAttribute("stroke", it.color); r.setAttribute("stroke-width", m.bw);
  svg.appendChild(r);
  it.lines.forEach((line, i) => {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", it.w / 2);
    t.setAttribute("y", m.tp + it.size * 0.86 + i * it.size * 1.2);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-family", "Helvetica,Arial,sans-serif");
    t.setAttribute("font-weight", "700");
    t.setAttribute("font-size", it.size);
    t.setAttribute("fill", it.color);
    t.textContent = line;
    svg.appendChild(t);
  });
  return svg;
}
function stampLines(text, withDate) {
  text = text.trim();
  if (!withDate) return [text];
  const d = fmtDate(new Date());
  return /\ble$/i.test(text) ? [text + " " + d] : [text, "le " + d];
}

const Stamps = {
  custom: () => store.get(Prof.key("stamps"), []),
  render() {
    const host = $("#stampList"); host.innerHTML = "";
    const color = PREF.stampColor || "#c0392b";
    const all = STAMPS.map(t => ({ t, own: false })).concat(Stamps.custom().map((t, i) => ({ t, own: true, i })));
    for (const s of all) {
      const b = document.createElement("div");
      b.className = "stampbtn"; b.setAttribute("role", "button");
      b.innerHTML = '<span style="color:' + color + '">' + esc(s.t) + "</span>" +
        (s.own ? '<button class="x" aria-label="Supprimer">' + icon("trash") + "</button>" : "");
      b.onclick = () => {
        closeSheet();
        const lines = stampLines(s.t, $("#stampDate").checked);
        setPending({ kind: "stamp", lines }, "Touchez l'endroit où apposer « " + lines.join(" ") + " »");
      };
      if (s.own) b.querySelector(".x").onclick = ev => {
        ev.stopPropagation();
        const l = Stamps.custom(); l.splice(s.i, 1); store.set(Prof.key("stamps"), l); Stamps.render();
      };
      host.appendChild(b);
    }
    const sw = $("#stampColors"); sw.innerHTML = "";
    for (const c of STAMP_COLORS) {
      const b = document.createElement("button");
      b.setAttribute("aria-label", "Couleur");
      b.innerHTML = '<span class="dot' + (c === color ? " on" : "") + '" style="background:' + c + '"></span>';
      b.onclick = () => { PREF.stampColor = c; Prof.savePref(); Stamps.render(); };
      sw.appendChild(b);
    }
    $("#stampDate").checked = PREF.stampDate !== false;
  },
  open() {
    if (!S.doc) { toast("Ouvrez d'abord un PDF."); return; }
    setTool("select");
    Stamps.render();
    openSheet("shStamps");
  }
};

/* ------------------------------------------------------- recherche de texte */
const normc = c => /\s/.test(c) ? " " : c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const Search = {
  hits: [], cur: -1, token: 0, q: "",
  reset() { Search.hits = []; Search.cur = -1; Search.q = ""; Search.token++; $("#searchCount").textContent = "";
            if ($("#searchInput")) $("#searchInput").value = ""; $("#searchBar").hidden = true; Search.render(); },
  open() {
    if (!S.doc) return;
    $("#searchBar").hidden = false;
    const inp = $("#searchInput");
    inp.focus(); try { inp.select(); } catch (e) {}
  },
  close() { Search.reset(); },
  async pageText(p) {
    if (p._txt) return p._txt;
    const tc = await p.page.getTextContent();
    let norm = ""; const map = [];
    tc.items.forEach((it, ii) => {
      const str = it.str || "";
      for (let ci = 0; ci < str.length; ci++) {
        const n = normc(str[ci]);
        for (const ch of n) {
          if (ch === " " && norm.endsWith(" ")) continue;
          norm += ch; map.push([ii, ci]);
        }
      }
      if (it.hasEOL && !norm.endsWith(" ")) { norm += " "; map.push([-1, 0]); }
    });
    p._txt = { norm, map, items: tc.items };
    return p._txt;
  },
  rect(p, item, c0, c1) {
    const [a, b, c, d, e, f] = item.transform;
    const len = Math.max(1, item.str.length);
    const dl = Math.hypot(a, b) || 1, fs = Math.hypot(c, d) || 1;
    const ux = a / dl, uy = b / dl, vx = c / fs, vy = d / fs;
    const t0 = item.width * c0 / len, t1 = item.width * c1 / len;
    const vp = p.page.getViewport({ scale: 1, rotation: p.rot });
    const pts = [];
    for (const t of [t0, t1]) for (const k of [-0.22, 0.95]) {
      pts.push(vp.convertToViewportPoint(e + ux * t + vx * fs * k, f + uy * t + vy * fs * k));
    }
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    return { x, y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
  },
  async run(q) {
    const tok = ++Search.token;
    Search.q = q; Search.hits = []; Search.cur = -1;
    const nq = Array.from(q).map(normc).join("").replace(/\s+/g, " ").trim();
    if (!nq) { $("#searchCount").textContent = ""; Search.render(); return; }
    $("#searchCount").textContent = "…";
    for (let i = 0; i < S.pages.length; i++) {
      const p = S.pages[i];
      let t;
      try { t = await Search.pageText(p); } catch (e) { continue; }
      if (tok !== Search.token) return;
      let from = 0, k;
      while ((k = t.norm.indexOf(nq, from)) >= 0) {
        from = k + nq.length;
        /* regroupe les caractères trouvés par élément de texte */
        const parts = [];
        for (let j = k; j < k + nq.length; j++) {
          const [ii, ci] = t.map[j]; if (ii < 0) continue;
          const last = parts[parts.length - 1];
          if (last && last.ii === ii) last.c1 = ci + 1; else parts.push({ ii, c0: ci, c1: ci + 1 });
        }
        const rects = parts.map(pt => Search.rect(p, t.items[pt.ii], pt.c0, pt.c1));
        if (rects.length) Search.hits.push({ page: i, rects });
      }
      if (Search.hits.length && Search.cur < 0) { Search.cur = 0; Search.render(); Search.show(); }
    }
    if (tok !== Search.token) return;
    Search.count();
    Search.render();
    if (!Search.hits.length) toast("Aucun résultat pour « " + q + " ».", 2000);
  },
  count() {
    $("#searchCount").textContent = Search.hits.length ? (Search.cur + 1) + " / " + Search.hits.length : "0";
  },
  render() {
    $$(".hit").forEach(e => e.remove());
    Search.hits.forEach((h, i) => {
      const p = S.pages[h.page]; if (!p || !p.layer) return;
      for (const r of h.rects) {
        const d = document.createElement("div");
        d.className = "hit" + (i === Search.cur ? " cur" : "");
        d.style.left = (r.x * S.scale - 1) + "px"; d.style.top = (r.y * S.scale - 1) + "px";
        d.style.width = (r.w * S.scale + 2) + "px"; d.style.height = (r.h * S.scale + 2) + "px";
        p.layer.prepend(d);
      }
    });
  },
  show() {
    const h = Search.hits[Search.cur]; if (!h) return;
    const p = S.pages[h.page], r = h.rects[0], v = $("#viewer");
    v.scrollTo({ top: p.el.offsetTop + r.y * S.scale - v.clientHeight * 0.3,
                 left: Math.max(0, p.el.offsetLeft + r.x * S.scale - v.clientWidth * 0.3), behavior: "smooth" });
  },
  step(d) {
    if (!Search.hits.length) return;
    Search.cur = (Search.cur + d + Search.hits.length) % Search.hits.length;
    Search.count(); Search.render(); Search.show();
  }
};

/* ------------------------------------------------- documents récents (IndexedDB) */
const Recents = {
  MAX: 10,
  _p: null,
  db() {
    if (this._p) return this._p;
    this._p = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error("IndexedDB indisponible")); return; }
      const r = indexedDB.open("lesacapdf", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("recent", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._p;
  },
  async tx(mode, fn) {
    const db = await this.db();
    return new Promise((res, rej) => {
      const t = db.transaction("recent", mode);
      const req = fn(t.objectStore("recent"));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  async list() { try { return (await this.tx("readonly", st => st.getAll())).sort((a, b) => b.date - a.date); } catch (e) { return []; } },
  get(id) { return this.tx("readonly", st => st.get(id)); },
  async remove(id) { try { await this.tx("readwrite", st => st.delete(id)); } catch (e) {} this.render(); },
  async add(bytes, name, thumb) {
    if (!bytes || bytes.length > 40 * Mo) return;
    try {
      const id = name + "|" + bytes.length;
      await this.tx("readwrite", st => st.put({ id, name, size: bytes.length, date: Date.now(),
        data: bytes.slice(0).buffer, thumb: thumb || "" }));
      const l = await this.list();
      for (const r of l.slice(this.MAX)) await this.tx("readwrite", st => st.delete(r.id));
    } catch (e) { console.warn("récents :", e); }
    this.render();
  },
  /* document courant : miniature de la 1re page */
  async addCurrent() {
    let thumb = "";
    try {
      const p = S.pages[0];
      const vp = p.page.getViewport({ scale: 96 / p.dw, rotation: p.rot });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await p.page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      thumb = c.toDataURL("image/jpeg", 0.7);
    } catch (e) {}
    this.add(S.bytes, S.name, thumb);
  },
  async render() {
    const l = await this.list();
    const fill = (host, items) => {
      host.innerHTML = "";
      if (!items.length) { host.innerHTML = '<div class="empty-note">Aucun document récent.</div>'; return; }
      for (const r of items) {
        const d = document.createElement("div"); d.className = "chip"; d.setAttribute("role", "button");
        const when = new Date(r.date);
        d.innerHTML = (r.thumb ? '<img class="rthumb" alt="" src="' + r.thumb + '">' : icon("pages")) +
          '<span class="t"><b>' + esc(r.name.replace(/\.pdf$/i, "")) + "</b><small>" + fmtDate(when) + " à " +
          fmtTime(when) + " · " + fmtMo(r.size) + '</small></span><button class="x" aria-label="Retirer">' + icon("close") + "</button>";
        d.querySelector(".x").onclick = ev => { ev.stopPropagation(); Recents.remove(r.id); };
        d.onclick = () => Recents.open(r.id);
        host.appendChild(d);
      }
    };
    fill($("#recentList"), l.slice(0, 4));
    fill($("#recentList2"), l);
    $("#recentsHome").hidden = !l.length;
  },
  async open(id) {
    const r = await this.get(id).catch(() => null);
    if (!r) { toast("Document introuvable."); this.render(); return; }
    if (curSheet) closeSheet();
    openBytes(new Uint8Array(r.data), r.name, { noRecent: false });
  }
};

/* --------------------------------------------------------------- impression
   Les pages (annotations comprises) sont converties en images et imprimées
   via la boîte d'impression du téléphone : fonctionne sur iPhone et Android. */
let printUrls = [];
function clearPrint() {
  printUrls.forEach(u => URL.revokeObjectURL(u)); printUrls = [];
  $("#printArea").innerHTML = "";
}
window.addEventListener("afterprint", () => setTimeout(clearPrint, 500));
async function printDoc() {
  if (!S.doc) return;
  if (curSheet) closeSheet();
  busy(true, "Préparation de l'impression…");
  let doc = null;
  try {
    clearPrint();
    const bytes = await buildVector();
    doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const area = $("#printArea"), cv = document.createElement("canvas"), cx = cv.getContext("2d", { alpha: false });
    const dpi = isIOS ? 130 : 150;
    for (let i = 1; i <= doc.numPages; i++) {
      busy(true, "Préparation de l'impression — page " + i + " sur " + doc.numPages + "…");
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: dpi / 72 });
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: cx, viewport: vp, intent: "print" }).promise;
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92));
      const url = URL.createObjectURL(blob); printUrls.push(url);
      const img = new Image(); img.src = url; img.alt = "";
      area.appendChild(img);
      try { await img.decode(); } catch (e) {}
      pg.cleanup();
    }
    cv.width = cv.height = 1;
    busy(false);
    await new Promise(r => setTimeout(r, 60));
    window.print();
  } catch (e) {
    console.error(e);
    busy(false);
    toast("Impression impossible : " + e.message, 5000);
  } finally {
    if (doc) { try { doc.destroy(); } catch (e) {} }
  }
}

/* ------------------------------------------- résultat d'une opération (PDF créé) */
function showResult(bytes, name, info) {
  S.out = { bytes, name };
  Recents.add(bytes, name);
  $("#doneName").textContent = name;
  $("#doneInfo").textContent = (info ? info + " · " : "") + fmtMo(bytes.length);
  $("#saveForm").hidden = true; $("#saveDone").hidden = false;
  $("#doneOpen").hidden = false;
  setDoneMode("share");
  openSheet("shSave");
}

/* ================================================ organiser / scinder / fusionner */
const SRC_COLORS = ["#2D6CDF", "#E07A2E", "#1E8E55", "#9B51E0", "#D13438", "#0F9BB0", "#B08900"];
const Org = {
  mode: "organize", list: [], sources: {}, order: [], sel: [], obs: null, n: 0,

  async start(mode) {
    Org.mode = mode;
    Org.list = []; Org.sources = {}; Org.order = []; Org.sel = []; Org.n = 0;
    $("#orgGrid").innerHTML = "";
    const titles = { organize: "Organiser les pages", split: "Scinder le document", merge: "Fusionner des PDF" };
    $("#orgTitle").textContent = titles[mode];
    openPanel("pnOrg");
    $("#pnOrg")._onclose = () => Org.cleanup();
    if (S.doc) {
      busy(true, "Préparation des pages…");
      try {
        const changed = S.items.length || S.fields.length ||
          S.pages.some(p => p.rot !== ((p.page.rotate % 360) + 360) % 360);
        const bytes = changed ? await buildVector({ flatten: true }) : S.bytes;
        await Org.addSource(bytes, S.name, true);
      } catch (e) { console.error(e); toast("Erreur : " + e.message, 5000); }
      busy(false);
    }
    Org.renderAll();
  },

  cleanup() {
    if (Org.obs) Org.obs.disconnect();
    for (const k in Org.sources) { try { Org.sources[k].pdf.destroy(); } catch (e) {} }
    Org.sources = {}; Org.list = []; Org.sel = [];
    $("#orgGrid").innerHTML = "";
  },

  async addSource(bytes, name, isCurrent) {
    const id = "s" + (Org.n++);
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    const src = { id, name, bytes: bytes.slice(0), pdf, color: SRC_COLORS[Org.order.length % SRC_COLORS.length],
                  letter: String.fromCharCode(65 + Org.order.length), current: !!isCurrent, rot: [] };
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      src.rot.push(((pg.rotate % 360) + 360) % 360);
      Org.list.push({ id: uid(), src: id, idx: i - 1, rot: 0 });
    }
    Org.sources[id] = src; Org.order.push(id);
  },

  async addFiles(files) {
    if (!files || !files.length) return;
    busy(true, "Ajout des documents…");
    let n = 0;
    for (const f of files) {
      if (!/\.pdf$/i.test(f.name || "") && f.type !== "application/pdf") continue;
      try { await Org.addSource(new Uint8Array(await f.arrayBuffer()), f.name || "document.pdf"); n++; }
      catch (e) { toast("« " + f.name + " » n'a pas pu être lu.", 4000); }
    }
    busy(false);
    if (n) toast(n + " document" + (n > 1 ? "s ajoutés" : " ajouté") + ".");
    Org.renderAll();
    const g = $("#orgGrid"); g.scrollTo({ top: g.scrollHeight, behavior: "smooth" });
  },

  label(e) {
    const s = Org.sources[e.src];
    return (Org.order.length > 1 ? s.letter + " · " : "") + "p. " + (e.idx + 1);
  },

  renderAll() {
    const g = $("#orgGrid");
    if (Org.obs) Org.obs.disconnect();
    Org.obs = new IntersectionObserver(list => {
      for (const en of list) if (en.isIntersecting && !en.target._done) Org.paint(en.target);
    }, { root: g, rootMargin: "400px 0px" });
    const keep = {};
    $$(".otile", g).forEach(t => keep[t.dataset.id] = t);
    g.innerHTML = "";
    for (const e of Org.list) {
      let t = keep[e.id];
      if (!t) {
        t = document.createElement("div");
        t.className = "otile"; t.dataset.id = e.id;
        t.innerHTML = '<span class="ord"></span><div class="ofr"><canvas></canvas></div>' +
          '<button class="oeye" aria-label="Voir en grand">' + icon("eye") + "</button>" +
          '<span class="ohd" aria-label="Déplacer">' + icon("drag") + "</span>" +
          '<span class="dtag"></span><span class="onum"></span>';
        t.addEventListener("click", ev => {
          if (ev.target.closest(".oeye")) { Org.preview(e.id); return; }
          if (ev.target.closest(".ohd")) return;
          Org.toggle(e.id);
        });
        Org.bindDrag(t);
      }
      t.querySelector(".onum").textContent = Org.label(e);
      const tag = t.querySelector(".dtag");
      tag.style.background = Org.sources[e.src].color;
      tag.hidden = Org.order.length < 2;
      g.appendChild(t);
      Org.obs.observe(t);
    }
    Org.renderSel();
  },

  async paint(t) {
    const e = Org.list.find(x => x.id === t.dataset.id); if (!e) return;
    t._done = true;
    const s = Org.sources[e.src];
    try {
      const pg = await s.pdf.getPage(e.idx + 1);
      const rot = (s.rot[e.idx] + e.rot) % 360;
      const base = pg.getViewport({ scale: 1, rotation: rot });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pg.getViewport({ scale: 150 * dpr / Math.max(base.width, base.height), rotation: rot });
      const cv = t.querySelector("canvas");
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      cv.style.width = (vp.width / dpr / 150 * 100) + "%";
      cv.style.aspectRatio = vp.width + " / " + vp.height;
      await pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    } catch (er) { t._done = false; }
  },

  toggle(id) {
    const i = Org.sel.indexOf(id);
    if (i >= 0) Org.sel.splice(i, 1); else Org.sel.push(id);
    Org.renderSel();
  },

  renderSel() {
    $$("#orgGrid .otile").forEach(t => {
      const k = Org.sel.indexOf(t.dataset.id);
      t.classList.toggle("sel", k >= 0);
      t.querySelector(".ord").textContent = k >= 0 ? k + 1 : "";
    });
    const n = Org.list.length, ns = Org.sel.length, nd = Org.order.length;
    $("#orgSub").textContent = n + " page" + (n > 1 ? "s" : "") +
      (nd > 1 ? " · " + Org.order.map(k => Org.sources[k].letter + " = " + Org.sources[k].name).join(", ") : "");
    const hints = {
      organize: "Touchez des pages pour les sélectionner, faites glisser " + "⠿" + " pour les déplacer.",
      split: "Touchez les pages à extraire dans l'ordre voulu : le numéro bleu indique leur ordre dans le nouveau document.",
      merge: "Ajoutez des PDF avec « + PDF », réordonnez en faisant glisser ⠿, puis créez le document."
    };
    $("#orgHint").textContent = !n ? "Aucune page : ajoutez un PDF avec « + PDF »." : hints[Org.mode];
    const f = $("#orgFoot");
    const act = (a, ic, lb, cls) => '<button data-o="' + a + '"' + (cls ? ' class="' + cls + '"' : "") + ">" + icon(ic) + lb + "</button>";
    if (ns) {
      f.innerHTML = '<span class="count">' + ns + " sélectionnée" + (ns > 1 ? "s" : "") + "</span>" +
        '<button class="ghost" data-o="none">Désélectionner</button>' +
        '<div class="acts">' + act("extract", "split", "Nouveau PDF", "go") + act("rotate", "rotate", "Pivoter") +
        act("dup", "copy", "Dupliquer") + act("first", "up", "Au début") + act("last", "dn", "À la fin") +
        act("del", "trash", "Supprimer", "danger") + "</div>";
    } else {
      const main = Org.mode === "merge" || nd > 1 || !S.doc
        ? '<button class="primary grow" data-o="build"' + (n ? "" : " disabled") + ">" + icon("merge") + " Créer le PDF (" + n + " p.)</button>"
        : Org.mode === "split"
          ? '<button class="primary grow" disabled>Sélectionnez des pages</button>'
          : '<button class="primary grow" data-o="apply">Appliquer au document</button>';
      f.innerHTML = '<button class="ghost" data-o="add">' + icon("plus") + " PDF</button>" + main;
    }
  },

  async action(a) {
    const selE = () => Org.sel.map(id => Org.list.find(e => e.id === id)).filter(Boolean);
    switch (a) {
      case "none": Org.sel = []; Org.renderSel(); break;
      case "add": $("#fileMerge").click(); break;
      case "rotate":
        for (const e of selE()) {
          e.rot = (e.rot + 90) % 360;
          const t = $('.otile[data-id="' + e.id + '"]'); if (t) { t._done = false; Org.paint(t); }
        }
        break;
      case "dup": {
        const out = [];
        for (const e of Org.list) {
          out.push(e);
          if (Org.sel.includes(e.id)) out.push({ id: uid(), src: e.src, idx: e.idx, rot: e.rot });
        }
        Org.list = out; Org.sel = []; Org.renderAll();
        toast("Pages dupliquées.");
        break;
      }
      case "first": case "last": {
        const s = selE(), rest = Org.list.filter(e => !Org.sel.includes(e.id));
        Org.list = a === "first" ? s.concat(rest) : rest.concat(s);
        Org.renderAll();
        break;
      }
      case "del": {
        const n = Org.sel.length;
        if (n >= Org.list.length) { toast("Le document doit garder au moins une page."); return; }
        Org.list = Org.list.filter(e => !Org.sel.includes(e.id));
        Org.sel = []; Org.renderAll();
        toast(n + " page" + (n > 1 ? "s supprimées" : " supprimée") + ".");
        break;
      }
      case "extract": {
        const base = (Org.sources[selE()[0].src].name || "document").replace(/\.pdf$/i, "");
        const bytes = await Org.build(selE());
        if (bytes) showResult(bytes, base + " - extrait.pdf", Org.sel.length + " page" + (Org.sel.length > 1 ? "s" : ""));
        break;
      }
      case "build": {
        const first = Org.sources[Org.order[0]];
        const name = (Org.order.length > 1 ? "Fusion - " : "") + (first ? first.name.replace(/\.pdf$/i, "") : "document") +
          (Org.order.length > 1 ? "" : " - modifié") + ".pdf";
        const bytes = await Org.build(Org.list);
        if (bytes) showResult(bytes, name, Org.list.length + " pages");
        break;
      }
      case "apply": {
        const bytes = await Org.build(Org.list);
        if (!bytes) return;
        const name = S.name;
        closePanel();
        await openBytes(bytes, name, { force: true });
        toast("Document mis à jour.");
        break;
      }
    }
  },

  async build(entries) {
    if (!entries.length) return null;
    busy(true, "Création du PDF…");
    try {
      const L = window.PDFLib, out = await L.PDFDocument.create(), libs = {};
      for (const e of entries) {
        let d = libs[e.src];
        if (!d) {
          d = await L.PDFDocument.load(Org.sources[e.src].bytes, { ignoreEncryption: true, updateMetadata: false });
          try {
            const f = d.getForm();
            if (f.getFields().length) { f.flatten(); await d.flush(); pruneDangling(d); }
          } catch (er) {}
          libs[e.src] = d;
        }
        const [pg] = await out.copyPages(d, [e.idx]);
        if (e.rot) pg.setRotation(L.degrees((pg.getRotation().angle + e.rot) % 360));
        out.addPage(pg);
      }
      return await out.save();
    } catch (e) {
      console.error(e); toast("Échec de la création : " + e.message, 6000); return null;
    } finally { busy(false); }
  },

  /* réordonner en faisant glisser la poignée ⠿ */
  bindDrag(t) {
    const hd = t.querySelector(".ohd");
    hd.addEventListener("pointerdown", ev => {
      ev.preventDefault(); ev.stopPropagation();
      try { hd.setPointerCapture(ev.pointerId); } catch (e) {}
      const g = $("#orgGrid");
      const ghost = document.createElement("div"); ghost.className = "dragghost";
      const src = t.querySelector("canvas"), c2 = document.createElement("canvas");
      c2.width = src.width || 1; c2.height = src.height || 1;
      try { c2.getContext("2d").drawImage(src, 0, 0); } catch (e) {}
      ghost.appendChild(c2); document.body.appendChild(ghost);
      t.classList.add("drag");
      let over = null, scrollV = 0, raf = 0;
      const pos = e => { ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px"; };
      pos(ev);
      const tick = () => { if (scrollV) { g.scrollTop += scrollV; raf = requestAnimationFrame(tick); } else raf = 0; };
      const move = e => {
        pos(e);
        const r = g.getBoundingClientRect();
        scrollV = e.clientY < r.top + 60 ? -10 : e.clientY > r.bottom - 60 ? 10 : 0;
        if (scrollV && !raf) raf = requestAnimationFrame(tick);
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const tt = el && el.closest(".otile");
        if (over && over !== tt) over.classList.remove("over");
        over = tt && tt !== t ? tt : null;
        if (over) over.classList.add("over");
      };
      const up = e => {
        hd.removeEventListener("pointermove", move);
        hd.removeEventListener("pointerup", up);
        hd.removeEventListener("pointercancel", up);
        scrollV = 0; ghost.remove(); t.classList.remove("drag");
        if (over) over.classList.remove("over");
        const from = Org.list.findIndex(x => x.id === t.dataset.id);
        let to = over ? Org.list.findIndex(x => x.id === over.dataset.id) : -1;
        if (!over && e.type === "pointerup") {
          /* lâché après la dernière page : on place à la fin */
          const last = g.lastElementChild;
          if (last && last !== t) { const lr = last.getBoundingClientRect(); if (e.clientY > lr.bottom || (e.clientY > lr.top && e.clientX > lr.right)) to = Org.list.length; }
        }
        if (to >= 0 && from >= 0 && to !== from) {
          const [moved] = Org.list.splice(from, 1);
          Org.list.splice(to > from ? to - 1 : to, 0, moved);
          Org.renderAll();
        }
      };
      hd.addEventListener("pointermove", move);
      hd.addEventListener("pointerup", up);
      hd.addEventListener("pointercancel", up);
    });
  },

  /* visualisation d'une page en grand */
  pv: null,
  preview(id) {
    Org.pv = id;
    openPanel("pnPreview");
    Org.paintPreview();
  },
  async paintPreview() {
    const i = Org.list.findIndex(e => e.id === Org.pv); if (i < 0) return;
    const e = Org.list[i], s = Org.sources[e.src];
    $("#pvTitle").textContent = (Org.order.length > 1 ? s.letter + " · " : "") + s.name;
    $("#pvSub").textContent = "Page " + (e.idx + 1) + " du document · position " + (i + 1) + " sur " + Org.list.length;
    const k = Org.sel.indexOf(e.id);
    $("#pvSel").textContent = k >= 0 ? "Sélectionnée (n° " + (k + 1) + ") — retirer" : "Sélectionner cette page";
    $("#pvSel").classList.toggle("ghost", k >= 0);
    $("#pvSel").classList.toggle("primary", k < 0);
    const pg = await s.pdf.getPage(e.idx + 1);
    const rot = (s.rot[e.idx] + e.rot) % 360;
    const base = pg.getViewport({ scale: 1, rotation: rot });
    const body = $("#pvBody"), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const fit = Math.min((body.clientWidth - 24) / base.width, (body.clientHeight - 24) / base.height);
    let sc = fit * dpr;
    const area = base.width * base.height * sc * sc;
    if (area > MAX_PX) sc *= Math.sqrt(MAX_PX / area);
    const vp = pg.getViewport({ scale: sc, rotation: rot });
    const cv = $("#pvCanvas");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    cv.style.width = (base.width * fit) + "px"; cv.style.height = (base.height * fit) + "px";
    await pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
  },
  pvStep(d) {
    const i = Org.list.findIndex(e => e.id === Org.pv);
    const j = clamp(i + d, 0, Org.list.length - 1);
    if (j !== i) { Org.pv = Org.list[j].id; Org.paintPreview(); }
  }
};

/* ================================================================ scanner */
const Scan = {
  pages: [], cur: -1, step: "crop", scale: 1,

  pick(camera) { closeSheet(); $(camera ? "#fileScan" : "#fileScanGal").click(); },

  async addFiles(files) {
    if (!files || !files.length) return;
    busy(true, "Lecture de la photo…");
    const first = Scan.pages.length;
    for (const f of files) {
      try {
        const img = await new Promise((res, rej) => {
          const u = URL.createObjectURL(f), im = new Image();
          im.onload = () => { URL.revokeObjectURL(u); res(im); };
          im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("image illisible")); };
          im.src = u;
        });
        const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const w = c.width, h = c.height, m = 0.04;
        const auto = detectPaper(c);
        Scan.pages.push({ src: c, q: auto || [[w * m, h * m], [w * (1 - m), h * m], [w * (1 - m), h * (1 - m)], [w * m, h * (1 - m)]],
                          fx: "auto", contrast: 30, bright: 5, warp: null, out: null, thumb: "" });
      } catch (e) { toast("Photo illisible : " + (f.name || ""), 4000); }
    }
    busy(false);
    if (Scan.pages.length === first) return;
    if (!$("#pnScan").classList.contains("on")) {
      openPanel("pnScan");
      $("#pnScan")._onclose = () => { Scan.pages = []; Scan.cur = -1; };
    }
    Scan.cur = first;
    Scan.showCrop();
  },

  page() { return Scan.pages[Scan.cur]; },

  fit(w, h) {
    const b = $("#scBody");
    const W = b.clientWidth - 28, H = b.clientHeight - 28;
    return Math.max(0.05, Math.min(W / w, H / h));
  },
  draw(c) {
    const cv = $("#scCanvas"), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = Scan.fit(c.width, c.height);
    Scan.scale = k;
    cv.width = Math.round(c.width * k * dpr); cv.height = Math.round(c.height * k * dpr);
    cv.style.width = (c.width * k) + "px"; cv.style.height = (c.height * k) + "px";
    const x = cv.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.drawImage(c, 0, 0, cv.width, cv.height);
  },
  header() {
    $("#scSub").textContent = "Page " + (Scan.cur + 1) + " sur " + Scan.pages.length +
      (Scan.step === "crop" ? " · ajustez les 4 coins" : " · réglez le rendu");
  },

  showCrop() {
    Scan.step = "crop";
    const p = Scan.page(); if (!p) return;
    $("#scCropTools").hidden = false; $("#scFxTools").hidden = true;
    $("#scQuad").style.display = "";
    requestAnimationFrame(() => {
      Scan.draw(p.src);
      Scan.handles();
      Scan.header();
    });
  },
  handles() {
    const p = Scan.page(), st = $("#scStage");
    $$(".schd", st).forEach(h => h.remove());
    p.q.forEach((pt, i) => {
      const h = document.createElement("div"); h.className = "schd";
      st.appendChild(h);
      h.addEventListener("pointerdown", ev => {
        ev.preventDefault();
        try { h.setPointerCapture(ev.pointerId); } catch (e) {}
        const r = $("#scCanvas").getBoundingClientRect();
        const move = e => {
          p.q[i] = [clamp((e.clientX - r.left) / Scan.scale, 0, p.src.width), clamp((e.clientY - r.top) / Scan.scale, 0, p.src.height)];
          p.warp = null;
          Scan.poly();
        };
        const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); };
        h.addEventListener("pointermove", move);
        h.addEventListener("pointerup", up);
        h.addEventListener("pointercancel", up);
      });
    });
    Scan.poly();
  },
  poly() {
    const p = Scan.page(), k = Scan.scale;
    $("#scPoly").setAttribute("points", p.q.map(q => (q[0] * k) + "," + (q[1] * k)).join(" "));
    $$(".schd").forEach((h, i) => { h.style.left = (p.q[i][0] * k) + "px"; h.style.top = (p.q[i][1] * k) + "px"; });
  },

  async showFx() {
    const p = Scan.page(); if (!p) return;
    Scan.step = "fx";
    $("#scCropTools").hidden = true; $("#scFxTools").hidden = false;
    $("#scQuad").style.display = "none"; $$(".schd").forEach(h => h.remove());
    $$("#scFx button").forEach(b => b.classList.toggle("on", b.dataset.fx === p.fx));
    $("#scContrast").value = p.contrast; $("#scBright").value = p.bright;
    await Scan.process(p);
    requestAnimationFrame(() => { Scan.draw(p.out); Scan.header(); Scan.strip(); });
  },

  async process(p) {
    if (!p.warp) { busy(true, "Redressement de la page…"); await yieldUI(); p.warp = warpQuad(p.src, p.q, 1800); busy(false); }
    p.out = applyFx(p.warp, p.fx, p.contrast, p.bright);
    const t = document.createElement("canvas"), k = 120 / Math.max(p.out.width, p.out.height);
    t.width = Math.round(p.out.width * k); t.height = Math.round(p.out.height * k);
    t.getContext("2d").drawImage(p.out, 0, 0, t.width, t.height);
    p.thumb = t.toDataURL("image/jpeg", 0.7);
  },

  strip() {
    const s = $("#scStrip"); s.innerHTML = "";
    Scan.pages.forEach((p, i) => {
      const b = document.createElement("button");
      b.className = i === Scan.cur ? "on" : "";
      b.innerHTML = p.thumb ? '<img alt="" src="' + p.thumb + '">' : '<span style="color:#667;font-size:12px">' + (i + 1) + "</span>";
      b.onclick = () => { Scan.cur = i; p.out ? Scan.showFx() : Scan.showCrop(); };
      s.appendChild(b);
    });
  },

  rotate() {
    const p = Scan.page(); if (!p) return;
    const c = document.createElement("canvas"), w = p.src.width, h = p.src.height;
    c.width = h; c.height = w;
    const x = c.getContext("2d");
    x.translate(h, 0); x.rotate(Math.PI / 2); x.drawImage(p.src, 0, 0);
    p.src = c;
    p.q = p.q.map(([qx, qy]) => [h - qy, qx]);
    p.q = [p.q[3], p.q[0], p.q[1], p.q[2]];      /* garde l'ordre haut-gauche, haut-droit… */
    p.warp = null; p.out = null;
    Scan.showCrop();
  },

  remove() {
    Scan.pages.splice(Scan.cur, 1);
    if (!Scan.pages.length) { closePanel(); return; }
    Scan.cur = Math.min(Scan.cur, Scan.pages.length - 1);
    Scan.page().out ? Scan.showFx() : Scan.showCrop();
  },

  async finish() {
    busy(true, "Création du PDF…");
    try {
      for (const p of Scan.pages) if (!p.out) await Scan.process(p);
      const L = window.PDFLib, doc = await L.PDFDocument.create();
      for (const p of Scan.pages) {
        const blob = await new Promise(r => p.out.toBlob(r, "image/jpeg", 0.82));
        const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const W = 595.28, H = W * p.out.height / p.out.width;
        doc.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
      }
      doc.setTitle("Scan"); doc.setCreator("LeSacAPDF");
      const bytes = await doc.save();
      const d = new Date();
      const name = "Scan " + fmtDate(d).replace(/\//g, "-") + " " + fmtTime(d) + ".pdf";
      busy(false);
      closePanel();
      await openBytes(bytes, name);
    } catch (e) {
      console.error(e); busy(false); toast("Échec : " + e.message, 5000);
    }
  }
};

/* --- détection automatique de la feuille : zone claire principale (seuil
   d'Otsu sur une image réduite), puis ses 4 coins extrêmes. */
function detectPaper(src) {
  const k = 220 / Math.max(src.width, src.height);
  const w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++) {
    const v = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
    g[i] = v; hist[v]++;
  }
  /* seuil d'Otsu */
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = w * h - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  /* plus grande zone claire connexe */
  const lab = new Int32Array(w * h).fill(-1);
  let bestId = -1, bestN = 0, id = 0;
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== -1 || g[i] <= thr) continue;
    let n = 0; stack.push(i); lab[i] = id;
    while (stack.length) {
      const j = stack.pop(); n++;
      const jx = j % w, jy = (j / w) | 0;
      const nb = [jx > 0 ? j - 1 : -1, jx < w - 1 ? j + 1 : -1, jy > 0 ? j - w : -1, jy < h - 1 ? j + w : -1];
      for (const q of nb) if (q >= 0 && lab[q] === -1 && g[q] > thr) { lab[q] = id; stack.push(q); }
    }
    if (n > bestN) { bestN = n; bestId = id; }
    id++;
  }
  if (bestN < w * h * 0.12 || bestN > w * h * 0.96) return null;
  let tl = null, tr = null, br = null, bl = null;
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== bestId) continue;
    const px = i % w, py = (i / w) | 0;
    if (!tl || px + py < tl[0] + tl[1]) tl = [px, py];
    if (!br || px + py > br[0] + br[1]) br = [px, py];
    if (!tr || px - py > tr[0] - tr[1]) tr = [px, py];
    if (!bl || px - py < bl[0] - bl[1]) bl = [px, py];
  }
  const area = Math.abs((tr[0] - bl[0]) * (br[1] - tl[1]) - (br[0] - tl[0]) * (tr[1] - bl[1])) / 2;
  if (area < w * h * 0.1) return null;
  return [tl, tr, br, bl].map(([px, py]) => [(px + 0.5) / k, (py + 0.5) / k]);
}

/* --- redressement : homographie (rectangle de sortie -> quadrilatère source) */
function homography(src, dst) {
  /* résout dst -> src : 8 inconnues */
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let c = 0; c < 8; c++) {                       /* élimination de Gauss */
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  return B.map((b, i) => b / A[i][i]);
}
function warpQuad(srcCanvas, q, maxSide) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.max(d(q[0], q[1]), d(q[3], q[2])), H = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const k = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(20, Math.round(W * k)); H = Math.max(20, Math.round(H * k));
  const h = homography(q, [[0, 0], [W, 0], [W, H], [0, H]]);
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const sd = srcCanvas.getContext("2d").getImageData(0, 0, sw, sh).data;
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const oc = out.getContext("2d"), od = oc.createImageData(W, H), o = od.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = h[6] * x + h[7] * y + 1;
      let u = (h[0] * x + h[1] * y + h[2]) / den, v = (h[3] * x + h[4] * y + h[5]) / den;
      u = Math.min(sw - 1.001, Math.max(0, u)); v = Math.min(sh - 1.001, Math.max(0, v));
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const oi = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
        const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
        o[oi + c] = top + (bot - top) * fy;
      }
      o[oi + 3] = 255;
    }
  }
  oc.putImageData(od, 0, 0);
  return out;
}
/* --- rendu « scanner » : fond blanchi (éclairage corrigé), contraste, filtres */
function applyFx(src, fx, contrast, bright) {
  const W = src.width, H = src.height;
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const oc = out.getContext("2d");
  oc.drawImage(src, 0, 0);
  if (fx === "none") return out;
  const img = oc.getImageData(0, 0, W, H), a = img.data;
  let bg = null;
  if (fx !== "color") {
    /* estimation de l'éclairage du papier : réduction + maximum local + agrandissement */
    const sw = Math.max(8, Math.round(W / 24)), sh = Math.max(8, Math.round(H / 24));
    const s = document.createElement("canvas"); s.width = sw; s.height = sh;
    const sc = s.getContext("2d"); sc.imageSmoothingQuality = "high"; sc.drawImage(src, 0, 0, sw, sh);
    const sd = sc.getImageData(0, 0, sw, sh);
    for (let pass = 0; pass < 2; pass++) {
      const cp = new Uint8ClampedArray(sd.data);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        for (let c = 0; c < 3; c++) {
          let m = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(sw - 1, Math.max(0, x + dx)), yy = Math.min(sh - 1, Math.max(0, y + dy));
            m = Math.max(m, cp[(yy * sw + xx) * 4 + c]);
          }
          sd.data[i + c] = m;
        }
      }
    }
    sc.putImageData(sd, 0, 0);
    const big = document.createElement("canvas"); big.width = W; big.height = H;
    const bc = big.getContext("2d"); bc.imageSmoothingQuality = "high"; bc.drawImage(s, 0, 0, W, H);
    bg = bc.getImageData(0, 0, W, H).data;
  }
  const c = clamp(+contrast, -100, 120), f = (259 * (c + 255)) / (255 * (259 - c)), br = (+bright) * 2;
  /* niveaux automatiques pour le mode couleur */
  let lo = 0, hi = 255;
  if (fx === "color") {
    const hist = new Uint32Array(256);
    for (let i = 0; i < a.length; i += 16) hist[(a[i] * 77 + a[i + 1] * 150 + a[i + 2] * 29) >> 8]++;
    const tot = a.length / 16; let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > tot * 0.01) { lo = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > tot * 0.01) { hi = i; break; } }
    if (hi - lo < 40) { lo = 0; hi = 255; }
  }
  const span = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < a.length; i += 4) {
    let r = a[i], g = a[i + 1], b = a[i + 2];
    if (bg) {
      r = r * 255 / Math.max(30, bg[i]); g = g * 255 / Math.max(30, bg[i + 1]); b = b * 255 / Math.max(30, bg[i + 2]);
    } else { r = (r - lo) * span; g = (g - lo) * span; b = (b - lo) * span; }
    if (fx === "gray" || fx === "bw") { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = l; }
    r = f * (r - 128) + 128 + br; g = f * (g - 128) + 128 + br; b = f * (b - 128) + 128 + br;
    if (fx === "bw") { const v = (r - 175) * 6 + 128; r = g = b = v; }
    a[i] = r; a[i + 1] = g; a[i + 2] = b;
  }
  oc.putImageData(img, 0, 0);
  return out;
}

/* ----------------------------------------------------- dons (PROMEDNAV) */
function faireUnDon() {
  if (!DON_URL) { toast("Le lien de don sera activé prochainement. Merci pour votre soutien !", 3500); return; }
  window.open(DON_URL, "_blank", "noopener");
}

/* =====================================================================
   VERSION 3.3 — enregistrement dans d'autres formats :
   images (PNG, JPEG), Word (.docx), OpenDocument (.odt), texte (.txt).
   Tout est fabriqué sur l'appareil, à partir du PDF annoté.
   ===================================================================== */
const MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text", txt: "text/plain",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

/* --- archive ZIP sans compression (suffisant pour DOCX, ODT et lots d'images) */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC_T[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(entries) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const now = new Date();
  const dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  for (const e of entries) {
    const name = enc.encode(e.name), data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cSize, true); end.setUint32(16, off, true);
  const all = parts.concat(central, [new Uint8Array(end.buffer)]);
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

/* --- rendu des pages du PDF annoté en images */
async function renderPages(bytes, dpi, type, onPage) {
  const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const out = [], cv = document.createElement("canvas"), cx = cv.getContext("2d", { alpha: false });
  const cap = isIOS ? 9e6 : 16e6;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (onPage) onPage(i, doc.numPages);
      await yieldUI();
      const pg = await doc.getPage(i);
      let k = dpi / 72;
      const base = pg.getViewport({ scale: 1 });
      if (base.width * base.height * k * k > cap) k = Math.sqrt(cap / (base.width * base.height));
      const vp = pg.getViewport({ scale: k });
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: cx, viewport: vp, intent: "print" }).promise;
      const blob = await new Promise(r => cv.toBlob(r, type === "png" ? "image/png" : "image/jpeg", 0.9));
      out.push({ blob, w: cv.width, h: cv.height, pw: base.width, ph: base.height });
      pg.cleanup();
    }
  } finally { cv.width = cv.height = 1; try { await doc.destroy(); } catch (e) {} }
  return out;
}

/* --- extraction du texte : lignes puis paragraphes, page par page */
async function extractText(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const vp = pg.getViewport({ scale: 1 });
      const tc = await pg.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim() && !it.hasEOL) continue;
        const [a, b, c, d, e, f] = it.transform;
        const h = Math.hypot(c, d) || Math.hypot(a, b) || 10;
        const p0 = vp.convertToViewportPoint(e, f);
        items.push({ s: it.str, x: p0[0], y: p0[1], h, w: it.width || 0 });
      }
      items.sort((p, q) => p.y - q.y || p.x - q.x);
      const lines = [];
      for (const it of items) {
        if (!it.s.trim()) continue;
        const L = lines[lines.length - 1];
        if (L && Math.abs(it.y - L.y) < Math.max(it.h, L.h) * 0.5) { L.items.push(it); L.h = Math.max(L.h, it.h); }
        else lines.push({ y: it.y, h: it.h, items: [it] });
      }
      const outLines = lines.map(L => {
        L.items.sort((p, q) => p.x - q.x);
        let s = "", end = null;
        for (const it of L.items) {
          if (end !== null && it.x - end > it.h * 0.18 && !/\s$/.test(s) && !/^\s/.test(it.s)) s += " ";
          s += it.s; end = it.x + it.w;
        }
        return { text: s.replace(/\s+/g, " ").trim(), y: L.y, h: L.h };
      }).filter(l => l.text);
      /* paragraphes : un écart vertical nettement plus grand que l'interligne */
      const paras = [];
      let prev = null;
      for (const l of outLines) {
        const P = paras[paras.length - 1];
        if (P && prev && l.y - prev.y < Math.max(l.h, prev.h) * 1.75 && Math.abs(l.h - prev.h) < 2) P.lines.push(l.text);
        else paras.push({ lines: [l.text], size: l.h });
        prev = l;
      }
      pages.push(paras);
      pg.cleanup();
    }
  } finally { try { await doc.destroy(); } catch (e) {} }
  return pages;
}

const xe = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

/* --- Word (.docx) */
async function buildDocx(pages, images, title) {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const body = [], media = [], rels = [];
  const sizes = pages.flat().map(p => p.size).sort((a, b) => a - b);
  const med = sizes.length ? sizes[sizes.length >> 1] : 11;
  const EMU = 360000, maxW = 17 * EMU, maxH = 24.7 * EMU;
  const pageCount = Math.max(pages.length, images ? images.length : 0);
  for (let i = 0; i < pageCount; i++) {
    if (i) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    if (images && images[i]) {
      const im = images[i], id = "rIdImg" + (i + 1), ext = im.ext, fn = "media/page" + (i + 1) + "." + ext;
      media.push({ name: "word/" + fn, data: new Uint8Array(await im.blob.arrayBuffer()) });
      rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + fn + '"/>');
      let cx = maxW, cy = Math.round(maxW * im.ph / im.pw);
      if (cy > maxH) { cx = Math.round(cx * maxH / cy); cy = maxH; }
      body.push('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + (i + 1) + '" name="Page ' + (i + 1) + '"/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + (i + 1) + '" name="page' + (i + 1) + '.' + ext + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>');
      if (pages[i] && pages[i].length) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    }
    for (const p of pages[i] || []) {
      const big = p.size > med * 1.25;
      const sz = Math.round(clamp(p.size, 7, 32) * 2);
      const rpr = '<w:rPr>' + (big ? "<w:b/>" : "") + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
      const runs = p.lines.map((l, k) => (k ? '<w:r>' + rpr + '<w:br/></w:r>' : "") +
        '<w:r>' + rpr + '<w:t xml:space="preserve">' + xe(l) + '</w:t></w:r>').join("");
      body.push('<w:p><w:pPr><w:spacing w:after="160"/></w:pPr>' + runs + '</w:p>');
    }
  }
  if (!body.length) body.push("<w:p/>");
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="' + W + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' + body.join("") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="' + W + '"><w:docDefaults>' +
    '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>';
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
  const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + rels.join("") + '</Relationships>';
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + xe(title) + '</dc:title><dc:creator>LeSacAPDF</dc:creator>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + 'Z</dcterms:created></cp:coreProperties>';
  return zipStore([{ name: "[Content_Types].xml", data: ct }, { name: "_rels/.rels", data: rootRels },
    { name: "docProps/core.xml", data: core }, { name: "word/document.xml", data: doc },
    { name: "word/styles.xml", data: styles }, { name: "word/_rels/document.xml.rels", data: docRels }].concat(media));
}

/* --- OpenDocument texte (.odt) */
async function buildOdt(pages, images, title) {
  const sizes = pages.flat().map(p => p.size).sort((a, b) => a - b);
  const med = sizes.length ? sizes[sizes.length >> 1] : 11;
  const used = new Set(), body = [], media = [];
  const pageCount = Math.max(pages.length, images ? images.length : 0);
  for (let i = 0; i < pageCount; i++) {
    let brk = i > 0;
    const style = base => { if (brk) { brk = false; return base + "B"; } return base; };
    if (images && images[i]) {
      const im = images[i], fn = "Pictures/page" + (i + 1) + "." + im.ext;
      media.push({ name: fn, data: new Uint8Array(await im.blob.arrayBuffer()), type: MIME[im.ext] });
      let w = 17, h = 17 * im.ph / im.pw;
      if (h > 24.7) { w = w * 24.7 / h; h = 24.7; }
      body.push('<text:p text:style-name="' + style("C") + '"><draw:frame draw:name="Page ' + (i + 1) + '" text:anchor-type="as-char" svg:width="' +
        w.toFixed(2) + 'cm" svg:height="' + h.toFixed(2) + 'cm"><draw:image xlink:href="' + fn + '" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>');
      if (pages[i] && pages[i].length) brk = true;
    }
    for (const p of pages[i] || []) {
      const sz = Math.round(clamp(p.size, 7, 32)), big = p.size > med * 1.25;
      const ts = "T" + sz + (big ? "b" : ""); used.add(ts);
      body.push('<text:p text:style-name="' + style("P") + '"><text:span text:style-name="' + ts + '">' +
        p.lines.map(xe).join("<text:line-break/>") + "</text:span></text:p>");
    }
  }
  const auto = ['<style:style style:name="P" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.28cm"/></style:style>',
    '<style:style style:name="PB" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.28cm" fo:break-before="page"/></style:style>',
    '<style:style style:name="C" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>',
    '<style:style style:name="CB" style:family="paragraph"><style:paragraph-properties fo:text-align="center" fo:break-before="page"/></style:style>']
    .concat([...used].map(ts => '<style:style style:name="' + ts + '" style:family="text"><style:text-properties fo:font-size="' +
      parseInt(ts.slice(1), 10) + 'pt"' + (ts.endsWith("b") ? ' fo:font-weight="bold"' : "") + "/></style:style>"));
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
    'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
  const content = '<?xml version="1.0" encoding="UTF-8"?><office:document-content ' + NS + ' office:version="1.2">' +
    "<office:automatic-styles>" + auto.join("") + "</office:automatic-styles><office:body><office:text>" +
    (body.join("") || "<text:p/>") + "</office:text></office:body></office:document-content>";
  const styles = '<?xml version="1.0" encoding="UTF-8"?><office:document-styles ' + NS + ' office:version="1.2"><office:styles>' +
    '<style:default-style style:family="paragraph"><style:text-properties style:font-name="Liberation Sans" fo:font-family="Calibri, Arial, sans-serif" fo:font-size="11pt" fo:language="fr" fo:country="FR"/></style:default-style>' +
    '</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" ' +
    'fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles>' +
    '<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>';
  const meta = '<?xml version="1.0" encoding="UTF-8"?><office:document-meta ' + NS + ' office:version="1.2"><office:meta><dc:title>' + xe(title) +
    '</dc:title><meta:generator>LeSacAPDF</meta:generator></office:meta></office:document-meta>';
  const manifest = '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
    '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="' + MIME.odt + '"/>' +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
    '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
    '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>' +
    media.map(m => '<manifest:file-entry manifest:full-path="' + m.name + '" manifest:media-type="' + m.type + '"/>').join("") +
    "</manifest:manifest>";
  /* « mimetype » doit être la première entrée, non compressée */
  return zipStore([{ name: "mimetype", data: MIME.odt }, { name: "content.xml", data: content }, { name: "styles.xml", data: styles },
    { name: "meta.xml", data: meta }, { name: "META-INF/manifest.xml", data: manifest }].concat(media));
}

function buildTxt(pages) {
  return pages.map((paras, i) => (i ? "\n\n--- Page " + (i + 1) + " ---\n\n" : "") +
    paras.map(p => p.lines.join("\n")).join("\n\n")).join("") + "\n";
}

/* --- fabrication du ou des fichiers dans le format choisi */
async function makeExport(fmt, baseName, opt) {
  busy(true, "Préparation du document…");
  await new Promise(r => setTimeout(r, 30));
  try {
    /* le filigrane est une décoration : gardé dans les exports en image,
       exclu des exports de texte (sinon il se mêle au contenu) */
    const textual = /^(docx|odt|txt|xlsx)$/.test(fmt) || (fmt === "pptx" && opt.pptMode === "text");
    const wmSave = S.wm;
    if (textual) S.wm = null;
    let bytes;
    try { bytes = await buildVector(); } finally { S.wm = wmSave; }
    if (fmt === "img") {
      const type = opt.imgType, ext = type === "png" ? "png" : "jpg";
      const imgs = await renderPages(bytes.slice(0), opt.dpi, type, (i, n) => busy(true, "Image de la page " + i + " sur " + n + "…"));
      const files = imgs.map((im, i) => ({ name: baseName + (imgs.length > 1 ? " - page " + (i + 1) : "") + "." + ext, blob: im.blob, type: MIME[ext] }));
      const tot = files.reduce((s, f) => s + f.blob.size, 0);
      return { files, info: files.length + " image" + (files.length > 1 ? "s " : " ") + ext.toUpperCase() + " · " + fmtMo(tot) };
    }
    if (fmt === "pdfa") {
      const lv = opt.pdfaLevel || "a";
      const out = await buildPdfA(bytes, baseName, lv);
      const blob = new Blob([out], { type: MIME.pdf });
      return { files: [{ name: baseName + " (PDF-A-2" + lv + ").pdf", blob, type: MIME.pdf }],
        info: "PDF/A-2" + lv + (lv !== "b" ? " · " + out.words + " mots sélectionnables" : "") + " · " + fmtMo(blob.size) };
    }
    if (fmt === "pptx") {
      const out = await buildPptx(bytes, baseName, opt.pptMode);
      const blob = new Blob([out], { type: MIME.pptx });
      return { files: [{ name: baseName + ".pptx", blob, type: MIME.pptx }], info: "PowerPoint · " + fmtMo(blob.size) };
    }
    if (fmt === "xlsx") {
      busy(true, "Analyse des tableaux…");
      const sheets = await extractCells(bytes.slice(0));
      const out = buildXlsx(sheets, baseName);
      const blob = new Blob([out], { type: MIME.xlsx });
      const rows = sheets.reduce((n, s2) => n + s2.length, 0);
      return { files: [{ name: baseName + ".xlsx", blob, type: MIME.xlsx }],
        info: sheets.length + " feuille" + (sheets.length > 1 ? "s" : "") + " · " + rows + " lignes · " + fmtMo(blob.size), empty: !rows };
    }
    busy(true, "Extraction du texte…");
    const pages = await extractText(bytes.slice(0));
    const nWords = pages.flat().reduce((s, p) => s + p.lines.join(" ").split(/\s+/).filter(Boolean).length, 0);
    let images = null;
    if ((fmt === "docx" || fmt === "odt") && opt.withImages) {
      images = (await renderPages(bytes.slice(0), 130, "jpg", (i, n) => busy(true, "Image de la page " + i + " sur " + n + "…")))
        .map(im => Object.assign(im, { ext: "jpg" }));
    }
    let data;
    if (fmt === "docx") data = await buildDocx(pages, images, baseName);
    else if (fmt === "odt") data = await buildOdt(pages, images, baseName);
    else data = new TextEncoder().encode(buildTxt(pages));
    const blob = new Blob([data], { type: MIME[fmt] });
    const note = !nWords ? (images ? "aucun texte trouvé (document scanné ?) : pages ajoutées en images" :
      "aucun texte trouvé : document scanné ? Cochez « Ajouter aussi l'image de chaque page »") : nWords + " mots";
    return { files: [{ name: baseName + "." + fmt, blob, type: MIME[fmt] }], info: note + " · " + fmtMo(blob.size), empty: !nWords && !images };
  } finally { busy(false); }
}

/* --- partage de plusieurs fichiers (images d'un document de plusieurs pages) */
async function shareFiles(files) {
  try {
    const list = files.map(f => new File([f.blob], f.name, { type: f.type }));
    if (navigator.canShare && navigator.canShare({ files: list })) {
      await navigator.share({ files: list, title: files[0].name });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "aborted";
    console.warn("partage impossible :", e);
  }
  saveFiles(files);
  toast("Partage de ce format non pris en charge ici : fichier téléchargé.", 4500);
  return "downloaded";
}
/* --- enregistrement : un fichier tel quel, plusieurs fichiers dans un ZIP */
async function saveFiles(files, zipName) {
  let blob, name;
  if (files.length === 1) { blob = files[0].blob; name = files[0].name; }
  else {
    const entries = [];
    for (const f of files) entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
    blob = new Blob([zipStore(entries)], { type: MIME.zip }); name = zipName || "images.zip";
  }
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const ext = "." + name.split(".").pop();
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext.toUpperCase().slice(1), accept: { [blob.type || "application/octet-stream"]: [ext] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      toast("Enregistré : " + h.name); return;
    } catch (e) { if (e && e.name === "AbortError") return; }
  }
  download(blob, name);
  toast("Fichier téléchargé : " + name, 4000);
}

/* =====================================================================
   VERSION 4.0 — filigrane, censure définitive, chiffrement AES-256,
   PDF/A-2b, PowerPoint, Excel, conversion vers PDF, comparaison.
   ===================================================================== */

/* ================================================================ filigrane */
const WM_PRESETS = ["PROJET", "CONFIDENTIEL", "Usage exclusivement destiné à la location", "COPIE",
                    "BROUILLON", "DOCUMENT DE TRAVAIL", "ANNULÉ", "NE PAS DIFFUSER"];
const WM_DEF = { type: "text", text: "CONFIDENTIEL", font: "Helvetica", bold: true, color: "#c0392b",
                 opacity: 0.25, pos: "diag", size: 60, fit: true, pages: "all", scale: 0.5, src: null, ratio: 1 };
const WM = {
  /* taille effective du texte (ajustée à la page si « fit ») */
  size(pw, ph, wm, widthAt100) {
    if (!wm.fit || wm.pos === "tile" || wm.pos === "top" || wm.pos === "bottom") return wm.size;
    const target = wm.pos === "diag" ? Math.hypot(pw, ph) * 0.72 : pw * 0.8;
    return clamp(target / Math.max(1, widthAt100) * 100, 8, 220);
  },
  /* positions (centres) et angle en degrés, sens trigonométrique, repère « écran » */
  places(pw, ph, wm, w, h) {
    const diag = Math.atan2(ph, pw) * 180 / Math.PI;
    switch (wm.pos) {
      case "diag": return [{ cx: pw / 2, cy: ph / 2, a: diag }];
      case "top": return [{ cx: pw / 2, cy: Math.max(h / 2 + 14, ph * 0.06), a: 0 }];
      case "bottom": return [{ cx: pw / 2, cy: ph - Math.max(h / 2 + 14, ph * 0.06), a: 0 }];
      case "tile": {
        const out = [], sx = w * 1.25 + 40, sy = h * 3.2 + 40;
        for (let y = sy / 2, r = 0; y < ph + sy; y += sy, r++)
          for (let x = (r % 2 ? sx / 2 : 0); x < pw + sx; x += sx) out.push({ cx: x, cy: y, a: 30 });
        return out;
      }
      default: return [{ cx: pw / 2, cy: ph / 2, a: 0 }];
    }
  },
  measure(text, font, bold, size) {
    const c = measure._c || (measure._c = document.createElement("canvas").getContext("2d"));
    c.font = (bold ? "bold " : "") + size + "px " + CSS_FONT[font];
    return c.measureText(text).width;
  },
  /* aperçu dans l'éditeur */
  render() {
    $$(".wmk").forEach(e => e.remove());
    const wm = S.wm; if (!wm) return;
    S.pages.forEach((p, i) => {
      if (!p.layer || (wm.pages === "first" && i > 0)) return;
      let w, h, size = 0;
      if (wm.type === "image" && wm.src) { w = p.dw * wm.scale; h = w * wm.ratio; }
      else {
        size = WM.size(p.dw, p.dh, wm, WM.measure(wm.text, wm.font, wm.bold, 100));
        w = WM.measure(wm.text, wm.font, wm.bold, size); h = size;
      }
      for (const q of WM.places(p.dw, p.dh, wm, w, h)) {
        const d = document.createElement("div");
        d.className = "wmk";
        d.style.left = (q.cx * S.scale) + "px"; d.style.top = (q.cy * S.scale) + "px";
        d.style.opacity = wm.opacity;
        d.style.transform = "translate(-50%,-50%) rotate(" + (-q.a) + "deg)";
        if (wm.type === "image" && wm.src) {
          const im = document.createElement("img"); im.src = wm.src; im.alt = "";
          im.style.width = (w * S.scale) + "px"; im.style.height = (h * S.scale) + "px";
          d.appendChild(im);
        } else {
          d.textContent = wm.text; d.style.color = wm.color;
          d.style.font = (wm.bold ? "bold " : "") + (size * S.scale) + "px " + CSS_FONT[wm.font];
        }
        p.layer.prepend(d);
      }
    });
  },
  /* dessin dans le PDF (pdf-lib) */
  async draw(doc, page, g, idx, fonts) {
    const wm = S.wm; if (!wm || (wm.pages === "first" && idx > 0)) return;
    const L = window.PDFLib;
    const pw = (g.rot === 90 || g.rot === 270) ? g.ph : g.pw, ph = (g.rot === 90 || g.rot === 270) ? g.pw : g.ph;
    const geo = (q, w, h, upShift) => {
      const a = q.a * Math.PI / 180, dir = [Math.cos(a), -Math.sin(a)], up = [-Math.sin(a), -Math.cos(a)];
      return mapPt(q.cx - dir[0] * w / 2 - up[0] * upShift, q.cy - dir[1] * w / 2 - up[1] * upShift, g);
    };
    if (wm.type === "image" && wm.src) {
      const img = await embed(doc, wm.src); if (!img) return;
      const w = pw * wm.scale, h = w * wm.ratio;
      for (const q of WM.places(pw, ph, wm, w, h)) {
        const P = geo(q, w, h, h / 2);
        page.drawImage(img, { x: P[0], y: P[1], width: w, height: h, opacity: wm.opacity, rotate: L.degrees(g.rot + q.a) });
      }
      return;
    }
    const f = await getFont(doc, fonts, { font: wm.font, bold: wm.bold });
    const t = clean(wm.text);
    const size = WM.size(pw, ph, wm, f.widthOfTextAtSize(t, 100));
    const w = f.widthOfTextAtSize(t, size), cap = size * 0.7;
    for (const q of WM.places(pw, ph, wm, w, size)) {
      const P = geo(q, w, cap, cap / 2);
      page.drawText(t, { x: P[0], y: P[1], size, font: f, color: hexRgb(wm.color, L), opacity: wm.opacity,
        rotate: L.degrees(g.rot + q.a) });
    }
  }
};

/* ======================================================== censure définitive
   Les pages qui portent une zone censurée sont remplacées par une image où
   les zones sont noircies : le texte et les images d'origine disparaissent
   réellement (vérifiable : le texte n'est plus extractible). */
const hasRedactions = () => S.items.some(it => it.type === "redact");
async function burnRedactions(bytes) {
  const pagesIdx = [...new Set(S.items.filter(it => it.type === "redact").map(it => it.page))].sort((a, b) => a - b);
  if (!pagesIdx.length) return bytes;
  const L = window.PDFLib;
  const src = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const cv = document.createElement("canvas"), cx = cv.getContext("2d", { alpha: false });
  try {
    for (const i of pagesIdx) {
      busy(true, "Censure définitive — page " + (i + 1) + "…");
      await yieldUI();
      const pg = await src.getPage(i + 1);
      const base = pg.getViewport({ scale: 1 });
      let k = 200 / 72;
      const cap = isIOS ? 9e6 : 16e6;
      if (base.width * base.height * k * k > cap) k = Math.sqrt(cap / (base.width * base.height));
      const vp = pg.getViewport({ scale: k });
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: cx, viewport: vp, intent: "print" }).promise;
      /* sécurité : les zones sont repeintes en noir sur l'image, quoi qu'il arrive au rendu */
      cx.fillStyle = "#000";
      for (const it of S.items.filter(x => x.type === "redact" && x.page === i))
        cx.fillRect(it.x * k - 1, it.y * k - 1, it.w * k + 2, it.h * k + 2);
      const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92));
      const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      doc.removePage(i);
      const np = doc.insertPage(i, [base.width, base.height]);
      np.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      pg.cleanup();
    }
    await doc.flush();            /* les images sont réellement écrites avant le nettoyage */
    pruneDangling(doc);
    return await doc.save({ useObjectStreams: false });
  } finally { cv.width = cv.height = 1; try { await src.destroy(); } catch (e) {} busy(false); }
}

/* =============================================== chiffrement AES-256 (R6)
   Norme ISO 32000-2, gestionnaire de sécurité standard, révision 6.
   Calculs faits par le navigateur (WebCrypto), rien n'est envoyé. */
const Crypt = {
  rnd: n => crypto.getRandomValues(new Uint8Array(n)),
  cat(...a) { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; },
  async sha(alg, d) { return new Uint8Array(await crypto.subtle.digest(alg, d)); },
  async aesCbc(key, iv, data, noPad) {
    const k = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["encrypt"]);
    const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, k, data));
    return noPad ? out.slice(0, data.length) : out;        /* sans remplissage : on retire le bloc ajouté */
  },
  /* algorithme 2.B (ISO 32000-2, 7.6.4.3.4) */
  async hash(pwd, salt, udata) {
    let k = await Crypt.sha("SHA-256", Crypt.cat(pwd, salt, udata)), e = new Uint8Array(0);
    let i = 0;
    while (i < 64 || e[e.length - 1] > i - 32) {
      const k1 = Crypt.cat(pwd, k, udata), big = new Uint8Array(k1.length * 64);
      for (let j = 0; j < 64; j++) big.set(k1, j * k1.length);
      e = await Crypt.aesCbc(k.slice(0, 16), k.slice(16, 32), big, true);
      let s = 0; for (let j = 0; j < 16; j++) s += e[j];
      k = await Crypt.sha(["SHA-256", "SHA-384", "SHA-512"][s % 3], e);
      i++;
    }
    return k.slice(0, 32);
  },
  hex: b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("")
};
async function encryptPdf(bytes, password) {
  if (!window.crypto || !crypto.subtle) throw new Error("chiffrement indisponible (connexion non sécurisée)");
  const L = window.PDFLib;
  const pwd = new TextEncoder().encode(password).slice(0, 127);
  const fileKey = Crypt.rnd(32);
  /* U, UE */
  const uvs = Crypt.rnd(8), uks = Crypt.rnd(8);
  const U = Crypt.cat(await Crypt.hash(pwd, uvs, new Uint8Array(0)), uvs, uks);
  const UE = await Crypt.aesCbc(await Crypt.hash(pwd, uks, new Uint8Array(0)), new Uint8Array(16), fileKey, true);
  /* O, OE (mot de passe propriétaire = même mot de passe) */
  const ovs = Crypt.rnd(8), oks = Crypt.rnd(8);
  const O = Crypt.cat(await Crypt.hash(pwd, ovs, U), ovs, oks);
  const OE = await Crypt.aesCbc(await Crypt.hash(pwd, oks, U), new Uint8Array(16), fileKey, true);
  /* Perms : P (tous droits) + « adb », chiffré AES-256 en mode ECB (un bloc = CBC à IV nul) */
  const P = -4;
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, P, true);
  perms.set([0xFF, 0xFF, 0xFF, 0xFF, 0x54, 0x61, 0x64, 0x62], 4);
  perms.set(Crypt.rnd(4), 12);
  const Perms = await Crypt.aesCbc(fileKey, new Uint8Array(16), perms, true);

  const doc = await L.PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const encBytes = async d => { const iv = Crypt.rnd(16); return Crypt.cat(iv, await Crypt.aesCbc(fileKey, iv, d)); };
  const encObj = async o => {
    if (o instanceof L.PDFString || o instanceof L.PDFHexString) return L.PDFHexString.of(Crypt.hex(await encBytes(o.asBytes())));
    if (o instanceof L.PDFDict) { for (const [k, v] of o.entries()) o.set(k, await encObj(v)); return o; }
    if (o instanceof L.PDFArray) { for (let i = 0; i < o.size(); i++) o.set(i, await encObj(o.get(i))); return o; }
    return o;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof L.PDFRawStream) {
      await encObj(obj.dict);
      ctx.assign(ref, L.PDFRawStream.of(obj.dict, await encBytes(obj.contents)));
    } else if (obj instanceof L.PDFStream) {
      throw new Error("flux non pris en charge pour le chiffrement");
    } else await encObj(obj);
  }
  const hexs = b => L.PDFHexString.of(Crypt.hex(b));
  const encDict = ctx.obj({
    Filter: "Standard", V: 5, R: 6, Length: 256, P,
    CF: { StdCF: { AuthEvent: "DocOpen", CFM: "AESV3", Length: 32 } }, StmF: "StdCF", StrF: "StdCF",
    EncryptMetadata: true
  });
  encDict.set(L.PDFName.of("O"), hexs(O)); encDict.set(L.PDFName.of("U"), hexs(U));
  encDict.set(L.PDFName.of("OE"), hexs(OE)); encDict.set(L.PDFName.of("UE"), hexs(UE));
  encDict.set(L.PDFName.of("Perms"), hexs(Perms));
  const encRef = ctx.register(encDict);
  ctx.trailerInfo.Encrypt = encRef;
  const id = hexs(Crypt.rnd(16));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

/* ===================================================== PDF/A-2b, 2u et 2a
   2b : image fidèle de chaque page, profil sRGB, métadonnées XMP.
   2u : + couche de texte invisible, en Unicode, police Liberation Sans
        intégrée (sous-ensemble) : texte sélectionnable et cherchable.
   2a : + PDF balisé : paragraphes (P) dans un arbre de structure, langue
        du document, image de page déclarée comme élément décoratif.     */
const SRGB_ICC_B64 = "AAAJ3GxjbXMCEAAAbW50clJHQiBYWVogAAAAAAAAAAAAAAAAYWNzcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABsY3BydAAAAVwAAAAkd3RwdAAAAYAAAAAUclhZWgAAAZQAAAAUZ1hZWgAAAagAAAAUYlhZWgAAAbwAAAAUclRSQwAAAdAAAAgMZ1RSQwAAAdAAAAgMYlRSQwAAAdAAAAgMZGVzYwAAAAAAAAASc1JHQiBJRUM2MTk2Ni0yLjEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdGV4dAAAAABObyBjb3B5cmlnaHQsIHVzZSBmcmVlbHkAAAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1YWVogAAAAAAAAb6QAADj2AAADj1hZWiAAAAAAAABilgAAt4cAABjcWFlaIAAAAAAAACSiAAAPgwAAts9jdXJ2AAAAAAAABAAAAAAFAAoADwAUABkAHgAjACgALQAyADcAOwBAAEUASgBPAFQAWQBeAGMAaABtAHIAdwB8AIEAhgCLAJAAlQCaAJ8ApACpAK4AsgC3ALwAwQDGAMsA0ADVANsA4ADlAOsA8AD2APsBAQEHAQ0BEwEZAR8BJQErATIBOAE+AUUBTAFSAVkBYAFnAW4BdQF8AYMBiwGSAZoBoQGpAbEBuQHBAckB0QHZAeEB6QHyAfoCAwIMAhQCHQImAi8COAJBAksCVAJdAmcCcQJ6AoQCjgKYAqICrAK2AsECywLVAuAC6wL1AwADCwMWAyEDLQM4A0MDTwNaA2YDcgN+A4oDlgOiA64DugPHA9MD4APsA/kEBgQTBCAELQQ7BEgEVQRjBHEEfgSMBJoEqAS2BMQE0wThBPAE/gUNBRwFKwU6BUkFWAVnBXcFhgWWBaYFtQXFBdUF5QX2BgYGFgYnBjcGSAZZBmoGewaMBp0GrwbABtEG4wb1BwcHGQcrBz0HTwdhB3QHhgeZB6wHvwfSB+UH+AgLCB8IMghGCFoIbgiCCJYIqgi+CNII5wj7CRAJJQk6CU8JZAl5CY8JpAm6Cc8J5Qn7ChEKJwo9ClQKagqBCpgKrgrFCtwK8wsLCyILOQtRC2kLgAuYC7ALyAvhC/kMEgwqDEMMXAx1DI4MpwzADNkM8w0NDSYNQA1aDXQNjg2pDcMN3g34DhMOLg5JDmQOfw6bDrYO0g7uDwkPJQ9BD14Peg+WD7MPzw/sEAkQJhBDEGEQfhCbELkQ1xD1ERMRMRFPEW0RjBGqEckR6BIHEiYSRRJkEoQSoxLDEuMTAxMjE0MTYxODE6QTxRPlFAYUJxRJFGoUixStFM4U8BUSFTQVVhV4FZsVvRXgFgMWJhZJFmwWjxayFtYW+hcdF0EXZReJF64X0hf3GBsYQBhlGIoYrxjVGPoZIBlFGWsZkRm3Gd0aBBoqGlEadxqeGsUa7BsUGzsbYxuKG7Ib2hwCHCocUhx7HKMczBz1HR4dRx1wHZkdwx3sHhYeQB5qHpQevh7pHxMfPh9pH5Qfvx/qIBUgQSBsIJggxCDwIRwhSCF1IaEhziH7IiciVSKCIq8i3SMKIzgjZiOUI8Ij8CQfJE0kfCSrJNolCSU4JWgllyXHJfcmJyZXJocmtyboJxgnSSd6J6sn3CgNKD8ocSiiKNQpBik4KWspnSnQKgIqNSpoKpsqzysCKzYraSudK9EsBSw5LG4soizXLQwtQS12Last4S4WLkwugi63Lu4vJC9aL5Evxy/+MDUwbDCkMNsxEjFKMYIxujHyMioyYzKbMtQzDTNGM38zuDPxNCs0ZTSeNNg1EzVNNYc1wjX9Njc2cjauNuk3JDdgN5w31zgUOFA4jDjIOQU5Qjl/Obw5+To2OnQ6sjrvOy07azuqO+g8JzxlPKQ84z0iPWE9oT3gPiA+YD6gPuA/IT9hP6I/4kAjQGRApkDnQSlBakGsQe5CMEJyQrVC90M6Q31DwEQDREdEikTORRJFVUWaRd5GIkZnRqtG8Ec1R3tHwEgFSEtIkUjXSR1JY0mpSfBKN0p9SsRLDEtTS5pL4kwqTHJMuk0CTUpNk03cTiVObk63TwBPSU+TT91QJ1BxULtRBlFQUZtR5lIxUnxSx1MTU19TqlP2VEJUj1TbVShVdVXCVg9WXFapVvdXRFeSV+BYL1h9WMtZGllpWbhaB1pWWqZa9VtFW5Vb5Vw1XIZc1l0nXXhdyV4aXmxevV8PX2Ffs2AFYFdgqmD8YU9homH1YklinGLwY0Njl2PrZEBklGTpZT1lkmXnZj1mkmboZz1nk2fpaD9olmjsaUNpmmnxakhqn2r3a09rp2v/bFdsr20IbWBtuW4SbmtuxG8eb3hv0XArcIZw4HE6cZVx8HJLcqZzAXNdc7h0FHRwdMx1KHWFdeF2Pnabdvh3VnezeBF4bnjMeSp5iXnnekZ6pXsEe2N7wnwhfIF84X1BfaF+AX5ifsJ/I3+Ef+WAR4CogQqBa4HNgjCCkoL0g1eDuoQdhICE44VHhauGDoZyhteHO4efiASIaYjOiTOJmYn+imSKyoswi5aL/IxjjMqNMY2Yjf+OZo7OjzaPnpAGkG6Q1pE/kaiSEZJ6kuOTTZO2lCCUipT0lV+VyZY0lp+XCpd1l+CYTJi4mSSZkJn8mmia1ZtCm6+cHJyJnPedZJ3SnkCerp8dn4uf+qBpoNihR6G2oiailqMGo3aj5qRWpMelOKWpphqmi6b9p26n4KhSqMSpN6mpqhyqj6sCq3Wr6axcrNCtRK24ri2uoa8Wr4uwALB1sOqxYLHWskuywrM4s660JbSctRO1irYBtnm28Ldot+C4WbjRuUq5wro7urW7LrunvCG8m70VvY++Cr6Evv+/er/1wHDA7MFnwePCX8Lbw1jD1MRRxM7FS8XIxkbGw8dBx7/IPci8yTrJuco4yrfLNsu2zDXMtc01zbXONs62zzfPuNA50LrRPNG+0j/SwdNE08bUSdTL1U7V0dZV1tjXXNfg2GTY6Nls2fHadtr724DcBdyK3RDdlt4c3qLfKd+v4DbgveFE4cziU+Lb42Pj6+Rz5PzlhOYN5pbnH+ep6DLovOlG6dDqW+rl63Dr++yG7RHtnO4o7rTvQO/M8Fjw5fFy8f/yjPMZ86f0NPTC9VD13vZt9vv3ivgZ+Kj5OPnH+lf65/t3/Af8mP0p/br+S/7c/23//w==";
/* couche de texte : lignes regroupées en paragraphes, matrices en coordonnées de sortie */
async function textLayer(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), ph = vp.height, tc = await pg.getTextContent();
      const out = (x, y) => { const q = vp.convertToViewportPoint(x, y); return [q[0], ph - q[1]]; };
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const [a, b, c, d, e, f] = it.transform;
        const O = out(e, f), X = out(e + a, f + b), Y = out(e + c, f + d);
        const top = vp.convertToViewportPoint(e, f);
        items.push({ s: it.str, w: it.width || 0, m: [X[0] - O[0], X[1] - O[1], Y[0] - O[0], Y[1] - O[1], O[0], O[1]],
                     y: top[1], x: top[0], h: Math.hypot(c, d) || 10 });
      }
      items.sort((p, q) => p.y - q.y || p.x - q.x);
      const lines = [];
      for (const it of items) {
        const L0 = lines[lines.length - 1];
        if (L0 && Math.abs(it.y - L0.y) < Math.max(it.h, L0.h) * 0.5) { L0.items.push(it); L0.h = Math.max(L0.h, it.h); }
        else lines.push({ y: it.y, h: it.h, items: [it] });
      }
      const paras = [];
      let prev = null;
      for (const L0 of lines) {
        L0.items.sort((p, q) => p.x - q.x);
        const P = paras[paras.length - 1];
        if (P && prev && L0.y - prev.y < Math.max(L0.h, prev.h) * 1.75 && Math.abs(L0.h - prev.h) < 2) P.items.push(...L0.items);
        else paras.push({ items: L0.items.slice() });
        prev = L0;
      }
      pages.push(paras);
      pg.cleanup();
    }
  } finally { try { await doc.destroy(); } catch (e) {} }
  return pages;
}
async function buildPdfA(bytes, title, level) {
  level = level || "b";
  const L = window.PDFLib, N = n => L.PDFName.of(n);
  const imgs = await renderPages(bytes.slice(0), 200, "jpg", (i, n) => busy(true, "PDF/A — page " + i + " sur " + n + "…"));
  const doc = await L.PDFDocument.create({ updateMetadata: false });
  const ctx = doc.context;
  let font = null, charset = null, text = null;
  if (level !== "b") {
    busy(true, "PDF/A — couche de texte…");
    await loadScript("vendor/fontkit.umd.min.js");
    doc.registerFontkit(window.fontkit);
    const ttf = new Uint8Array(await (await fetch("vendor/fonts/LiberationSans-Regular.ttf")).arrayBuffer());
    font = await doc.embedFont(ttf, { subset: true });
    charset = new Set(font.getCharacterSet());
    text = await textLayer(bytes.slice(0));
  }
  const tagged = level === "a";
  const rootRef = tagged ? ctx.nextRef() : null, docElRef = tagged ? ctx.nextRef() : null;
  const allP = [], nums = [];
  let words = 0;
  for (let i = 0; i < imgs.length; i++) {
    const im = imgs[i];
    const img = await doc.embedJpg(new Uint8Array(await im.blob.arrayBuffer()));
    const page = doc.addPage([im.pw, im.ph]);
    if (level === "b") { page.drawImage(img, { x: 0, y: 0, width: im.pw, height: im.ph }); continue; }
    const imName = page.node.newXObject("Im", img.ref), fName = page.node.newFontDictionary("F", font.ref);
    let cs = (tagged ? "/Artifact BMC\n" : "") + "q " + im.pw + " 0 0 " + im.ph + " 0 0 cm " + imName + " Do Q\n" + (tagged ? "EMC\n" : "");
    const pageP = [];
    for (const para of (text[i] || [])) {
      let body = "";
      for (const it of para.items) {
        const t = Array.from(it.s).filter(ch => charset.has(ch.codePointAt(0))).join("");
        if (!t.trim()) continue;
        const w1 = font.widthOfTextAtSize(t, 1), sx = Math.hypot(it.m[0], it.m[1]);
        const tz = (w1 > 0 && sx > 0 && it.w > 0) ? clamp(it.w / (w1 * sx) * 100, 10, 1000) : 100;
        body += "BT 3 Tr " + fName + " 1 Tf " + tz.toFixed(2) + " Tz " + it.m.map(v => (+v).toFixed(4)).join(" ") + " Tm " +
          font.encodeText(t).toString() + " Tj ET\n";
        words += t.trim().split(/\s+/).length;
      }
      if (!body) continue;
      if (tagged) {
        const mcid = pageP.length;
        cs += "/P <</MCID " + mcid + ">> BDC\n" + body + "EMC\n";
        const pRef = ctx.register(ctx.obj({ Type: "StructElem", S: "P", P: docElRef, Pg: page.ref, K: mcid }));
        pageP.push(pRef); allP.push(pRef);
      } else cs += body;
    }
    if (tagged && pageP.length) { page.node.set(N("StructParents"), L.PDFNumber.of(i)); nums.push(L.PDFNumber.of(i), ctx.obj(pageP)); }
    page.node.set(N("Contents"), ctx.register(ctx.flateStream(new TextEncoder().encode(cs))));
  }
  if (tagged) {
    ctx.assign(docElRef, ctx.obj({ Type: "StructElem", S: "Document", P: rootRef, K: allP }));
    ctx.assign(rootRef, ctx.obj({ Type: "StructTreeRoot", K: docElRef, ParentTree: ctx.obj({ Nums: nums }), ParentTreeNextKey: imgs.length }));
    doc.catalog.set(N("StructTreeRoot"), rootRef);
    doc.catalog.set(N("MarkInfo"), ctx.obj({ Marked: true }));
    doc.catalog.set(N("Lang"), L.PDFString.of("fr-FR"));
  }
  const now = new Date(); now.setMilliseconds(0);
  const iso = now.toISOString().replace(/\.\d+Z$/, "Z");
  doc.setTitle(title); doc.setProducer("LeSacAPDF"); doc.setCreator("LeSacAPDF");
  doc.setCreationDate(now); doc.setModificationDate(now);
  const icc = Uint8Array.from(atob(SRGB_ICC_B64), c => c.charCodeAt(0));
  const iccRef = ctx.register(ctx.flateStream(icc, { N: 3 }));
  const oi = ctx.obj({ Type: "OutputIntent", S: "GTS_PDFA1", DestOutputProfile: iccRef });
  oi.set(N("OutputConditionIdentifier"), L.PDFString.of("sRGB IEC61966-2.1"));
  oi.set(N("Info"), L.PDFString.of("sRGB IEC61966-2.1"));
  doc.catalog.set(N("OutputIntents"), ctx.obj([ctx.register(oi)]));
  const x = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const xmp = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">' +
    "<pdfaid:part>2</pdfaid:part><pdfaid:conformance>" + level.toUpperCase() + "</pdfaid:conformance>" +
    '<dc:format>application/pdf</dc:format><dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + x(title) + "</rdf:li></rdf:Alt></dc:title>" +
    (tagged ? "<dc:language><rdf:Bag><rdf:li>fr-FR</rdf:li></rdf:Bag></dc:language>" : "") +
    "<xmp:CreatorTool>LeSacAPDF</xmp:CreatorTool><xmp:CreateDate>" + iso + "</xmp:CreateDate><xmp:ModifyDate>" + iso + "</xmp:ModifyDate>" +
    "<xmp:MetadataDate>" + iso + "</xmp:MetadataDate><pdf:Producer>LeSacAPDF</pdf:Producer>" +
    '</rdf:Description></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>';
  doc.catalog.set(N("Metadata"), ctx.register(ctx.stream(new TextEncoder().encode(xmp), { Type: "Metadata", Subtype: "XML" })));
  const id = L.PDFHexString.of(Crypt.hex(Crypt.rnd(16)));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  const saved = await doc.save({ useObjectStreams: false });
  saved.words = words;
  return saved;
}

/* ===================================================== PowerPoint (.pptx)
   Une diapositive par page : image fidèle de la page, ou texte modifiable. */
async function buildPptx(bytes, title, mode) {
  const imgs = await renderPages(bytes.slice(0), 150, "jpg", (i, n) => busy(true, "Diapositive " + i + " sur " + n + "…"));
  const texts = mode === "text" ? await extractText(bytes.slice(0)) : null;
  const E = 12700;                               /* 1 point = 12 700 EMU */
  const W = Math.round(imgs[0].pw * E), H = Math.round(imgs[0].ph * E);
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  const files = [], slideIds = [], presRels = [], ctOver = [];
  const spTree = inner => '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' + inner + "</p:spTree></p:cSld>";
  for (let i = 0; i < imgs.length; i++) {
    const n = i + 1, im = imgs[i];
    /* chaque diapositive garde le format de la page, centrée si les pages diffèrent */
    let cx = W, cy = Math.round(W * im.ph / im.pw);
    if (cy > H) { cy = H; cx = Math.round(H * im.pw / im.ph); }
    const ox = Math.round((W - cx) / 2), oy = Math.round((H - cy) / 2);
    let inner, rels = '<Relationship Id="rId1" Type="' + RT + 'slideLayout" Target="../slideLayouts/slideLayout1.xml"/>';
    if (mode === "text") {
      const paras = (texts[i] || []).map(p => {
        const sz = Math.round(clamp(p.size, 8, 40) * 100);
        return "<a:p>" + p.lines.map((l, k) => (k ? "<a:br><a:rPr lang=\"fr-FR\" sz=\"" + sz + "\"/></a:br>" : "") +
          '<a:r><a:rPr lang="fr-FR" sz="' + sz + '" dirty="0"/><a:t>' + xe(l) + "</a:t></a:r>").join("") + "</a:p>";
      }).join("") || "<a:p><a:endParaRPr lang=\"fr-FR\"/></a:p>";
      const m = Math.round(0.05 * W);
      inner = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Texte"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + m + '" y="' + m +
        '"/><a:ext cx="' + (W - 2 * m) + '" cy="' + (H - 2 * m) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>' +
        '<p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>' + paras + "</p:txBody></p:sp>";
    } else {
      files.push({ name: "ppt/media/page" + n + ".jpg", data: new Uint8Array(await im.blob.arrayBuffer()) });
      rels += '<Relationship Id="rId2" Type="' + RT + 'image" Target="../media/page' + n + '.jpg"/>';
      inner = '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ' + n + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
        '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + ox + '" y="' + oy +
        '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
    }
    files.push({ name: "ppt/slides/slide" + n + ".xml", data: hdr + "<p:sld " + NS + ">" + spTree(inner) + "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>" });
    files.push({ name: "ppt/slides/_rels/slide" + n + ".xml.rels", data: hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + "</Relationships>" });
    slideIds.push('<p:sldId id="' + (255 + n) + '" r:id="rId' + (n + 1) + '"/>');
    presRels.push('<Relationship Id="rId' + (n + 1) + '" Type="' + RT + 'slide" Target="slides/slide' + n + '.xml"/>');
    ctOver.push('<Override PartName="/ppt/slides/slide' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>');
  }
  const theme = hdr + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="LeSacAPDF"><a:themeElements>' +
    '<a:clrScheme name="LeSacAPDF"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="1B3558"/></a:dk2><a:lt2><a:srgbClr val="EEF1F5"/></a:lt2><a:accent1><a:srgbClr val="2D6CDF"/></a:accent1><a:accent2><a:srgbClr val="E5484D"/></a:accent2>' +
    '<a:accent3><a:srgbClr val="C98B4E"/></a:accent3><a:accent4><a:srgbClr val="1E8E55"/></a:accent4><a:accent5><a:srgbClr val="9B51E0"/></a:accent5><a:accent6><a:srgbClr val="0F9BB0"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="2D6CDF"/></a:hlink><a:folHlink><a:srgbClr val="9B51E0"/></a:folHlink></a:clrScheme>' +
    '<a:fontScheme name="LeSacAPDF"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
    '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
    '<a:fmtScheme name="LeSacAPDF"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
    '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
    "</a:fmtScheme></a:themeElements></a:theme>";
  const master = hdr + "<p:sldMaster " + NS + "><p:cSld><p:bg><p:bgRef idx=\"1001\"><a:schemeClr val=\"bg1\"/></p:bgRef></p:bg>" + spTree("").replace("<p:cSld>", "").replace("</p:cSld>", "") +
    '</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';
  const layout = hdr + "<p:sldLayout " + NS + ' type="blank" preserve="1">' + spTree("").replace("<p:cSld>", '<p:cSld name="Vide">') + "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>";
  const rel = (id, type, target) => '<Relationship Id="' + id + '" Type="' + RT + type + '" Target="' + target + '"/>';
  const rels = x => hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + x + "</Relationships>";
  const pres = hdr + "<p:presentation " + NS + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    "<p:sldIdLst>" + slideIds.join("") + '</p:sldIdLst><p:sldSz cx="' + W + '" cy="' + H + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
  const ct = hdr + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + ctOver.join("") + "</Types>";
  const core = hdr + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xe(title) + '</dc:title><dc:creator>LeSacAPDF</dc:creator>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + "Z</dcterms:created></cp:coreProperties>";
  return zipStore([
    { name: "[Content_Types].xml", data: ct },
    { name: "_rels/.rels", data: rels(rel("rId1", "officeDocument", "ppt/presentation.xml") +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>') },
    { name: "docProps/core.xml", data: core },
    { name: "ppt/presentation.xml", data: pres },
    { name: "ppt/_rels/presentation.xml.rels", data: rels(rel("rId1", "slideMaster", "slideMasters/slideMaster1.xml") + presRels.join("") +
      rel("rId" + (imgs.length + 2), "theme", "theme/theme1.xml")) },
    { name: "ppt/slideMasters/slideMaster1.xml", data: master },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: rels(rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml") + rel("rId2", "theme", "../theme/theme1.xml")) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: layout },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: rels(rel("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")) },
    { name: "ppt/theme/theme1.xml", data: theme }
  ].concat(files));
}

/* ============================================================ Excel (.xlsx)
   Une feuille par page ; chaque ligne de texte devient une ligne du tableur,
   découpée en colonnes selon l'alignement horizontal du texte. */
async function extractCells(bytes) {
  const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const sheets = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const [a, b, c, d, e, f] = it.transform;
        const p0 = vp.convertToViewportPoint(e, f);
        items.push({ s: it.str, x: p0[0], y: p0[1], h: Math.hypot(c, d) || 10, w: it.width || 0 });
      }
      items.sort((p, q) => p.y - q.y || p.x - q.x);
      const lines = [];
      for (const it of items) {
        const L0 = lines[lines.length - 1];
        if (L0 && Math.abs(it.y - L0.y) < Math.max(it.h, L0.h) * 0.5) L0.items.push(it);
        else lines.push({ y: it.y, h: it.h, items: [it] });
      }
      /* cellules : un grand écart horizontal sépare deux cellules */
      const rows = lines.map(L0 => {
        L0.items.sort((p, q) => p.x - q.x);
        const cells = [];
        for (const it of L0.items) {
          const c = cells[cells.length - 1];
          if (c && it.x - c.end < it.h * 1.2) { c.s += (it.x - c.end > it.h * 0.18 && !/\s$/.test(c.s) ? " " : "") + it.s; c.end = it.x + it.w; }
          else cells.push({ s: it.s, x: it.x, end: it.x + it.w });
        }
        return cells.map(c => ({ s: c.s.replace(/\s+/g, " ").trim(), x: c.x }));
      });
      /* colonnes : positions de départ regroupées sur toute la page */
      const xs = rows.flat().map(c => c.x).sort((a, b) => a - b), cols = [];
      for (const x of xs) { if (!cols.length || x - cols[cols.length - 1] > 14) cols.push(x); }
      const colOf = x => { let best = 0; cols.forEach((c, k) => { if (Math.abs(c - x) < Math.abs(cols[best] - x)) best = k; }); return best; };
      sheets.push(rows.map(r => {
        const out = [];
        for (const c of r) { let k = colOf(c.x); while (out[k] !== undefined) k++; out[k] = c.s; }
        return out;
      }));
      pg.cleanup();
    }
  } finally { try { await doc.destroy(); } catch (e) {} }
  return sheets;
}
function buildXlsx(sheets, title) {
  const hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const col = n => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  /* nombres au format français : « 1 234,56 », « 120,00 € », « 12 % » */
  /* renvoie { v, st } : st = 1 (euros) ou 2 (pourcentage) pour le format de cellule */
  const num = s => {
    const raw = s.replace(/[   ]/g, ""), eur = /€$/.test(raw), t = raw.replace(/€$/, "");
    if (!/^-?\d+(?:[.,]\d+)?%?$/.test(t)) return null;
    const v = parseFloat(t.replace(",", ".").replace("%", ""));
    if (!isFinite(v)) return null;
    return t.endsWith("%") ? { v: v / 100, st: 2 } : { v, st: eur ? 1 : 0 };
  };
  const files = [], wbSheets = [], wbRels = [], ctOver = [];
  const list = sheets.length ? sheets : [[]];
  list.forEach((rows, i) => {
    const n = i + 1;
    let maxC = 0;
    const widths = [];
    const xmlRows = rows.map((r, ri) => {
      maxC = Math.max(maxC, r.length);
      const cells = [];
      r.forEach((v, ci) => {
        if (v === undefined || v === "") return;
        widths[ci] = Math.max(widths[ci] || 8, Math.min(60, v.length + 2));
        const ref = col(ci) + (ri + 1), nv = num(v);
        cells.push(nv !== null ? '<c r="' + ref + '"' + (nv.st ? ' s="' + nv.st + '"' : "") + "><v>" + nv.v + "</v></c>"
          : '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xe(v) + "</t></is></c>");
      });
      return '<row r="' + (ri + 1) + '">' + cells.join("") + "</row>";
    }).join("");
    const colsXml = widths.length ? "<cols>" + widths.map((w, k) => w ? '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + w + '" customWidth="1"/>' : "").join("") + "</cols>" : "";
    files.push({ name: "xl/worksheets/sheet" + n + ".xml", data: hdr + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      colsXml + "<sheetData>" + xmlRows + "</sheetData></worksheet>" });
    wbSheets.push('<sheet name="Page ' + n + '" sheetId="' + n + '" r:id="rId' + n + '"/>');
    wbRels.push('<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>');
    ctOver.push('<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  });
  const S2 = list.length + 1;
  const styles = hdr + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return zipStore([
    { name: "[Content_Types].xml", data: hdr + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ctOver.join("") + "</Types>" },
    { name: "_rels/.rels", data: hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", data: hdr + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + wbSheets.join("") + "</sheets></workbook>" },
    { name: "xl/_rels/workbook.xml.rels", data: hdr + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wbRels.join("") +
      '<Relationship Id="rId' + S2 + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: "xl/styles.xml", data: styles }
  ].concat(files));
}

/* ================================================ conversion vers PDF
   Images : intégrées telles quelles (texte des images non reconnu).
   HTML, Word (.docx), OpenDocument (.odt), PowerPoint (.pptx) : mis en page
   puis convertis en images de pages (texte non sélectionnable).          */
const loadScript = src => new Promise((res, rej) => {
  if (document.querySelector('script[data-src="' + src + '"]')) { res(); return; }
  const s = document.createElement("script"); s.src = src; s.dataset.src = src;
  s.onload = res; s.onerror = () => rej(new Error("module « " + src + " » indisponible"));
  document.head.appendChild(s);
});

/* --- lecture d'une archive ZIP (DOCX, ODT, PPTX) */
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("archive illisible");
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder(), entries = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    entries[dec.decode(u8.subarray(p + 46, p + 46 + nl))] = { method, csize, lho };
    p += 46 + nl + xl + cl;
  }
  const get = async name => {
    const e = entries[name]; if (!e) return null;
    const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
    const data = u8.subarray(start, start + e.csize);
    if (e.method === 0) return data.slice();
    if (e.method !== 8) throw new Error("compression non prise en charge");
    if (typeof DecompressionStream !== "function") throw new Error("navigateur trop ancien pour ce format");
    return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  };
  return { names: Object.keys(entries), get, text: async n => { const d = await get(n); return d ? dec.decode(d) : null; } };
}
const xmlDoc = s => new DOMParser().parseFromString(s, "application/xml");
const kids = (el, name) => Array.from(el ? el.children : []).filter(c => !name || c.localName === name);
const attr = (el, name) => { if (!el) return null; for (const a of el.attributes) if (a.localName === name) return a.value; return null; };
const blobUrl = (data, type) => URL.createObjectURL(new Blob([data], { type }));
const imgType = n => /\.png$/i.test(n) ? "image/png" : /\.gif$/i.test(n) ? "image/gif" : /\.svg$/i.test(n) ? "image/svg+xml" : "image/jpeg";

/* --- nettoyage d'un HTML importé : ni script, ni contenu actif */
function sanitizeHtml(html) {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("script,iframe,object,embed,link[rel=import],meta[http-equiv],base,form").forEach(e => e.remove());
  d.querySelectorAll("*").forEach(e => {
    for (const a of Array.from(e.attributes)) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) e.removeAttribute(a.name);
    }
  });
  const css = Array.from(d.querySelectorAll("style")).map(s => s.outerHTML).join("");
  return { css, body: d.body ? d.body.innerHTML : "" };
}

/* --- rendu HTML -> images de pages A4 (html2canvas) */
const A4 = { w: 595.28, h: 841.89 };
async function renderHtmlPages(bodyHtml, css, opts) {
  await loadScript("vendor/html2canvas.min.js");
  opts = opts || {};
  const pxW = opts.pxW || 794, pxH = opts.pxH || 1123;
  const ifr = document.createElement("iframe");
  ifr.setAttribute("sandbox", "allow-same-origin");
  ifr.style.cssText = "position:fixed;left:-20000px;top:0;width:" + pxW + "px;height:" + pxH + "px;border:0;background:#fff";
  ifr.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    (opts.raw ? "html,body{margin:0;padding:0;background:#fff}" :
      "html{background:#fff}body{margin:0;padding:56px 60px;font:11pt/1.45 Calibri,Carlito,Arial,sans-serif;color:#111;background:#fff;word-wrap:break-word}" +
      "img{max-width:100%;height:auto}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #9aa;padding:4px 6px;vertical-align:top}" +
      "h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}p{margin:0 0 8px}") + "</style>" + (css || "") + "</head><body>" + bodyHtml + "</body></html>";
  document.body.appendChild(ifr);
  try {
    await new Promise(r => { ifr.onload = r; setTimeout(r, 4000); });
    const d = ifr.contentDocument;
    await Promise.all(Array.from(d.images).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 3000); })));
    if (d.fonts && d.fonts.ready) { try { await d.fonts.ready; } catch (e) {} }
    const fullH = opts.raw ? pxH : Math.max(pxH, d.documentElement.scrollHeight);
    ifr.style.height = fullH + "px";
    const scale = Math.min(2, Math.sqrt((isIOS ? 9e6 : 16e6) / (pxW * fullH)) || 1);
    const canvas = await window.html2canvas(d.documentElement, { scale: Math.max(0.5, scale), backgroundColor: "#ffffff",
      width: pxW, height: fullH, windowWidth: pxW, windowHeight: fullH, logging: false, useCORS: true });
    if (opts.raw) return [canvas];
    /* découpage en pages : on coupe de préférence sur une ligne blanche */
    const k = canvas.width / pxW, pageH = Math.round(pxH * k), out = [];
    const cx = canvas.getContext("2d");
    let y = 0;
    while (y < canvas.height - 2) {
      let cut = Math.min(canvas.height, y + pageH);
      if (cut < canvas.height) {
        const look = Math.round(160 * k), data = cx.getImageData(0, cut - look, canvas.width, look).data;
        for (let r = look - 1; r > 0; r--) {
          let white = true;
          for (let c = 0; c < canvas.width; c += 3) { const i = (r * canvas.width + c) * 4; if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) { white = false; break; } }
          if (white) { cut = cut - look + r; break; }
        }
      }
      const pc = document.createElement("canvas"); pc.width = canvas.width; pc.height = pageH;
      const pcx = pc.getContext("2d"); pcx.fillStyle = "#fff"; pcx.fillRect(0, 0, pc.width, pc.height);
      pcx.drawImage(canvas, 0, y, canvas.width, cut - y, 0, 0, canvas.width, cut - y);
      out.push(pc);
      y = cut;
    }
    return out;
  } finally { ifr.remove(); }
}
async function canvasesToPdf(doc, canvases, w, h) {
  for (const c of canvases) {
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
    const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const W = w || A4.w, H = h || A4.h;
    doc.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
    c.width = c.height = 1;
  }
}

/* --- OpenDocument texte -> HTML */
async function odtToHtml(zip) {
  const x = xmlDoc(await zip.text("content.xml"));
  const styles = {};
  x.querySelectorAll("*").forEach(el => {
    if (el.localName !== "style") return;
    const name = attr(el, "name"); if (!name) return;
    const tp = kids(el, "text-properties")[0], pp = kids(el, "paragraph-properties")[0];
    let css = "";
    if (tp) {
      if (attr(tp, "font-weight") === "bold") css += "font-weight:bold;";
      if (attr(tp, "font-style") === "italic") css += "font-style:italic;";
      if (attr(tp, "font-size")) css += "font-size:" + attr(tp, "font-size") + ";";
      if (attr(tp, "color")) css += "color:" + attr(tp, "color") + ";";
      if (attr(tp, "text-underline-style") && attr(tp, "text-underline-style") !== "none") css += "text-decoration:underline;";
    }
    if (pp && attr(pp, "text-align")) css += "text-align:" + attr(pp, "text-align").replace("start", "left").replace("end", "right") + ";";
    styles[name] = css;
  });
  const urls = {};
  const conv = async el => {
    let h = "";
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { h += xe(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const st = styles[attr(n, "style-name")] || "";
      switch (n.localName) {
        case "h": { const lv = clamp(+attr(n, "outline-level") || 1, 1, 6); h += "<h" + lv + ' style="' + st + '">' + await conv(n) + "</h" + lv + ">"; break; }
        case "p": h += '<p style="' + st + '">' + (await conv(n) || "&nbsp;") + "</p>"; break;
        case "span": h += '<span style="' + st + '">' + await conv(n) + "</span>"; break;
        case "a": h += "<u>" + await conv(n) + "</u>"; break;
        case "s": h += "&nbsp;".repeat(+attr(n, "c") || 1); break;
        case "tab": h += "&emsp;"; break;
        case "line-break": h += "<br>"; break;
        case "list": h += "<ul>" + await conv(n) + "</ul>"; break;
        case "list-item": h += "<li>" + await conv(n) + "</li>"; break;
        case "table": h += "<table>" + await conv(n) + "</table>"; break;
        case "table-row": h += "<tr>" + await conv(n) + "</tr>"; break;
        case "table-cell": h += '<td colspan="' + (+attr(n, "number-columns-spanned") || 1) + '">' + await conv(n) + "</td>"; break;
        case "frame": {
          const im = kids(n, "image")[0], href = attr(im, "href");
          if (href && !/^https?:/i.test(href)) {
            if (!urls[href]) { const d = await zip.get(href); if (d) urls[href] = blobUrl(d, imgType(href)); }
            const w = attr(n, "width");
            if (urls[href]) h += '<img src="' + urls[href] + '" style="' + (w ? "width:" + w + ";" : "") + 'max-width:100%">';
          } else h += await conv(n);
          break;
        }
        case "table-columns": case "table-column": case "sequence-decls": case "tracked-changes": case "annotation": break;
        default: h += await conv(n);
      }
    }
    return h;
  };
  const text = x.getElementsByTagNameNS("urn:oasis:names:tc:opendocument:xmlns:office:1.0", "text")[0];
  return { body: text ? await conv(text) : "", urls: Object.values(urls) };
}

/* --- PowerPoint (.pptx) -> une page par diapositive */
async function pptxToCanvases(zip, onSlide) {
  const pres = xmlDoc(await zip.text("ppt/presentation.xml"));
  const sz = pres.getElementsByTagNameNS("*", "sldSz")[0];
  const SW = +attr(sz, "cx") || 9144000, SH = +attr(sz, "cy") || 6858000;
  const relsOf = async path => {
    const dir = path.replace(/[^/]+$/, ""), file = path.replace(/^.*\//, "");
    const r = await zip.text(dir + "_rels/" + file + ".rels"), m = {};
    if (r) xmlDoc(r).querySelectorAll("Relationship").forEach(e => {
      const t = e.getAttribute("Target");
      m[e.getAttribute("Id")] = t.startsWith("/") ? t.slice(1) : (dir + t).split("/").reduce((a, s) => (s === ".." ? a.pop() : s !== "." && a.push(s), a), []).join("/");
    });
    return m;
  };
  const presRels = await relsOf("ppt/presentation.xml");
  const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  /* sldId porte « id » (numéro) et « r:id » (relation) : on lit la relation */
  const ids = Array.from(pres.getElementsByTagNameNS("*", "sldId")).map(e => presRels[e.getAttributeNS(RNS, "id")]).filter(Boolean);
  const pxW = Math.round(SW / 12700 * 96 / 72), pxH = Math.round(SH / 12700 * 96 / 72);
  const toPx = v => (+v || 0) / 12700 * 96 / 72;
  const out = [], urls = [];
  for (let s = 0; s < ids.length; s++) {
    if (onSlide) onSlide(s + 1, ids.length);
    const path = ids[s], x = xmlDoc(await zip.text(path)), rels = await relsOf(path);
    let html = "";
    const shapes = Array.from(x.getElementsByTagNameNS("*", "sp")).concat(Array.from(x.getElementsByTagNameNS("*", "pic")));
    for (const sp of shapes) {
      const off = sp.getElementsByTagNameNS("*", "off")[0], ext = sp.getElementsByTagNameNS("*", "ext")[0];
      const ph = sp.getElementsByTagNameNS("*", "ph")[0], phType = attr(ph, "type") || "";
      let L, T, W, H;
      if (off && ext && attr(ext, "cx")) { L = toPx(attr(off, "x")); T = toPx(attr(off, "y")); W = toPx(attr(ext, "cx")); H = toPx(attr(ext, "cy")); }
      else if (/title/i.test(phType)) { L = pxW * 0.05; T = pxH * 0.05; W = pxW * 0.9; H = pxH * 0.17; }
      else { L = pxW * 0.06; T = pxH * 0.25; W = pxW * 0.88; H = pxH * 0.68; }
      const box = "position:absolute;left:" + L + "px;top:" + T + "px;width:" + W + "px;height:" + H + "px;";
      if (sp.localName === "pic") {
        const blip = sp.getElementsByTagNameNS("*", "blip")[0], target = blip ? rels[blip.getAttributeNS(RNS, "embed")] : null;
        if (target) { const d = await zip.get(target); if (d) { const u = blobUrl(d, imgType(target)); urls.push(u); html += '<img src="' + u + '" style="' + box + 'object-fit:fill">'; } }
        continue;
      }
      const fill = kids(sp.getElementsByTagNameNS("*", "spPr")[0], "solidFill")[0];
      const bg = fill ? attr(kids(fill, "srgbClr")[0], "val") : null;
      const paras = Array.from(sp.getElementsByTagNameNS("*", "p")).filter(p => p.namespaceURI && p.namespaceURI.includes("drawingml"));
      if (!paras.length && !bg) continue;
      const title = /title/i.test(phType);
      const body = paras.map(p => {
        const pPr = kids(p, "pPr")[0], algn = attr(pPr, "algn");
        const runs = kids(p).filter(r => r.localName === "r" || r.localName === "br" || r.localName === "fld").map(r => {
          if (r.localName === "br") return "<br>";
          const rp = kids(r, "rPr")[0], t = kids(r, "t")[0];
          const szv = attr(rp, "sz"), col = rp ? attr(rp.getElementsByTagNameNS("*", "srgbClr")[0], "val") : null;
          const st = (szv ? "font-size:" + (+szv / 100) + "pt;" : "") + (attr(rp, "b") === "1" ? "font-weight:bold;" : "") +
            (attr(rp, "i") === "1" ? "font-style:italic;" : "") + (col ? "color:#" + col + ";" : "");
          return '<span style="' + st + '">' + xe(t ? t.textContent : "") + "</span>";
        }).join("");
        const bullet = !title && phType !== "ctrTitle" && /body|^$/.test(phType) && ph && runs;
        return '<p style="margin:0 0 6px;' + (algn === "ctr" ? "text-align:center;" : algn === "r" ? "text-align:right;" : "") + '">' + (bullet ? "• " : "") + (runs || "&nbsp;") + "</p>";
      }).join("");
      html += '<div style="' + box + 'overflow:hidden;font:' + (title ? "bold 32pt" : "18pt") + "/1.2 Calibri,Carlito,Arial,sans-serif;" +
        (bg ? "background:#" + bg + ";" : "") + '">' + body + "</div>";
    }
    const [c] = await renderHtmlPages('<div style="position:relative;width:' + pxW + "px;height:" + pxH + 'px;overflow:hidden;background:#fff">' + html + "</div>", "", { raw: true, pxW, pxH });
    out.push(c);
  }
  urls.forEach(u => URL.revokeObjectURL(u));
  return { canvases: out, w: SW / 12700, h: SH / 12700 };
}

/* --- point d'entrée : liste de fichiers -> un seul PDF ouvert dans l'éditeur */
const Conv = {
  async run(files) {
    if (!files.length) return;
    const L = window.PDFLib;
    const out = await L.PDFDocument.create();
    const fit = $("#convFit").value;
    const skipped = [];
    busy(true, "Conversion…");
    try {
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi], name = f.name || "", low = name.toLowerCase();
        busy(true, "Conversion de « " + name + " » (" + (fi + 1) + "/" + files.length + ")…");
        await yieldUI();
        if (/\.(rtf|pages|key|numbers)$/i.test(low)) { skipped.push(name + " (format non pris en charge)"); continue; }
        try {
          if (/^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(low)) {
            await Conv.image(out, f, fit);
          } else if (/\.pdf$/i.test(low) || f.type === "application/pdf") {
            const src = await L.PDFDocument.load(new Uint8Array(await f.arrayBuffer()), { ignoreEncryption: true });
            (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
          } else if (/\.html?$/i.test(low) || f.type === "text/html") {
            const { css, body } = sanitizeHtml(await f.text());
            await canvasesToPdf(out, await renderHtmlPages(body, css));
          } else if (/\.txt$/i.test(low) || f.type === "text/plain") {
            await canvasesToPdf(out, await renderHtmlPages('<pre style="white-space:pre-wrap;font:10.5pt/1.4 Consolas,monospace">' + xe(await f.text()) + "</pre>"));
          } else if (/\.(xls|xlt)$/i.test(low)) {
            await loadScript("vendor/cfb.min.js");
            await sheetsToPdf(out, xlsModel(await f.arrayBuffer()), (i, n) => busy(true, "« " + name + " » : feuille " + i + " sur " + n + "…"));
          } else if (/\.(xlsx|xlsm)$/i.test(low)) {
            await sheetsToPdf(out, await xlsxModel(await f.arrayBuffer()), (i, n) => busy(true, "« " + name + " » : feuille " + i + " sur " + n + "…"));
          } else if (/\.(doc|dot)$/i.test(low)) {
            await loadScript("vendor/cfb.min.js");
            await canvasesToPdf(out, await renderHtmlPages(docToHtml(await f.arrayBuffer())));
          } else if (/\.(ppt|pps|pot)$/i.test(low)) {
            await loadScript("vendor/cfb.min.js");
            const r = await pptToCanvases(await f.arrayBuffer(), (i, n) => busy(true, "« " + name + " » : diapositive " + i + " sur " + n + "…"));
            await canvasesToPdf(out, r.canvases, r.w, r.h);
          } else if (/\.docx$/i.test(low)) {
            await loadScript("vendor/mammoth.browser.min.js");
            const r = await window.mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
            await canvasesToPdf(out, await renderHtmlPages(sanitizeHtml(r.value).body));
          } else if (/\.odt$/i.test(low)) {
            const z = await unzip(await f.arrayBuffer());
            const r = await odtToHtml(z);
            await canvasesToPdf(out, await renderHtmlPages(r.body));
            r.urls.forEach(u => URL.revokeObjectURL(u));
          } else if (/\.pptx$/i.test(low)) {
            const z = await unzip(await f.arrayBuffer());
            const r = await pptxToCanvases(z, (i, n) => busy(true, "« " + name + " » : diapositive " + i + " sur " + n + "…"));
            await canvasesToPdf(out, r.canvases, r.w, r.h);
          } else { skipped.push(name + " (format inconnu)"); }
        } catch (e) { console.warn("conversion impossible :", name, e); skipped.push(name + " (" + e.message + ")"); }
      }
      if (!out.getPageCount()) { busy(false); toast("Aucun fichier n'a pu être converti : " + skipped.join(", "), 7000); return; }
      const first = files[0].name.replace(/\.[^.]+$/, "") || "document";
      const bytes = await out.save();
      busy(false);
      if (curSheet) closeSheet();
      await openBytes(bytes, (files.length > 1 ? first + " et autres" : first) + ".pdf");
      if (skipped.length) toast("Non convertis : " + skipped.join(" · "), 9000);
      else if (files.some(x => /\.(doc|dot|ppt|pps|pot)$/i.test(x.name || "")))
        toast("Ancien format Office : texte et structure repris, sans les images ni la mise en forme d'origine.", 6000);
      else toast("Conversion terminée : " + out.getPageCount() + " page" + (out.getPageCount() > 1 ? "s" : "") + ".", 3000);
    } finally { busy(false); }
  },
  async image(doc, f, fit) {
    const url = URL.createObjectURL(f);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image illisible par ce navigateur")); i.src = url; });
      const c = document.createElement("canvas");
      const k = Math.min(1, 3000 / Math.max(im.naturalWidth, im.naturalHeight));
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(im, 0, 0, c.width, c.height);
      const png = /png$/i.test(f.type) || /\.png$/i.test(f.name);
      const blob = await new Promise(r => c.toBlob(r, png ? "image/png" : "image/jpeg", 0.92));
      const data = new Uint8Array(await blob.arrayBuffer());
      const img = png ? await doc.embedPng(data) : await doc.embedJpg(data);
      if (fit === "image") {
        const W = im.naturalWidth * 0.75, H = im.naturalHeight * 0.75;          /* 96 ppp -> points */
        doc.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
      } else {
        const land = im.naturalWidth > im.naturalHeight;
        const W = land ? A4.h : A4.w, H = land ? A4.w : A4.h, m = 28;
        const s = Math.min((W - 2 * m) / im.naturalWidth, (H - 2 * m) / im.naturalHeight);
        const w = im.naturalWidth * s, h = im.naturalHeight * s;
        doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
      }
      c.width = c.height = 1;
    } finally { URL.revokeObjectURL(url); }
  }
};

/* ==================================================== comparer deux PDF */
async function pageLines(doc) {
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      const p0 = vp.convertToViewportPoint(e, f), h = Math.hypot(c, d) || 10;
      items.push({ s: it.str, x: p0[0], y: p0[1], h, w: it.width || 0 });
    }
    items.sort((p, q) => p.y - q.y || p.x - q.x);
    const lines = [];
    for (const it of items) {
      const L0 = lines[lines.length - 1];
      if (L0 && Math.abs(it.y - L0.y) < Math.max(it.h, L0.h) * 0.5) { L0.items.push(it); L0.h = Math.max(L0.h, it.h); }
      else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    out.push({ w: vp.width, h: vp.height, lines: lines.map(L0 => {
      L0.items.sort((p, q) => p.x - q.x);
      const x0 = Math.min(...L0.items.map(t => t.x)), x1 = Math.max(...L0.items.map(t => t.x + t.w));
      const txt = L0.items.map(t => t.s).join(" ");
      return { t: txt.replace(/\s+/g, " ").trim(), n: txt.replace(/\s+/g, "").toLowerCase(), x: x0, y: L0.y - L0.h, w: Math.max(4, x1 - x0), h: L0.h * 1.25 };
    }) });
    pg.cleanup();
  }
  return out;
}
/* plus longue sous-suite commune : lignes identiques des deux côtés */
function lcsDiff(A, B) {
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const delA = new Set(), addB = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) delA.add(i++);
    else addB.add(j++);
  }
  while (i < n) delA.add(i++);
  while (j < m) addB.add(j++);
  return { delA, addB };
}
const Cmp = {
  a: null, b: null, rows: [], diffs: [], cur: -1, mode: "text",
  async start() {
    if (!S.doc) return;
    if (curSheet) closeSheet();
    busy(true, "Préparation de la comparaison…");
    try {
      const bytes = await buildVector();
      Cmp.cleanup();
      Cmp.a = { name: S.name, pdf: await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise };
    } finally { busy(false); }
    $("#cmpTitle").textContent = "Comparer « " + S.name.replace(/\.pdf$/i, "") + " »";
    $("#cmpSub").textContent = "Choisissez le second PDF à comparer";
    $("#cmpBody").innerHTML = '<div class="cmp-empty"><p>Choisissez la version à comparer avec le document ouvert.</p>' +
      '<button class="primary" id="cmpPick2">' + icon("open") + " Choisir le 2e PDF</button></div>";
    $("#cmpPick2").onclick = () => $("#fileCmp").click();
    $("#cmpBar").hidden = true;
    openPanel("pnCmp");
    $("#pnCmp")._onclose = () => Cmp.cleanup();
  },
  cleanup() {
    for (const k of ["a", "b"]) if (Cmp[k]) { try { Cmp[k].pdf.destroy(); } catch (e) {} Cmp[k] = null; }
    Cmp.rows = []; Cmp.diffs = []; Cmp.cur = -1;
  },
  async load(file) {
    if (!file) return;
    busy(true, "Lecture du second document…");
    try {
      if (Cmp.b) { try { Cmp.b.pdf.destroy(); } catch (e) {} }
      Cmp.b = { name: file.name, pdf: await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise };
      busy(true, "Analyse des différences…");
      const LA = await pageLines(Cmp.a.pdf), LB = await pageLines(Cmp.b.pdf);
      const n = Math.max(LA.length, LB.length);
      Cmp.rows = []; Cmp.diffs = [];
      for (let i = 0; i < n; i++) {
        const A = LA[i], B = LB[i];
        const row = { i, A, B, delA: new Set(), addB: new Set() };
        if (A && B) Object.assign(row, lcsDiff(A.lines.map(l => l.n), B.lines.map(l => l.n)));
        else if (A) A.lines.forEach((l, k) => row.delA.add(k));
        else B.lines.forEach((l, k) => row.addB.add(k));
        /* une différence = un bloc de lignes modifiées consécutives */
        const marks = [...[...row.delA].map(k => ({ y: A.lines[k].y })), ...[...row.addB].map(k => ({ y: B.lines[k].y }))].sort((p, q) => p.y - q.y);
        let last = -1e9;
        for (const m of marks) { if (m.y - last > 30) Cmp.diffs.push({ row: i, y: m.y }); last = m.y; }
        if ((!A || !B) && !marks.length) Cmp.diffs.push({ row: i, y: 0 });
        Cmp.rows.push(row);
      }
      $("#cmpSub").textContent = "A : " + Cmp.a.name + " · B : " + Cmp.b.name;
      $("#cmpBar").hidden = false;
      await Cmp.render();
    } catch (e) { console.error(e); toast("Comparaison impossible : " + e.message, 6000); }
    finally { busy(false); }
  },
  async render() {
    const body = $("#cmpBody"); body.innerHTML = "";
    const colW = Math.floor((body.clientWidth - 30) / 2), dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const r of Cmp.rows) {
      busy(true, "Affichage — page " + (r.i + 1) + " sur " + Cmp.rows.length + "…");
      const row = document.createElement("div"); row.className = "cmp-row"; row.dataset.row = r.i;
      row.innerHTML = '<div class="cmp-num">Page ' + (r.i + 1) + "</div>";
      const cells = [];
      for (const side of ["A", "B"]) {
        const cell = document.createElement("div"); cell.className = "cmp-cell";
        const info = r[side];
        if (!info) { cell.innerHTML = '<div class="cmp-missing">Page absente de ' + side + "</div>"; row.appendChild(cell); cells.push(null); continue; }
        const k = colW / info.w;
        const pg = await Cmp[side.toLowerCase()].pdf.getPage(r.i + 1);
        const vp = pg.getViewport({ scale: k * dpr });
        const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
        cv.style.width = colW + "px"; cv.style.height = (info.h * k) + "px";
        await pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        cell.style.width = colW + "px"; cell.appendChild(cv);
        if (Cmp.mode === "text") {
          const set = side === "A" ? r.delA : r.addB;
          for (const idx of set) {
            const l = info.lines[idx], d = document.createElement("div");
            d.className = "cmp-hl " + (side === "A" ? "del" : "add");
            d.style.cssText = "left:" + (l.x * k - 2) + "px;top:" + (l.y * k - 1) + "px;width:" + (l.w * k + 4) + "px;height:" + (l.h * k + 2) + "px";
            cell.appendChild(d);
          }
        }
        row.appendChild(cell); cells.push({ cv, info, k });
        pg.cleanup();
      }
      if (Cmp.mode === "visual" && cells[0] && cells[1]) Cmp.pixelDiff(cells[0].cv, cells[1].cv);
      body.appendChild(row);
    }
    busy(false);
    Cmp.cur = -1;
    $("#cmpCount").textContent = Cmp.diffs.length ? Cmp.diffs.length + " différence" + (Cmp.diffs.length > 1 ? "s" : "") : "Aucune différence de texte";
  },
  /* différences de pixels : surlignées en rouge sur B */
  pixelDiff(ca, cb) {
    const w = Math.min(ca.width, cb.width), h = Math.min(ca.height, cb.height);
    const a = ca.getContext("2d").getImageData(0, 0, w, h).data, bx = cb.getContext("2d"), bd = bx.getImageData(0, 0, w, h);
    const b = bd.data; let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 90) { b[i] = 230; b[i + 1] = 40; b[i + 2] = 40; n++; }
      else { b[i] = 255 - (255 - b[i]) * 0.35; b[i + 1] = 255 - (255 - b[i + 1]) * 0.35; b[i + 2] = 255 - (255 - b[i + 2]) * 0.35; }
    }
    bx.putImageData(bd, 0, 0);
    return n;
  },
  step(d) {
    if (!Cmp.diffs.length) return;
    Cmp.cur = (Cmp.cur + d + Cmp.diffs.length) % Cmp.diffs.length;
    const df = Cmp.diffs[Cmp.cur], row = $('.cmp-row[data-row="' + df.row + '"]'), body = $("#cmpBody");
    if (!row) return;
    const cell = row.querySelector(".cmp-cell canvas"), r = Cmp.rows[df.row], info = r.A || r.B;
    const k = cell ? parseFloat(cell.style.width) / info.w : 1;
    body.scrollTo({ top: row.offsetTop + df.y * k - body.clientHeight * 0.3, behavior: "smooth" });
    $("#cmpCount").textContent = "Différence " + (Cmp.cur + 1) + " sur " + Cmp.diffs.length;
  }
};

/* =====================================================================
   VERSION 4.1 — anciens formats Office 97-2003 (.doc, .ppt).
   Conteneur lu avec cfb (SheetJS, Apache 2.0) ; texte et structure
   extraits selon les spécifications publiques [MS-DOC] et [MS-PPT].
   Les images et la mise en forme fine ne sont pas reprises.
   ===================================================================== */
const cfbStream = (cfb, name) => {
  const e = window.CFB.find(cfb, name);
  return e && e.content ? (e.content instanceof Uint8Array ? e.content : Uint8Array.from(e.content)) : null;
};
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/* --- Word 97-2003 (.doc) : texte du document principal via la table des pièces */
function docToHtml(buf) {
  const cfb = window.CFB.read(new Uint8Array(buf), { type: "array" });
  const wd = cfbStream(cfb, "WordDocument");
  if (!wd || u16(wd, 0) !== 0xA5EC) throw new Error("fichier Word 97-2003 non reconnu");
  const flags = u16(wd, 0x0A);
  if (flags & 0x0100) throw new Error("document protégé par mot de passe");
  const table = cfbStream(cfb, (flags & 0x0200) ? "1Table" : "0Table");
  if (!table) throw new Error("table du document introuvable");
  /* FIB : base (32 o), puis tableaux de mots, de longs et de paires fc/lcb */
  const csw = u16(wd, 32), lwPos = 34 + csw * 2, cslw = u16(wd, lwPos);
  const ccpText = u32(wd, lwPos + 2 + 3 * 4);
  const fcPos = lwPos + 2 + cslw * 4 + 2;
  const fcClx = u32(wd, fcPos + 33 * 8), lcbClx = u32(wd, fcPos + 33 * 8 + 4);
  /* Clx : blocs Prc (0x01) à ignorer, puis Pcdt (0x02) */
  let p = fcClx;
  while (p < fcClx + lcbClx && table[p] === 0x01) p += 3 + u16(table, p + 1);
  if (table[p] !== 0x02) throw new Error("structure du texte illisible");
  const lcb = u32(table, p + 1), plc = p + 5, n = (lcb - 4) / 12;
  const cp1252 = new TextDecoder("windows-1252"), utf16 = new TextDecoder("utf-16le");
  let text = "";
  for (let i = 0; i < n && text.length < ccpText; i++) {
    const cp0 = u32(table, plc + i * 4), cp1 = u32(table, plc + (i + 1) * 4);
    const fcv = u32(table, plc + (n + 1) * 4 + i * 8 + 2);
    const compressed = (fcv & 0x40000000) !== 0, fc = fcv & 0x3FFFFFFF, len = cp1 - cp0;
    text += compressed ? cp1252.decode(wd.subarray(fc / 2, fc / 2 + len)) : utf16.decode(wd.subarray(fc, fc + len * 2));
  }
  text = text.slice(0, ccpText);
  /* champs : \x13 code \x14 résultat \x15 -> on garde le résultat */
  let out = "", depth = 0, showing = [true];
  for (const ch of text) {
    if (ch === "\x13") { depth++; showing.push(false); continue; }
    if (ch === "\x14") { showing[showing.length - 1] = true; continue; }
    if (ch === "\x15") { if (depth) { depth--; showing.pop(); } continue; }
    if (showing.every(Boolean)) out += ch;
  }
  /* paragraphes (\r), cellules (\x07), saut de ligne (\x0b), saut de page (\x0c) */
  const clean = s => xe(s.replace(/[\x01\x02\x05\x08]/g, "").replace(/\x1e/g, "-").replace(/\x1f/g, "").replace(/\xa0/g, " "))
    .replace(/\x0b/g, "<br>").replace(/\t/g, "&emsp;");
  let html = "", row = [], rows = [], seg = "";
  const flushTable = () => {
    ncols = 0;
    if (!rows.length) return;
    html += "<table>" + rows.map(r => "<tr>" + r.map(c => "<td>" + (clean(c) || "&nbsp;") + "</td>").join("") + "</tr>").join("") + "</table>";
    rows = [];
  };
  const para = s => {
    const parts = s.split("\x0c");
    parts.forEach((t, k) => {
      if (k) html += '<div style="break-before:page;page-break-before:always;height:0"></div>';
      if (t.trim()) html += "<p>" + clean(t) + "</p>"; else if (!k) html += "<p>&nbsp;</p>";
    });
  };
  /* une cellule vide et la marque de fin de ligne s'écrivent pareil : on se fie
     au nombre de colonnes de la première ligne du tableau */
  let ncols = 0;
  for (const ch of out) {
    if (ch === "\x07") {
      const rowEnd = seg === "" && row.length && (!ncols || row.length >= ncols);
      if (rowEnd) { if (!ncols) ncols = row.length; rows.push(row); row = []; }
      else row.push(seg);
      seg = "";
    } else if (ch === "\r") {
      if (row.length) { row[row.length - 1] += "\x0b" + seg; seg = ""; continue; }
      flushTable();
      para(seg); seg = "";
    } else seg += ch;
  }
  if (row.length) rows.push(row);
  flushTable();
  if (seg) para(seg);
  /* premier paragraphe court : présenté comme un titre */
  return html.replace(/^<p>([^<]{1,90})<\/p>/, "<h1>$1</h1>");
}

/* --- PowerPoint 97-2003 (.ppt) : texte de chaque diapositive, dans l'ordre */
function pptSlides(buf) {
  const cfb = window.CFB.read(new Uint8Array(buf), { type: "array" });
  const ps = cfbStream(cfb, "PowerPoint Document");
  if (!ps) throw new Error("fichier PowerPoint 97-2003 non reconnu");
  const cu = cfbStream(cfb, "Current User");
  const hdr = o => ({ inst: u16(ps, o) >> 4, ver: u16(ps, o) & 0xF, type: u16(ps, o + 2), len: u32(ps, o + 4) });
  /* répertoire de persistance : identifiant -> position, de la plus ancienne à la plus récente édition */
  const persist = {};
  let docRef = 0;
  try {
    let edit = cu ? u32(cu, 16) : -1, guard = 0, firstDoc = 0;
    const chain = [];
    while (edit >= 0 && edit < ps.length && guard++ < 200) {
      const h = hdr(edit); if (h.type !== 0x0FF5) break;
      chain.push(edit);
      if (!firstDoc) firstDoc = u32(ps, edit + 8 + 16);
      const last = u32(ps, edit + 8 + 8);
      if (!last) break;
      edit = last;
    }
    docRef = firstDoc;
    for (const e of chain.reverse()) {
      const pd = u32(ps, e + 8 + 12), h = hdr(pd);
      if (h.type !== 0x1772) continue;
      let q = pd + 8;
      while (q < pd + 8 + h.len) {
        const v = u32(ps, q), id = v & 0xFFFFF, cnt = v >>> 20; q += 4;
        for (let k = 0; k < cnt; k++) { persist[id + k] = u32(ps, q); q += 4; }
      }
    }
  } catch (e) { console.warn("répertoire PowerPoint :", e); }
  const dec = new TextDecoder("utf-16le"), lat = new TextDecoder("windows-1252");
  const textAt = (o, h) => h.type === 0x0FA0 ? dec.decode(ps.subarray(o + 8, o + 8 + h.len)) : lat.decode(ps.subarray(o + 8, o + 8 + h.len));
  /* textes d'un conteneur (zones de texte des formes) */
  const collect = (start, end, out) => {
    let o = start;
    while (o + 8 <= end) {
      const h = hdr(o);
      if (h.ver === 0xF) collect(o + 8, o + 8 + h.len, out);
      else if (h.type === 0x0FA0 || h.type === 0x0FA8) out.push({ t: textAt(o, h), kind: "other" });
      else if (h.type === 0x0F9F) out.push({ header: u32(ps, o + 8) });
      o += 8 + h.len;
    }
    return out;
  };
  /* type de texte : 0 titre, 6 titre centré, 1/5 corps, 2 notes, 4 autre */
  const typed = list => {
    const res = []; let cur = 4;
    for (const x of list) { if (x.header !== undefined) cur = x.header; else if (cur !== 2) res.push({ t: x.t, kind: cur === 0 || cur === 6 ? "title" : (cur === 1 || cur === 5) ? "body" : "other" }); }
    return res;
  };
  let slideSize = [5760, 4320], slides = [];
  const docOff = persist[docRef];
  if (docOff !== undefined && hdr(docOff).type === 0x03E8) {
    const dh = hdr(docOff);
    let o = docOff + 8;
    while (o < docOff + 8 + dh.len) {
      const h = hdr(o);
      if (h.type === 0x03E9) slideSize = [u32(ps, o + 8), u32(ps, o + 12)];
      if (h.type === 0x0FF0 && h.inst === 0) {
        /* liste des diapositives : SlidePersistAtom suivi des textes de ses espaces réservés */
        let q = o + 8, curSlide = null;
        while (q < o + 8 + h.len) {
          const r = hdr(q);
          if (r.type === 0x03F3) { curSlide = { ref: u32(ps, q + 8), list: [] }; slides.push(curSlide); }
          else if (curSlide && (r.type === 0x0FA0 || r.type === 0x0FA8)) curSlide.list.push({ t: textAt(q, r) });
          else if (curSlide && r.type === 0x0F9F) curSlide.list.push({ header: u32(ps, q + 8) });
          q += 8 + r.len;
        }
      }
      o += 8 + h.len;
    }
  }
  if (slides.length) {
    return { size: slideSize, slides: slides.map(s => {
      const texts = typed(s.list);
      const so = persist[s.ref];
      if (so !== undefined && hdr(so).type === 0x03EE) {
        const h = hdr(so), own = typed(collect(so + 8, so + 8 + h.len, []));
        for (const x of own) if (!texts.some(y => y.t === x.t)) texts.push(x);
      }
      return texts;
    }) };
  }
  /* secours : parcours linéaire des diapositives (fichier inhabituel) */
  const found = [];
  let o = 0;
  const walk = (start, end) => {
    let q = start;
    while (q + 8 <= end) {
      const h = hdr(q);
      if (h.type === 0x03EE) found.push(typed(collect(q + 8, q + 8 + h.len, [])));
      else if (h.ver === 0xF) walk(q + 8, q + 8 + h.len);
      q += 8 + h.len;
    }
  };
  walk(o, ps.length);
  return { size: slideSize, slides: found };
}
async function pptToCanvases(buf, onSlide) {
  const { size, slides } = pptSlides(buf);
  if (!slides.length) throw new Error("aucune diapositive trouvée");
  /* unités principales : 576 par pouce -> points = /8 */
  const wPt = size[0] / 8, hPt = size[1] / 8, pxW = Math.round(wPt * 96 / 72), pxH = Math.round(hPt * 96 / 72);
  const out = [];
  for (let i = 0; i < slides.length; i++) {
    if (onSlide) onSlide(i + 1, slides.length);
    const texts = slides[i];
    const lines = s => s.split(/[\r\x0b]/).map(l => l.trim()).filter(Boolean);
    const title = texts.filter(x => x.kind === "title").map(x => lines(x.t).map(xe).join("<br>")).join("<br>");
    const body = texts.filter(x => x.kind !== "title").map(x =>
      "<ul>" + lines(x.t).map(l => "<li>" + xe(l) + "</li>").join("") + "</ul>").join("");
    const html = '<div style="position:relative;width:' + pxW + "px;height:" + pxH + 'px;overflow:hidden;background:#fff;box-sizing:border-box;padding:' +
      Math.round(pxH * 0.06) + "px " + Math.round(pxW * 0.06) + 'px;font-family:Calibri,Carlito,Arial,sans-serif;color:#111">' +
      (title ? '<div style="font-size:' + Math.round(pxH * 0.075) + 'px;font-weight:bold;margin-bottom:' + Math.round(pxH * 0.04) + 'px;color:#1B3558">' + title + "</div>" : "") +
      '<div style="font-size:' + Math.round(pxH * 0.045) + 'px;line-height:1.35">' + body + "</div>" +
      '<div style="position:absolute;right:' + Math.round(pxW * 0.03) + "px;bottom:" + Math.round(pxH * 0.025) + "px;font-size:" + Math.round(pxH * 0.025) + 'px;color:#999">' + (i + 1) + "</div></div>";
    const [c] = await renderHtmlPages(html, "<style>ul{margin:0 0 .4em;padding-left:1.2em}li{margin:.15em 0}</style>", { raw: true, pxW, pxH });
    out.push(c);
  }
  return { canvases: out, w: wPt, h: hPt };
}

/* =====================================================================
   VERSION 4.2 — Excel vers PDF : ancien format .xls (BIFF8, [MS-XLS])
   et format moderne .xlsx. Valeurs affichées comme dans Excel (dates,
   pourcentages, euros, décimales), cellules fusionnées, une ou plusieurs
   feuilles ; mise en forme (couleurs, bordures, polices) non reprise.
   ===================================================================== */
/* modèle commun : [{ name, cells: Map("r,c" -> {v, f}), merges: [[r1,c1,r2,c2]], maxR, maxC }] */
const XlFmt = {
  builtinDate: new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]),
  isDate(id, code) {
    if (XlFmt.builtinDate.has(id)) return true;
    if (!code) return false;
    const c = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    return /[dmyhs]/i.test(c) && !/^general$/i.test(c);
  },
  /* valeur numérique -> texte affiché */
  show(v, id, code, d1904) {
    if (typeof v !== "number") return v;
    if (XlFmt.isDate(id, code)) {
      const ms = Math.round((v + (d1904 ? 1462 : 0)) * 864e5) + Date.UTC(1899, 11, 30);
      const d = new Date(ms), p2 = x => String(x).padStart(2, "0");
      const date = p2(d.getUTCDate()) + "/" + p2(d.getUTCMonth() + 1) + "/" + d.getUTCFullYear();
      const hasTime = /h|s/i.test((code || "").replace(/"[^"]*"/g, "")) || [18, 19, 20, 21, 22, 45, 46, 47].includes(id);
      const time = p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes());
      if (v < 1 && hasTime) return time;
      return hasTime ? date + " " + time : date;
    }
    const c = code || "";
    const pct = id === 9 || id === 10 || /%/.test(c.replace(/"[^"]*"/g, ""));
    const m = /0\.(0+)/.exec(c);
    let dec = m ? m[1].length : (id === 2 || id === 4 || id === 10 || id === 7 || id === 8 ? 2 : null);
    const x = pct ? v * 100 : v;
    let s;
    if (dec !== null) s = x.toLocaleString("fr-FR", { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: /#,##|[34]$/.test(c) || id === 3 || id === 4 });
    else s = parseFloat(x.toPrecision(12)).toLocaleString("fr-FR", { maximumFractionDigits: 10, useGrouping: false });
    if (pct) s += " %";
    if (/€/.test(c)) s += " €";
    return s;
  }
};

/* --- .xls (BIFF8) */
function xlsModel(buf) {
  const cfb = window.CFB.read(new Uint8Array(buf), { type: "array" });
  const wb = cfbStream(cfb, "Workbook") || cfbStream(cfb, "Book");
  if (!wb) throw new Error("fichier Excel 97-2003 non reconnu");
  const rec = o => ({ type: u16(wb, o), len: u16(wb, o + 2), d: o + 4 });
  const utf16 = new TextDecoder("utf-16le"), latin = new TextDecoder("windows-1252");
  const f64 = (o) => new DataView(wb.buffer, wb.byteOffset + o, 8).getFloat64(0, true);
  const rk = x => {
    let v;
    if (x & 2) v = x >> 2;
    else { const b = new ArrayBuffer(8), dv = new DataView(b); dv.setUint32(4, x & 0xFFFFFFFC, true); v = dv.getFloat64(0, true); }
    return (x & 1) ? v / 100 : v;
  };
  /* chaîne XLUnicodeString (longueur sur 1 ou 2 octets) */
  const ustr = (o, wide) => {
    const cch = wide ? u16(wb, o) : wb[o], fl = wb[o + (wide ? 2 : 1)], s = o + (wide ? 3 : 2);
    return (fl & 1) ? utf16.decode(wb.subarray(s, s + cch * 2)) : latin.decode(wb.subarray(s, s + cch));
  };
  const sheets = [], xf = [], formats = {};
  let sst = [], d1904 = false, o = 0;
  /* globals : jusqu'au premier EOF */
  while (o + 4 <= wb.length) {
    const r = rec(o);
    if (r.type === 0x002F) throw new Error("classeur protégé par mot de passe");
    if (r.type === 0x0085) {
      const vis = wb[r.d + 4], kind = wb[r.d + 5];
      if (kind === 0) sheets.push({ pos: u32(wb, r.d), name: ustr(r.d + 6, false), hidden: vis !== 0 });
    } else if (r.type === 0x041E) formats[u16(wb, r.d)] = ustr(r.d + 2, true);
    else if (r.type === 0x00E0) xf.push(u16(wb, r.d + 2));
    else if (r.type === 0x0022) d1904 = u16(wb, r.d) === 1;
    else if (r.type === 0x00FC) {
      /* table des chaînes partagées, répartie sur des enregistrements CONTINUE */
      const segs = [[r.d + 8, r.d + r.len]];
      let q = r.d + r.len;
      while (q + 4 <= wb.length && u16(wb, q) === 0x003C) { const l = u16(wb, q + 2); segs.push([q + 4, q + 4 + l]); q += 4 + l; }
      const total = u32(wb, r.d + 4);
      let si = 0, pos = segs[0][0];
      const need = n => { if (pos + n > segs[si][1] && si + 1 < segs.length && pos >= segs[si][1]) { si++; pos = segs[si][0]; } };
      const byte = () => { if (pos >= segs[si][1]) { si++; pos = segs[si][0]; } return wb[pos++]; };
      const skip = n => { while (n > 0) { if (pos >= segs[si][1]) { si++; pos = segs[si][0]; } const k = Math.min(n, segs[si][1] - pos); pos += k; n -= k; } };
      for (let k = 0; k < total && si < segs.length; k++) {
        need(3);
        let cch = byte() | (byte() << 8), fl = byte(), runs = 0, ext = 0;
        if (fl & 8) runs = byte() | (byte() << 8);
        if (fl & 4) ext = byte() | (byte() << 8) | (byte() << 16) | (byte() << 24);
        let s = "", wide = fl & 1;
        while (cch > 0) {
          if (pos >= segs[si][1]) { si++; pos = segs[si][0]; wide = wb[pos++] & 1; }   /* reprise : nouvel octet d'options */
          const avail = Math.floor((segs[si][1] - pos) / (wide ? 2 : 1)), n = Math.min(cch, avail);
          s += wide ? utf16.decode(wb.subarray(pos, pos + n * 2)) : latin.decode(wb.subarray(pos, pos + n));
          pos += n * (wide ? 2 : 1); cch -= n;
        }
        skip(runs * 4 + ext);
        sst.push(s);
      }
      o = q; continue;
    } else if (r.type === 0x000A) break;
    o += 4 + r.len;
  }
  const out = [];
  for (const sh of sheets) {
    if (sh.hidden) continue;
    const cells = new Map(), merges = [];
    let maxR = -1, maxC = -1, p = sh.pos, pendingStr = null;
    const put = (r0, c0, v, xfi) => {
      const id = xf[xfi] || 0;
      const text = typeof v === "number" ? XlFmt.show(v, id, formats[id], d1904) : v;
      if (text === "" || text == null) return;
      cells.set(r0 + "," + c0, { v: text, num: typeof v === "number" });
      if (r0 > maxR) maxR = r0; if (c0 > maxC) maxC = c0;
    };
    while (p + 4 <= wb.length) {
      const r = rec(p), d = r.d;
      if (r.type === 0x000A) break;
      switch (r.type) {
        case 0x00FD: put(u16(wb, d), u16(wb, d + 2), sst[u32(wb, d + 6)], u16(wb, d + 4)); break;
        case 0x0204: case 0x00D6: put(u16(wb, d), u16(wb, d + 2), ustr(d + 6, true), u16(wb, d + 4)); break;
        case 0x0203: put(u16(wb, d), u16(wb, d + 2), f64(d + 6), u16(wb, d + 4)); break;
        case 0x027E: put(u16(wb, d), u16(wb, d + 2), rk(u32(wb, d + 6)), u16(wb, d + 4)); break;
        case 0x00BD: {
          const row = u16(wb, d), c1 = u16(wb, d + 2), n = (r.len - 6) / 6;
          for (let k = 0; k < n; k++) put(row, c1 + k, rk(u32(wb, d + 6 + k * 6)), u16(wb, d + 4 + k * 6));
          break;
        }
        case 0x0006: {
          const row = u16(wb, d), col = u16(wb, d + 2), x = u16(wb, d + 4);
          if (u16(wb, d + 12) === 0xFFFF) {
            const t = wb[d + 6];
            if (t === 0) pendingStr = { row, col, x };
            else if (t === 1) put(row, col, wb[d + 8] ? "VRAI" : "FAUX", x);
            else if (t === 2) put(row, col, "#ERREUR", x);
          } else put(row, col, f64(d + 6), x);
          break;
        }
        case 0x0207: if (pendingStr) { put(pendingStr.row, pendingStr.col, ustr(d, true), pendingStr.x); pendingStr = null; } break;
        case 0x0205: {
          const v = wb[d + 6], isErr = wb[d + 7];
          put(u16(wb, d), u16(wb, d + 2), isErr ? "#ERREUR" : (v ? "VRAI" : "FAUX"), u16(wb, d + 4));
          break;
        }
        case 0x00E5: {
          const n = u16(wb, d);
          for (let k = 0; k < n; k++) { const q = d + 2 + k * 8; merges.push([u16(wb, q), u16(wb, q + 4), u16(wb, q + 2), u16(wb, q + 6)]); }
          break;
        }
      }
      p += 4 + r.len;
    }
    out.push({ name: sh.name, cells, merges, maxR, maxC });
  }
  return out;
}

/* --- .xlsx */
async function xlsxModel(buf) {
  const z = await unzip(buf);
  const wbx = xmlDoc(await z.text("xl/workbook.xml"));
  const d1904 = Array.from(wbx.getElementsByTagNameNS("*", "workbookPr")).some(e => /^(1|true)$/.test(e.getAttribute("date1904") || ""));
  const rels = {};
  const rx = await z.text("xl/_rels/workbook.xml.rels");
  if (rx) xmlDoc(rx).querySelectorAll("Relationship").forEach(e => { const t = e.getAttribute("Target"); rels[e.getAttribute("Id")] = t.startsWith("/") ? t.slice(1) : "xl/" + t; });
  const sst = [];
  const sx = await z.text("xl/sharedStrings.xml");
  if (sx) for (const si of xmlDoc(sx).getElementsByTagNameNS("*", "si")) sst.push(Array.from(si.getElementsByTagNameNS("*", "t")).filter(t => t.parentNode.localName !== "rPh").map(t => t.textContent).join(""));
  const numFmts = {}, xfs = [];
  const st = await z.text("xl/styles.xml");
  if (st) {
    const sd = xmlDoc(st);
    for (const n of sd.getElementsByTagNameNS("*", "numFmt")) numFmts[+n.getAttribute("numFmtId")] = n.getAttribute("formatCode");
    const cx = sd.getElementsByTagNameNS("*", "cellXfs")[0];
    if (cx) for (const x of kids(cx, "xf")) xfs.push(+(x.getAttribute("numFmtId") || 0));
  }
  const RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const out = [];
  for (const s of wbx.getElementsByTagNameNS("*", "sheet")) {
    if (/hidden/i.test(s.getAttribute("state") || "")) continue;
    const path = rels[s.getAttributeNS(RNS, "id")]; if (!path) continue;
    const x = xmlDoc(await z.text(path));
    const cells = new Map(), merges = [];
    let maxR = -1, maxC = -1;
    const pos = ref => { const m = /^([A-Z]+)(\d+)$/.exec(ref || ""); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return [+m[2] - 1, c - 1]; };
    for (const c of x.getElementsByTagNameNS("*", "c")) {
      const p = pos(c.getAttribute("r")); if (!p) continue;
      const t = c.getAttribute("t"), vEl = kids(c, "v")[0], v = vEl ? vEl.textContent : null;
      let val = null, isNum = false;
      if (t === "s") val = v !== null ? sst[+v] : null;
      else if (t === "inlineStr") val = Array.from(c.getElementsByTagNameNS("*", "t")).map(e => e.textContent).join("");
      else if (t === "str") val = v;
      else if (t === "b") val = v === "1" ? "VRAI" : "FAUX";
      else if (t === "e") val = v;
      else if (v !== null && v !== "") {
        const id = xfs[+(c.getAttribute("s") || 0)] || 0;
        val = XlFmt.show(parseFloat(v), id, numFmts[id], d1904); isNum = true;
      }
      if (val === null || val === "") continue;
      cells.set(p[0] + "," + p[1], { v: val, num: isNum });
      if (p[0] > maxR) maxR = p[0]; if (p[1] > maxC) maxC = p[1];
    }
    for (const mc of x.getElementsByTagNameNS("*", "mergeCell")) {
      const [a, b] = (mc.getAttribute("ref") || "").split(":"), pa = pos(a), pb = pos(b);
      if (pa && pb) merges.push([pa[0], pb[0], pa[1], pb[1]]);
    }
    out.push({ name: s.getAttribute("name"), cells, merges, maxR, maxC });
  }
  return out;
}

/* --- rendu : une section par feuille, paysage si le tableau est large */
async function sheetsToPdf(doc, sheets, onSheet) {
  const MAXR = 3000;
  let any = false;
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (onSheet) onSheet(i + 1, sheets.length);
    if (sh.maxR < 0) continue;
    any = true;
    const rows = Math.min(sh.maxR, MAXR - 1), cover = new Set(), span = {};
    for (const [r1, r2, c1, c2] of sh.merges) {
      span[r1 + "," + c1] = [r2 - r1 + 1, c2 - c1 + 1];
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) cover.add(r + "," + c);
    }
    let html = "<h2>" + xe(sh.name) + "</h2><table class=\"xl\">";
    for (let r = 0; r <= rows; r++) {
      html += "<tr>";
      for (let c = 0; c <= sh.maxC; c++) {
        const k = r + "," + c; if (cover.has(k)) continue;
        const cell = sh.cells.get(k), sp = span[k];
        html += "<td" + (sp ? ' rowspan="' + sp[0] + '" colspan="' + sp[1] + '"' : "") + (cell && cell.num ? ' class="n"' : "") + ">" +
          (cell ? xe(String(cell.v)) : "") + "</td>";
      }
      html += "</tr>";
    }
    html += "</table>" + (sh.maxR >= MAXR ? "<p><i>Feuille tronquée aux " + MAXR + " premières lignes.</i></p>" : "");
    const land = sh.maxC > 5;
    const css = "<style>h2{font-size:13pt;margin:0 0 8px;color:#1B3558}table.xl{border-collapse:collapse;font-size:9pt}" +
      "table.xl td{border:1px solid #c5ccd6;padding:3px 6px;vertical-align:top;word-break:break-word}table.xl td.n{text-align:right}" +
      "body{padding:40px 36px !important}</style>";
    const canv = await renderHtmlPages(html, css, land ? { pxW: 1123, pxH: 794 } : {});
    await canvasesToPdf(doc, canv, land ? A4.h : A4.w, land ? A4.w : A4.h);
  }
  if (!any) throw new Error("classeur vide");
}

/* =====================================================================
   VERSION 4.3 — lecture en diaporama : une page à la fois, plein écran.
   Toucher / cliquer : à droite page suivante, à gauche page précédente.
   Balayage horizontal, flèches, espace, Page suivante/précédente, Échap.
   Le document est présenté tel qu'il sera enregistré (annotations,
   filigrane, censure comprise).
   ===================================================================== */
const Show = {
  pdf: null, i: 0, n: 0, cache: new Map(), token: 0, hideT: null,
  async start(from) {
    if (!S.doc) return;
    if (curSheet) closeSheet();
    busy(true, "Préparation du diaporama…");
    try {
      const bytes = await buildVector();
      Show.pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    } catch (e) { busy(false); toast("Diaporama impossible : " + e.message, 5000); return; }
    busy(false);
    Show.n = Show.pdf.numPages; Show.i = clamp(from || 0, 0, Show.n - 1); Show.cache.clear();
    openPanel("pnShow");
    document.body.classList.add("showing");          /* pas de messages de l'éditeur par-dessus la présentation */
    $("#toast").classList.remove("on");
    $("#pnShow")._onclose = () => Show.stop();
    const el = document.documentElement;
    try { if (el.requestFullscreen && !document.fullscreenElement) await el.requestFullscreen({ navigationUI: "hide" }); } catch (e) {}
    try { if (navigator.wakeLock) Show.lock = await navigator.wakeLock.request("screen"); } catch (e) {}   /* écran toujours allumé */
    Show.show();
    Show.chrome(true);
  },
  stop() {
    Show.token++;
    document.body.classList.remove("showing");
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    if (Show.lock) { try { Show.lock.release(); } catch (e) {} Show.lock = null; }
    Show.cache.forEach(c => { c.width = c.height = 1; }); Show.cache.clear();
    if (Show.pdf) { try { Show.pdf.destroy(); } catch (e) {} Show.pdf = null; }
    $("#showStage").innerHTML = "";
    /* on revient dans l'éditeur sur la page regardée, une fois le plein écran
       quitté (le changement de taille annulerait un défilement immédiat) */
    const target = Show.i;
    const back = () => { const pg = S.pages[target]; if (pg && pg.el) { $("#viewer").scrollTop = pg.el.offsetTop - 10; updatePill(); } };
    setTimeout(back, 120); setTimeout(back, 500);
  },
  /* rendu d'une page à la taille de l'écran (mis en cache : précédente, courante, suivante) */
  async render(i) {
    const key = i + ":" + window.innerWidth + "x" + window.innerHeight;
    if (Show.cache.has(key)) return Show.cache.get(key);
    const pg = await Show.pdf.getPage(i + 1), base = pg.getViewport({ scale: 1 });
    const W = window.innerWidth, H = window.innerHeight, fit = Math.min(W / base.width, H / base.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    let k = fit * dpr;
    if (base.width * base.height * k * k > MAX_PX * 1.5) k = Math.sqrt(MAX_PX * 1.5 / (base.width * base.height));
    const vp = pg.getViewport({ scale: k }), c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    c.style.width = Math.round(base.width * fit) + "px"; c.style.height = Math.round(base.height * fit) + "px";
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    pg.cleanup();
    Show.cache.set(key, c);
    /* mémoire : on ne garde que les pages voisines */
    for (const k2 of [...Show.cache.keys()]) {
      const j = +k2.split(":")[0];
      if (Math.abs(j - Show.i) > 1 || !k2.endsWith(":" + window.innerWidth + "x" + window.innerHeight)) {
        const old = Show.cache.get(k2); old.width = old.height = 1; Show.cache.delete(k2);
      }
    }
    return c;
  },
  async show(dir) {
    const tok = ++Show.token, i = Show.i;
    $("#showNum").textContent = (i + 1) + " / " + Show.n;
    $("#showBar").style.width = ((i + 1) / Show.n * 100) + "%";
    const c = await Show.render(i);
    if (tok !== Show.token) return;
    const st = $("#showStage");
    st.innerHTML = ""; st.appendChild(c);
    c.classList.remove("in-next", "in-prev");
    if (dir) { void c.offsetWidth; c.classList.add(dir > 0 ? "in-next" : "in-prev"); }
    /* préchargement des voisines */
    if (i + 1 < Show.n) Show.render(i + 1).catch(() => {});
    if (i > 0) Show.render(i - 1).catch(() => {});
  },
  go(d) {
    const j = Show.i + d;
    if (j < 0) { Show.flash("Première page"); return; }
    if (j >= Show.n) { Show.flash("Fin du document — touchez ✕ pour quitter"); return; }
    Show.i = j; Show.show(d);
  },
  flash(msg) { const f = $("#showMsg"); f.textContent = msg; f.classList.add("on"); clearTimeout(Show.msgT); Show.msgT = setTimeout(() => f.classList.remove("on"), 1600); },
  /* boutons et numéro visibles quelques secondes, puis masqués */
  chrome(on) {
    $("#pnShow").classList.toggle("chrome", on);
    clearTimeout(Show.hideT);
    if (on) Show.hideT = setTimeout(() => $("#pnShow").classList.remove("chrome"), 2800);
  }
};
function initShow() {
  const st = $("#showStage"), pn = $("#pnShow");
  let x0 = null, y0 = 0, t0 = 0, swiped = false;
  st.addEventListener("pointerdown", e => { x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); swiped = false; });
  st.addEventListener("pointerup", e => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - t0 < 800) { swiped = true; Show.go(dx < 0 ? 1 : -1); Show.chrome(false); }
    x0 = null;
  });
  /* clic : tiers gauche = précédente, tiers central = afficher les commandes, tiers droit = suivante */
  st.addEventListener("click", e => {
    if (swiped) return;
    const w = window.innerWidth;
    if (e.clientX < w / 3) Show.go(-1);
    else if (e.clientX > w * 2 / 3) Show.go(1);
    else { Show.chrome(!pn.classList.contains("chrome")); return; }
    Show.chrome(false);
  });
  $("#showPrev").onclick = e => { e.stopPropagation(); Show.go(-1); Show.chrome(true); };
  $("#showNext").onclick = e => { e.stopPropagation(); Show.go(1); Show.chrome(true); };
  $("#showClose").onclick = e => { e.stopPropagation(); closePanel(); };
  document.addEventListener("keydown", e => {
    if (!pn.classList.contains("on")) return;
    const k = e.key;
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"].includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); Show.go(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"].includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); Show.go(-1); }
    else if (k === "Home") { e.preventDefault(); Show.i = 0; Show.show(-1); }
    else if (k === "End") { e.preventDefault(); Show.i = Show.n - 1; Show.show(1); }
    else if (k === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closePanel(); }
  }, true);
  /* rotation de l'écran ou sortie du plein écran : on redessine à la bonne taille */
  let rt = null;
  window.addEventListener("resize", () => { if (!pn.classList.contains("on")) return; clearTimeout(rt); rt = setTimeout(() => Show.show(), 150); });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && pn.classList.contains("on") && Show.wasFull) closePanel();
    Show.wasFull = !!document.fullscreenElement;
  });
  $("#btnShow").onclick = () => Show.start(S.cur);
}

/* ------------------------------------------------- branchements de la v4 */
function initV4() {
  /* filigrane */
  const wmDraft = () => S.wmDraft || (S.wmDraft = Object.assign({}, WM_DEF, S.wm || {}));
  const wmSync = () => {
    const w = wmDraft();
    $$("#wmType button").forEach(b => b.classList.toggle("on", b.dataset.t === w.type));
    $$("#shWm .pane").forEach(p => p.classList.toggle("on", p.dataset.pane === w.type));
    $("#wmText").value = w.text; $("#wmFont").value = w.font; $("#wmBold").checked = w.bold;
    $("#wmSize").value = w.size; $("#wmFit").checked = w.fit; $("#wmOpacity").value = Math.round(w.opacity * 100);
    $("#wmPos").value = w.pos; $("#wmPages").value = w.pages; $("#wmScale").value = Math.round(w.scale * 100);
    $("#wmOpacityV").textContent = Math.round(w.opacity * 100) + " %";
    $("#wmSizeV").textContent = w.fit && (w.pos === "diag" || w.pos === "center") ? "auto" : w.size + " pt";
    $$("#wmColors .dot").forEach(d => d.classList.toggle("on", d.dataset.c === w.color));
    $$("#wmPresets button").forEach(b => b.classList.toggle("on", b.textContent === w.text));
    if (w.src) $("#wmImgPrev").src = w.src; else $("#wmImgPrev").removeAttribute("src");
  };
  const wmLive = () => { const w = wmDraft(); if (w.type === "image" && !w.src) { S.wm = null; } else S.wm = Object.assign({}, w); WM.render(); };
  WM.open = () => {
    if (!S.doc) { toast("Ouvrez d'abord un PDF."); return; }
    setTool("select");
    S.wmPrev = S.wm ? Object.assign({}, S.wm) : null;
    S.wmDraft = Object.assign({}, WM_DEF, S.wm || {});
    wmSync(); wmLive();
    openSheet("shWm");
    $("#shWm")._onclose = () => { if (!S.wmKeep) { S.wm = S.wmPrev; WM.render(); } S.wmKeep = false; S.wmDraft = null; };
  };
  $("#wmPresets").innerHTML = WM_PRESETS.map(p => "<button>" + esc(p) + "</button>").join("");
  $$("#wmPresets button").forEach(b => b.onclick = () => { wmDraft().text = b.textContent; wmSync(); wmLive(); });
  $("#wmColors").innerHTML = ["#c0392b", "#111111", "#1d4ed8", "#7f8c8d", "#0a6b2f"].map(c =>
    '<button aria-label="Couleur"><span class="dot" data-c="' + c + '" style="background:' + c + '"></span></button>').join("");
  $$("#wmColors .dot").forEach(d => d.parentNode.onclick = () => { wmDraft().color = d.dataset.c; wmSync(); wmLive(); });
  $$("#wmType button").forEach(b => b.onclick = () => { wmDraft().type = b.dataset.t; wmSync(); wmLive(); });
  const bindIn = (id, fn) => $(id).addEventListener("input", e => { fn(e.target); wmSync(); wmLive(); });
  bindIn("#wmText", t => wmDraft().text = t.value || " ");
  bindIn("#wmFont", t => wmDraft().font = t.value);
  bindIn("#wmBold", t => wmDraft().bold = t.checked);
  bindIn("#wmSize", t => { wmDraft().size = +t.value; wmDraft().fit = false; });
  bindIn("#wmFit", t => wmDraft().fit = t.checked);
  bindIn("#wmOpacity", t => wmDraft().opacity = +t.value / 100);
  bindIn("#wmPos", t => wmDraft().pos = t.value);
  bindIn("#wmPages", t => wmDraft().pages = t.value);
  bindIn("#wmScale", t => wmDraft().scale = +t.value / 100);
  ["#wmFont", "#wmPos", "#wmPages", "#wmBold", "#wmFit"].forEach(id => $(id).addEventListener("change", () => { $(id).dispatchEvent(new Event("input")); }));
  $("#wmPick").onclick = () => $("#fileWm").click();
  $("#fileWm").onchange = e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      const src = await downscale(rd.result, 1600);
      const im = new Image(); im.onload = () => { const w = wmDraft(); w.src = src; w.ratio = im.height / im.width; w.type = "image"; wmSync(); wmLive(); };
      im.src = src;
    };
    rd.readAsDataURL(f);
  };
  $("#wmApply").onclick = () => {
    const w = wmDraft();
    if (w.type === "image" && !w.src) { toast("Choisissez d'abord une image."); return; }
    S.wm = Object.assign({}, w); S.wmKeep = true; closeSheet(); WM.render();
    toast("Filigrane appliqué : il sera intégré à l'enregistrement, au partage et à l'impression.", 3500);
  };
  $("#wmRemove").onclick = () => { S.wm = null; S.wmKeep = true; closeSheet(); WM.render(); toast("Filigrane retiré."); };

  /* censure */
  $("#searchRedact").onclick = () => {
    if (!Search.hits.length) { toast("Lancez d'abord une recherche."); return; }
    snapshot();
    let n = 0;
    for (const h of Search.hits) for (const r of h.rects) {
      S.items.push({ id: uid(), type: "redact", page: h.page, x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2, color: "#000000" }); n++;
    }
    renderItems(); updateUndo();
    toast(n + " zone" + (n > 1 ? "s" : "") + " censurée" + (n > 1 ? "s" : "") + ". La suppression devient définitive à l'enregistrement.", 4500);
  };

  /* chiffrement : afficher les champs */
  $("#encOn").onchange = e => { $("#encBox").hidden = !e.target.checked; if (e.target.checked) $("#encPwd").focus(); };

  /* conversion vers PDF */
  $("#convPick").onclick = () => $("#fileConv").click();
  $("#fileConv").onchange = e => { const f = Array.from(e.target.files); e.target.value = ""; Conv.run(f); };
  $("#btnConvHome").onclick = () => openSheet("shConv");

  /* comparaison */
  $("#fileCmp").onchange = e => { const f = e.target.files[0]; e.target.value = ""; Cmp.load(f); };
  $("#cmpPick").onclick = () => $("#fileCmp").click();
  $("#cmpPrev").onclick = () => Cmp.step(-1);
  $("#cmpNext").onclick = () => Cmp.step(1);
  $$("#cmpMode button").forEach(b => b.onclick = () => {
    Cmp.mode = b.dataset.m; $$("#cmpMode button").forEach(x => x.classList.toggle("on", x === b));
    if (Cmp.rows.length) Cmp.render();
  });
}

/* ------------------------------------------------- branchements de la v3.1 */
function initV31() {
  /* recherche */
  $("#btnSearch").onclick = () => Search.open();
  let deb = null;
  $("#searchInput").addEventListener("input", e => { clearTimeout(deb); deb = setTimeout(() => Search.run(e.target.value), 350); });
  $("#searchInput").addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault(); clearTimeout(deb);
      if (Search.q !== e.target.value) Search.run(e.target.value); else Search.step(e.shiftKey ? -1 : 1);
    }
    if (e.key === "Escape") Search.close();
  });
  $("#searchPrev").onclick = () => Search.step(-1);
  $("#searchNext").onclick = () => Search.step(1);
  $("#searchClose").onclick = () => Search.close();

  /* tampons */
  $("#stampDate").onchange = e => { PREF.stampDate = e.target.checked; Prof.savePref(); };
  $("#btnNewStamp").onclick = async () => {
    const t = await ask("Nouveau tampon", "Texte du tampon (ex. : « Certifié exact », « Remis en main propre »).", "");
    if (!t) return;
    const l = Stamps.custom(); l.push(t.slice(0, 60)); store.set(Prof.key("stamps"), l);
    Stamps.open();
  };

  /* organiser / scinder / fusionner */
  $("#orgFoot").addEventListener("click", e => { const b = e.target.closest("[data-o]"); if (b && !b.disabled) Org.action(b.dataset.o); });
  $("#orgAdd").onclick = () => $("#fileMerge").click();
  $("#orgAll").onclick = () => {
    Org.sel = Org.sel.length === Org.list.length ? [] : Org.list.map(e => e.id);
    Org.renderSel();
  };
  $("#fileMerge").onchange = e => {
    const files = Array.from(e.target.files); e.target.value = "";
    const go = () => Org.addFiles(files);
    if (!$("#pnOrg").classList.contains("on")) Org.start("merge").then(go); else go();
  };
  $("#pvPrev").onclick = () => Org.pvStep(-1);
  $("#pvNext").onclick = () => Org.pvStep(1);
  $("#pvSel").onclick = () => { Org.toggle(Org.pv); Org.paintPreview(); };
  $$("[data-pclose]").forEach(b => b.onclick = closePanel);

  /* scanner */
  $("#scCam").onclick = () => Scan.pick(true);
  $("#scGal").onclick = () => Scan.pick(false);
  ["#fileScan", "#fileScanGal"].forEach(id => $(id).onchange = e => {
    const files = Array.from(e.target.files); e.target.value = ""; Scan.addFiles(files);
  });
  $("#scFull").onclick = () => {
    const p = Scan.page(), w = p.src.width, h = p.src.height;
    p.q = [[0, 0], [w, 0], [w, h], [0, h]]; p.warp = null; Scan.poly();
  };
  $("#scCropOk").onclick = () => Scan.showFx();
  $("#scRecrop").onclick = () => Scan.showCrop();
  $("#scMore").onclick = () => $("#fileScan").click();
  $("#scDone").onclick = () => Scan.finish();
  $("#scRot").onclick = () => Scan.rotate();
  $("#scDel").onclick = () => Scan.remove();
  $$("#scFx button").forEach(b => b.onclick = async () => {
    const p = Scan.page(); p.fx = b.dataset.fx;
    $$("#scFx button").forEach(x => x.classList.toggle("on", x === b));
    await Scan.process(p); Scan.draw(p.out); Scan.strip();
  });
  let fxT = null;
  ["#scContrast", "#scBright"].forEach(id => $(id).addEventListener("input", () => {
    clearTimeout(fxT);
    fxT = setTimeout(async () => {
      const p = Scan.page(); if (!p) return;
      p.contrast = +$("#scContrast").value; p.bright = +$("#scBright").value;
      await Scan.process(p); Scan.draw(p.out); Scan.strip();
    }, 120);
  }));
  window.addEventListener("resize", () => {
    if (!$("#pnScan").classList.contains("on") || !Scan.page()) return;
    if (Scan.step === "crop") { Scan.draw(Scan.page().src); Scan.poly(); } else if (Scan.page().out) Scan.draw(Scan.page().out);
  });

  /* accueil */
  $("#btnDon").onclick = faireUnDon;
  $("#btnScanHome").onclick = () => openSheet("shScanSrc");
  $("#btnMergeHome").onclick = () => $("#fileMerge").click();

  /* résultat : ouvrir dans l'éditeur */
  $("#doneOpen").onclick = async () => {
    if (!S.out) return;
    const o = S.out;
    closeSheet();
    while (panels.length) hidePanel();
    await openBytes(o.bytes, o.name);
  };

  Recents.render();
}

/* ============================================================== démarrage */
function init() {
  $("#appVer").textContent = "version " + APP_VERSION;
  initV31();
  initV4();
  initShow();
  Prof.init();
  initSigSheet();
  initPinch();
  initKeyboard();
  const install = initInstall();
  $$(".sheet").forEach(bindSheetDrag);
  $("#scrim").onclick = closeSheet;
  $$("[data-close]").forEach(b => b.onclick = closeSheet);

  /* ouverture */
  const pick = () => $("#filePdf").click();
  $("#btnOpen2").onclick = pick;
  $("#btnHome").onclick = () => { if (!S.doc) pick(); else $("#viewer").scrollTo({ top: 0, behavior: "smooth" }); };
  $("#filePdf").onchange = e => { const f = e.target.files[0]; e.target.value = ""; openFile(f); };

  /* outils */
  $$(".tool[data-tool]").forEach(b => b.onclick = () => {
    if (!S.doc && b.dataset.tool !== "select") { toast("Ouvrez d'abord un PDF."); return; }
    setTool(S.tool === b.dataset.tool && b.dataset.tool !== "select" ? "select" : b.dataset.tool);
  });
  const dateStr = d => String(d.getDate()).padStart(2, "0") + "/" +
    String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
  const heureStr = d => String(d.getHours()).padStart(2, "0") + "h" +
    String(d.getMinutes()).padStart(2, "0");
  const acts = {
    sign() {
      if (!S.doc) { toast("Ouvrez d'abord un PDF."); return; }
      setTool("select");
      if (!Sigs.all().length) Sigs.openNew(); else openSheet("shSigs");
    },
    date() { setPending({ kind: "text", text: dateStr(new Date()) }, "Touchez l'endroit où placer la date"); },
    image() { if (!S.doc) { toast("Ouvrez d'abord un PDF."); return; } $("#fileImg").click(); },
    snips() { setTool("select"); openSheet("shSnips"); },
    stamp() { Stamps.open(); },
    wm() { WM.open(); }
  };
  $$(".tool[data-act]").forEach(b => b.onclick = () => acts[b.dataset.act]());
  $("#hintDone").onclick = () => setTool("select");
  $("#btnNewSnip").onclick = () => Snips.openNew();
  $("#txtOk").onclick = textOk;
  $("#txtArea").addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); textOk(); }
  });

  $("#ctxBar").addEventListener("click", e => {
    const b = e.target.closest("[data-a]"); if (b) ctxAction(b.dataset.a, b);
  });

  $("#btnUndo").onclick = undo;
  $("#btnRedo").onclick = redo;

  /* image */
  $("#fileImg").onchange = e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      const src = await downscale(rd.result, 2000);
      const im = new Image();
      im.onload = () => {
        const w = Math.min(220, im.width);
        setPending({ kind: "image", src, w, ratio: im.height / im.width }, "Touchez l'endroit où placer l'image");
      };
      im.onerror = () => toast("Format d'image non pris en charge.");
      im.src = src;
    };
    rd.readAsDataURL(f);
  };

  /* menu */
  $("#btnMenu").onclick = () => {
    $$("#shMenu .needdoc").forEach(b => b.disabled = !S.doc);
    $("#menuProf").textContent = Prof.name();
    openSheet("shMenu");
  };
  const menu = {
    open() { closeSheet(); pick(); },
    pages() { buildThumbs(); openSheet("shPages"); },
    show() { closeSheet(); setTimeout(() => Show.start(0), 50); },
    rotate() {
      closeSheet();
      const p = S.pages[S.cur]; if (!p) return;
      if (S.items.some(i => i.page === S.cur)) {
        toast("Faites pivoter la page avant d'y ajouter des annotations.", 3500); return;
      }
      p.rot = (p.rot + 90) % 360;
      const vp = p.page.getViewport({ scale: 1, rotation: p.rot });
      p.dw = vp.width; p.dh = vp.height;
      S.fields.filter(f => f.page === S.cur).length && toast("Les champs de cette page restent à leur position d'origine.");
      repaintAll();
    },
    fit() { closeSheet(); fitWidth(); },
    redo() { closeSheet(); redo(); },
    recents() { Recents.render(); openSheet("shRecents"); },
    scan() { openSheet("shScanSrc"); },
    organize() { closeSheet(); Org.start("organize"); },
    split() { closeSheet(); Org.start("split"); },
    merge() {
      closeSheet();
      if (S.doc) { Org.start("merge"); toast("Ajoutez les PDF à fusionner avec « + PDF ».", 3500); }
      else $("#fileMerge").click();
    },
    search() { closeSheet(); Search.open(); },
    print() { printDoc(); },
    convert() { openSheet("shConv"); },
    compare() { closeSheet(); Cmp.start(); },
    wm() { WM.open(); },
    redact() { closeSheet(); setTool("redact"); },
    encrypt() {
      closeSheet(); setTool("select"); select(null);
      setTimeout(() => {
        $$("#saveFmt button").forEach(x => x.classList.toggle("on", x.dataset.f === "pdf"));
        $("#encOn").checked = true;
        openSave("save");
        $("#encBox").hidden = false;
      }, 320);
    },
    don() { closeSheet(); faireUnDon(); },
    time() { closeSheet(); setPending({ kind: "text", text: heureStr(new Date()) }, "Touchez l'endroit où placer l'heure"); },
    datetime() {
      closeSheet(); const d = new Date();
      setPending({ kind: "text", text: dateStr(d) + " à " + heureStr(d) }, "Touchez l'endroit où placer la date et l'heure");
    },
    library() { openSheet("shLibrary"); },
    profiles() { Prof.render(); openSheet("shProfiles"); },
    backup() { openSheet("shBackup"); },
    install() { install(); },
    help() { openSheet("shHelp"); }
  };
  $$("#shMenu [data-m]").forEach(b => b.onclick = () => menu[b.dataset.m]());
  $$("#shLibrary [data-go]").forEach(b => b.onclick = () => {
    if (b.dataset.go === "newsig") Sigs.openNew(); else Snips.openNew();
  });
  $("#pagePill").onclick = menu.pages;

  /* utilisateurs */
  $("#profAdd").onclick = async () => {
    const n = await ask("Nouvel utilisateur", "Il démarre avec une bibliothèque vide.", "");
    if (n) { Prof.add(n); toast("Utilisateur créé : " + n); }
  };
  $("#profRen").onclick = async () => {
    const n = await ask("Renommer", "", Prof.name());
    if (n) Prof.rename(n);
  };
  $("#profDel").onclick = async () => {
    const ok = await ask("Supprimer « " + Prof.name() + " » ?",
      "Ses signatures et textes seront définitivement effacés de cet appareil.", null);
    if (ok) Prof.remove();
  };
  $("#profExp").onclick = () => Prof.exportAll();
  $("#profImp").onclick = () => $("#fileConf").click();
  $("#fileConf").onchange = e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { closeSheet(); Prof.importAll(rd.result); };
    rd.readAsText(f);
  };
  $("#chkFlatten").onchange = e => { PREF.flatten = e.target.checked; Prof.savePref(); };

  /* enregistrement / partage */
  $("#btnSave").onclick = () => { setTool("select"); select(null); openSave("save"); };
  $("#btnShare").onclick = () => { setTool("select"); select(null); openSave("share"); };
  $("#btnPrint").onclick = () => printDoc();
  $$('input[name=smode]').forEach(r => r.onchange = syncSmall);
  $$("#saveFmt button").forEach(b => b.onclick = () => {
    $$("#saveFmt button").forEach(x => x.classList.toggle("on", x === b)); syncFmt();
  });
  $("#saveGo").onclick = async () => {
    const mode = $$('input[name=smode]').find(r => r.checked).value;
    const fmt = curFmt();
    const base = $("#saveName").value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\.(pdf|png|jpe?g|docx|odt|txt|zip)$/i, "") || "document";
    if (fmt !== "pdf") {
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
      try {
        const r = await makeExport(fmt, base, {
          imgType: $$('input[name=imgType]').find(x => x.checked).value, dpi: +$("#imgDpi").value,
          withImages: $("#txtImages").checked, pptMode: $$('input[name=pptMode]').find(x => x.checked).value,
          pdfaLevel: $$('input[name=pdfaLevel]').find(x => x.checked).value });
        S.out = { files: r.files, name: r.files.length > 1 ? base + " - images.zip" : r.files[0].name };
        $("#doneName").textContent = r.files.length > 1 ? r.files.length + " images · " + base : r.files[0].name;
        $("#doneInfo").textContent = "Prêt · " + r.info;
        $("#saveForm").hidden = true; $("#saveDone").hidden = false;
        $("#doneOpen").hidden = true;
        setDoneMode(S.intent);
        $("#shSave").scrollTop = 0;
        if (r.empty) toast("Aucun texte trouvé : ce PDF est probablement scanné.", 5000);
      } catch (e) {
        console.error(e);
        toast("Échec de l'export : " + e.message, 7000);
      }
      return;
    }
    const nm = base + ".pdf";
    const enc = $("#encOn").checked ? $("#encPwd").value : "";
    if ($("#encOn").checked) {
      if (enc.length < 4) { toast("Choisissez un mot de passe d'au moins 4 caractères."); $("#encPwd").focus(); return; }
      if (enc !== $("#encPwd2").value) { toast("Les deux mots de passe ne correspondent pas."); $("#encPwd2").focus(); return; }
    }
    const cible = Math.max(0.2, parseFloat(String($("#saveTarget").value).replace(",", ".")) || 5) * Mo;
    const gris = $("#saveGray").checked;
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    try {
      const r = await makePdf(mode, cible, gris);
      if (enc) {
        busy(true, "Chiffrement AES-256…");
        try { r.bytes = await encryptPdf(r.bytes, enc); } finally { busy(false); }
        r.note = (r.note ? r.note + " · " : "") + "protégé par mot de passe (AES-256)";
      }
      S.out = { bytes: r.bytes, name: nm, files: [{ name: nm, blob: new Blob([r.bytes], { type: "application/pdf" }), type: "application/pdf" }] };
      $("#doneName").textContent = nm;
      $("#doneInfo").textContent = "PDF prêt · " + fmtMo(r.bytes.length) + (r.note ? " · " + r.note : "");
      $("#saveForm").hidden = true; $("#saveDone").hidden = false;
      $("#doneOpen").hidden = true;
      setDoneMode(S.intent);
      if (!enc) Recents.add(r.bytes, nm);
      $("#shSave").scrollTop = 0;
    } catch (e) {
      console.error(e);
      toast("Échec : " + e.message + " — essayez « Fichier allégé ».", 7000);
    }
  };
  $("#doneShare").onclick = async () => {
    if (!S.out) return;
    if (!S.out.bytes) { const r = await shareFiles(S.out.files); if (r === "shared") toast("Partagé."); return; }
    const r = await shareOrSave(new Blob([S.out.bytes], { type: "application/pdf" }), S.out.name, "application/pdf");
    if (r === "shared") toast("Document partagé.");
  };
  $("#doneDl").onclick = async () => {
    if (!S.out) return;
    if (!S.out.bytes) { saveFiles(S.out.files, S.out.name); return; }
    const blob = new Blob([S.out.bytes], { type: "application/pdf" });
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: S.out.name,
          types: [{ description: "Document PDF", accept: { "application/pdf": [".pdf"] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        toast("Enregistré : " + h.name); return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    download(blob, S.out.name);
    toast("Fichier téléchargé : " + S.out.name, 4000);
  };
  $("#doneClose").onclick = closeSheet;

  /* glisser-déposer (tablette / ordinateur) */
  const vw = $("#viewer");
  ["dragenter", "dragover"].forEach(ev => vw.addEventListener(ev, e => { e.preventDefault(); vw.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(ev => vw.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === "dragleave" && vw.contains(e.relatedTarget)) return;
    vw.classList.remove("drag");
  }));
  vw.addEventListener("drop", e => {
    const f = e.dataTransfer.files[0]; if (!f) return;
    if (/^image\//.test(f.type) && S.doc) {
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => {
          const pageEl = e.target.closest(".page");
          const p = pageEl ? S.pages[+pageEl.dataset.page - 1] : S.pages[S.cur];
          const r = p.layer.getBoundingClientRect();
          const w = Math.min(220, im.width);
          const h = w * im.height / im.width;
          addItem({ type: "image", page: p.num - 1,
            x: clamp((e.clientX - r.left) / S.scale - w / 2, 0, p.dw - w),
            y: clamp((e.clientY - r.top) / S.scale - h / 2, 0, p.dh - h),
            w, h, src: rd.result, lockRatio: true });
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    } else openFile(f);
  });

  /* clavier physique (tablette avec clavier, ordinateur) */
  document.addEventListener("keydown", e => {
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const c = e.ctrlKey || e.metaKey;
    if (c && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (c && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (c && e.key.toLowerCase() === "s") { e.preventDefault(); openSave("save"); return; }
    if (c && e.key.toLowerCase() === "f") { e.preventDefault(); Search.open(); return; }
    if (c && e.key.toLowerCase() === "p") { e.preventDefault(); printDoc(); return; }
    if (c && e.key.toLowerCase() === "o") { e.preventDefault(); pick(); return; }
    if (c && (e.key === "+" || e.key === "=")) { e.preventDefault(); setScale(S.scale * 1.2); return; }
    if (c && e.key === "-") { e.preventDefault(); setScale(S.scale / 1.2); return; }
    if (c) return;
    if (e.key === "Escape") { if (curSheet) closeSheet(); else { setTool("select"); select(null); } return; }
    if (curSheet) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (S.sel) { e.preventDefault(); removeItem(S.sel); } return;
    }
    const it = getSel();
    if (it && e.key.startsWith("Arrow")) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
      const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
      it.x += dx; it.y += dy;
      if (it.pts) it.pts = it.pts.map(q => [q[0] + dx, q[1] + dy]);
      renderItems();
      return;
    }
    const keys = { v: "select", t: "text", c: "check", x: "cross", e: "circle", d: "pen", s: "marker", m: "mask" };
    if (S.doc && keys[e.key.toLowerCase()]) setTool(keys[e.key.toLowerCase()]);
  });

  /* page courante au défilement */
  $("#viewer").addEventListener("scroll", updatePill, { passive: true });

  /* rotation de l'écran : la page reste ajustée à la largeur si elle l'était */
  let lastW = $("#viewer").clientWidth;
  window.addEventListener("resize", () => {
    const w = $("#viewer").clientWidth;
    if (S.doc && Math.abs(w - lastW) > 40) {
      const maxW = Math.max.apply(null, S.pages.map(p => p.dw));
      if (Math.abs(S.scale - (lastW - 24) / maxW) < 0.02) fitWidth();
    }
    lastW = w;
  });

  window.addEventListener("beforeunload", e => {
    if (S.items.length) { e.preventDefault(); e.returnValue = ""; }
  });

  /* stockage persistant (évite l'effacement automatique des signatures) */
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  receiveShared();
}


function updatePill() {
  if (!S.pages.length) return;
  const v = $("#viewer");
  const mid = v.getBoundingClientRect().top + v.clientHeight * 0.35;
  for (let i = 0; i < S.pages.length; i++) {
    const r = S.pages[i].el.getBoundingClientRect();
    if (r.top <= mid && r.bottom + 16 > mid) { S.cur = i; break; }
  }
  $("#pageNum").textContent = (S.cur + 1) + " / " + S.pages.length;
}

/* mode hors ligne */
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("service worker :", e));
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
})();
