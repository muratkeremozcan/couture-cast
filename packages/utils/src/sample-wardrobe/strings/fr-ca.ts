// Story 6.16 guest preview strings for fr-CA. Keys mirror en-us.ts exactly.

import type { GuestPreviewStrings } from './en-us'

export const frCA: GuestPreviewStrings = {
  chrome: {
    entry: "Essayer une garde-robe d'exemple",
    sampleLabel:
      "Garde-robe d'exemple. Météo et tenues présentées à titre d'exemple; ce n'est ni votre garde-robe ni une prévision en temps réel.",
    supporting: 'Modifiez une préférence pour voir comment cet exemple réagit.',
    conversion:
      "Créez un compte pour ajouter vos vêtements. Après la connexion, vous pourrez choisir d'enregistrer vos préférences de confort. Les articles d'exemple et les J'aime de l'aperçu restent dans cet aperçu.",
    createAccount: 'Créer un compte',
    signIn: 'Se connecter',
    resetPreview: "Réinitialiser l'aperçu",
    exitPreview: "Quitter l'aperçu",
    storageUnavailable: 'Cet aperçu pourrait être réinitialisé à sa fermeture.',
    connectionNeeded: "La création d'un compte nécessite une connexion Internet.",
    navLabel: "Sections de l'aperçu",
    navOutfit: 'Tenue',
    navWardrobe: "Garde-robe d'exemple",
    navPreferences: 'Préférences',
    close: 'Fermer',
    checkingSession: 'Vérification de votre session…',
    sessionUnavailable:
      "Nous n'avons pas pu confirmer votre session. Votre session reste ouverte sur cet appareil.",
    retry: 'Réessayer',
  },
  gate: {
    heading: "Avant d'essayer la garde-robe d'exemple",
    body: "Entrez votre date de naissance. Elle est vérifiée sur cet appareil seulement et n'est ni enregistrée ni envoyée.",
    field: 'Date de naissance (YYYY-MM-DD)',
    submit: 'Continuer',
    selfReported:
      "Cette vérification de l'âge repose sur votre déclaration; elle ne vérifie pas votre identité.",
    underage: 'Vous devez avoir 13 ans ou plus',
    invalid: 'Entrez votre date de naissance au format YYYY-MM-DD',
    exit: "Retour à l'accueil",
  },
  outfit: {
    heading: "Tenue d'exemple",
    whyThisWorks: 'Pourquoi ce choix',
    tryAnother: 'Essayer une autre tenue',
    noAlternative:
      "C'est la seule tenue d'exemple qui convient à ces réglages. Essayez un autre exemple de météo ou un autre réglage de confort.",
    browseWardrobe: "Parcourir la garde-robe d'exemple",
    swap: 'Changer {category}',
    swapTitle: 'Choisir {category}',
    current: 'Choix actuel',
    noSuitableAlternative:
      "Aucune autre option ne convient dans cette garde-robe d'exemple.",
    undoSwaps: 'Annuler les changements',
    swapped: '{garment} fait maintenant partie de la tenue.',
    updated: 'Tenue mise à jour : {look}.',
    allDisliked:
      'Vous avez marqué « Pas pour moi » toutes les tenues qui conviennent à ces réglages.',
    noEligible:
      "Aucune tenue d'exemple de cette collection ne convient à ces réglages. Essayez une autre collection ou un autre exemple de météo.",
    reviewChoices: 'Revoir les choix',
    resetChoices: 'Réinitialiser les choix',
  },
  preferences: {
    heading: 'Préférences',
    weather: "Météo d'exemple",
    weatherDetail:
      'Exemple : température ressentie de {temperature}, vent de {windSpeed} m/s, {rainPercent} % de probabilité de pluie.',
    thermal: 'Confort thermique',
    wind: 'Tolérance au vent',
    rain: 'Préparation à la pluie',
    collection: 'Collection',
  },
  feedback: {
    heading: "Évaluer les tenues d'exemple (facultatif)",
    body: "Un J'aime fait monter une tenue. Les tenues marquées « Pas pour moi » sont ignorées jusqu'à ce que vous retiriez cette mention.",
    like: "J'aime",
    dislike: 'Pas pour moi',
    progress: '{reviewed} sur {total} évaluées',
    previous: 'Tenue précédente',
    next: 'Tenue suivante',
    skip: 'Passer pour le moment',
  },
  wardrobe: {
    heading: "Garde-robe d'exemple",
    category: 'Catégorie',
    allCategories: 'Toutes',
    details: 'Détails',
    material: 'Matière',
    comfortRange: 'Plage de confort',
    windResistant: 'Résistant au vent',
    waterResistant: "Résistant à l'eau",
    yes: 'Oui',
    no: 'Non',
    backToOutfit: 'Retour à la tenue',
    empty: "Aucun article d'exemple dans cette catégorie pour cette collection.",
    count: "{count} articles d'exemple",
  },
  conversionDetail: {
    canSave: 'Peut être enregistré après la connexion',
    canSaveBody: 'Vos trois réglages de confort.',
    previewOnly: 'Aperçu seulement',
    previewOnlyBody:
      "Articles d'exemple, tenues, J'aime, filtre de collection et changements.",
    stillRequired: 'Toujours requis',
    stillRequiredBody:
      "Configuration du compte, connexion vérifiée et approbation d'un tuteur, s'il y a lieu.",
    backToPreview: "Retour à l'aperçu",
    signInToContinue: 'Connectez-vous pour continuer',
  },
  review: {
    heading: 'Utiliser ces préférences de confort?',
    account: 'Votre compte',
    proposed: "De l'aperçu",
    use: "Utiliser les réglages de l'aperçu",
    keep: 'Garder les préférences du compte',
    saving: 'Enregistrement…',
    saved: 'Vos préférences de confort sont enregistrées.',
    kept: 'Les préférences de votre compte sont inchangées.',
    failed:
      "Nous n'avons pas pu enregistrer vos préférences. Votre choix est conservé; vous pouvez réessayer.",
    loadFailed: "Nous n'avons pas pu charger les préférences de votre compte.",
    continue: 'Continuer',
  },
  values: {
    runsColdWarm: {
      cold: "J'ai tendance à avoir froid",
      neutral: 'Dans la moyenne',
      warm: "J'ai tendance à avoir chaud",
    },
    windTolerance: {
      low: 'Le vent me dérange',
      medium: 'Un peu de vent, ça va',
      high: 'Le vent me dérange rarement',
    },
    precipPreparedness: {
      low: 'Seulement en cas de forte pluie',
      medium: 'Quand la pluie est probable',
      high: 'Au moindre risque de pluie',
    },
    weather: {
      'cool-windy': 'Frais et venteux',
      'mild-dry': 'Doux et sec',
      'warm-rainy': 'Chaud et pluvieux',
    },
    collection: {
      all: 'Tous les exemples',
      womenswear: 'Mode femme',
      menswear: 'Mode homme',
    },
    category: {
      top: 'le haut',
      bottom: 'le bas',
      outerwear: 'la couche extérieure',
      dress: 'la robe',
      shoes: 'les chaussures',
      accessory: "l'accessoire",
    },
    categoryTitle: {
      top: 'Hauts',
      bottom: 'Bas',
      outerwear: 'Couches extérieures',
      dress: 'Robes',
      shoes: 'Chaussures',
      accessory: 'Accessoires',
    },
    material: {
      cotton: 'Coton',
      wool: 'Laine',
      linen: 'Lin',
      leather: 'Cuir',
      denim: 'Denim',
      fleece: 'Polaire',
      synthetic: 'Synthétique',
      down: 'Duvet',
      silk: 'Soie',
    },
    range: {
      cold: 'froid',
      cool: 'frais',
      mild: 'doux',
      warm: 'chaud',
      hot: 'très chaud',
    },
    control: {
      weather: "météo d'exemple",
      runsColdWarm: 'confort thermique',
      windTolerance: 'tolérance au vent',
      precipPreparedness: 'préparation à la pluie',
    },
    swapCause: {
      unknown: "cet article n'est pas dans cette garde-robe d'exemple",
      category: 'cet article appartient à une autre catégorie',
      collection: "cet article n'est pas dans cette collection",
      range: 'cet article ne convient pas à cette température',
      protection: "cette couche n'offre pas la protection nécessaire par ce temps",
    },
  },
  explanation: {
    weather: 'Exemple : {weather}, température ressentie de {feelsLike}.',
    'thermal-neutral':
      'Avec un confort dans la moyenne, cela correspond à un temps {range}.',
    'thermal-adjusted':
      'Vous avez tendance à trouver le temps plus {runsColdWarm}; il est donc traité comme {adjustedFeelsLike}, un temps {range}.',
    'layer-cold': '{garment} ajoute de la chaleur sous {threshold}.',
    'layer-wind':
      '{garment} bloque un vent de {windSpeed} m/s, au-delà de votre tolérance de {windThreshold} m/s.',
    'layer-rain':
      '{garment} vous garde au sec avec {rainPercent} % de probabilité de pluie, au-delà de votre seuil de {rainThresholdPercent} %.',
    'no-layer': "Par temps {range}, on peut se passer d'une couche extérieure.",
    'wind-within':
      'Un vent de {windSpeed} m/s reste dans votre tolérance de {windThreshold} m/s.',
    'rain-within':
      'Une probabilité de pluie de {rainPercent} % ne dépasse pas votre seuil de {rainThresholdPercent} %.',
    'liked-first': "Vous avez aimé {look}; cette tenue s'affiche donc en premier.",
    'stale-selection':
      'Votre tenue précédente ne convient plus à ces réglages; on affiche donc {look}.',
    'swap-applied': 'Vous avez choisi {garment} pour {category}.',
    'swap-ignored': 'Votre changement pour {category} est mis de côté : {cause}.',
    'still-suits':
      'Modifier le réglage « {control} » conserve cette tenue : elle convient toujours aux conditions.',
    'all-disliked':
      'Toutes les tenues qui conviennent à ces réglages sont marquées « Pas pour moi ».',
    'no-eligible': 'Aucune tenue de « {collection} » ne convient à ces réglages.',
  },
  garments: {
    'fleece-zip': {
      name: 'Veste polaire à glissière',
      description: 'Veste polaire vert sauge à fermeture éclair complète.',
    },
    'denim-jacket': {
      name: 'Veste en denim',
      description: 'Veste en denim bleu moyen avec poches poitrine.',
    },
    'cropped-blazer': {
      name: 'Blazer court',
      description: 'Blazer en laine gris charbon à revers dorés.',
    },
    'wool-overcoat': {
      name: 'Manteau de laine',
      description: 'Manteau de laine bleu marine aux genoux, à boutons camel.',
    },
    'puffer-jacket': {
      name: 'Manteau matelassé',
      description: 'Manteau matelassé en duvet noir.',
    },
    'trench-coat': {
      name: 'Trench',
      description: 'Trench classique camel avec ceinture.',
    },
    'rain-shell': {
      name: 'Imperméable léger',
      description:
        'Imperméable léger sarcelle clair à capuchon, avec fermeture éclair jaune.',
    },
    'oxford-shirt': {
      name: 'Chemise Oxford',
      description: 'Chemise en coton bleu pâle à col boutonné.',
    },
    'merino-sweater': {
      name: 'Chandail en mérinos',
      description: 'Chandail à col rond en laine mérinos bourgogne.',
    },
    'cotton-tee': {
      name: 'T-shirt en coton',
      description: 'T-shirt en coton blanc cassé à manches courtes.',
    },
    'cable-knit': {
      name: 'Chandail torsadé',
      description: 'Gros chandail en laine torsadée crème.',
    },
    'silk-blouse': {
      name: 'Blouse en soie',
      description: 'Blouse en soie rose poudré à col en V.',
    },
    'polo-shirt': {
      name: 'Polo',
      description: 'Polo en coton vert forêt à col blanc.',
    },
    'flannel-shirt': {
      name: 'Chemise en flanelle',
      description: 'Chemise en flanelle rouge brique à manches longues.',
    },
    'linen-shirt': {
      name: 'Chemise en lin',
      description: 'Chemise en lin couleur sable à manches longues.',
    },
    'dark-jeans': { name: 'Jeans foncés', description: 'Jeans droits indigo foncé.' },
    'wool-trousers': {
      name: 'Pantalon de laine',
      description: 'Pantalon ajusté en laine gris charbon.',
    },
    chinos: { name: 'Chinos', description: 'Pantalon chino en coton kaki.' },
    'linen-trousers': {
      name: 'Pantalon de lin',
      description: 'Pantalon en lin avoine clair.',
    },
    'midi-skirt': { name: 'Jupe midi', description: 'Jupe midi trapèze prune.' },
    'pleated-skirt': {
      name: 'Jupe plissée',
      description: 'Jupe plissée en laine gris ardoise.',
    },
    'tailored-shorts': {
      name: 'Short habillé',
      description: 'Short en coton olive à devant plat.',
    },
    'knit-dress': {
      name: 'Robe en tricot',
      description: 'Robe en tricot brun chocolat à manches longues.',
    },
    'wrap-dress': {
      name: 'Robe portefeuille',
      description: 'Robe portefeuille bleu sarcelle à taille nouée.',
    },
    sundress: {
      name: "Robe d'été",
      description: "Robe d'été en coton jaune souci à bretelles fines.",
    },
    'leather-boots': {
      name: 'Bottes en cuir',
      description: "Bottes en cuir brun résistantes à l'eau.",
    },
    'ankle-boots': { name: 'Bottillons', description: 'Bottillons en cuir noir.' },
    'white-sneakers': {
      name: 'Espadrilles blanches',
      description: 'Espadrilles blanches basses à semelle grise.',
    },
    loafers: { name: 'Flâneurs', description: 'Flâneurs en cuir brun à languette.' },
    sandals: { name: 'Sandales', description: 'Sandales à brides en cuir fauve.' },
    'wool-scarf': {
      name: 'Foulard de laine',
      description: 'Foulard de laine rouge à franges crème.',
    },
    beanie: { name: 'Tuque', description: 'Tuque en tricot bleu ardoise à bande crème.' },
    'canvas-tote': {
      name: 'Fourre-tout en toile',
      description: 'Sac fourre-tout en toile naturelle à poignées brunes.',
    },
    sunglasses: {
      name: 'Lunettes de soleil',
      description: 'Lunettes de soleil noires à branches dorées.',
    },
  },
  looks: {
    'winter-knit': {
      name: "Tricot d'hiver",
      description: 'Robe en tricot, bottillons et foulard de laine.',
    },
    'city-wool': {
      name: 'Laine en ville',
      description: 'Chandail en mérinos, pantalon de laine et bottes en cuir.',
    },
    'weekend-flannel': {
      name: 'Flanelle de fin de semaine',
      description: 'Chemise en flanelle, jeans foncés, bottes en cuir et tuque.',
    },
    'soft-pleats': {
      name: 'Plis tout doux',
      description: 'Chandail torsadé, jupe plissée et bottillons.',
    },
    'office-oxford': {
      name: 'Oxford au bureau',
      description: 'Chemise Oxford, jeans foncés et flâneurs.',
    },
    'silk-midi': {
      name: 'Soie et midi',
      description: 'Blouse en soie, jupe midi et espadrilles blanches.',
    },
    'easy-chinos': {
      name: 'Chinos décontractés',
      description: 'Chemise Oxford, chinos et espadrilles blanches.',
    },
    'summer-linen': {
      name: "Lin d'été",
      description: 'T-shirt en coton, pantalon de lin, sandales et lunettes de soleil.',
    },
    'sun-dress': {
      name: 'Jour de soleil',
      description: "Robe d'été, sandales et fourre-tout en toile.",
    },
    'wrap-day': {
      name: 'Robe portefeuille de jour',
      description: 'Robe portefeuille, flâneurs et fourre-tout en toile.',
    },
    'court-polo': {
      name: 'Polo sportif',
      description: 'Polo, short habillé et espadrilles blanches.',
    },
    'breezy-linen': {
      name: 'Lin aérien',
      description: 'Chemise en lin, pantalon de lin, flâneurs et fourre-tout en toile.',
    },
  },
}
