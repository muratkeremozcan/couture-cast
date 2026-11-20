// Story 6.16: every guest preview string for en-US. The other nine locale modules
// must carry exactly these keys (sample-wardrobe-strings.spec.ts).
// Templates use {name} placeholders filled by formatPreviewString.

export const enUS = {
  firstUse: {
    replaceGarment: 'Choose another photo',
    discardPhoto: 'Discard this photo?',
    keepEditing: 'Keep editing',
    discard: 'Discard',
    today: "Today's outfit",
    addGarment: 'Add one garment',
    setCity: 'Set your city',
    wardrobeFailed: 'Unable to load your wardrobe.',
    staleWardrobe: 'Showing your saved garments. Refresh failed.',
    backToOutfit: "Back to today's outfit",
    checkGarment: 'Check garment status',
    backToWardrobe: 'Back to Wardrobe',
    outfitFailed: "Unable to load today's outfit.",
    sampleEntry: 'Try a sample look',
    outfitIdea: 'Outfit idea',
  },
  chrome: {
    entry: 'Try a sample wardrobe',
    exampleLabel: 'Example',
    welcomeHeading: "Outfits for today's weather",
    welcomeBody:
      'Try a sample wardrobe first, or sign in to see outfits from your own closet.',
    sampleLabel:
      'Sample wardrobe. Example weather and outfits, not your closet or live forecast.',
    supporting: 'Change a preference to see how this example responds.',
    conversion:
      'Create an account to add your clothes. You can choose to save your comfort preferences after signing in. Sample items and preview likes stay in this preview.',
    createAccount: 'Create account',
    signIn: 'Sign in',
    openWardrobe: 'Open your wardrobe',
    signOut: 'Sign out',
    resetPreview: 'Reset preview',
    exitPreview: 'Exit preview',
    storageUnavailable: 'This preview may reset when you close it.',
    connectionNeeded: 'Creating an account needs an internet connection.',
    navLabel: 'Preview sections',
    navOutfit: 'Outfit',
    navWardrobe: 'Sample wardrobe',
    navPreferences: 'Preferences',
    close: 'Close',
    checkingSession: 'Checking your session…',
    sessionUnavailable:
      "We couldn't confirm your session. You are still signed in on this device.",
    retry: 'Try again',
  },
  gate: {
    heading: 'Before you try the sample wardrobe',
    body: 'Enter your birthdate. It is checked on this device only and is not saved or sent.',
    field: 'Birthdate (YYYY-MM-DD)',
    submit: 'Continue',
    selfReported: 'This is a self-reported age check, not identity verification.',
    underage: 'You must be 13 or older',
    invalid: 'Enter your birthdate as YYYY-MM-DD',
    exit: 'Back to home',
  },
  outfit: {
    heading: 'Sample outfit',
    whyThisWorks: 'Why this works',
    tryAnother: 'Try another look',
    noAlternative:
      'This is the only sample look that suits these settings. Try another weather example or comfort setting.',
    browseWardrobe: 'Browse the sample wardrobe',
    swap: 'Swap {category}',
    swapTitle: 'Swap the {category}',
    current: 'Current',
    noSuitableAlternative: 'No suitable alternative in this sample wardrobe.',
    undoSwaps: 'Undo swaps',
    swapped: '{garment} is now in the outfit.',
    updated: 'Outfit updated: {look}.',
    allDisliked: 'You marked every look that suits these settings as not for you.',
    noEligible:
      'No sample look in this collection suits these settings. Try another collection or weather example.',
    reviewChoices: 'Review choices',
    resetChoices: 'Reset choices',
  },
  preferences: {
    heading: 'Preferences',
    weather: 'Sample weather',
    weatherDetail:
      'Example: feels like {temperature}, wind {windSpeed} m/s, {rainPercent}% chance of rain.',
    thermal: 'Thermal comfort',
    wind: 'Wind tolerance',
    rain: 'Rain preparedness',
    collection: 'Collection',
  },
  feedback: {
    heading: 'Rate sample looks (optional)',
    body: 'Likes move a look up. Looks marked not for me are skipped until you clear them.',
    like: 'Like',
    dislike: 'Not for me',
    progress: '{reviewed} of {total} reviewed',
    previous: 'Previous look',
    next: 'Next look',
    skip: 'Skip for now',
  },
  wardrobe: {
    heading: 'Sample wardrobe',
    category: 'Category',
    allCategories: 'All',
    details: 'Details',
    material: 'Material',
    comfortRange: 'Comfort range',
    windResistant: 'Wind resistant',
    waterResistant: 'Water resistant',
    yes: 'Yes',
    no: 'No',
    backToOutfit: 'Back to outfit',
    empty: 'No sample items in this category for this collection.',
    count: '{count} sample items',
  },
  conversionDetail: {
    garmentHeading: 'Add your own garment',
    canSave: 'Can be saved after sign-in',
    canSaveBody: 'Your three comfort settings.',
    previewOnly: 'Preview only',
    previewOnlyBody: 'Sample items, outfits, likes, the collection filter and swaps.',
    stillRequired: 'Still required',
    stillRequiredBody: 'Account setup and verified sign-in.',
    backToPreview: 'Back to preview',
    signInToContinue: 'Sign in to continue',
  },
  review: {
    heading: 'Use these comfort preferences?',
    account: 'Your account',
    proposed: 'From the preview',
    use: 'Use preview settings',
    keep: 'Keep account preferences',
    saving: 'Saving…',
    saved: 'Your comfort preferences are saved.',
    kept: 'Your account preferences are unchanged.',
    rejected: "Your account can't save preferences yet. An age check comes first.",
    failed:
      "We couldn't save your preferences. Your choice is kept, so you can try again.",
    loadFailed: "We couldn't load your account preferences.",
    continue: 'Continue',
  },
  values: {
    runsColdWarm: {
      cold: 'I tend to feel cold',
      neutral: 'About average',
      warm: 'I tend to feel warm',
    },
    windTolerance: {
      low: 'Wind bothers me',
      medium: 'Some wind is fine',
      high: 'Wind rarely bothers me',
    },
    precipPreparedness: {
      low: 'Only for heavy rain',
      medium: 'When rain is likely',
      high: 'For any chance of rain',
    },
    weather: {
      'cool-windy': 'Cool and windy',
      'mild-dry': 'Mild and dry',
      'warm-rainy': 'Warm and rainy',
    },
    collection: {
      all: 'All examples',
      womenswear: 'Womenswear',
      menswear: 'Menswear',
    },
    category: {
      top: 'top',
      bottom: 'bottom',
      outerwear: 'outer layer',
      dress: 'dress',
      shoes: 'shoes',
      accessory: 'accessory',
    },
    categoryTitle: {
      top: 'Tops',
      bottom: 'Bottoms',
      outerwear: 'Outer layers',
      dress: 'Dresses',
      shoes: 'Shoes',
      accessory: 'Accessories',
    },
    material: {
      cotton: 'Cotton',
      wool: 'Wool',
      linen: 'Linen',
      leather: 'Leather',
      denim: 'Denim',
      fleece: 'Fleece',
      synthetic: 'Synthetic',
      down: 'Down',
      silk: 'Silk',
    },
    range: {
      cold: 'cold',
      cool: 'cool',
      mild: 'mild',
      warm: 'warm',
      hot: 'hot',
    },
    control: {
      weather: 'sample weather',
      runsColdWarm: 'thermal comfort',
      windTolerance: 'wind tolerance',
      precipPreparedness: 'rain preparedness',
    },
    swapCause: {
      unknown: 'that item is not in this sample wardrobe',
      category: 'that item belongs to another category',
      collection: 'that item is not in this collection',
      range: 'that item does not suit this temperature',
      protection: 'that layer does not give the protection this weather needs',
    },
  },
  explanation: {
    weather: '{weather} example, feels like {feelsLike}.',
    'thermal-neutral': 'At about average comfort, that reads as {range} weather.',
    'thermal-adjusted':
      'You tend to feel {runsColdWarm}, so it is treated as {adjustedFeelsLike}: {range} weather.',
    'layer-cold': '{garment} adds warmth below {threshold}.',
    'layer-wind':
      '{garment} blocks wind of {windSpeed} m/s, above your {windThreshold} m/s tolerance.',
    'layer-rain':
      '{garment} keeps you dry at a {rainPercent}% chance of rain, above your {rainThresholdPercent}%.',
    'no-layer': 'It is {range} enough to skip an outer layer.',
    'layer-unavailable':
      'This sample wardrobe has no layer with the protection this weather needs.',
    'wind-within':
      'Wind of {windSpeed} m/s is within your {windThreshold} m/s tolerance.',
    'rain-within':
      'A {rainPercent}% chance of rain is within your {rainThresholdPercent}%.',
    'liked-first': 'You liked {look}, so it comes first.',
    'stale-selection':
      'Your earlier look no longer suits these settings, so {look} is shown.',
    'swap-applied': 'You chose {garment} as the {category}.',
    'swap-ignored': 'Your {category} swap is set aside: {cause}.',
    'still-suits': 'Changing {control} keeps this outfit: it still suits the conditions.',
    'all-disliked': 'Every look that suits these settings is marked not for me.',
    'no-eligible': 'No look in {collection} suits these settings.',
  },
  garments: {
    'fleece-zip': {
      name: 'Fleece zip jacket',
      description: 'Sage green fleece jacket with a full zip.',
    },
    'denim-jacket': {
      name: 'Denim jacket',
      description: 'Mid blue denim jacket with chest pockets.',
    },
    'cropped-blazer': {
      name: 'Cropped blazer',
      description: 'Charcoal wool blazer with gold lapels.',
    },
    'wool-overcoat': {
      name: 'Wool overcoat',
      description: 'Navy knee-length wool coat with camel buttons.',
    },
    'puffer-jacket': { name: 'Puffer jacket', description: 'Black quilted down jacket.' },
    'trench-coat': {
      name: 'Trench coat',
      description: 'Classic camel trench coat with a belt.',
    },
    'rain-shell': {
      name: 'Rain shell',
      description: 'Light teal hooded rain jacket with a yellow zip.',
    },
    'oxford-shirt': {
      name: 'Oxford shirt',
      description: 'Pale blue cotton button-down shirt.',
    },
    'merino-sweater': {
      name: 'Merino sweater',
      description: 'Burgundy crew-neck merino wool sweater.',
    },
    'cotton-tee': {
      name: 'Cotton tee',
      description: 'Off-white short-sleeve cotton T-shirt.',
    },
    'cable-knit': {
      name: 'Cable-knit sweater',
      description: 'Cream chunky cable-knit wool sweater.',
    },
    'silk-blouse': { name: 'Silk blouse', description: 'Blush pink V-neck silk blouse.' },
    'polo-shirt': {
      name: 'Polo shirt',
      description: 'Forest green cotton polo with a white collar.',
    },
    'flannel-shirt': {
      name: 'Flannel shirt',
      description: 'Brick red long-sleeve flannel shirt.',
    },
    'linen-shirt': {
      name: 'Linen shirt',
      description: 'Sand-colored long-sleeve linen shirt.',
    },
    'dark-jeans': { name: 'Dark jeans', description: 'Dark indigo straight-leg jeans.' },
    'wool-trousers': {
      name: 'Wool trousers',
      description: 'Charcoal tailored wool trousers.',
    },
    chinos: { name: 'Chinos', description: 'Khaki cotton chino trousers.' },
    'linen-trousers': {
      name: 'Linen trousers',
      description: 'Light oatmeal linen trousers.',
    },
    'midi-skirt': { name: 'Midi skirt', description: 'Plum A-line midi skirt.' },
    'pleated-skirt': {
      name: 'Pleated skirt',
      description: 'Slate grey pleated wool skirt.',
    },
    'tailored-shorts': {
      name: 'Tailored shorts',
      description: 'Olive cotton shorts with a flat front.',
    },
    'knit-dress': {
      name: 'Knit dress',
      description: 'Chocolate brown long-sleeve knit dress.',
    },
    'wrap-dress': {
      name: 'Wrap dress',
      description: 'Teal blue wrap dress with a tie waist.',
    },
    sundress: {
      name: 'Sundress',
      description: 'Marigold cotton sundress with thin straps.',
    },
    'leather-boots': {
      name: 'Leather boots',
      description: 'Brown water-resistant leather boots.',
    },
    'ankle-boots': { name: 'Ankle boots', description: 'Black leather ankle boots.' },
    'white-sneakers': {
      name: 'White sneakers',
      description: 'White low-top sneakers with grey soles.',
    },
    loafers: { name: 'Loafers', description: 'Brown leather penny loafers.' },
    sandals: { name: 'Sandals', description: 'Tan leather strap sandals.' },
    'wool-scarf': {
      name: 'Wool scarf',
      description: 'Red wool scarf with cream fringe.',
    },
    beanie: { name: 'Beanie', description: 'Slate blue knit beanie with a cream band.' },
    'canvas-tote': {
      name: 'Canvas tote',
      description: 'Natural canvas tote bag with brown handles.',
    },
    sunglasses: { name: 'Sunglasses', description: 'Black sunglasses with gold arms.' },
  },
  looks: {
    'winter-knit': {
      name: 'Winter knit',
      description: 'Knit dress, ankle boots and a wool scarf.',
    },
    'city-wool': {
      name: 'City wool',
      description: 'Merino sweater, wool trousers and leather boots.',
    },
    'weekend-flannel': {
      name: 'Weekend flannel',
      description: 'Flannel shirt, dark jeans, leather boots and a beanie.',
    },
    'soft-pleats': {
      name: 'Soft pleats',
      description: 'Cable-knit sweater, pleated skirt and ankle boots.',
    },
    'office-oxford': {
      name: 'Office oxford',
      description: 'Oxford shirt, dark jeans and loafers.',
    },
    'silk-midi': {
      name: 'Silk midi',
      description: 'Silk blouse, midi skirt and white sneakers.',
    },
    'easy-chinos': {
      name: 'Easy chinos',
      description: 'Oxford shirt, chinos and white sneakers.',
    },
    'summer-linen': {
      name: 'Summer linen',
      description: 'Cotton tee, linen trousers, sandals and sunglasses.',
    },
    'sun-dress': {
      name: 'Sun dress',
      description: 'Sundress, sandals and a canvas tote.',
    },
    'wrap-day': {
      name: 'Wrap day',
      description: 'Wrap dress, loafers and a canvas tote.',
    },
    'court-polo': {
      name: 'Court polo',
      description: 'Polo shirt, tailored shorts and white sneakers.',
    },
    'breezy-linen': {
      name: 'Breezy linen',
      description: 'Linen shirt, linen trousers, loafers and a canvas tote.',
    },
  },
}

/** Structural type every locale module must match; values are free text. */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }
export type GuestPreviewStrings = Widen<typeof enUS>
