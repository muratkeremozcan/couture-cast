// Story 6.16 guest preview strings for fr-FR. Keys mirror en-us.ts exactly.
import type { GuestPreviewStrings } from './en-us'

export const frFR: GuestPreviewStrings = {
  styleIdeas: {
    heading: 'Préférences de style (facultatif)',
    style: 'Style',
    palette: 'Palette',
    texture: 'Texture',
    any: 'Au choix',
    active: 'Sport et quotidien',
    chic: 'Décontracté chic',
    cozy: 'Douillet et soigné',
    neutral: 'Neutre',
    colorful: 'Colorée',
    smooth: 'Lisse',
    textured: 'Texturée',
    save: 'Enregistrer la tenue exemple',
    update: 'Mettre à jour la tenue enregistrée',
    saved: 'Enregistrée sur cet appareil',
    remove: 'Retirer {look}',
    illustrations: 'Illustrations de vêtements',
    inspiration: 'Idées de tenues',
  },
  firstUse: {
    cleanupFallback:
      'Le fond est conservé, car le vêtement ne pouvait pas être isolé avec précision.',
    replaceGarment: 'Choisir une autre photo',
    discardPhoto: 'Supprimer cette photo ?',
    keepEditing: 'Continuer la modification',
    discard: 'Supprimer',
    today: 'Ta tenue du jour',
    addGarment: 'Ajouter un vêtement',
    setCity: 'Choisir ta ville',
    wardrobeFailed: 'Impossible de charger ta garde-robe.',
    staleWardrobe: 'Tes vêtements enregistrés sont affichés. La mise à jour a échoué.',
    backToOutfit: 'Retour à la tenue du jour',
    checkGarment: 'Vérifier le statut du vêtement',
    backToWardrobe: 'Retour à la garde-robe',
    outfitFailed: 'Impossible de charger la tenue du jour.',
    sampleEntry: 'Essayer une tenue exemple',
    outfitIdea: 'Idée de tenue',
  },
  chrome: {
    entry: "Essayer une garde-robe d'exemple",
    exampleLabel: 'Exemple',
    welcomeHeading: 'Des tenues pour la météo du jour',
    welcomeBody:
      "Essayez d'abord une garde-robe d'exemple, ou connectez-vous pour voir des tenues issues de votre propre garde-robe.",
    sampleLabel:
      "Garde-robe d'exemple. Météo et tenues fictives : ce n'est pas votre garde-robe ni une prévision en direct.",
    supporting: 'Modifiez une préférence pour voir comment cet exemple réagit.',
    conversion:
      "Créez un compte pour ajouter vos vêtements. Après la connexion, vous pourrez choisir d'enregistrer vos préférences de confort. Les pièces d'exemple et les « j'aime » de l'aperçu restent dans cet aperçu.",
    createAccount: 'Créer un compte',
    signIn: 'Se connecter',
    openWardrobe: 'Ouvrir votre garde-robe',
    signOut: 'Se déconnecter',
    resetPreview: "Réinitialiser l'aperçu",
    exitPreview: "Quitter l'aperçu",
    storageUnavailable: 'Cet aperçu peut se réinitialiser à sa fermeture.',
    connectionNeeded: "La création d'un compte nécessite une connexion Internet.",
    navLabel: "Sections de l'aperçu",
    navOutfit: 'Tenue',
    navWardrobe: "Garde-robe d'exemple",
    navPreferences: 'Préférences',
    close: 'Fermer',
    checkingSession: 'Vérification de votre session…',
    sessionUnavailable:
      "Nous n'avons pas pu confirmer votre session. Votre connexion reste active sur cet appareil.",
    retry: 'Réessayer',
  },
  gate: {
    heading: "Avant d'essayer la garde-robe d'exemple",
    body: "Saisissez votre date de naissance. Elle est vérifiée uniquement sur cet appareil, et n'est ni enregistrée ni envoyée.",
    field: 'Date de naissance (YYYY-MM-DD)',
    submit: 'Continuer',
    selfReported:
      "Il s'agit d'une vérification d'âge déclarative, sans vérification d'identité.",
    underage: 'Vous devez avoir 13 ans ou plus',
    invalid: 'Saisissez votre date de naissance au format YYYY-MM-DD',
    exit: "Retour à l'accueil",
  },
  outfit: {
    heading: "Tenue d'exemple",
    whyThisWorks: 'Pourquoi ça fonctionne',
    tryAnother: 'Essayer un autre look',
    noAlternative:
      "C'est le seul look d'exemple adapté à ces réglages. Essayez un autre exemple de météo ou un autre réglage de confort.",
    browseWardrobe: "Parcourir la garde-robe d'exemple",
    swap: 'Remplacer {category}',
    swapTitle: 'Choisir {category}',
    current: 'Actuel',
    noSuitableAlternative: "Aucune autre pièce adaptée dans cette garde-robe d'exemple.",
    undoSwaps: 'Annuler les remplacements',
    swapped: 'Ajouté à la tenue : {garment}.',
    updated: 'Tenue mise à jour : {look}.',
    allDisliked:
      'Vous avez marqué tous les looks adaptés à ces réglages comme « Pas pour moi ».',
    noEligible:
      "Aucun look d'exemple de cette collection n'est adapté à ces réglages. Essayez une autre collection ou un autre exemple de météo.",
    reviewChoices: 'Revoir mes choix',
    resetChoices: 'Réinitialiser mes choix',
  },
  preferences: {
    heading: 'Préférences',
    weather: "Météo d'exemple",
    weatherDetail:
      'Exemple : ressenti {temperature}, vent {windSpeed} m/s, {rainPercent} % de risque de pluie.',
    thermal: 'Confort thermique',
    wind: 'Tolérance au vent',
    rain: 'Préparation à la pluie',
    collection: 'Collection',
  },
  feedback: {
    heading: "Évaluer les looks d'exemple (facultatif)",
    body: "Un « j'aime » fait monter un look. Les looks marqués « Pas pour moi » sont ignorés jusqu'à ce que vous les effaciez.",
    like: "J'aime",
    dislike: 'Pas pour moi',
    progress: '{reviewed} sur {total} évalués',
    previous: 'Look précédent',
    next: 'Look suivant',
    skip: 'Passer pour le moment',
  },
  wardrobe: {
    heading: "Garde-robe d'exemple",
    category: 'Catégorie',
    allCategories: 'Toutes',
    details: 'Détails',
    material: 'Matière',
    comfortRange: 'Plage de confort',
    windResistant: 'Coupe-vent',
    waterResistant: "Résistant à l'eau",
    yes: 'Oui',
    no: 'Non',
    backToOutfit: 'Retour à la tenue',
    empty: "Aucune pièce d'exemple dans cette catégorie pour cette collection.",
    count: "{count} pièces d'exemple",
  },
  conversionDetail: {
    garmentHeading: 'Ajoutez un de vos vêtements',
    canSave: 'Enregistrable après la connexion',
    canSaveBody: 'Vos trois réglages de confort.',
    previewOnly: 'Aperçu uniquement',
    previewOnlyBody:
      "Pièces d'exemple, tenues, « j'aime », filtre de collection et remplacements.",
    stillRequired: 'Toujours nécessaire',
    stillRequiredBody: 'Création du compte et connexion vérifiée.',
    backToPreview: "Retour à l'aperçu",
    signInToContinue: 'Se connecter pour continuer',
  },
  review: {
    heading: 'Utiliser ces préférences de confort ?',
    account: 'Votre compte',
    proposed: "Depuis l'aperçu",
    use: "Utiliser les réglages de l'aperçu",
    keep: 'Garder les préférences du compte',
    saving: 'Enregistrement…',
    saved: 'Vos préférences de confort sont enregistrées.',
    kept: 'Les préférences de votre compte sont inchangées.',
    rejected:
      "Votre compte ne peut pas encore enregistrer de préférences. Une vérification d'âge est d'abord nécessaire.",
    failed:
      "Nous n'avons pas pu enregistrer vos préférences. Votre choix est conservé, vous pouvez réessayer.",
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
      low: 'Le vent me gêne',
      medium: 'Un peu de vent me va',
      high: 'Le vent me gêne rarement',
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
      'cool-rainy': 'Frais et pluvieux',
      'mild-rainy': 'Doux et pluvieux',
      'warm-dry': 'Chaud et sec',
    },
    collection: {
      all: 'Tous les exemples',
      womenswear: 'Femme',
      menswear: 'Homme',
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
      unknown: "cette pièce n'est pas dans cette garde-robe d'exemple",
      category: 'cette pièce appartient à une autre catégorie',
      collection: "cette pièce n'est pas dans cette collection",
      range: 'cette pièce ne convient pas à cette température',
      protection: "cette couche n'offre pas la protection que ce temps exige",
    },
  },
  explanation: {
    weather: 'Exemple : {weather}, ressenti {feelsLike}.',
    'thermal-neutral': 'Pour un confort moyen, il fait {range}.',
    'thermal-adjusted':
      'Vous avez souvent {runsColdWarm}, donc la température compte comme {adjustedFeelsLike} : il fait {range}.',
    'layer-cold': '{garment} : apporte de la chaleur sous {threshold}.',
    'layer-wind':
      '{garment} : coupe un vent de {windSpeed} m/s, au-delà de votre tolérance de {windThreshold} m/s.',
    'layer-rain':
      '{garment} : vous garde au sec avec {rainPercent} % de risque de pluie, au-delà de votre seuil de {rainThresholdPercent} %.',
    'no-layer': 'Il fait {range}, une couche extérieure est inutile.',
    'layer-unavailable':
      "Cette garde-robe d'exemple n'a aucune couche extérieure offrant la protection nécessaire par ce temps.",
    'wind-within':
      'Un vent de {windSpeed} m/s ne dépasse pas votre tolérance de {windThreshold} m/s.',
    'rain-within':
      'Un risque de pluie de {rainPercent} % ne dépasse pas votre seuil de {rainThresholdPercent} %.',
    'liked-first': 'Vous avez aimé {look}, donc ce look passe en premier.',
    'stale-selection':
      'Votre look précédent ne convient plus à ces réglages, voici donc {look}.',
    'swap-applied': 'Choisi pour {category} : {garment}.',
    'swap-ignored': 'Votre remplacement pour {category} est mis de côté : {cause}.',
    'still-suits':
      'Réglage modifié : {control}. Cette tenue reste, car elle convient toujours aux conditions.',
    'all-disliked':
      'Tous les looks adaptés à ces réglages sont marqués « Pas pour moi ».',
    'no-eligible': 'Collection : {collection}. Aucun look ne convient à ces réglages.',
  },
  garments: {
    'ribbed-knit': {
      name: 'Pull côtelé',
      description: 'Pull en coton crème à maille côtelée.',
    },
    'ribbed-socks': {
      name: 'Chaussettes côtelées',
      description: 'Chaussettes en coton taupe à bords côtelés.',
    },
    'mini-skirt': {
      name: 'Minijupe',
      description: 'Jupe courte en laine, couleur prune douce.',
    },
    'opaque-tights': {
      name: 'Collants opaques',
      description: 'Collants foncés par temps frais.',
    },
    'fleece-zip': {
      name: 'Veste polaire zippée',
      description: 'Veste polaire vert sauge entièrement zippée.',
    },
    'denim-jacket': {
      name: 'Veste en jean',
      description: 'Veste en jean bleu moyen avec poches poitrine.',
    },
    'cropped-blazer': {
      name: 'Blazer court',
      description: 'Blazer en laine anthracite à revers dorés.',
    },
    'wool-overcoat': {
      name: 'Manteau en laine',
      description: 'Manteau en laine bleu marine aux genoux, boutons camel.',
    },
    'puffer-jacket': {
      name: 'Doudoune',
      description: 'Doudoune noire matelassée en duvet.',
    },
    'trench-coat': {
      name: 'Trench',
      description: 'Trench camel classique avec ceinture.',
    },
    'rain-shell': {
      name: 'Veste de pluie',
      description: 'Veste de pluie légère à capuche bleu sarcelle clair, zip jaune.',
    },
    'oxford-shirt': {
      name: 'Chemise oxford',
      description: 'Chemise en coton bleu pâle à col boutonné.',
    },
    'merino-sweater': {
      name: 'Pull en mérinos',
      description: 'Pull col rond en laine mérinos bordeaux.',
    },
    'cotton-tee': {
      name: 'T-shirt en coton',
      description: 'T-shirt en coton blanc cassé à manches courtes.',
    },
    'cable-knit': {
      name: 'Pull torsadé',
      description: 'Pull épais torsadé en laine crème.',
    },
    'silk-blouse': {
      name: 'Chemisier en soie',
      description: 'Chemisier en soie rose poudré col V.',
    },
    'polo-shirt': { name: 'Polo', description: 'Polo en coton vert forêt à col blanc.' },
    'flannel-shirt': {
      name: 'Chemise en flanelle',
      description: 'Chemise en flanelle rouge brique à manches longues.',
    },
    'linen-shirt': {
      name: 'Chemise en lin',
      description: 'Chemise en lin couleur sable à manches longues.',
    },
    'dark-jeans': { name: 'Jean foncé', description: 'Jean droit indigo foncé.' },
    'wool-trousers': {
      name: 'Pantalon en laine',
      description: 'Pantalon de tailleur en laine anthracite.',
    },
    chinos: { name: 'Chino', description: 'Pantalon chino en coton kaki.' },
    'linen-trousers': {
      name: 'Pantalon en lin',
      description: 'Pantalon en lin couleur avoine clair.',
    },
    'midi-skirt': { name: 'Jupe midi', description: 'Jupe midi trapèze prune.' },
    'pleated-skirt': {
      name: 'Jupe plissée',
      description: 'Jupe plissée en laine gris ardoise.',
    },
    'tailored-shorts': {
      name: 'Short de ville',
      description: 'Short en coton olive sans pinces.',
    },
    'knit-dress': {
      name: 'Robe en maille',
      description: 'Robe en maille chocolat à manches longues.',
    },
    'wrap-dress': {
      name: 'Robe portefeuille',
      description: 'Robe portefeuille bleu sarcelle nouée à la taille.',
    },
    sundress: {
      name: "Robe d'été",
      description: "Robe d'été en coton jaune souci à fines bretelles.",
    },
    'leather-boots': {
      name: 'Bottes en cuir',
      description: "Bottes en cuir marron résistantes à l'eau.",
    },
    'ankle-boots': { name: 'Bottines', description: 'Bottines en cuir noir.' },
    'white-sneakers': {
      name: 'Baskets blanches',
      description: 'Baskets basses blanches à semelle grise.',
    },
    loafers: { name: 'Mocassins', description: 'Mocassins à patte en cuir marron.' },
    sandals: { name: 'Sandales', description: 'Sandales à brides en cuir fauve.' },
    'wool-scarf': {
      name: 'Écharpe en laine',
      description: 'Écharpe en laine rouge à franges crème.',
    },
    beanie: {
      name: 'Bonnet',
      description: 'Bonnet en maille bleu ardoise à bande crème.',
    },
    'canvas-tote': {
      name: 'Cabas en toile',
      description: 'Sac cabas en toile naturelle à anses marron.',
    },
    sunglasses: {
      name: 'Lunettes de soleil',
      description: 'Lunettes de soleil noires à branches dorées.',
    },
  },
  looks: {
    'mini-and-tights': {
      name: 'Minijupe et collants',
      description: 'Pull côtelé, minijupe prune, collants opaques et bottines.',
    },
    'winter-knit': {
      name: "Maille d'hiver",
      description: 'Robe en maille, bottines et écharpe en laine.',
    },
    'city-wool': {
      name: 'Laine en ville',
      description: 'Pull en mérinos, pantalon en laine et bottes en cuir.',
    },
    'weekend-flannel': {
      name: 'Flanelle du week-end',
      description: 'Chemise en flanelle, jean foncé, bottes en cuir et bonnet.',
    },
    'soft-pleats': {
      name: 'Plis doux',
      description: 'Pull torsadé, jupe plissée et bottines.',
    },
    'office-oxford': {
      name: 'Oxford au bureau',
      description: 'Chemise oxford, jean foncé et mocassins.',
    },
    'silk-midi': {
      name: 'Soie et midi',
      description: 'Chemisier en soie, jupe midi et baskets blanches.',
    },
    'easy-chinos': {
      name: 'Chino décontracté',
      description: 'Chemise oxford, chino et baskets blanches.',
    },
    'summer-linen': {
      name: "Lin d'été",
      description: 'T-shirt en coton, pantalon en lin, sandales et lunettes de soleil.',
    },
    'sun-dress': {
      name: 'Journée ensoleillée',
      description: "Robe d'été, sandales et cabas en toile.",
    },
    'wrap-day': {
      name: 'Journée portefeuille',
      description: 'Robe portefeuille, mocassins et cabas en toile.',
    },
    'court-polo': {
      name: 'Polo de court',
      description: 'Polo, short de ville et baskets blanches.',
    },
    'breezy-linen': {
      name: 'Lin léger',
      description: 'Chemise en lin, pantalon en lin, mocassins et cabas en toile.',
    },
  },
}
