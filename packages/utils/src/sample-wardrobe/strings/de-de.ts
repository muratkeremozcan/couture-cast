// Story 6.16 guest preview strings for de-DE. Keys mirror en-us.ts exactly.
import type { GuestPreviewStrings } from './en-us'

export const deDE: GuestPreviewStrings = {
  chrome: {
    entry: 'Beispielgarderobe ausprobieren',
    exampleLabel: 'Beispiel',
    sampleLabel:
      'Beispielgarderobe. Beispielwetter und Beispieloutfits, nicht Ihr Kleiderschrank und keine Live-Vorhersage.',
    supporting: 'Ändern Sie eine Einstellung, um zu sehen, wie dieses Beispiel reagiert.',
    conversion:
      'Erstellen Sie ein Konto, um Ihre Kleidung hinzuzufügen. Nach der Anmeldung können Sie Ihre Komforteinstellungen speichern. Beispielteile und Likes aus der Vorschau bleiben in dieser Vorschau.',
    createAccount: 'Konto erstellen',
    signIn: 'Anmelden',
    resetPreview: 'Vorschau zurücksetzen',
    exitPreview: 'Vorschau beenden',
    storageUnavailable: 'Diese Vorschau wird beim Schließen eventuell zurückgesetzt.',
    connectionNeeded: 'Für die Kontoerstellung ist eine Internetverbindung nötig.',
    navLabel: 'Bereiche der Vorschau',
    navOutfit: 'Outfit',
    navWardrobe: 'Beispielgarderobe',
    navPreferences: 'Einstellungen',
    close: 'Schließen',
    checkingSession: 'Sitzung wird geprüft…',
    sessionUnavailable:
      'Ihre Sitzung konnte nicht bestätigt werden. Sie bleiben auf diesem Gerät angemeldet.',
    retry: 'Erneut versuchen',
  },
  gate: {
    heading: 'Bevor Sie die Beispielgarderobe ausprobieren',
    body: 'Geben Sie Ihr Geburtsdatum ein. Es wird nur auf diesem Gerät geprüft und weder gespeichert noch gesendet.',
    field: 'Geburtsdatum (YYYY-MM-DD)',
    submit: 'Weiter',
    selfReported:
      'Dies ist eine Altersprüfung per Selbstauskunft, keine Identitätsprüfung.',
    underage: 'Sie müssen mindestens 13 Jahre alt sein',
    invalid: 'Geben Sie Ihr Geburtsdatum im Format YYYY-MM-DD ein',
    exit: 'Zur Startseite',
  },
  outfit: {
    heading: 'Beispieloutfit',
    whyThisWorks: 'Darum passt es',
    tryAnother: 'Anderen Look ausprobieren',
    noAlternative:
      'Dies ist der einzige Beispiellook, der zu diesen Einstellungen passt. Probieren Sie ein anderes Wetterbeispiel oder eine andere Komforteinstellung.',
    browseWardrobe: 'Beispielgarderobe durchsehen',
    swap: '{category} tauschen',
    swapTitle: '{category} auswählen',
    current: 'Aktuell',
    noSuitableAlternative: 'Keine passende Alternative in dieser Beispielgarderobe.',
    undoSwaps: 'Tausch rückgängig machen',
    swapped: 'Jetzt im Outfit: {garment}.',
    updated: 'Outfit aktualisiert: {look}.',
    allDisliked:
      'Sie haben jeden Look, der zu diesen Einstellungen passt, als „Nicht für mich“ markiert.',
    noEligible:
      'Kein Beispiellook in dieser Kollektion passt zu diesen Einstellungen. Probieren Sie eine andere Kollektion oder ein anderes Wetterbeispiel.',
    reviewChoices: 'Auswahl prüfen',
    resetChoices: 'Auswahl zurücksetzen',
  },
  preferences: {
    heading: 'Einstellungen',
    weather: 'Beispielwetter',
    weatherDetail:
      'Beispiel: gefühlt {temperature}, Wind {windSpeed} m/s, {rainPercent}% Regenwahrscheinlichkeit.',
    thermal: 'Wärmeempfinden',
    wind: 'Windtoleranz',
    rain: 'Regenvorsorge',
    collection: 'Kollektion',
  },
  feedback: {
    heading: 'Beispiellooks bewerten (optional)',
    body: 'Likes rücken einen Look nach oben. Als „Nicht für mich“ markierte Looks werden übersprungen, bis Sie die Markierung entfernen.',
    like: 'Gefällt mir',
    dislike: 'Nicht für mich',
    progress: '{reviewed} von {total} bewertet',
    previous: 'Vorheriger Look',
    next: 'Nächster Look',
    skip: 'Vorerst überspringen',
  },
  wardrobe: {
    heading: 'Beispielgarderobe',
    category: 'Kategorie',
    allCategories: 'Alle',
    details: 'Details',
    material: 'Material',
    comfortRange: 'Komfortbereich',
    windResistant: 'Winddicht',
    waterResistant: 'Wasserabweisend',
    yes: 'Ja',
    no: 'Nein',
    backToOutfit: 'Zurück zum Outfit',
    empty: 'Keine Beispielteile in dieser Kategorie für diese Kollektion.',
    count: '{count} Beispielteile',
  },
  conversionDetail: {
    canSave: 'Nach der Anmeldung speicherbar',
    canSaveBody: 'Ihre drei Komforteinstellungen.',
    previewOnly: 'Nur in der Vorschau',
    previewOnlyBody:
      'Beispielteile, Outfits, Likes, der Kollektionsfilter und getauschte Teile.',
    stillRequired: 'Weiterhin erforderlich',
    stillRequiredBody:
      'Kontoeinrichtung, bestätigte Anmeldung und, falls zutreffend, die Zustimmung der Eltern.',
    backToPreview: 'Zurück zur Vorschau',
    signInToContinue: 'Zum Fortfahren anmelden',
  },
  review: {
    heading: 'Diese Komforteinstellungen übernehmen?',
    account: 'Ihr Konto',
    proposed: 'Aus der Vorschau',
    use: 'Vorschau-Einstellungen übernehmen',
    keep: 'Kontoeinstellungen behalten',
    saving: 'Wird gespeichert…',
    saved: 'Ihre Komforteinstellungen sind gespeichert.',
    kept: 'Ihre Kontoeinstellungen sind unverändert.',
    rejected:
      'Ihr Konto kann noch keine Einstellungen speichern. Zuerst ist die Zustimmung eines Erziehungsberechtigten oder eine Altersprüfung nötig.',
    failed:
      'Ihre Einstellungen konnten nicht gespeichert werden. Ihre Auswahl bleibt erhalten, Sie können es erneut versuchen.',
    loadFailed: 'Ihre Kontoeinstellungen konnten nicht geladen werden.',
    continue: 'Weiter',
  },
  values: {
    runsColdWarm: {
      cold: 'Mir ist oft kalt',
      neutral: 'Etwa durchschnittlich',
      warm: 'Mir ist oft warm',
    },
    windTolerance: {
      low: 'Wind stört mich',
      medium: 'Etwas Wind ist in Ordnung',
      high: 'Wind stört mich selten',
    },
    precipPreparedness: {
      low: 'Nur bei starkem Regen',
      medium: 'Wenn Regen wahrscheinlich ist',
      high: 'Schon bei geringer Regenwahrscheinlichkeit',
    },
    weather: {
      'cool-windy': 'Kühl und windig',
      'mild-dry': 'Mild und trocken',
      'warm-rainy': 'Warm und regnerisch',
    },
    collection: {
      all: 'Alle Beispiele',
      womenswear: 'Damenmode',
      menswear: 'Herrenmode',
    },
    category: {
      top: 'Oberteil',
      bottom: 'Unterteil',
      outerwear: 'Außenschicht',
      dress: 'Kleid',
      shoes: 'Schuhe',
      accessory: 'Accessoire',
    },
    categoryTitle: {
      top: 'Oberteile',
      bottom: 'Unterteile',
      outerwear: 'Außenschichten',
      dress: 'Kleider',
      shoes: 'Schuhe',
      accessory: 'Accessoires',
    },
    material: {
      cotton: 'Baumwolle',
      wool: 'Wolle',
      linen: 'Leinen',
      leather: 'Leder',
      denim: 'Denim',
      fleece: 'Fleece',
      synthetic: 'Synthetik',
      down: 'Daunen',
      silk: 'Seide',
    },
    range: {
      cold: 'kalt',
      cool: 'kühl',
      mild: 'mild',
      warm: 'warm',
      hot: 'heiß',
    },
    control: {
      weather: 'Beispielwetter',
      runsColdWarm: 'Wärmeempfinden',
      windTolerance: 'Windtoleranz',
      precipPreparedness: 'Regenvorsorge',
    },
    swapCause: {
      unknown: 'dieses Teil ist nicht in dieser Beispielgarderobe',
      category: 'dieses Teil gehört zu einer anderen Kategorie',
      collection: 'dieses Teil ist nicht in dieser Kollektion',
      range: 'dieses Teil passt nicht zu dieser Temperatur',
      protection: 'diese Schicht bietet nicht den Schutz, den dieses Wetter braucht',
    },
  },
  explanation: {
    weather: 'Beispiel: {weather}, gefühlt {feelsLike}.',
    'thermal-neutral': 'Bei durchschnittlichem Empfinden wirkt das Wetter {range}.',
    'thermal-adjusted':
      'Ihnen ist oft {runsColdWarm}, daher gilt {adjustedFeelsLike}: Das Wetter wirkt {range}.',
    'layer-cold': '{garment}: wärmt unter {threshold}.',
    'layer-wind':
      '{garment}: hält Wind mit {windSpeed} m/s ab, mehr als Ihre Toleranz von {windThreshold} m/s.',
    'layer-rain':
      '{garment}: hält Sie bei {rainPercent}% Regenwahrscheinlichkeit trocken, mehr als Ihre {rainThresholdPercent}%.',
    'no-layer': 'Es ist {range} genug, um auf eine Außenschicht zu verzichten.',
    'layer-unavailable':
      'Diese Beispielgarderobe hat keine Außenschicht mit dem Schutz, den dieses Wetter braucht.',
    'wind-within':
      'Wind mit {windSpeed} m/s liegt innerhalb Ihrer Toleranz von {windThreshold} m/s.',
    'rain-within':
      'Eine Regenwahrscheinlichkeit von {rainPercent}% liegt innerhalb Ihrer {rainThresholdPercent}%.',
    'liked-first': 'Ihnen gefällt {look}, daher kommt dieser Look zuerst.',
    'stale-selection':
      'Ihr vorheriger Look passt nicht mehr zu diesen Einstellungen, daher wird {look} gezeigt.',
    'swap-applied': 'Gewählt als {category}: {garment}.',
    'swap-ignored': 'Ihr Tausch in der Kategorie {category} ruht: {cause}.',
    'still-suits':
      '{control} geändert, das Outfit bleibt: Es passt weiterhin zu den Bedingungen.',
    'all-disliked':
      'Jeder Look, der zu diesen Einstellungen passt, ist als „Nicht für mich“ markiert.',
    'no-eligible': 'Kollektion {collection}: Kein Look passt zu diesen Einstellungen.',
  },
  garments: {
    'fleece-zip': {
      name: 'Fleecejacke mit Reißverschluss',
      description: 'Salbeigrüne Fleecejacke mit durchgehendem Reißverschluss.',
    },
    'denim-jacket': {
      name: 'Jeansjacke',
      description: 'Mittelblaue Jeansjacke mit Brusttaschen.',
    },
    'cropped-blazer': {
      name: 'Kurzblazer',
      description: 'Anthrazitfarbener Wollblazer mit goldenen Revers.',
    },
    'wool-overcoat': {
      name: 'Wollmantel',
      description: 'Marineblauer knielanger Wollmantel mit camelfarbenen Knöpfen.',
    },
    'puffer-jacket': {
      name: 'Steppjacke',
      description: 'Schwarze gesteppte Daunenjacke.',
    },
    'trench-coat': {
      name: 'Trenchcoat',
      description: 'Klassischer camelfarbener Trenchcoat mit Gürtel.',
    },
    'rain-shell': {
      name: 'Regenjacke',
      description:
        'Leichte petrolfarbene Regenjacke mit Kapuze und gelbem Reißverschluss.',
    },
    'oxford-shirt': {
      name: 'Oxfordhemd',
      description: 'Hellblaues Button-down-Hemd aus Baumwolle.',
    },
    'merino-sweater': {
      name: 'Merinopullover',
      description: 'Bordeauxroter Pullover aus Merinowolle mit Rundhalsausschnitt.',
    },
    'cotton-tee': {
      name: 'Baumwoll-T-Shirt',
      description: 'Kurzärmeliges T-Shirt aus cremeweißer Baumwolle.',
    },
    'cable-knit': {
      name: 'Zopfstrickpullover',
      description: 'Cremefarbener grober Zopfstrickpullover aus Wolle.',
    },
    'silk-blouse': {
      name: 'Seidenbluse',
      description: 'Zartrosa Seidenbluse mit V-Ausschnitt.',
    },
    'polo-shirt': {
      name: 'Poloshirt',
      description: 'Waldgrünes Poloshirt aus Baumwolle mit weißem Kragen.',
    },
    'flannel-shirt': {
      name: 'Flanellhemd',
      description: 'Ziegelrotes langärmeliges Flanellhemd.',
    },
    'linen-shirt': {
      name: 'Leinenhemd',
      description: 'Sandfarbenes langärmeliges Leinenhemd.',
    },
    'dark-jeans': {
      name: 'Indigo-Jeans',
      description: 'Dunkle Indigo-Jeans mit geradem Bein.',
    },
    'wool-trousers': {
      name: 'Wollhose',
      description: 'Anthrazitfarbene, maßgeschneiderte Wollhose.',
    },
    chinos: { name: 'Chinos', description: 'Khakifarbene Chinohose aus Baumwolle.' },
    'linen-trousers': {
      name: 'Leinenhose',
      description: 'Helle haferfarbene Leinenhose.',
    },
    'midi-skirt': {
      name: 'Midirock',
      description: 'Pflaumenfarbener Midirock in A-Linie.',
    },
    'pleated-skirt': {
      name: 'Faltenrock',
      description: 'Schiefergrauer Faltenrock aus Wolle.',
    },
    'tailored-shorts': {
      name: 'Stoffshorts',
      description: 'Olivfarbene Baumwollshorts ohne Bundfalten.',
    },
    'knit-dress': {
      name: 'Strickkleid',
      description: 'Schokobraunes langärmeliges Strickkleid.',
    },
    'wrap-dress': {
      name: 'Wickelkleid',
      description: 'Petrolblaues Wickelkleid mit Bindegürtel.',
    },
    sundress: {
      name: 'Sommerkleid',
      description: 'Ringelblumengelbes Sommerkleid aus Baumwolle mit dünnen Trägern.',
    },
    'leather-boots': {
      name: 'Lederstiefel',
      description: 'Braune wasserabweisende Lederstiefel.',
    },
    'ankle-boots': {
      name: 'Stiefeletten',
      description: 'Schwarze Stiefeletten aus Leder.',
    },
    'white-sneakers': {
      name: 'Sneaker in Weiß',
      description: 'Weiße Low-Top-Sneaker mit grauen Sohlen.',
    },
    loafers: { name: 'Loafer', description: 'Braune Penny-Loafer aus Leder.' },
    sandals: { name: 'Sandalen', description: 'Hellbraune Riemchensandalen aus Leder.' },
    'wool-scarf': {
      name: 'Wollschal',
      description: 'Roter Wollschal mit cremefarbenen Fransen.',
    },
    beanie: {
      name: 'Mütze',
      description: 'Schieferblaue Strickmütze mit cremefarbenem Streifen.',
    },
    'canvas-tote': {
      name: 'Canvas-Tasche',
      description: 'Naturfarbene Canvas-Tragetasche mit braunen Henkeln.',
    },
    sunglasses: {
      name: 'Sonnenbrille',
      description: 'Schwarze Sonnenbrille mit goldenen Bügeln.',
    },
  },
  looks: {
    'winter-knit': {
      name: 'Winterstrick',
      description: 'Strickkleid, Stiefeletten und Wollschal.',
    },
    'city-wool': {
      name: 'Wolle in der Stadt',
      description: 'Merinopullover, Wollhose und Lederstiefel.',
    },
    'weekend-flannel': {
      name: 'Wochenend-Flanell',
      description: 'Flanellhemd, Indigo-Jeans, Lederstiefel und Mütze.',
    },
    'soft-pleats': {
      name: 'Weiche Falten',
      description: 'Zopfstrickpullover, Faltenrock und Stiefeletten.',
    },
    'office-oxford': {
      name: 'Oxford im Büro',
      description: 'Oxfordhemd, Indigo-Jeans und Loafer.',
    },
    'silk-midi': {
      name: 'Seide und Midi',
      description: 'Seidenbluse, Midirock und weiße Sneaker.',
    },
    'easy-chinos': {
      name: 'Lässige Chinos',
      description: 'Oxfordhemd, Chinos und weiße Sneaker.',
    },
    'summer-linen': {
      name: 'Sommerleinen',
      description: 'Baumwoll-T-Shirt, Leinenhose, Sandalen und Sonnenbrille.',
    },
    'sun-dress': {
      name: 'Sonnentag',
      description: 'Sommerkleid, Sandalen und Canvas-Tasche.',
    },
    'wrap-day': {
      name: 'Wickeltag',
      description: 'Wickelkleid, Loafer und Canvas-Tasche.',
    },
    'court-polo': {
      name: 'Tennis-Polo',
      description: 'Poloshirt, Stoffshorts und weiße Sneaker.',
    },
    'breezy-linen': {
      name: 'Luftiges Leinen',
      description: 'Leinenhemd, Leinenhose, Loafer und Canvas-Tasche.',
    },
  },
}
