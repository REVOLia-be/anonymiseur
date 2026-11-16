/* Corpus SYNTHÉTIQUE belge FR/NL pour tests/regles.mjs — aucune donnée réelle :
   noms courants combinés au hasard, numéros d'exemple (NISS, BCE, INAMI en suites
   évidentes), IBAN de test publiés ou inventés, adresses e-mail sur domaines
   « exemple ». Ne JAMAIS y coller un extrait d'un vrai document : le dépôt est public.

   [[valeur|ÉTIQUETTE]] = valeur sensible que les règles doivent masquer EN ENTIER.
   L'étiquette sert à ventiler le compte rendu :
   NOM · ORG · RUE · CP (code postal + commune) · VILLE (commune seule) · TEL · EMAIL ·
   IBAN · NISS · ENTREPRISE (n° BCE/TVA) · NAISSANCE · IDENT (INAMI, carte d'identité,
   plaque, matricule, référence, mutuelle). */
export const CORPUS = {
'FR fiche de paie': `FICHE DE PAIE — Mars 2025
Employeur : Boulangerie [[Dewolf|ORG]] SRL — [[Chaussée de Waterloo 412|RUE]], [[1180 Uccle|CP]]
N° d'entreprise : [[BE 0456.789.123|ENTREPRISE]]
Travailleur : [[DUPONT Marie-Claire|NOM]]
Matricule : [[EMP-00427|IDENT]]
NISS : [[85073003328|NISS]]
Date de naissance : [[30 juillet 1985|NAISSANCE]]
Adresse : [[Rue des Alliés 27 bte 3|RUE]], [[4000 Liège|CP]]
Compte : [[BE68 5390 0754 7034|IBAN]]
Salaire brut : 2 845,30 €
Cotisations ONSS (13,07 %) : 371,88 €
Précompte professionnel : 412,50 €
Net à payer : 2 060,92 €
Période : du 01/03/2025 au 31/03/2025
Commission paritaire 118.03`,

'FR contrat de bail': `CONTRAT DE BAIL DE RÉSIDENCE PRINCIPALE
Entre : [[Jean-Pierre Lambert|NOM]] et [[Françoise Lambert-Moreau|NOM]], domiciliés [[Avenue Brugmann 156|RUE]] à [[1190 Forest|CP]], ci-après « le bailleur »,
Et : [[Kevin Van den Broeck|NOM]], né à [[Gand|VILLE]] le [[12 février 1994|NAISSANCE]], titulaire de la carte d'identité n° [[591-2345678-90|IDENT]], ci-après « le preneur ».
Le bien loué est situé [[Place du Jeu de Balle 8|RUE]], [[1000 Bruxelles|CP]], 2e étage.
Loyer mensuel : 950,00 EUR, payable avant le 5 de chaque mois sur le compte [[BE43 0682 4417 9301|IBAN]].
Garantie locative : 1 900,00 EUR.
Fait à Bruxelles, le 15 janvier 2025, en trois exemplaires.
Contact du bailleur : [[02/345.67.89|TEL]] — [[jp.lambert@exemple.be|EMAIL]]`,

'FR courrier médical': `Dr [[Nathalie Mertens|NOM]] — Médecine générale
N° INAMI : [[1-23456-78-901|IDENT]]
[[Boulevard de la Sauvenière 33|RUE]], [[4000 Liège|CP]] — Tél. [[04 222 33 44|TEL]]

Liège, le 4 novembre 2025

Cher Confrère,

Je vous adresse [[Mme Aïcha Benali|NOM]], 42 ans, que je suis pour un diabète de type 2 déséquilibré (HbA1c 9,2 %).
Elle est affiliée à sa mutualité sous le numéro [[150-123456-78|IDENT]].
Antécédents : cholécystectomie en 2019.
Son mari, [[Youssef Benali|NOM]], peut être joint au [[0476 55 44 33|TEL]].
Merci de la recevoir rapidement.
Confraternellement,
[[N. Mertens|NOM]]`,

'FR PV syndical': `PV de la réunion de la délégation syndicale — 12/09/2025
Présents : [[Marc Wauters|NOM]] (délégué principal), [[Sandrine Claes|NOM]], [[Olivier Dubois|NOM]]
Excusé : [[Thierry Lejeune|NOM]]
1. Situation de [[Mme Leroy|NOM]] (atelier de découpe) : licenciement pour motif grave contesté. [[Mme Leroy|NOM]] a été entendue le 3 septembre.
2. Plainte pour harcèlement déposée par [[Julie|NOM]] contre son chef d'équipe [[M. Peeters|NOM]].
3. Prochaine réunion le 10 octobre. Contact : [[marc.wauters@syndicat-exemple.be|EMAIL]], [[0495/12.34.56|TEL]].`,

'FR facture': `FACTURE N° 2025-0187
Atelier Graphique [[Lemaire|ORG]] SRL — [[Rue de Namur 14|RUE]], [[5000 Namur|CP]]
TVA [[BE 1002.345.678|ENTREPRISE]] — IBAN [[BE62 5100 0754 7061|IBAN]]
Client : Cabinet vétérinaire [[Janssens|ORG]], à l'attention de [[Dr Pieter Janssens|NOM]], [[Kerkstraat 52|RUE]], [[2000 Antwerpen|CP]], TVA [[BE0412.345.678|ENTREPRISE]]
Date : 05/06/2025 — Échéance : 05/07/2025
Communication structurée : +++090/9337/55493+++
Total HTVA : 1.250,00 € — TVA 21 % : 262,50 € — Total TVAC : 1.512,50 €`,

'FR e-mail RH': `De : [[sophie.renard@groupe-delta.be|EMAIL]]
À : [[thomas.mathieu@exemple.be|EMAIL]]
Objet : Votre dossier — réf. [[RH/2025/0342|IDENT]]

Bonjour [[Thomas|NOM]],

Suite à notre entretien du 14 mars, je vous confirme votre engagement au poste de comptable à partir du 1er avril.
Votre véhicule de société ([[1-ABC-234|IDENT]]) vous sera remis à cette date.
Pour toute question : [[+32 2 512 34 56|TEL]] ou mon portable français [[+33 6 12 34 56 78|TEL]].
Nous avons bien reçu votre compte néerlandais [[NL91 ABNA 0417 1643 00|IBAN]] et votre adresse privée [[thomas.mathieu (at) exemple.org|EMAIL]].
Bien à vous,
[[Sophie Renard|NOM]]
Responsable RH`,

'NL loonbrief': `LOONBRIEF — maart 2025
Werkgever: Bakkerij [[Verhaegen|ORG]] BV — [[Stationsstraat 45|RUE]], [[9000 Gent|CP]]
Ondernemingsnummer: [[0456.789.123|ENTREPRISE]]
Werknemer: [[De heer Pieter De Smet|NOM]]
Rijksregisternummer: [[90.02.14-123.03|NISS]]
Geboortedatum: [[14 februari 1990|NAISSANCE]]
Adres: [[Lange Kievitstraat 112 bus 4|RUE]], [[2018 Antwerpen|CP]]
Rekeningnummer: [[BE71 0961 2345 6769|IBAN]]
Brutoloon: 3.120,45 EUR
Nettoloon: 2.215,10 EUR`,

'NL huurcontract': `HUUROVEREENKOMST
Tussen [[Mevrouw Annelies Van den Bossche|NOM]], wonende te [[Dorpsstraat 7|RUE]], [[3000 Leuven|CP]], verhuurder,
en [[de heer Jan Vermeulen|NOM]], geboren op [[3 oktober 1988|NAISSANCE]] te [[Brugge|VILLE]], huurder.
Telefoon verhuurder: [[016 23 45 67|TEL]] — e-mail: [[annelies.vandenbossche@exemple.be|EMAIL]]
De huurprijs bedraagt 875,00 euro per maand, te betalen op rekening [[BE43 0682 4417 9301|IBAN]].
Opgemaakt te Leuven op 1 september 2025.`,

'NL medische brief': `Dr. [[Els Peeters|NOM]], huisarts — RIZIV-nummer [[1-98765-43-210|IDENT]]
[[Grote Markt 3|RUE]], [[8000 Brugge|CP]]
Geachte collega,
Ik verwijs [[mevrouw Lotte Willems|NOM]] (°[[23/05/1976|NAISSANCE]]) naar u voor verder onderzoek.
Patiënte woont [[Zandstraat 19|RUE]], [[8200 Sint-Andries|CP]]. GSM: [[0472 98 76 54|TEL]].
Met collegiale groeten,
[[Dr. Els Peeters|NOM]]`,

'NL e-mail vakbond': `Van: [[k.janssens@vakbond-voorbeeld.be|EMAIL]]
Aan: [[pieter.dewilde@exemple.be|EMAIL]]
Betreft: dossier [[2025/ABV/118|IDENT]]
Beste [[Pieter|NOM]],
Na de vergadering van 4 juni bevestig ik dat [[Kris Janssens|NOM]] en [[Hilde Maes|NOM]] uw dossier opvolgen.
Uw nummerplaat [[2-DEF-567|IDENT]] staat op de lijst voor de parking.
Bel me gerust op [[+32 9 223 45 67|TEL]] of op mijn Nederlands nummer [[+31 6 1234 5678|TEL]].
Met vriendelijke groeten,
[[Kris Janssens|NOM]]`,
};

