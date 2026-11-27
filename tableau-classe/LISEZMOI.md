# Tableau de classe Didac (v1, 27.11.2026)

Site statique (HTML/CSS/JS, aucune installation), FR/DE, aux couleurs de la charte Didac.
En ligne : https://tonytonyfle.github.io/websites/tableau-classe/

## Fichiers
- `index.html` : la page
- `app.css` : mise en page (palette Didac, Atkinson Hyperlegible Next)
- `app.js` : pages, widgets, classes, sauvegarde
- `prof.js` : espace prof chiffré (agenda, absences, notes, checklist)
- `i18n.js` : tous les textes FR et DE
- `icones.js` : icônes Streamline Core Flat recolorées Didac
- `assets/` : logo blanc (bandeau), logo noir (PDF), favicon « d »

## Architecture et données
- Pas de serveur : tout tourne dans le navigateur (GitHub Pages).
- Pages, outils et listes de classe : `localStorage` du navigateur (prénoms seulement).
- Espace prof : mot de passe → PBKDF2-SHA256 (310 000 itérations) → AES-GCM 256.
  Seul le coffre chiffré est stocké. Verrouillage auto après 20 min.
  Mot de passe oublié = données perdues (pas de récupération).
- Changer d'ordinateur : Classes ou Réglages → « Sauvegarder (fichier) », puis « Restaurer » sur l'autre poste.
- Export PDF du texte : impression du navigateur → « Enregistrer en PDF » (A4, logo, adresse Didac).
- Notes : échelle suisse, note = points / max × 5 + 1, arrondi 0,5 / 0,25 / 0,1, moyenne pondérée, export CSV.

## Pistes v2
Synchronisation entre ordinateurs (nécessite un backend hébergé en Suisse/UE et l'accord de Didac),
widget symboles de travail, horaire des pauses, minuteurs multiples sur une même page.
