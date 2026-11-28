# LeSacAPDF

<img src="www/icons/icon-512.png" width="96" align="right" alt="Logo : un sac en cuir d'où sort un fichier PDF">

Application web installable (**PWA**) pour **Android et iPhone** : remplir, annoter et signer des PDF.
Version mobile de `EditeurPDF.html` : mêmes fonctions, interface pensée pour le doigt.
**Tout reste sur le téléphone** : aucun fichier n'est envoyé sur Internet, et l'application
fonctionne sans connexion une fois installée.

## Installer sur le téléphone

Adresse (après publication, voir plus bas) : `https://julienlesacapro-hub.github.io/LeSacAPDF/`

- **iPhone / iPad** : ouvrir l'adresse dans **Safari** → bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
- **Android** : ouvrir l'adresse dans **Chrome** → menu **⋮** → **Installer l'application**
  (ou le bandeau « Installer » proposé automatiquement). Une fois installée, elle apparaît
  dans le menu **Partager** des autres applications pour recevoir un PDF.
- **Ordinateur** (Chrome, Edge) : icône d'installation dans la barre d'adresse.

Les mises à jour sont automatiques : après une publication, la nouvelle version est
téléchargée en arrière-plan et s'affiche à l'ouverture suivante de l'application.

## Publier (GitHub Pages, gratuit pour ce dépôt public)

Le workflow `.github/workflows/pages.yml` publie le dossier `www/` à chaque envoi sur `main`.
Une seule fois : *Settings → Pages → Build and deployment → Source : **GitHub Actions***.

## Fonctions