/* Textes SANS donnée personnelle : tout ce qui y est masqué est un faux positif.
   Le premier est celui de l'audit (8 masquages avant les corrections). */
export const FAUX_POSITIFS = {
'FR texte juridique / gestion': `Rapport de gestion 2024
En 2024 Bruxelles Environnement a publié ses chiffres. Le chiffre d'affaires atteint 12 345 678 €.
Conformément à l'article 1382 Code civil et à la loi du 3 juillet 1978 relative aux contrats de travail,
le préavis est calculé selon la CP 200. Référence produit 12345678901. Exercice 2023 Rapport annuel.
Code NACE 69201. Commande n° 4500123456 du 12.03.2024. Lot 2025 Wallonie. Version 1.2.3.4.
Le taux de 21 % s'applique aux 1 250 pièces livrées.`,

'FR/NL pièges des nouvelles règles': `Madame la Présidente a ouvert la séance. Monsieur le Directeur a répondu.
Il habite dans la rue, près de la place du marché. Le dossier en-cours sera traité.
De vergadering vond plaats in de grote zaal; het dossier mi-temps blijft open.
Cher Confrère, Beste collega, Bonjour à tous. Tussen partijen is niets afgesproken.
Le Conseil d'État et la Cour de cassation. Réf. produit 1234567890123456.
Facture payable sous 30 jours, soit 21 jours après réception.`,
};

export function parse(src) {
  const spans = []; let out = ''; let i = 0;
  const re = /\[\[(.+?)\]\]/g; let m;
  while ((m = re.exec(src))) {
    out += src.slice(i, m.index);
    const brut = m[1], k = brut.lastIndexOf('|');
    const v = brut.slice(0, k), tag = brut.slice(k + 1);
    spans.push({ start: out.length, end: out.length + v.length, v, tag });
    out += v; i = m.index + m[0].length;
  }
  out += src.slice(i);
  return { text: out, spans };
}
