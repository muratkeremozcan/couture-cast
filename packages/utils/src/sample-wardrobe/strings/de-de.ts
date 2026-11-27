// Story 6.16 guest preview strings for de-DE. Keys mirror en-us.ts exactly.
import type { GuestPreviewStrings } from './en-us'

export const deDE: GuestPreviewStrings = {
  styleIdeas: {
    heading: 'Wähle deinen Stil (freiwillig)',
    style: 'Stil',
    palette: 'Farben',
    texture: 'Textur',
    any: 'Beliebig',
    active: 'Sportlich',
    chic: 'Schick',
    cozy: 'Gemütlich',
    neutral: 'Neutral',
    colorful: 'Farbenfroh',
    smooth: 'Glatt',
    textured: 'Strukturiert',
    save: 'Beispieloutfit speichern',
    update: 'Gespeichertes Outfit aktualisieren',
    saved: 'Auf diesem Gerät gespeichert',
    remove: '{look} entfernen',
    illustrations: 'Zeichnungen von Kleidung',
    inspiration: 'Outfitideen',
  },
  firstUse: {
    cleanupFallback:
      'Der Hintergrund bleibt auf deinem Foto. Wir konnten das Teil nicht ausschneiden.',
    replaceGarment: 'Anderes Foto wählen',
    discardPhoto: 'Dieses Foto verwerfen?',
    keepEditing: 'Weiter bearbeiten',
    discard: 'Verwerfen',
    today: 'Dein heutiges Outfit',
    addGarment: 'Teil hinzufügen',
    setCity: 'Stadt festlegen',
    wardrobeFailed: 'Deine Garderobe konnte nicht geladen werden.',
    staleWardrobe:
      'Gespeicherte Kleidungsstücke werden angezeigt. Aktualisierung fehlgeschlagen.',
    backToOutfit: 'Zurück zum Outfit',
    checkGarment: 'Teil prüfen',
    backToWardrobe: 'Zum Kleiderschrank',
    outfitFailed: 'Das heutige Outfit konnte nicht geladen werden.',
    sampleEntry: 'Beispieloutfits testen',
    outfitIdea: 'Outfitidee',
  },
  chrome: {
    entry: 'Looks testen',
    exampleLabel: 'Beispiel',
    welcomeHeading: 'Outfits für das Wetter von heute',
    welcomeBody:
      'Probiere ein paar Beispieloutfits. Melde dich an, um Outfits aus deinem Schrank zu sehen.',
    sampleLabel:
      'Das sind Beispieloutfits und Beispielwetter. Dein Schrank und das aktuelle Wetter bleiben getrennt.',
    supporting: 'Probiere eine neue Einstellung.',
    conversion:
      'Erstelle ein Konto, um deine Kleidung hinzuzufügen. Nach der Anmeldung kannst du deine Wettereinstellungen behalten. Deine Beispielteile und Likes bleiben hier.',
    createAccount: 'Konto erstellen',
    signIn: 'Anmelden',
    openWardrobe: 'Ihren Kleiderschrank öffnen',
    signOut: 'Abmelden',
    resetPreview: 'Vorschau zurücksetzen',
    exitPreview: 'Vorschau beenden',
    storageUnavailable: 'Diese Vorschau wird beim Schließen eventuell zurückgesetzt.',
    connectionNeeded: 'Für die Kontoerstellung ist eine Internetverbindung nötig.',
    navLabel: 'Bereiche der Vorschau',
    navOutfit: 'Outfit',
    navWardrobe: 'Beispielschrank',
    navPreferences: 'Einstellungen',
    close: 'Schließen',
    checkingSession: 'Sitzung wird geprüft…',
    sessionUnavailable:
      'Ihre Sitzung konnte nicht bestätigt werden. Sie bleiben auf diesem Gerät angemeldet.',
    retry: 'Erneut versuchen',
  },
  gate: {
    heading: 'Prüfe dein Alter',
    body: 'Gib dein Geburtsdatum ein. Nur dieses Gerät prüft es. Die App speichert und sendet es nicht.',
    field: 'Geburtsdatum (YYYY-MM-DD)',
    submit: 'Weiter',
    selfReported:
      'Wir verwenden das Alter, das du angibst. Wir prüfen deinen Ausweis nicht.',
    underage: 'Sie müssen mindestens 13 Jahre alt sein',
    invalid: 'Geben Sie Ihr Geburtsdatum im Format YYYY-MM-DD ein',
    exit: 'Zur Startseite',
  },
  outfit: {
    heading: 'Beispiel',
    whyThisWorks: 'Darum passt es',
    tryAnother: 'Nächster Look',
    noAlternative:
      'Nur dieses Outfit passt. Probiere anderes Wetter oder ändere eine Einstellung.',
    browseWardrobe: 'Beispielschrank ansehen',
    swap: '{category} tauschen',
    swapTitle: '{category} auswählen',
    current: 'Aktuell',
    weatherFit: {
      exact: 'Passt am besten zum Wetter',
      nearby: 'Passt auch',
    },
    showMore: 'Mehr anzeigen',
    noSuitableAlternative: 'Kein anderes Teil passt zu diesem Outfit.',
    undoSwaps: 'Tausch rückgängig machen',
    swapped: 'Jetzt im Outfit: {garment}.',
    updated: 'Outfit aktualisiert: {look}.',
    allDisliked: 'Du hast bei allen passenden Outfits „Nicht für mich“ gewählt.',
    noEligible: 'Kein Outfit passt. Wähle eine andere Gruppe oder ändere das Wetter.',
    reviewChoices: 'Auswahl prüfen',
    resetChoices: 'Auswahl zurücksetzen',
  },
  preferences: {
    heading: 'Deine Einstellungen',
    weather: 'Beispielwetter',
    weatherDetail: 'Gefühlt {temperature}. Wind: {windSpeed} m/s. {rainPercent}.',
    thermal: 'Wie warm du es magst',
    wind: 'Wie du Wind empfindest',
    rain: 'Wann du dich auf Regen einstellst',
    collection: 'Kollektion',
  },
  feedback: {
    heading: 'Sag, was dir gefällt',
    body: 'Outfits, die dir gefallen, rücken nach oben. Mit „Nicht für mich“ blendest du sie aus, bis du deine Auswahl löschst.',
    like: 'Gefällt mir',
    dislike: 'Nicht für mich',
    progress: '{reviewed} von {total} bewertet',
    previous: 'Vorheriger Look',
    next: 'Nächster Look',
    skip: 'Vorerst überspringen',
  },
  wardrobe: {
    heading: 'Beispielschrank',
    category: 'Kategorie',
    useItem: 'Dieses Teil verwenden',
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
    garmentHeading: 'Deine Kleidung hinzufügen',
    canSave: 'Nach der Anmeldung speicherbar',
    canSaveBody: 'Deine drei Vorlieben fürs Wetter.',
    previewOnly: 'Nur in der Vorschau',
    previewOnlyBody:
      'Beispielteile, Outfits, Likes, der Kollektionsfilter und getauschte Teile.',
    stillRequired: 'Weiterhin erforderlich',
    stillRequiredBody: 'Kontoeinrichtung und bestätigte Anmeldung.',
    backToPreview: 'Zurück zur Vorschau',
    signInToContinue: 'Anmelden',
  },
  review: {
    heading: 'Diese Einstellungen behalten?',
    account: 'Ihr Konto',
    proposed: 'Aus der Vorschau',
    use: 'Vorschau-Einstellungen übernehmen',
    keep: 'Meine Einstellungen behalten',
    saving: 'Wird gespeichert…',
    saved: 'Ihre Komforteinstellungen sind gespeichert.',
    kept: 'Ihre Kontoeinstellungen sind unverändert.',
    rejected:
      'Ihr Konto kann noch keine Einstellungen speichern. Zuerst ist eine Altersprüfung nötig.',
    failed:
      'Ihre Einstellungen konnten nicht gespeichert werden. Ihre Auswahl bleibt erhalten, Sie können es erneut versuchen.',
    loadFailed: 'Ihre Kontoeinstellungen konnten nicht geladen werden.',
    continue: 'Weiter',
  },
  values: {
    rainChance: {
      none: 'Kein Regen in Sicht',
      possible: 'Es kann regnen',
      likely: 'Es regnet wohl',
    },
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
      high: 'Ich packe oft',
    },
    weather: {
      'cool-windy': 'Kühl und windig',
      'mild-dry': 'Mild und trocken',
      'warm-rainy': 'Warm und regnerisch',
      'cool-rainy': 'Kühl und regnerisch',
      'mild-rainy': 'Mild und regnerisch',
      'warm-dry': 'Warm und trocken',
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
    garmentType: {
      tank: 'Ärmellose Tops',
      'crop-top': 'Kurze Tops',
      leggings: 'Leggings',
      tee: 'T-Shirts',
      shirt: 'Hemden',
      sweater: 'Pullover',
      blouse: 'Blusen',
      polo: 'Poloshirts',
      trousers: 'Hosen',
      jeans: 'Jeans',
      shorts: 'Shorts',
      skirt: 'Röcke',
      dress: 'Kleider',
      coat: 'Mäntel',
      trench: 'Trenchcoats',
      jacket: 'Jacken',
      puffer: 'Steppjacken',
      shell: 'Regenjacken',
      blazer: 'Blazer',
      fleece: 'Fleecejacken',
      boots: 'Stiefel',
      sneakers: 'Sneaker',
      loafers: 'Loafer',
      sandals: 'Sandalen',
      scarf: 'Schals',
      beanie: 'Strickmützen',
      tote: 'Stofftaschen',
      sunglasses: 'Sonnenbrillen',
      tights: 'Strumpfhosen',
      socks: 'Socken',
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
    'layer-rain': '{rainPercent}. {garment} hält dich trocken.',
    'no-layer': 'Es ist {range} genug, um auf eine Außenschicht zu verzichten.',
    'layer-unavailable':
      'Diese Beispielgarderobe hat keine Außenschicht mit dem Schutz, den dieses Wetter braucht.',
    'wind-within':
      'Wind mit {windSpeed} m/s liegt innerhalb Ihrer Toleranz von {windThreshold} m/s.',
    'rain-within': '{rainPercent}. Du kannst die Regenkleidung daheim lassen.',
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
    'lined-blazer': {
      name: 'Gefütterter Blazer',
      description: 'Schieferblauer Blazer aus dichter Wolle.',
    },
    camisole: {
      name: 'Top aus Seide',
      description: 'Rosafarbene Seide mit schmalen Trägern.',
    },
    tank: {
      name: 'Geripptes Tanktop',
      description: 'Salbeigrünes Top aus gerippter Baumwolle.',
    },
    'crop-top': {
      name: 'Kurzes Baumwolltop',
      description: 'Ein kurzes fliederfarbenes T-Shirt.',
    },
    'maxi-skirt': {
      name: 'Maxirock aus Leinen',
      description: 'Ein langer blauer Rock aus Leinen.',
    },
    leggings: {
      name: 'Stretchleggings',
      description: 'Dunkelgraue Leggings mit breitem Bund.',
    },
    'moto-jacket': {
      name: 'Bikerjacke aus Leder',
      description: 'Schwarzes Leder mit schrägem Reißverschluss.',
    },
    'moto-boots': {
      name: 'Bikerstiefel',
      description: 'Dunkle Lederstiefel mit Schnalle.',
    },
    'knee-boots': {
      name: 'Kniehohe Stiefel',
      description: 'Hohe Stiefel aus braunem Leder.',
    },
    'ribbed-knit': {
      name: 'Rippenpullover',
      description: 'Cremefarbener Baumwollpullover in Rippenstrick.',
    },
    'ribbed-socks': {
      name: 'Rippensocken',
      description: 'Taupefarbene Baumwollsocken mit Rippbündchen.',
    },
    'mini-skirt': {
      name: 'Minirock',
      description: 'Kurzer Wollrock in gedecktem Pflaumenton.',
    },
    'opaque-tights': {
      name: 'Blickdichte Strumpfhose',
      description: 'Dunkle Strumpfhose für kühles Wetter.',
    },
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
    'weekend-layers': {
      name: 'Schichten fürs Wochenende',
      description: 'Rippstrick, Leggings, Bikerstiefel und Socken.',
    },
    'skirt-and-boots': {
      name: 'Rock und hohe Stiefel',
      description: 'Pullover, Minirock, Strumpfhose und kniehohe Stiefel.',
    },
    'summer-skirt': {
      name: 'Sommerrock',
      description: 'Seidentop, langer Rock und Sandalen.',
    },
    'sunny-weekend': {
      name: 'Sonniges Wochenende',
      description: 'Tanktop, Leinenhose und Sandalen.',
    },
    'midi-and-sneakers': {
      name: 'Midirock und Sneaker',
      description: 'Kurzes Top, Midirock und weiße Sneaker.',
    },
    'mini-and-tights': {
      name: 'Minirock und Strumpfhose',
      description:
        'Rippenpullover, pflaumenfarbener Minirock, blickdichte Strumpfhose und Stiefeletten.',
    },
    'winter-knit': {
      name: 'Winterstrick',
      description: 'Strickkleid, Stiefeletten und Wollschal.',
    },
    'city-wool': {
      name: 'Wolle in der Stadt',
      description: 'Merinopullover, Wollhose und Lederstiefel.',
    },
    'weekend-flannel': {
      name: 'Wochenend-Outfit',
      description:
        'Ein Flanellhemd, dunkle Jeans, Stiefel und eine Mütze fürs Wochenende.',
    },
    'soft-pleats': {
      name: 'Weiche Falten',
      description: 'Zopfstrickpullover, Faltenrock und Stiefeletten.',
    },
    'office-oxford': {
      name: 'Schultag',
      description: 'Ein Hemd mit Knöpfen, dunkle Jeans und Loafer für die Schule.',
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
      description: 'Ein Wickelkleid, Loafer und eine Tasche zum Ausgehen.',
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