| | |
|---|---|
| Formulaires PDF | les champs interactifs sont détectés et remplis directement (option « verrouiller les champs ») |
| Texte | police, taille, gras, italique, couleur ; deux appuis sur un texte pour le modifier |
| Signer | signature dessinée au doigt ou photo d'une signature (fond retiré automatiquement), mémorisée |
| Coche, croix, entourer, stylo, surligneur, masque blanc | outils de remplissage et d'annotation |
| Date, heure, image, textes enregistrés (en-tête, adresse, RPPS…) | insertion en un geste |
| Utilisateurs | plusieurs profils avec leurs signatures et textes ; sauvegarde / restauration (compatible avec la version ordinateur) |
| Enregistrer | qualité d'origine ou fichier allégé sous une taille maximale (Mo), puis **Partager** (mail, messagerie, « Enregistrer dans Fichiers ») |
| **Nouveau 3.1** — Imprimer | menu ⋮ → Imprimer : impression du document annoté via la fenêtre d'impression du téléphone |
| **3.1** — Organiser les pages | supprimer, réordonner (glisser ⠿), dupliquer, pivoter, avec aperçu en grand |
| **3.1** — Scinder | sélectionner des pages dans l'ordre voulu et en faire un nouveau PDF |
| **3.1** — Fusionner | assembler des pages de plusieurs PDF (lettres A, B, C… par document) |
| **3.1** — Scanner | photo → détection des bords, redressement, rendu Document / Couleur / Gris / Noir & blanc, contraste, plusieurs pages |
| **3.1** — Rechercher | texte surligné, insensible aux accents et majuscules |
| **3.1** — Tampons | « Lu et approuvé », « Bon pour accord », « Copie conforme »… datés automatiquement, tampons personnalisés |
| **3.1** — Documents récents | les 10 derniers PDF ouverts ou créés, rouvrables depuis l'accueil |
| **3.3** — Autres formats | Enregistrer / Partager en **image** (PNG ou JPEG, 96 à 300 ppp, une image par page, ZIP au téléchargement), **Word** (.docx), **OpenDocument** (.odt) ou **texte** (.txt) : texte extrait et modifiable, mise en page non conservée, option « image de chaque page » pour les PDF scannés |
| **4.0** — Filigrane | texte (préréglages PROJET, CONFIDENTIEL, « Usage exclusivement destiné à la location »…) ou image ; emplacement (diagonale, centre, haut, bas, mosaïque), transparence, police, gras, couleur, taille ou ajustement automatique |
| **4.0** — Mot de passe | chiffrement AES-256 (norme PDF 2.0, révision 6) à l'enregistrement d'un PDF |
| **4.0** — PDF/A, PowerPoint, Excel | PDF/A au choix : **2a** (texte sélectionnable + document balisé : paragraphes, langue), **2u** (texte Unicode sélectionnable) ou **2b** (apparence seule) — pages en images fidèles, couche de texte invisible avec police Liberation Sans intégrée, profil sRGB ; validé par veraPDF aux trois niveaux ; PowerPoint .pptx (image fidèle ou texte modifiable) ; Excel .xlsx (une feuille par page, colonnes détectées, nombres en € et % reconnus) |
| **4.0** — Convertir en PDF | images (JPG, PNG, WebP…), Word .docx, OpenDocument .odt, PowerPoint .pptx, HTML, texte → un seul PDF (les documents mis en page deviennent des images) |
| **4.2** — Excel → PDF | .xls (97-2003) et .xlsx : une section par feuille visible, valeurs affichées comme dans Excel (dates, €, %, décimales, résultats des formules), cellules fusionnées ; tableaux larges en paysage ; couleurs et bordures d'origine non reprises |
| **4.1** — Anciens formats Office | Word .doc et PowerPoint .ppt (97-2003) → PDF : texte et structure repris (paragraphes, tableaux, une page par diapositive avec titre et puces), sans les images ni la mise en forme d'origine |
| **4.0** — Censure définitive | rectangles noirs ou « censurer tous les résultats » d'une recherche ; les pages concernées sont rastérisées à l'enregistrement : le contenu caché est supprimé |
| **4.0** — Comparer | deux PDF côte à côte, lignes modifiées surlignées (A rouge / B vert), navigation de différence en différence, mode visuel (pixels) |
| **4.3** — Diaporama | lecture plein écran, une page à la fois : toucher à droite / à gauche, balayage, flèches ou espace ; commandes au centre ; écran maintenu allumé ; s'adapte à la rotation ; annotations et filigrane affichés |
| **4.4** — Sécurité et fiabilité | pdf.js 6.5 (correctifs de sécurité à jour, repli automatique sur la 3.11 pour les téléphones trop anciens), politique de sécurité du contenu (CSP) : aucun script ni ressource extérieure ne peut être chargé ; signatures enregistrées dans IndexedDB (au-delà des ~5 Mo du stockage précédent, migration automatique) ; tests automatiques à chaque pull request |
| **4.5** — Texte sélectionnable et OCR | conversions Word, ODT, PowerPoint, Excel, HTML et texte : texte sélectionnable, cherchable et copiable, posé exactement sur la page ; **reconnaissance de texte (OCR)** sur le téléphone, sans envoi (Tesseract.js, français) : scanner (option cochée par défaut), conversion d'images, et menu « Reconnaître le texte » pour un PDF déjà ouvert (annotations conservées) ; les exports Word, texte et PDF/A d'un scan reprennent le texte reconnu |
| **4.6** — PDF protégés, annulation étendue | ouverture des PDF protégés par mot de passe (RC4 40 à 128 bits, AES-128, AES-256), déchiffrés sur le téléphone ; si l'auteur interdit la modification, mot de passe propriétaire ou lecture seule ; un document déverrouillé n'est pas gardé en clair dans les récents ; « Annuler » couvre aussi les champs de formulaire, la rotation et l'organisation des pages et la reconnaissance du texte (60 étapes, dont 8 avec copie du document) ; version affichée sous le titre et en bas de l'accueil, avis des nouveautés après une mise à jour et bandeau « Mettre à jour » quand une nouvelle version est téléchargée |
| Confort mobile | pincer pour zoomer, annuler/rétablir, aperçu des pages, mode sombre, hors connexion |

Bon à savoir : sur iPhone, les signatures et textes enregistrés de l'application installée sont
séparés de ceux de Safari. Utilisez *Menu → Sauvegarder / restaurer* pour les transférer.

## Développement

```bash
npm ci                         # installe Playwright (version figée dans package-lock.json)
npm run serve                  # http://localhost:8080
npm test                       # toutes les séries de tests, Android et iPhone émulés (fichiers : tests/fixtures/)
tools/test-all.sh android      # un seul appareil ; résultats et captures dans test-results/
npm run icons                  # régénère les icônes depuis design/sac-source.jpg
```

