// Story 6.16 guest preview strings for fr-CA. Keys mirror en-us.ts exactly.

import type { GuestPreviewStrings } from './en-us'

export const frCA: GuestPreviewStrings = {
  styleIdeas: {
    heading: 'Choisis ton style (facultatif)',
    style: 'Style',
    palette: 'Couleurs',
    texture: 'Texture',
    any: 'Au choix',
    active: 'Sport',
    chic: 'Chic',
    cozy: 'Douillet',
    neutral: 'Neutre',
    colorful: 'Colorée',
    smooth: 'Lisse',
    textured: 'Texturée',
    save: 'Enregistrer la tenue exemple',
    update: 'Mettre à jour la tenue enregistrée',
    saved: 'Enregistrée sur cet appareil',
    remove: 'Retirer {look}',
    illustrations: 'Dessins de vêtements',
    inspiration: 'Idées de tenues',
  },
  firstUse: {
    cleanupFallback: 'Ta photo garde son fond. On n’a pas pu détourer le vêtement.',
    replaceGarment: 'Choisir une autre photo',
    discardPhoto: 'Supprimer cette photo?',
    keepEditing: 'Continuer la modification',
    discard: 'Supprimer',
    today: 'Ta tenue du jour',
    addGarment: 'Ajoute un vêtement',
    setCity: 'Choisir ta ville',
    wardrobeFailed: 'Impossible de charger ta garde-robe.',
    staleWardrobe: 'Tes vêtements enregistrés sont affichés. La mise à jour a échoué.',
    backToOutfit: 'Retour à la tenue',
    checkGarment: 'Vérifie ton vêtement',
    backToWardrobe: 'Retour à la garde-robe',
    outfitFailed: 'Impossible de charger la tenue du jour.',
    sampleEntry: 'Essaie des tenues',
    outfitIdea: 'Idée de tenue',
  },
  chrome: {
    entry: 'Essaie des tenues',
    exampleLabel: 'Exemple',
    welcomeHeading: "Des tenues pour la météo d'aujourd'hui",
    welcomeBody:
      'Essaie quelques tenues. Connecte-toi pour voir des tenues faites avec tes vêtements.',
    sampleLabel:
      'Ce sont des exemples de tenues et de météo. Ta garde-robe et la météo du jour restent à part.',
    supporting: 'Essaie un autre réglage.',
    conversion:
      'Crée un compte pour ajouter tes vêtements. Une fois connecté, tu peux garder tes réglages de météo. Tes vêtements d’exemple et tes coups de cœur restent ici.',
    createAccount: 'Créer un compte',
    signIn: 'Se connecter',
    openWardrobe: 'Ouvrir votre garde-robe',
    signOut: 'Se déconnecter',
    resetPreview: "Réinitialiser l'aperçu",
    exitPreview: "Quitter l'aperçu",
    storageUnavailable: 'Cet aperçu pourrait être réinitialisé à sa fermeture.',
    connectionNeeded: "La création d'un compte nécessite une connexion Internet.",
    navLabel: "Sections de l'aperçu",
    navOutfit: 'Tenue',
    navWardrobe: 'Garde-robe d’exemple',
    navPreferences: 'Préférences',
    close: 'Fermer',
    checkingSession: 'Vérification de votre session…',
    sessionUnavailable:
      "Nous n'avons pas pu confirmer votre session. Votre session reste ouverte sur cet appareil.",
    retry: 'Réessayer',
  },
  gate: {
    heading: 'Vérifie ton âge',
    body: 'Entre ta date de naissance. Cet appareil la vérifie. L’appli ne l’enregistre pas et ne l’envoie pas.',
    field: 'Date de naissance (YYYY-MM-DD)',
    submit: 'Continuer',
    selfReported:
      'On se fie à l’âge que tu donnes. On ne vérifie pas ta pièce d’identité.',
    underage: 'Vous devez avoir 13 ans ou plus',
    invalid: 'Entrez votre date de naissance au format YYYY-MM-DD',
    exit: "Retour à l'accueil",
  },
  outfit: {
    heading: "Tenue d'exemple",
    whyThisWorks: 'Pourquoi ce choix',
    tryAnother: 'Essayer une autre tenue',
    noAlternative:
      'Seule cette tenue convient. Essaie une autre météo ou change un réglage.',
    browseWardrobe: 'Explore la garde-robe',
    swap: 'Changer {category}',
    swapTitle: 'Choisir {category}',
    current: 'Choix actuel',
    noSuitableAlternative: 'Aucun autre vêtement ne va avec cette tenue.',
    undoSwaps: 'Annuler les changements',
    swapped: '{garment} fait maintenant partie de la tenue.',
    updated: 'Tenue mise à jour : {look}.',
    allDisliked: 'Tu as choisi « Pas pour moi » pour toutes les tenues qui conviennent.',
    noEligible: 'Aucune tenue ne convient. Essaie un autre groupe ou change la météo.',
    reviewChoices: 'Revoir les choix',
    resetChoices: 'Réinitialiser les choix',
  },
  preferences: {
    heading: 'Tes réglages',
    weather: "Météo d'exemple",
    weatherDetail: 'Ressenti : {temperature}. Vent : {windSpeed} m/s. {rainPercent}.',
    thermal: 'Ton ressenti',
    wind: 'Ce que tu penses du vent',
    rain: 'Quand tu te prépares pour la pluie',
    collection: 'Collection',
  },
  feedback: {
    heading: 'Dis ce que tu aimes',
    body: 'Les tenues que tu aimes remontent. Avec « Pas pour moi », la tenue reste masquée jusqu’à ce que tu effaces tes choix.',
    like: "J'aime",
    dislike: 'Pas pour moi',
    progress: '{reviewed} sur {total} évaluées',
    previous: 'Tenue précédente',
    next: 'Tenue suivante',
    skip: 'Passer pour le moment',
  },
  wardrobe: {
    heading: 'Garde-robe d’exemple',
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
    garmentHeading: 'Ajoute tes vêtements',
    canSave: 'Peut être enregistré après la connexion',
    canSaveBody: 'Vos trois réglages de confort.',
    previewOnly: 'Aperçu seulement',
    previewOnlyBody:
      "Articles d'exemple, tenues, J'aime, filtre de collection et changements.",
    stillRequired: 'Toujours requis',
    stillRequiredBody: 'Configuration du compte et connexion vérifiée.',
    backToPreview: "Retour à l'aperçu",
    signInToContinue: 'Connecte-toi',
  },
  review: {
    heading: 'Garder ces réglages?',
    account: 'Votre compte',
    proposed: "De l'aperçu",
    use: "Utiliser les réglages de l'aperçu",
    keep: 'Garde mes réglages',
    saving: 'Enregistrement…',
    saved: 'Vos préférences de confort sont enregistrées.',
    kept: 'Les préférences de votre compte sont inchangées.',
    rejected:
      "Votre compte ne peut pas encore enregistrer de préférences. Une vérification d'âge doit d'abord avoir lieu.",
    failed:
      "Nous n'avons pas pu enregistrer vos préférences. Votre choix est conservé; vous pouvez réessayer.",
    loadFailed: "Nous n'avons pas pu charger les préférences de votre compte.",
    continue: 'Continuer',
  },
  values: {
    rainChance: {
      none: 'Pas de pluie en vue',
      possible: 'Il pourrait pleuvoir',
      likely: 'Il risque de pleuvoir',
    },
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
      high: 'Souvent',
    },
    weather: {
      'cool-windy': 'Frais et venteux',
      'mild-dry': 'Doux et sec',
      'warm-rainy': 'Chaud et pluvieux',
      'cool-rainy': 'Frais et pluvieux',
      'mild-rainy': 'Doux et pluvieux',
      'warm-dry': 'Chaud et sec',
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
    'layer-rain': '{rainPercent}. Prends ce vêtement pour rester au sec : {garment}.',
    'no-layer': "Par temps {range}, on peut se passer d'une couche extérieure.",
    'layer-unavailable':
      "Cette garde-robe d'exemple n'a aucune couche extérieure offrant la protection que ce temps exige.",
    'wind-within':
      'Un vent de {windSpeed} m/s reste dans votre tolérance de {windThreshold} m/s.',
    'rain-within': '{rainPercent}. Tu peux laisser ton imper à la maison.',
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
    'ribbed-knit': {
      name: 'Tricot côtelé',
      description: 'Chandail de coton crème en maille côtelée.',
    },
    'ribbed-socks': {
      name: 'Bas côtelés',
      description: 'Bas de coton taupe à bords côtelés.',
    },
    'mini-skirt': {
      name: 'Minijupe',
      description: 'Jupe courte en laine, couleur prune douce.',
    },
    'opaque-tights': {
      name: 'Collants opaques',
      description: 'Collants foncés pour le temps frais.',
    },
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
    'mini-and-tights': {
      name: 'Minijupe et collants',
      description: 'Tricot côtelé, minijupe prune, collants opaques et bottillons.',
    },
    'winter-knit': {
      name: "Tricot d'hiver",
      description: 'Robe en tricot, bottillons et foulard de laine.',
    },
    'city-wool': {
      name: 'Laine en ville',
      description: 'Chandail en mérinos, pantalon de laine et bottes en cuir.',
    },
    'weekend-flannel': {
      name: 'Tenue de fin de semaine',
      description:
        'Une chemise de flanelle, un jean foncé, des bottes et une tuque pour la fin de semaine.',
    },
    'soft-pleats': {
      name: 'Plis tout doux',
      description: 'Chandail torsadé, jupe plissée et bottillons.',
    },
    'office-oxford': {
      name: 'Jour d’école',
      description: 'Une chemise boutonnée, un jean foncé et des flâneurs pour l’école.',
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
      description: 'Une robe portefeuille, des flâneurs et un sac pour sortir.',
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
