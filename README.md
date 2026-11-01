# Le Sac à PDF

<img src="www/icons/icon-512.png" width="96" align="right" alt="Logo : un sac d'où sort un fichier PDF">

Application pour **Android et iPhone** qui permet de remplir, annoter et signer des PDF.
Version mobile de `EditeurPDF.html` : mêmes fonctions, interface pensée pour le doigt.
**Tout reste sur le téléphone** : aucun fichier n'est envoyé sur Internet.

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
| Confort mobile | pincer pour zoomer, annuler/rétablir, aperçu des pages, mode sombre, fonctionne hors connexion |

## Trois façons de l'installer

### 1. Application web installable (PWA) — la plus simple, gratuite
Le dossier `www/` est une application complète. Une fois publiée en HTTPS
(par exemple avec GitHub Pages, workflow `.github/workflows/pages.yml` déjà prêt) :

- **iPhone** : ouvrir l'adresse dans Safari → bouton Partager → « Sur l'écran d'accueil ».
- **Android** : ouvrir l'adresse dans Chrome → menu ⋮ → « Installer l'application ».
  Elle apparaît ensuite dans le menu « Partager » des autres applications pour recevoir un PDF.

Pour activer GitHub Pages : *Settings → Pages → Source : GitHub Actions*, puis fusionner sur `main`.
(Sur un dépôt privé, GitHub Pages demande un abonnement payant.)

### 2. APK Android (installation directe)
À chaque envoi sur GitHub, le workflow « APK Android » fabrique `app-debug.apk`
(onglet *Actions* → dernière exécution → *Artifacts*). Sur le téléphone, autorisez
« installer des applications inconnues » puis ouvrez le fichier.
C'est une version de test, signée avec une clé de débogage : pour le Play Store, il faut
la signer avec votre propre clé (Android Studio → *Build → Generate Signed Bundle*).

### 3. Applications natives (Play Store / App Store) avec Capacitor
Les projets natifs sont dans `android/` et `ios/`.

```bash
npm install
npx cap sync           # copie www/ dans les projets natifs
npx cap open android   # Android Studio
npx cap open ios       # Xcode (Mac obligatoire)
```

iOS nécessite un Mac avec Xcode et CocoaPods (`cd ios/App && pod install`), ainsi
qu'un compte Apple Developer (99 $/an) pour installer sur un iPhone hors simulateur ou publier.
Le Play Store demande un compte Google Play Console (25 $ une fois).

## Développement

```bash
npm run serve                              # http://localhost:8080
node tools/e2e-test.js fichier.pdf captures/ android   # test complet sur téléphone émulé
node tools/make-icons.js                   # régénère les icônes depuis www/icons/logo.svg
npx capacitor-assets generate              # régénère les icônes natives depuis assets/
```

Bibliothèques incluses (identiques octet pour octet à celles de `EditeurPDF.html`, sauf pdf.js
qui passe à la variante *legacy* pour les iPhone plus anciens) :
[pdf.js 3.11.174](https://github.com/mozilla/pdf.js) (Apache 2.0) et
[pdf-lib 1.17.1](https://github.com/Hopding/pdf-lib) (MIT) — licences dans `www/vendor/`.
