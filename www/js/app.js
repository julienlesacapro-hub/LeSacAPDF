/* =========================================================================
   LeSacAPDF — remplissage de formulaires, texte, images et signatures.
   Version mobile (Android / iPhone) de l'éditeur PDF.
   100 % local : aucun fichier ne quitte l'appareil.
   © 2026 LESACA Julien — Tous droits réservés.
   ========================================================================= */
(function () {
"use strict";

const APP_VERSION = "3.1.0";
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
function closeSheet() {
  if (!curSheet) return;
  if (history.state && history.state.sheet) history.back();   /* popstate -> hideSheet */
  else hideSheet();
}
window.addEventListener("popstate", () => { if (curSheet) hideSheet(); else hidePanel(); });

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
  if (history.state && history.state.panel) history.back(); else hidePanel();
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
    Search.reset();
    $("#empty").hidden = true;
    document.body.classList.add("has-doc");
    await buildPages();
    await readFormFields();
    fitWidth(true);
    render();
    $("#btnSave").disabled = false;
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
  renderItems(); renderFields(); Search.render();
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
    if (S.tool === "mask") { ev.preventDefault(); dragRect(p, ev, x, y); }
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

function dragRect(p, ev, x0, y0) {
  const ghost = document.createElement("div");
  ghost.style.cssText = "position:absolute;background:#fff;outline:1.5px dashed #2D6CDF;";
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
      addItem({ type: "mask", page: p.num - 1, x: Math.min(x1, x0), y: Math.min(y1, y0), w, h, color: "#ffffff" });
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
  if (!it || S.tool !== "select" || S.pending) { bar.hidden = true; bar.innerHTML = ""; return; }
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
  mask: "Tracez un rectangle sur la zone à cacher"
};
function setTool(t, keepPending) {
  if (!keepPending) S.pending = null;
  S.tool = t;
  if (t !== "select") S.sel = null;
  $$(".tool[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t && !S.pending));
  document.body.classList.toggle("drawing", t === "pen" || t === "marker" || t === "mask");
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
    if (it.type === "mask") {
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
      if ((opt && opt.flatten) || $("#chkFlatten").checked) {
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
    if (!items.length || sansAnnotations) continue;
    await drawItems(doc, pages[i], items,
      { x1: p.view[0], y1: p.view[1], pw: p.pw, ph: p.ph, rot: p.rot }, fonts);
  }
  return doc.save({ useObjectStreams: false });
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
    const r = await fitPage(cv, tmp, Math.max(9000, reste / (n - i)), hint);
    hint = { s: r.s, q: r.q };
    const img = await out.embedJpg(new Uint8Array(await r.blob.arrayBuffer()));
    const pg = out.addPage([p.dw, p.dh]);
    pg.drawImage(img, { x: 0, y: 0, width: p.dw, height: p.dh });
    await drawItems(out, pg, S.items.filter(it => it.page === i),
      { x1: 0, y1: 0, pw: p.dw, ph: p.dh, rot: 0 }, fonts);
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

function openSave() {
  if (!S.doc) return;
  $("#saveForm").hidden = false; $("#saveDone").hidden = true;
  $("#saveName").value = S.name.replace(/\.pdf$/i, "") + " - rempli.pdf";
  $("#saveSrc").textContent = S.pages.length + " page" + (S.pages.length > 1 ? "s" : "") +
    (S.srcSize ? " · " + fmtMo(S.srcSize) + " à l'origine" : "");
  syncSmall();
  openSheet("shSave");
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
    stamp() { Stamps.open(); }
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
  $("#btnSave").onclick = () => { setTool("select"); select(null); openSave(); };
  $$('input[name=smode]').forEach(r => r.onchange = syncSmall);
  $("#saveGo").onclick = async () => {
    const mode = $$('input[name=smode]').find(r => r.checked).value;
    let nm = $("#saveName").value.trim().replace(/[\\/:*?"<>|]+/g, "-") || "document.pdf";
    if (!/\.pdf$/i.test(nm)) nm += ".pdf";
    const cible = Math.max(0.2, parseFloat(String($("#saveTarget").value).replace(",", ".")) || 5) * Mo;
    const gris = $("#saveGray").checked;
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    try {
      const r = await makePdf(mode, cible, gris);
      S.out = { bytes: r.bytes, name: nm };
      $("#doneName").textContent = nm;
      $("#doneInfo").textContent = "PDF prêt · " + fmtMo(r.bytes.length) + (r.note ? " · " + r.note : "");
      $("#saveForm").hidden = true; $("#saveDone").hidden = false;
      $("#doneOpen").hidden = true;
      Recents.add(r.bytes, nm);
      $("#shSave").scrollTop = 0;
    } catch (e) {
      console.error(e);
      toast("Échec : " + e.message + " — essayez « Fichier allégé ».", 7000);
    }
  };
  $("#doneShare").onclick = async () => {
    if (!S.out) return;
    const r = await shareOrSave(new Blob([S.out.bytes], { type: "application/pdf" }), S.out.name, "application/pdf");
    if (r === "shared") toast("Document partagé.");
  };
  $("#doneDl").onclick = async () => {
    if (!S.out) return;
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
    if (c && e.key.toLowerCase() === "s") { e.preventDefault(); openSave(); return; }
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