Séries : `e2e-test.js` (éditeur), `e2e-v31.js` (pages, scanner, recherche…), `e2e-v4.js` (filigrane, chiffrement,
PDF/A, conversions…), `e2e-show.js` (diaporama), `e2e-storage.js` (signatures, pdf.js, CSP), `e2e-ocr.js` (texte sélectionnable, OCR),
`e2e-v46.js` (PDF protégés, lecture seule, annulation, version, bouton retour),
`e2e-export.js` (exports).
Prérequis hors npm : `pdftotext` et `pdfinfo` (paquet poppler-utils).

Le workflow `.github/workflows/tests.yml` les lance sur GitHub à chaque pull request et à chaque envoi sur `main`.
Pour empêcher la fusion d'une PR dont les tests échouent : *Settings → Rules → Rulesets* → la règle de `main` →
**Require status checks to pass** → ajouter `Tests (android)` et `Tests (iphone)`.

**Sécurité** : `index.html` contient une politique de sécurité du contenu (balise `<meta http-equiv="Content-Security-Policy">`).
Toute nouvelle ressource extérieure (police, script, image distante) sera bloquée tant qu'elle n'y est pas ajoutée.

À chaque nouvelle version, augmentez `APP_VERSION` dans `www/js/app.js` et `VERSION` dans `www/sw.js`
(l'ancien cache est alors purgé proprement), et ajoutez ses nouveautés dans `NEWS` (`www/js/app.js`) :
elles s'affichent une fois sur les téléphones après la mise à jour.

## Dons (association PROMEDNAV)

L'écran d'accueil (sans document ouvert) et le menu affichent un appel aux dons pour l'association
PROMEDNAV. **Pour activer le bouton « Faire un don »**, renseignez le lien de la page de don dans
`www/js/app.js` :

```js
const DON_URL = "https://…";   // vide = « Le lien de don sera activé prochainement »
```

puis augmentez `VERSION` dans `www/sw.js` pour que les téléphones récupèrent la mise à jour.

## Propriété

© 2026 LESACA Julien — Tous droits réservés. Voir [LICENSE](LICENSE).

Bibliothèques incluses : [pdf.js 6.5.438](https://github.com/mozilla/pdf.js) (Apache 2.0, variante *legacy*,
dans `vendor/pdfjs/`, avec ses décodeurs WebAssembly OpenJPEG, JBIG2 et qcms), pdf.js 3.11.174 en secours pour
les navigateurs antérieurs à Safari 18 / Chrome 125 (`vendor/pdfjs-3/`), et [pdf-lib 1.17.1](https://github.com/Hopding/pdf-lib)
(MIT) ; pour la reconnaissance de texte : [Tesseract.js 7.0.0](https://github.com/naptha/tesseract.js) et
tesseract.js-core 7.0.0 (Apache 2.0, moteur Tesseract LSTM compilé en WebAssembly) avec les données françaises
`fra` *best_int* de [tessdata](https://github.com/tesseract-ocr/tessdata_best) (Apache 2.0), dans `vendor/tesseract/`,
téléchargés à la première reconnaissance puis conservés hors ligne ; pour la conversion vers PDF :
[html2canvas 1.4.1](https://github.com/niklasvh/html2canvas) (MIT), [mammoth 1.13.0](https://github.com/mwilliamson/mammoth.js)
(BSD-2), [cfb 1.2.2](https://github.com/SheetJS/js-cfb) (Apache 2.0, lecture des fichiers .doc, .ppt et .xls) et
[@pdf-lib/fontkit 1.1.1](https://github.com/Hopding/fontkit) (MIT) avec la police [Liberation Sans](https://github.com/liberationfonts) (SIL OFL 1.1,
fournie avec pdf.js) pour le texte des PDF/A-2u et 2a, chargés seulement quand on les utilise — licences dans `www/vendor/`. Le profil de couleur sRGB du PDF/A
est généré pour l'application à partir des valeurs publiques de la norme IEC 61966-2-1.
