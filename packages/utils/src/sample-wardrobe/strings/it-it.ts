// Story 6.16 guest preview strings for it-IT. Keys mirror en-us.ts exactly.
import type { GuestPreviewStrings } from './en-us'

export const itIT: GuestPreviewStrings = {
  chrome: {
    entry: 'Prova un guardaroba di esempio',
    exampleLabel: 'Esempio',
    welcomeHeading: 'Outfit per il meteo di oggi',
    welcomeBody:
      'Prova prima un guardaroba di esempio, oppure accedi per vedere outfit con i tuoi capi.',
    sampleLabel:
      'Guardaroba di esempio. Meteo e outfit sono esempi, non il tuo armadio né previsioni in tempo reale.',
    supporting: 'Cambia una preferenza per vedere come risponde questo esempio.',
    conversion:
      "Crea un account per aggiungere i tuoi vestiti. Dopo l'accesso puoi scegliere di salvare le tue preferenze di comfort. I capi di esempio e i Mi piace dell'anteprima restano in questa anteprima.",
    createAccount: 'Crea account',
    signIn: 'Accedi',
    openWardrobe: 'Apri il tuo guardaroba',
    signOut: 'Esci',
    resetPreview: 'Reimposta anteprima',
    exitPreview: "Esci dall'anteprima",
    storageUnavailable: 'Questa anteprima potrebbe azzerarsi quando la chiudi.',
    connectionNeeded: 'Per creare un account serve una connessione a internet.',
    navLabel: "Sezioni dell'anteprima",
    navOutfit: 'Outfit',
    navWardrobe: 'Guardaroba di esempio',
    navPreferences: 'Preferenze',
    close: 'Chiudi',
    checkingSession: 'Verifica della sessione…',
    sessionUnavailable:
      "Non è stato possibile confermare la tua sessione. L'accesso su questo dispositivo resta attivo.",
    retry: 'Riprova',
  },
  gate: {
    heading: 'Prima di provare il guardaroba di esempio',
    body: 'Inserisci la tua data di nascita. Viene verificata solo su questo dispositivo e non viene salvata né inviata.',
    field: 'Data di nascita (YYYY-MM-DD)',
    submit: 'Continua',
    selfReported:
      "Questo è un controllo dell'età autodichiarata, non una verifica dell'identità.",
    underage: 'Devi avere almeno 13 anni',
    invalid: 'Inserisci la data di nascita nel formato YYYY-MM-DD',
    exit: 'Torna alla home',
  },
  outfit: {
    heading: 'Outfit di esempio',
    whyThisWorks: 'Perché funziona',
    tryAnother: 'Prova un altro look',
    noAlternative:
      "Questo è l'unico look di esempio adatto a queste impostazioni. Prova un altro meteo di esempio o un'altra impostazione di comfort.",
    browseWardrobe: 'Sfoglia il guardaroba di esempio',
    swap: 'Cambia {category}',
    swapTitle: 'Scegli: {category}',
    current: 'Attuale',
    noSuitableAlternative: 'Nessuna alternativa adatta in questo guardaroba di esempio.',
    undoSwaps: 'Annulla i cambi',
    swapped: "{garment} ora fa parte dell'outfit.",
    updated: 'Outfit aggiornato: {look}.',
    allDisliked: 'Hai segnato come Non fa per me ogni look adatto a queste impostazioni.',
    noEligible:
      "Nessun look di esempio in questa collezione è adatto a queste impostazioni. Prova un'altra collezione o un altro meteo di esempio.",
    reviewChoices: 'Rivedi le scelte',
    resetChoices: 'Reimposta le scelte',
  },
  preferences: {
    heading: 'Preferenze',
    weather: 'Meteo di esempio',
    weatherDetail:
      'Esempio: temperatura percepita {temperature}, vento {windSpeed} m/s, probabilità di pioggia {rainPercent}%.',
    thermal: 'Comfort termico',
    wind: 'Tolleranza al vento',
    rain: 'Preparazione alla pioggia',
    collection: 'Collezione',
  },
  feedback: {
    heading: 'Valuta i look di esempio (facoltativo)',
    body: 'I Mi piace fanno salire un look. I look segnati come Non fa per me vengono saltati finché non li azzeri.',
    like: 'Mi piace',
    dislike: 'Non fa per me',
    progress: '{reviewed} di {total} valutati',
    previous: 'Look precedente',
    next: 'Look successivo',
    skip: 'Salta per ora',
  },
  wardrobe: {
    heading: 'Guardaroba di esempio',
    category: 'Categoria',
    allCategories: 'Tutte',
    details: 'Dettagli',
    material: 'Materiale',
    comfortRange: 'Fascia di comfort',
    windResistant: 'Antivento',
    waterResistant: 'Idrorepellente',
    yes: 'Sì',
    no: 'No',
    backToOutfit: "Torna all'outfit",
    empty: 'Nessun capo di esempio in questa categoria per questa collezione.',
    count: 'Capi di esempio: {count}',
  },
  conversionDetail: {
    garmentHeading: 'Aggiungi un tuo capo',
    canSave: "Si può salvare dopo l'accesso",
    canSaveBody: 'Le tue tre impostazioni di comfort.',
    previewOnly: 'Solo anteprima',
    previewOnlyBody:
      'Capi di esempio, outfit, Mi piace, filtro della collezione e cambi.',
    stillRequired: 'Ancora necessario',
    stillRequiredBody: "Configurazione dell'account e accesso verificato.",
    backToPreview: "Torna all'anteprima",
    signInToContinue: 'Accedi per continuare',
  },
  review: {
    heading: 'Usare queste preferenze di comfort?',
    account: 'Il tuo account',
    proposed: "Dall'anteprima",
    use: "Usa le impostazioni dell'anteprima",
    keep: "Mantieni le preferenze dell'account",
    saving: 'Salvataggio…',
    saved: 'Le tue preferenze di comfort sono salvate.',
    kept: 'Le preferenze del tuo account non sono cambiate.',
    rejected:
      'Il tuo account non può ancora salvare le preferenze. Prima serve una verifica dell’età.',
    failed:
      'Non è stato possibile salvare le tue preferenze. La tua scelta resta, così puoi riprovare.',
    loadFailed: 'Non è stato possibile caricare le preferenze del tuo account.',
    continue: 'Continua',
  },
  values: {
    runsColdWarm: {
      cold: 'Tendo a sentire freddo',
      neutral: 'Nella media',
      warm: 'Tendo a sentire caldo',
    },
    windTolerance: {
      low: 'Il vento mi dà fastidio',
      medium: "Un po' di vento va bene",
      high: 'Il vento raramente mi dà fastidio',
    },
    precipPreparedness: {
      low: 'Solo con pioggia forte',
      medium: 'Quando la pioggia è probabile',
      high: 'Con qualsiasi probabilità di pioggia',
    },
    weather: {
      'cool-windy': 'Fresco e ventoso',
      'mild-dry': 'Mite e asciutto',
      'warm-rainy': 'Caldo e piovoso',
    },
    collection: {
      all: 'Tutti gli esempi',
      womenswear: 'Donna',
      menswear: 'Uomo',
    },
    category: {
      top: 'parte superiore',
      bottom: 'parte inferiore',
      outerwear: 'capospalla',
      dress: 'abito',
      shoes: 'scarpe',
      accessory: 'accessorio',
    },
    categoryTitle: {
      top: 'Parti superiori',
      bottom: 'Parti inferiori',
      outerwear: 'Capispalla',
      dress: 'Abiti',
      shoes: 'Scarpe',
      accessory: 'Accessori',
    },
    material: {
      cotton: 'Cotone',
      wool: 'Lana',
      linen: 'Lino',
      leather: 'Pelle',
      denim: 'Denim',
      fleece: 'Pile',
      synthetic: 'Sintetico',
      down: 'Piuma',
      silk: 'Seta',
    },
    range: {
      cold: 'freddo',
      cool: 'fresco',
      mild: 'mite',
      warm: 'caldo',
      hot: 'molto caldo',
    },
    control: {
      weather: 'meteo di esempio',
      runsColdWarm: 'comfort termico',
      windTolerance: 'tolleranza al vento',
      precipPreparedness: 'preparazione alla pioggia',
    },
    swapCause: {
      unknown: 'quel capo non è in questo guardaroba di esempio',
      category: "quel capo appartiene a un'altra categoria",
      collection: 'quel capo non è in questa collezione',
      range: 'quel capo non è adatto a questa temperatura',
      protection: 'quel capo non dà la protezione che serve con questo tempo',
    },
  },
  explanation: {
    weather: '{weather} (esempio), temperatura percepita {feelsLike}.',
    'thermal-neutral': 'Con un comfort nella media, corrisponde a tempo {range}.',
    'thermal-adjusted':
      'Tendi a percepire il tempo più {runsColdWarm}, quindi conta come {adjustedFeelsLike}: tempo {range}.',
    'layer-cold': '{garment} aggiunge calore sotto {threshold}.',
    'layer-wind':
      '{garment} blocca il vento a {windSpeed} m/s, oltre la tua tolleranza di {windThreshold} m/s.',
    'layer-rain':
      "{garment} ti tiene all'asciutto: probabilità di pioggia {rainPercent}%, sopra la tua soglia ({rainThresholdPercent}%).",
    'no-layer': 'Con tempo {range} puoi fare a meno del capospalla.',
    'layer-unavailable':
      'Questo guardaroba di esempio non ha un capospalla con la protezione che serve con questo tempo.',
    'wind-within':
      'Vento a {windSpeed} m/s: entro la tua tolleranza di {windThreshold} m/s.',
    'rain-within':
      'Probabilità di pioggia {rainPercent}%: entro la tua soglia ({rainThresholdPercent}%).',
    'liked-first': 'Hai messo Mi piace a {look}, quindi compare per primo.',
    'stale-selection':
      'Il look scelto prima non è più adatto a queste impostazioni, quindi ti mostriamo {look}.',
    'swap-applied': 'Hai scelto {garment} per la categoria {category}.',
    'swap-ignored': 'Il cambio nella categoria {category} è messo da parte: {cause}.',
    'still-suits':
      "Impostazione cambiata: {control}. L'outfit resta lo stesso perché è ancora adatto alle condizioni.",
    'all-disliked':
      'Ogni look adatto a queste impostazioni è segnato come Non fa per me.',
    'no-eligible':
      'Nessun look adatto a queste impostazioni nella collezione: {collection}.',
  },
  garments: {
    'fleece-zip': {
      name: 'Giacca in pile con zip',
      description: 'Giacca in pile verde salvia con zip intera.',
    },
    'denim-jacket': {
      name: 'Giacca di jeans',
      description: 'Giacca di jeans blu medio con tasche sul petto.',
    },
    'cropped-blazer': {
      name: 'Blazer corto',
      description: 'Blazer di lana antracite con revers dorati.',
    },
    'wool-overcoat': {
      name: 'Cappotto di lana',
      description: 'Cappotto di lana blu navy al ginocchio con bottoni color cammello.',
    },
    'puffer-jacket': { name: 'Piumino', description: 'Piumino trapuntato nero.' },
    'trench-coat': {
      name: 'Trench',
      description: 'Trench classico color cammello con cintura.',
    },
    'rain-shell': {
      name: 'Giacca antipioggia',
      description: 'Giacca antipioggia leggera verde acqua con cappuccio e zip gialla.',
    },
    'oxford-shirt': {
      name: 'Camicia Oxford',
      description: 'Camicia button-down di cotone azzurro chiaro.',
    },
    'merino-sweater': {
      name: 'Maglione di merino',
      description: 'Maglione girocollo bordeaux in lana merino.',
    },
    'cotton-tee': {
      name: 'T-shirt di cotone',
      description: 'T-shirt a maniche corte di cotone bianco sporco.',
    },
    'cable-knit': {
      name: 'Maglione a trecce',
      description: 'Maglione di lana a trecce grosse color panna.',
    },
    'silk-blouse': {
      name: 'Camicetta di seta',
      description: 'Camicetta di seta rosa cipria con scollo a V.',
    },
    'polo-shirt': {
      name: 'Polo',
      description: 'Polo di cotone verde bosco con colletto bianco.',
    },
    'flannel-shirt': {
      name: 'Camicia di flanella',
      description: 'Camicia di flanella rosso mattone a maniche lunghe.',
    },
    'linen-shirt': {
      name: 'Camicia di lino',
      description: 'Camicia di lino color sabbia a maniche lunghe.',
    },
    'dark-jeans': {
      name: 'Jeans scuri',
      description: 'Jeans a gamba dritta indaco scuro.',
    },
    'wool-trousers': {
      name: 'Pantaloni di lana',
      description: 'Pantaloni sartoriali di lana antracite.',
    },
    chinos: { name: 'Chino', description: 'Pantaloni chino di cotone color kaki.' },
    'linen-trousers': {
      name: 'Pantaloni di lino',
      description: 'Pantaloni di lino color avena chiaro.',
    },
    'midi-skirt': { name: 'Gonna midi', description: 'Gonna midi svasata color prugna.' },
    'pleated-skirt': {
      name: 'Gonna a pieghe',
      description: 'Gonna di lana a pieghe grigio ardesia.',
    },
    'tailored-shorts': {
      name: 'Shorts sartoriali',
      description: 'Shorts di cotone verde oliva senza pinces.',
    },
    'knit-dress': {
      name: 'Abito in maglia',
      description: 'Abito in maglia marrone cioccolato a maniche lunghe.',
    },
    'wrap-dress': {
      name: 'Abito a portafoglio',
      description: 'Abito a portafoglio blu petrolio con cintura da annodare.',
    },
    sundress: {
      name: 'Prendisole',
      description: 'Prendisole di cotone giallo calendula con spalline sottili.',
    },
    'leather-boots': {
      name: 'Stivali di pelle',
      description: "Stivali di pelle marroni resistenti all'acqua.",
    },
    'ankle-boots': { name: 'Stivaletti', description: 'Stivaletti di pelle neri.' },
    'white-sneakers': {
      name: 'Sneaker bianche',
      description: 'Sneaker basse bianche con suola grigia.',
    },
    loafers: { name: 'Mocassini', description: 'Mocassini penny di pelle marrone.' },
    sandals: {
      name: 'Sandali',
      description: 'Sandali di pelle color cuoio con cinturini.',
    },
    'wool-scarf': {
      name: 'Sciarpa di lana',
      description: 'Sciarpa di lana rossa con frange color panna.',
    },
    beanie: {
      name: 'Berretto',
      description: 'Berretto in maglia blu ardesia con fascia color panna.',
    },
    'canvas-tote': {
      name: 'Tote di tela',
      description: 'Borsa tote di tela naturale con manici marroni.',
    },
    sunglasses: {
      name: 'Occhiali da sole',
      description: 'Occhiali da sole neri con aste dorate.',
    },
  },
  looks: {
    'winter-knit': {
      name: 'Maglia invernale',
      description: 'Abito in maglia, stivaletti e sciarpa di lana.',
    },
    'city-wool': {
      name: 'Lana in città',
      description: 'Maglione di merino, pantaloni di lana e stivali di pelle.',
    },
    'weekend-flannel': {
      name: 'Flanella del weekend',
      description: 'Camicia di flanella, jeans scuri, stivali di pelle e berretto.',
    },
    'soft-pleats': {
      name: 'Pieghe morbide',
      description: 'Maglione a trecce, gonna a pieghe e stivaletti.',
    },
    'office-oxford': {
      name: 'Oxford da ufficio',
      description: 'Camicia Oxford, jeans scuri e mocassini.',
    },
    'silk-midi': {
      name: 'Seta e midi',
      description: 'Camicetta di seta, gonna midi e sneaker bianche.',
    },
    'easy-chinos': {
      name: 'Chino comodi',
      description: 'Camicia Oxford, chino e sneaker bianche.',
    },
    'summer-linen': {
      name: 'Lino estivo',
      description: 'T-shirt di cotone, pantaloni di lino, sandali e occhiali da sole.',
    },
    'sun-dress': {
      name: 'Giornata di sole',
      description: 'Prendisole, sandali e borsa tote di tela.',
    },
    'wrap-day': {
      name: 'Wrap di giorno',
      description: 'Abito a portafoglio, mocassini e borsa tote di tela.',
    },
    'court-polo': {
      name: 'Polo sportiva',
      description: 'Polo, shorts sartoriali e sneaker bianche.',
    },
    'breezy-linen': {
      name: 'Lino leggero',
      description: 'Camicia di lino, pantaloni di lino, mocassini e borsa tote di tela.',
    },
  },
}
