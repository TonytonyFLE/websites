# Tableau de classe Didac (v1.1, 27.11.2026)

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
widget symboles de travail, horaire des pauses.

## v1.1 (retours de Tony, 27.11.2026)
Minuteur « Allégé » (cercle + temps, clic = démarrer/pause), noms déplaçables entre groupes,
dés D4/D6/D8/D10/D12/D20 + pièce, évènements planifiés dans Espace prof › Agenda (non chiffrés)
et repris par le compte à rebours, planning avec icônes Didac en mode checklist ou liste,
widget Sticker (icônes Didac), formes dans le dessin (ligne, flèche, rectangle, cercle, triangle, étoile, remplissage, annuler),
bouton « ← Retour au tableau » dans le bandeau quand l'espace prof est ouvert.

## v1.2 (27.11.2026) : emploi du temps et documents
- Espace prof › Emploi du temps : grille vide lundi–vendredi, lignes = créneaux Didac Bern
  (08:40–09:20 … 16:40–17:20, pause de midi 12:35–13:30), modifiables via « Horaires ».
  Chaque case : matière, classe, salle, couleur, page du tableau liée → « Ouvrir la page » / « Leçon du … ».
- Agenda : « Remplir la semaine depuis l'emploi du temps », page liée par leçon, bandeau « Documents importants ».
- Espace prof › Documents : PDF importés par chaque prof (dates importantes, vacances, plans de semestre par matière,
  horaires, autres), chiffrés AES-256 dans IndexedDB, jamais publiés sur le site. Inclus (chiffrés) dans la sauvegarde.
- Évènements : import d'un fichier JSON ({ "events": [{ "title", "date": "AAAA-MM-JJTHH:MM", "note" }] }).
  Le fichier des dates Didac 2026/27 est gardé hors du site, dans le dossier privé tableau-classe-prive/.

## v1.3 (27.11.2026) : horaire auto
Widget « Horaire auto » (facultatif) : enchaîne cours → pause → cours selon l'heure réelle, à partir de
« Mon emploi du temps » (ou de tous les créneaux Didac), surface bleue pendant les pauses, son au changement.

## v1.4 (27.11.2026) : agenda connecté, import CSV, documents Didac
- Agenda : couleur par leçon, surlignage (jaune, bleu, vert, orange, rose) et gras dans objectifs/devoirs/remarques,
  tâches par leçon (à cocher) → envoyées comme planning sur une page (existante ou nouvelle),
  « Mes tâches » avec échéance → page, recherche dans tout l'agenda (sans accents, résultats surlignés).
- Réglages › Importer depuis un fichier CSV : classes, leçons, évènements, emploi du temps, tâches, notes, checklist.
  Modèle CSV téléchargeable (séparateur « ; », UTF-8) et consigne IA prête à copier pour chaque type.
- Espace prof › Documents › Didac-Dokumente (fichiers publics du site, dossier docs/) : Datenschutz-Merkblatt (DE),
  modèles Word couleur FR et DE. Source du Merkblatt : tableau-classe-docs/make.py.
- Police Atkinson Hyperlegible Next hébergée sur le site (fonts/, licence OFL) : aucun appel à un service tiers.
- Poids au chargement : ~300 Ko (≈ 120 Ko compressés), 9 requêtes, ~0,5 s sur une connexion 10 Mbit/s.

## v1.5 (27.11.2026) : catalogue des pages, liste libre, flashcards
- Bouton ▦ (nombre de pages) à gauche des onglets : catalogue de toutes les pages, recherche par nom, date ou contenu
  (textes, plannings), tri (récentes, nom, ordre), ★ = épinglée dans la barre, dupliquer, supprimer.
  La barre affiche les pages épinglées + les 3 dernières ouvertes + la page active. Les 8 premières pages sont épinglées d'office.
- Tirage au sort : source « Liste libre » (un élément par ligne), sans répétition possible.
- Widget Flashcards : une carte par ligne « recto ; verso » (aussi tabulation, « = » ou « - »), mode recto seul ou recto-verso,
  mélanger, commencer par le verso, « Je sais » retire la carte de la série, flèches et espace au clavier.

## v1.6 (27.11.2026) : nouveaux outils, modèles de pages, rappel de sauvegarde
- Consignes de travail (volume, forme sociale, activité, icônes Didac ; clic sur une tuile = suivante).
- Feu tricolore (Didac Rot / Gelb / Grün, texte facultatif par couleur).
- Devoirs : reprend les devoirs de l'agenda (de la dernière leçon passée aux suivantes), par classe ou toutes.
  Copie non chiffrée des textes de devoirs seulement (S.homework, fenêtre −21 / +60 jours), mise à jour à chaque enregistrement de l'agenda.
- Sondage : Oui / ? / Non, Oui / Non ou A B C D, l'enseignant·e clique pour compter les mains levées, masquer, −1, remettre.
- Modèles de pages : 5 modèles Didac (Input + macro-tâche, Travail en groupes, Début de cours, Vocabulaire, Test),
  « Enregistrer comme modèle » dans le menu de la page active, « Mes modèles » (positions relatives à l'écran).
  Accès : catalogue ▦ › « Partir d'un modèle », ou page vide.
- Rappel de sauvegarde : après 14 jours sans sauvegarde (ou jamais), bandeau « Sauvegarder maintenant / Plus tard » (7 jours).
- Poids : ~360 Ko (≈ 140 Ko compressés), 9 requêtes, ~0,5 s à 10 Mbit/s.

## v1.7 (27.11.2026) : barre d'outils masquable
Bouton « Masquer » à gauche de la barre du bas : le tableau prend toute la hauteur ; un bouton discret « Outils »
en bas à droite la fait revenir. Le choix est mémorisé.
À chaque publication, augmenter le numéro « ?v=… » des fichiers CSS/JS dans index.html, sinon les navigateurs gardent l'ancienne version en cache.

## v1.7.4 (27.11.2026) : cours uniques dans l'emploi du temps
Case « Cours unique : seulement le …, ne se répète pas » dans une case de l'emploi du temps : enregistré pour cette date
seulement (D.timetable.once, clé « AAAA-MM-JJ|créneau »), remplace le cours hebdomadaire ce jour-là, étiquette « Unique »,
repris par l'Horaire auto et « Remplir la semaine ».

## v1.8 (27.11.2026) : anglais et italien
Sélecteur FR | DE | EN | IT. Textes EN dans i18n-en.js, IT dans i18n-it.js, chargés seulement quand la langue est choisie
(le poids du site ne change pas pour FR/DE). Claims officiels : « Your year. Your next step ahead. » / « Il tuo anno. Un passo avanti. ».
Dates au format en-GB / it-CH. Import CSV : colonnes, modèles et valeurs (jours, couleurs, sections) aussi en EN et IT.

## v1.8.1 (27.11.2026) : horaire auto « Créneaux choisis »
Troisième mode de l'Horaire auto : on clique sur les créneaux Didac voulus (sans remplir l'emploi du temps),
pauses calculées automatiquement, fonctionne tous les jours. Choix gardé dans le widget (state.picked).
