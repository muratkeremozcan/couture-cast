// Story 6.16 guest preview strings for es-419. Keys mirror en-us.ts exactly.

import type { GuestPreviewStrings } from './en-us'

export const es419: GuestPreviewStrings = {
  styleIdeas: {
    heading: 'Elige tu estilo (opcional)',
    style: 'Estilo',
    palette: 'Colores',
    texture: 'Textura',
    any: 'Cualquiera',
    active: 'Deportivo',
    chic: 'Arreglado',
    cozy: 'Cómodo',
    neutral: 'Neutra',
    colorful: 'Colorida',
    smooth: 'Lisa',
    textured: 'Con textura',
    save: 'Guardar atuendo de ejemplo',
    update: 'Actualizar atuendo guardado',
    saved: 'Guardado en este dispositivo',
    remove: 'Quitar {look}',
    illustrations: 'Dibujos de ropa',
    inspiration: 'Ideas de conjuntos',
  },
  firstUse: {
    cleanupFallback: 'Tu foto sigue con el fondo. No pudimos recortar la prenda.',
    replaceGarment: 'Elige otra foto',
    discardPhoto: '¿Descartar esta foto?',
    keepEditing: 'Seguir editando',
    discard: 'Descartar',
    today: 'Tu atuendo de hoy',
    addGarment: 'Agrega una prenda',
    setCity: 'Configura tu ciudad',
    wardrobeFailed: 'No pudimos cargar tu clóset.',
    staleWardrobe: 'Mostramos tus prendas guardadas. No pudimos actualizarlas.',
    backToOutfit: 'Volver al conjunto',
    checkGarment: 'Revisa tu prenda',
    backToWardrobe: 'Volver al clóset',
    outfitFailed: 'No pudimos cargar el atuendo de hoy.',
    sampleEntry: 'Prueba conjuntos',
    outfitIdea: 'Idea de atuendo',
  },
  chrome: {
    entry: 'Prueba conjuntos',
    exampleLabel: 'Ejemplo',
    welcomeHeading: 'Atuendos para el clima de hoy',
    welcomeBody:
      'Prueba algunos conjuntos. Inicia sesión para ver conjuntos de tu clóset.',
    sampleLabel:
      'Estos son conjuntos y clima de ejemplo. Tu clóset y el clima actual se mantienen aparte.',
    supporting: 'Prueba otro ajuste.',
    conversion:
      'Crea una cuenta para agregar tu ropa. Cuando inicies sesión, puedes guardar tus ajustes de clima. Las prendas y los Me gusta de ejemplo se quedan aquí.',
    createAccount: 'Crear cuenta',
    signIn: 'Iniciar sesión',
    openWardrobe: 'Abrir tu guardarropa',
    signOut: 'Cerrar sesión',
    resetPreview: 'Restablecer vista previa',
    exitPreview: 'Salir de la vista previa',
    storageUnavailable: 'Esta vista previa puede reiniciarse al cerrarla.',
    connectionNeeded: 'Para crear una cuenta necesitas conexión a internet.',
    navLabel: 'Secciones de la vista previa',
    navOutfit: 'Atuendo',
    navWardrobe: 'Clóset de ejemplo',
    navPreferences: 'Preferencias',
    close: 'Cerrar',
    checkingSession: 'Verificando tu sesión…',
    sessionUnavailable:
      'No pudimos confirmar tu sesión. Tu sesión sigue iniciada en este dispositivo.',
    retry: 'Intentar de nuevo',
  },
  gate: {
    heading: 'Confirma tu edad',
    body: 'Escribe tu fecha de nacimiento. Este dispositivo la comprueba. La app no la guarda ni la envía.',
    field: 'Fecha de nacimiento (YYYY-MM-DD)',
    submit: 'Continuar',
    selfReported: 'Usamos la edad que nos das. No revisamos tu identificación.',
    underage: 'Debes tener 13 años o más',
    invalid: 'Ingresa tu fecha de nacimiento en formato YYYY-MM-DD',
    exit: 'Volver al inicio',
  },
  outfit: {
    heading: 'Atuendo de muestra',
    whyThisWorks: 'Por qué funciona',
    tryAnother: 'Probar otro conjunto',
    noAlternative: 'Solo este conjunto encaja. Prueba otro clima o cambia un ajuste.',
    browseWardrobe: 'Explora el clóset',
    swap: 'Cambiar {category}',
    swapTitle: 'Elegir {category}',
    current: 'Actual',
    noSuitableAlternative: 'Ninguna otra prenda va con este conjunto.',
    undoSwaps: 'Deshacer cambios',
    swapped: '{garment} ahora forma parte del atuendo.',
    updated: 'Atuendo actualizado: {look}.',
    allDisliked: 'Marcaste todos los conjuntos que encajan como «No es para mí».',
    noEligible: 'Ningún conjunto encaja. Prueba otro grupo o cambia el clima.',
    reviewChoices: 'Revisar elecciones',
    resetChoices: 'Restablecer elecciones',
  },
  preferences: {
    heading: 'Tus ajustes',
    weather: 'Clima de muestra',
    weatherDetail:
      'Se siente como {temperature}. Viento: {windSpeed} m/s. {rainPercent}.',
    thermal: 'Cómo sientes el frío',
    wind: 'Cómo sientes el viento',
    rain: 'Cuándo te preparas para la lluvia',
    collection: 'Colección',
  },
  feedback: {
    heading: 'Cuéntanos qué te gusta',
    body: 'Los conjuntos que te gustan suben. Si eliges «No es para mí», se oculta el conjunto hasta que borres tus elecciones.',
    like: 'Me gusta',
    dislike: 'No es para mí',
    progress: '{reviewed} de {total} revisados',
    previous: 'Conjunto anterior',
    next: 'Conjunto siguiente',
    skip: 'Omitir por ahora',
  },
  wardrobe: {
    heading: 'Clóset de ejemplo',
    category: 'Categoría',
    allCategories: 'Todas',
    details: 'Detalles',
    material: 'Material',
    comfortRange: 'Rango de comodidad',
    windResistant: 'Resistente al viento',
    waterResistant: 'Resistente al agua',
    yes: 'Sí',
    no: 'No',
    backToOutfit: 'Volver al atuendo',
    empty: 'No hay prendas de muestra en esta categoría para esta colección.',
    count: '{count} prendas de muestra',
  },
  conversionDetail: {
    garmentHeading: 'Agrega tu ropa',
    canSave: 'Se puede guardar después de iniciar sesión',
    canSaveBody: 'Tus tres ajustes de comodidad.',
    previewOnly: 'Solo en la vista previa',
    previewOnlyBody:
      'Prendas de muestra, atuendos, Me gusta, el filtro de colección y los cambios.',
    stillRequired: 'Aún se necesita',
    stillRequiredBody: 'Configuración de la cuenta e inicio de sesión verificado.',
    backToPreview: 'Volver a la vista previa',
    signInToContinue: 'Inicia sesión',
  },
  review: {
    heading: '¿Guardar estos ajustes?',
    account: 'Tu cuenta',
    proposed: 'De la vista previa',
    use: 'Usar ajustes de la vista previa',
    keep: 'Mantén mis ajustes',
    saving: 'Guardando…',
    saved: 'Tus preferencias de comodidad se guardaron.',
    kept: 'Las preferencias de tu cuenta no cambiaron.',
    rejected:
      'Tu cuenta todavía no puede guardar preferencias. Primero se necesita una verificación de edad.',
    failed:
      'No pudimos guardar tus preferencias. Tu elección se conserva para que puedas intentarlo de nuevo.',
    loadFailed: 'No pudimos cargar las preferencias de tu cuenta.',
    continue: 'Continuar',
  },
  values: {
    rainChance: {
      none: 'No se espera lluvia',
      possible: 'Puede llover',
      likely: 'Es probable que llueva',
    },
    runsColdWarm: {
      cold: 'Suelo sentir frío',
      neutral: 'Más o menos promedio',
      warm: 'Suelo sentir calor',
    },
    windTolerance: {
      low: 'El viento me molesta',
      medium: 'Un poco de viento está bien',
      high: 'El viento casi nunca me molesta',
    },
    precipPreparedness: {
      low: 'Solo con lluvia intensa',
      medium: 'Cuando es probable que llueva',
      high: 'Suelo llevarla',
    },
    weather: {
      'cool-windy': 'Fresco y ventoso',
      'mild-dry': 'Templado y seco',
      'warm-rainy': 'Cálido y lluvioso',
      'cool-rainy': 'Fresco y lluvioso',
      'mild-rainy': 'Templado y lluvioso',
      'warm-dry': 'Cálido y seco',
    },
    collection: {
      all: 'Todos los ejemplos',
      womenswear: 'Ropa de mujer',
      menswear: 'Ropa de hombre',
    },
    category: {
      top: 'prenda superior',
      bottom: 'prenda inferior',
      outerwear: 'capa exterior',
      dress: 'vestido',
      shoes: 'calzado',
      accessory: 'accesorio',
    },
    categoryTitle: {
      top: 'Prendas superiores',
      bottom: 'Prendas inferiores',
      outerwear: 'Capas exteriores',
      dress: 'Vestidos',
      shoes: 'Calzado',
      accessory: 'Accesorios',
    },
    material: {
      cotton: 'Algodón',
      wool: 'Lana',
      linen: 'Lino',
      leather: 'Cuero',
      denim: 'Mezclilla',
      fleece: 'Polar',
      synthetic: 'Sintético',
      down: 'Plumón',
      silk: 'Seda',
    },
    range: {
      cold: 'frío',
      cool: 'fresco',
      mild: 'templado',
      warm: 'cálido',
      hot: 'caluroso',
    },
    control: {
      weather: 'clima de muestra',
      runsColdWarm: 'comodidad térmica',
      windTolerance: 'tolerancia al viento',
      precipPreparedness: 'preparación para la lluvia',
    },
    swapCause: {
      unknown: 'esa prenda no está en este guardarropa de muestra',
      category: 'esa prenda pertenece a otra categoría',
      collection: 'esa prenda no está en esta colección',
      range: 'esa prenda no es adecuada para esta temperatura',
      protection: 'esa capa no da la protección que necesita este clima',
    },
  },
  explanation: {
    weather: 'Ejemplo: {weather}, con sensación térmica de {feelsLike}.',
    'thermal-neutral': 'Con una comodidad promedio, eso equivale a clima {range}.',
    'thermal-adjusted':
      'Como sueles sentir el clima más {runsColdWarm}, se toma como {adjustedFeelsLike}: clima {range}.',
    'layer-cold': '{garment} da abrigo por debajo de {threshold}.',
    'layer-wind':
      '{garment} bloquea un viento de {windSpeed} m/s, por encima de tu tolerancia de {windThreshold} m/s.',
    'layer-rain': '{rainPercent}. Lleva {garment} para no mojarte.',
    'no-layer': 'Con clima {range}, no hace falta una capa exterior.',
    'layer-unavailable':
      'Este guardarropa de ejemplo no tiene una capa exterior con la protección que pide este clima.',
    'wind-within':
      'Un viento de {windSpeed} m/s está dentro de tu tolerancia de {windThreshold} m/s.',
    'rain-within': '{rainPercent}. Puedes dejar la ropa para la lluvia en casa.',
    'liked-first': 'Te gustó {look}, así que aparece primero.',
    'stale-selection':
      'Tu conjunto anterior ya no es adecuado para esta configuración, así que se muestra {look}.',
    'swap-applied': 'Elegiste {garment} como {category}.',
    'swap-ignored': 'Tu cambio de {category} se dejó de lado: {cause}.',
    'still-suits':
      'Al cambiar el ajuste de {control}, se mantiene este atuendo: sigue siendo adecuado para las condiciones.',
    'all-disliked':
      'Todos los conjuntos adecuados para esta configuración están marcados como "No es para mí".',
    'no-eligible':
      'Ningún conjunto de "{collection}" es adecuado para esta configuración.',
  },
  garments: {
    'ribbed-knit': {
      name: 'Suéter acanalado',
      description: 'Suéter de algodón color crema con acabado acanalado.',
    },
    'ribbed-socks': {
      name: 'Calcetines acanalados',
      description: 'Calcetines de algodón color topo con puños acanalados.',
    },
    'mini-skirt': {
      name: 'Minifalda',
      description: 'Falda corta de lana en tono ciruela apagado.',
    },
    'opaque-tights': {
      name: 'Medias opacas',
      description: 'Medias oscuras para el clima fresco.',
    },
    'fleece-zip': {
      name: 'Chaqueta polar con cierre',
      description: 'Chaqueta polar verde salvia con cierre completo.',
    },
    'denim-jacket': {
      name: 'Chaqueta de mezclilla',
      description: 'Chaqueta de mezclilla azul medio con bolsillos en el pecho.',
    },
    'cropped-blazer': {
      name: 'Blazer corto',
      description: 'Blazer de lana gris carbón con solapas doradas.',
    },
    'wool-overcoat': {
      name: 'Abrigo de lana',
      description:
        'Abrigo de lana azul marino hasta la rodilla con botones color camello.',
    },
    'puffer-jacket': {
      name: 'Chaqueta acolchada',
      description: 'Chaqueta negra acolchada de plumón.',
    },
    'trench-coat': {
      name: 'Gabardina',
      description: 'Gabardina clásica color camello con cinturón.',
    },
    'rain-shell': {
      name: 'Impermeable',
      description:
        'Chaqueta impermeable ligera verde azulado claro con capucha y cierre amarillo.',
    },
    'oxford-shirt': {
      name: 'Camisa Oxford',
      description: 'Camisa de algodón azul pálido con cuello abotonado.',
    },
    'merino-sweater': {
      name: 'Suéter de merino',
      description: 'Suéter de lana merino color borgoña con cuello redondo.',
    },
    'cotton-tee': {
      name: 'Camiseta de algodón',
      description: 'Camiseta de algodón blanco hueso de manga corta.',
    },
    'cable-knit': {
      name: 'Suéter de trenzas',
      description: 'Suéter grueso de lana color crema con tejido de trenzas.',
    },
    'silk-blouse': {
      name: 'Blusa de seda',
      description: 'Blusa de seda rosa palo con cuello en V.',
    },
    'polo-shirt': {
      name: 'Camisa polo',
      description: 'Camisa polo de algodón verde bosque con cuello blanco.',
    },
    'flannel-shirt': {
      name: 'Camisa de franela',
      description: 'Camisa de franela rojo ladrillo de manga larga.',
    },
    'linen-shirt': {
      name: 'Camisa de lino',
      description: 'Camisa de lino color arena de manga larga.',
    },
    'dark-jeans': {
      name: 'Jeans oscuros',
      description: 'Jeans rectos color índigo oscuro.',
    },
    'wool-trousers': {
      name: 'Pantalón de lana',
      description: 'Pantalón de vestir de lana gris carbón.',
    },
    chinos: { name: 'Chinos', description: 'Pantalón chino de algodón color caqui.' },
    'linen-trousers': {
      name: 'Pantalón de lino',
      description: 'Pantalón de lino color avena claro.',
    },
    'midi-skirt': {
      name: 'Falda midi',
      description: 'Falda midi de corte en A color ciruela.',
    },
    'pleated-skirt': {
      name: 'Falda plisada',
      description: 'Falda plisada de lana gris pizarra.',
    },
    'tailored-shorts': {
      name: 'Shorts de vestir',
      description: 'Shorts de algodón verde oliva con frente liso.',
    },
    'knit-dress': {
      name: 'Vestido tejido',
      description: 'Vestido tejido color chocolate de manga larga.',
    },
    'wrap-dress': {
      name: 'Vestido cruzado',
      description: 'Vestido cruzado azul petróleo con lazo en la cintura.',
    },
    sundress: {
      name: 'Vestido de verano',
      description: 'Vestido de verano de algodón amarillo caléndula con tirantes finos.',
    },
    'leather-boots': {
      name: 'Botas de cuero',
      description: 'Botas de cuero marrón resistentes al agua.',
    },
    'ankle-boots': { name: 'Botines', description: 'Botines de cuero negro.' },
    'white-sneakers': {
      name: 'Tenis blancos',
      description: 'Tenis blancos de corte bajo con suela gris.',
    },
    loafers: { name: 'Mocasines', description: 'Mocasines de cuero marrón tipo penny.' },
    sandals: {
      name: 'Sandalias',
      description: 'Sandalias de tiras de cuero color canela.',
    },
    'wool-scarf': {
      name: 'Bufanda de lana',
      description: 'Bufanda de lana roja con flecos color crema.',
    },
    beanie: {
      name: 'Gorro tejido',
      description: 'Gorro tejido azul pizarra con banda color crema.',
    },
    'canvas-tote': {
      name: 'Bolso de lona',
      description: 'Bolso tote de lona natural con asas marrones.',
    },
    sunglasses: {
      name: 'Lentes de sol',
      description: 'Lentes de sol negros con patillas doradas.',
    },
  },
  looks: {
    'mini-and-tights': {
      name: 'Minifalda y medias',
      description: 'Suéter acanalado, minifalda ciruela, medias opacas y botines.',
    },
    'winter-knit': {
      name: 'Tejido de invierno',
      description: 'Vestido tejido, botines y bufanda de lana.',
    },
    'city-wool': {
      name: 'Lana urbana',
      description: 'Suéter de merino, pantalón de lana y botas de cuero.',
    },
    'weekend-flannel': {
      name: 'Conjunto de fin de semana',
      description:
        'Una camisa de franela, jeans oscuros, botas y gorro para el fin de semana.',
    },
    'soft-pleats': {
      name: 'Pliegues suaves',
      description: 'Suéter de trenzas, falda plisada y botines.',
    },
    'office-oxford': {
      name: 'Día de clases',
      description: 'Una camisa de botones, jeans oscuros y mocasines para ir a clases.',
    },
    'silk-midi': {
      name: 'Seda y midi',
      description: 'Blusa de seda, falda midi y tenis blancos.',
    },
    'easy-chinos': {
      name: 'Chinos relajados',
      description: 'Camisa Oxford, chinos y tenis blancos.',
    },
    'summer-linen': {
      name: 'Lino de verano',
      description: 'Camiseta de algodón, pantalón de lino, sandalias y lentes de sol.',
    },
    'sun-dress': {
      name: 'Día de sol',
      description: 'Vestido de verano, sandalias y bolso de lona.',
    },
    'wrap-day': {
      name: 'Vestido cruzado de día',
      description: 'Un vestido cruzado, mocasines y un bolso para salir.',
    },
    'court-polo': {
      name: 'Polo de cancha',
      description: 'Camisa polo, shorts de vestir y tenis blancos.',
    },
    'breezy-linen': {
      name: 'Lino fresco',
      description: 'Camisa de lino, pantalón de lino, mocasines y bolso de lona.',
    },
  },
}
