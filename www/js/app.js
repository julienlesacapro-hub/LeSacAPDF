/* =========================================================================
   Le Sac à PDF — remplissage de formulaires, texte, images et signatures.
   Version mobile (Android / iPhone) de l'éditeur PDF.
   100 % local : aucun fichier ne quitte l'appareil.
   ========================================================================= */
(function () {
"use strict";

const APP_VERSION = "1.1.0";
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
    const name = "sac-a-pdf-sauvegarde-" + new Date().toISOString().slice(0, 10) + ".json";
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
window.addEventListener("popstate", () => hideSheet());

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
  if (!file) return;
  if (!/\.pdf$/i.test(file.name || "") && file.type !== "application/pdf") {
    toast("Ce fichier n'est pas un PDF."); return;
  }
  if (S.items.length && !(await ask("Ouvrir un autre document ?",
      "Les annotations non enregistrées du document actuel seront perdues.", null))) return;
  busy(true, "Lecture du PDF…");
  try {
    const buf = await file.arrayBuffer();
    S.bytes = new Uint8Array(buf.slice(0));           // copie intacte pour l'export
    if (S.doc) { try { S.doc.destroy(); } catch (e) {} }
    S.doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    S.name = file.name || "document.pdf";
    S.srcSize = file.size || 0;
    S.items = []; S.fields = []; S.values = {}; S.undo = []; S.redo = []; S.sel = null; S.cur = 0;
    S.pending = null; setTool("select");
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
    document.title = S.name + " — Le Sac à PDF";
    $("#viewer").scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    const pw = e && e.name === "PasswordException";
    toast(pw ? "Ce PDF est protégé par un mot de passe : il ne peut pas être modifié ici."
             : "Impossible d'ouvrir ce PDF : " + (e && e.message ? e.message : e), 6000);
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
  renderItems(); renderFields();
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
  if (it.type === "circle") {                 // l'ovale suit la taille exacte
    const old = el.querySelector("svg");
    if (old) el.replaceChild(circleSvg(it), old);
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
      if (it.type === "text") {
        it.size = clamp(Math.round((start.s * (1 + dx / Math.max(start.w, 40))) * 10) / 10, 4, 96);
        measure(it);
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
      if ($("#chkFlatten").checked) {
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
        '<p class="sub" style="margin-top:12px">L\'icône du Sac à PDF apparaîtra avec vos autres applications ; elle fonctionne même sans connexion.</p>'
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

/* ============================================================== démarrage */
function init() {
  $("#appVer").textContent = "version " + APP_VERSION;
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
    snips() { setTool("select"); openSheet("shSnips"); }
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
