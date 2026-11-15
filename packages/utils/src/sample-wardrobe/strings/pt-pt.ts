// Story 6.16 guest preview strings for pt-PT. Keys mirror en-us.ts exactly.
import type { GuestPreviewStrings } from './en-us'

export const ptPT: GuestPreviewStrings = {
  chrome: {
    entry: 'Experimentar um roupeiro de exemplo',
    sampleLabel:
      'Roupeiro de exemplo. O tempo e os conjuntos são exemplos, não o seu armário nem uma previsão em tempo real.',
    supporting: 'Altere uma preferência para ver como este exemplo responde.',
    conversion:
      'Crie uma conta para adicionar a sua roupa. Depois de iniciar sessão, pode optar por guardar as preferências de conforto. Os artigos de exemplo e as marcações Gosto ficam nesta pré-visualização.',
    createAccount: 'Criar conta',
    signIn: 'Iniciar sessão',
    resetPreview: 'Repor pré-visualização',
    exitPreview: 'Sair da pré-visualização',
    storageUnavailable: 'Esta pré-visualização pode ser reposta ao fechá-la.',
    connectionNeeded: 'Criar uma conta requer ligação à internet.',
    navLabel: 'Secções da pré-visualização',
    navOutfit: 'Conjunto',
    navWardrobe: 'Roupeiro de exemplo',
    navPreferences: 'Preferências',
    close: 'Fechar',
    checkingSession: 'A verificar a sessão…',
    sessionUnavailable:
      'Não foi possível confirmar a sessão. A sessão continua iniciada neste dispositivo.',
    retry: 'Tentar novamente',
  },
  gate: {
    heading: 'Antes de experimentar o roupeiro de exemplo',
    body: 'Introduza a data de nascimento. É verificada apenas neste dispositivo e não é guardada nem enviada.',
    field: 'Data de nascimento (YYYY-MM-DD)',
    submit: 'Continuar',
    selfReported:
      'Esta é uma verificação de idade autodeclarada, não uma verificação de identidade.',
    underage: 'Tem de ter 13 anos ou mais',
    invalid: 'Introduza a data de nascimento no formato YYYY-MM-DD',
    exit: 'Voltar ao início',
  },
  outfit: {
    heading: 'Conjunto de exemplo',
    whyThisWorks: 'Porque resulta',
    tryAnother: 'Experimentar outro conjunto',
    noAlternative:
      'Este é o único conjunto de exemplo adequado a estas definições. Experimente outro exemplo de tempo ou outra definição de conforto.',
    browseWardrobe: 'Ver o roupeiro de exemplo',
    swap: 'Trocar {category}',
    swapTitle: 'Escolher: {category}',
    current: 'Atual',
    noSuitableAlternative: 'Não há alternativa adequada neste roupeiro de exemplo.',
    undoSwaps: 'Anular trocas',
    swapped: '{garment} faz agora parte do conjunto.',
    updated: 'Conjunto atualizado: {look}.',
    allDisliked:
      'Todos os conjuntos adequados a estas definições foram marcados como Não é para mim.',
    noEligible:
      'Nenhum conjunto de exemplo desta coleção é adequado a estas definições. Experimente outra coleção ou outro exemplo de tempo.',
    reviewChoices: 'Rever escolhas',
    resetChoices: 'Repor escolhas',
  },
  preferences: {
    heading: 'Preferências',
    weather: 'Tempo de exemplo',
    weatherDetail:
      'Exemplo: sensação térmica de {temperature}, vento a {windSpeed} m/s, probabilidade de chuva de {rainPercent}%.',
    thermal: 'Conforto térmico',
    wind: 'Tolerância ao vento',
    rain: 'Preparação para a chuva',
    collection: 'Coleção',
  },
  feedback: {
    heading: 'Avaliar conjuntos de exemplo (opcional)',
    body: 'Um Gosto faz subir o conjunto. Os conjuntos marcados como Não é para mim são ignorados até limpar a marcação.',
    like: 'Gosto',
    dislike: 'Não é para mim',
    progress: '{reviewed} de {total} avaliados',
    previous: 'Conjunto anterior',
    next: 'Conjunto seguinte',
    skip: 'Saltar por agora',
  },
  wardrobe: {
    heading: 'Roupeiro de exemplo',
    category: 'Categoria',
    allCategories: 'Todas',
    details: 'Detalhes',
    material: 'Material',
    comfortRange: 'Intervalo de conforto',
    windResistant: 'Corta-vento',
    waterResistant: 'Resistente à água',
    yes: 'Sim',
    no: 'Não',
    backToOutfit: 'Voltar ao conjunto',
    empty: 'Não há artigos de exemplo nesta categoria para esta coleção.',
    count: 'Artigos de exemplo: {count}',
  },
  conversionDetail: {
    canSave: 'Pode ser guardado após iniciar sessão',
    canSaveBody: 'As suas três definições de conforto.',
    previewOnly: 'Apenas na pré-visualização',
    previewOnlyBody:
      'Artigos de exemplo, conjuntos, marcações Gosto, o filtro de coleção e as trocas.',
    stillRequired: 'Continua a ser necessário',
    stillRequiredBody:
      'Configuração da conta, início de sessão verificado e aprovação do encarregado de educação, quando aplicável.',
    backToPreview: 'Voltar à pré-visualização',
    signInToContinue: 'Iniciar sessão para continuar',
  },
  review: {
    heading: 'Usar estas preferências de conforto?',
    account: 'A sua conta',
    proposed: 'Da pré-visualização',
    use: 'Usar definições da pré-visualização',
    keep: 'Manter preferências da conta',
    saving: 'A guardar…',
    saved: 'As preferências de conforto foram guardadas.',
    kept: 'As preferências da conta não foram alteradas.',
    failed:
      'Não foi possível guardar as preferências. A sua escolha mantém-se para poder tentar novamente.',
    loadFailed: 'Não foi possível carregar as preferências da conta.',
    continue: 'Continuar',
  },
  values: {
    runsColdWarm: {
      cold: 'Sinto frio com facilidade',
      neutral: 'Na média',
      warm: 'Sinto calor com facilidade',
    },
    windTolerance: {
      low: 'O vento incomoda-me',
      medium: 'Algum vento não faz mal',
      high: 'O vento raramente me incomoda',
    },
    precipPreparedness: {
      low: 'Só com chuva forte',
      medium: 'Quando é provável chover',
      high: 'Com qualquer probabilidade de chuva',
    },
    weather: {
      'cool-windy': 'Fresco e ventoso',
      'mild-dry': 'Ameno e seco',
      'warm-rainy': 'Quente e chuvoso',
    },
    collection: {
      all: 'Todos os exemplos',
      womenswear: 'Mulher',
      menswear: 'Homem',
    },
    category: {
      top: 'parte de cima',
      bottom: 'parte de baixo',
      outerwear: 'camada exterior',
      dress: 'vestido',
      shoes: 'calçado',
      accessory: 'acessório',
    },
    categoryTitle: {
      top: 'Partes de cima',
      bottom: 'Partes de baixo',
      outerwear: 'Camadas exteriores',
      dress: 'Vestidos',
      shoes: 'Calçado',
      accessory: 'Acessórios',
    },
    material: {
      cotton: 'Algodão',
      wool: 'Lã',
      linen: 'Linho',
      leather: 'Pele',
      denim: 'Ganga',
      fleece: 'Polar',
      synthetic: 'Sintético',
      down: 'Penas',
      silk: 'Seda',
    },
    range: {
      cold: 'frio',
      cool: 'fresco',
      mild: 'ameno',
      warm: 'quente',
      hot: 'muito quente',
    },
    control: {
      weather: 'tempo de exemplo',
      runsColdWarm: 'conforto térmico',
      windTolerance: 'tolerância ao vento',
      precipPreparedness: 'preparação para a chuva',
    },
    swapCause: {
      unknown: 'esse artigo não está neste roupeiro de exemplo',
      category: 'esse artigo pertence a outra categoria',
      collection: 'esse artigo não está nesta coleção',
      range: 'esse artigo não é adequado a esta temperatura',
      protection: 'essa camada não dá a proteção de que este tempo precisa',
    },
  },
  explanation: {
    weather: '{weather} (exemplo), sensação térmica de {feelsLike}.',
    'thermal-neutral': 'Com conforto na média, corresponde a tempo {range}.',
    'thermal-adjusted':
      'Como tende a sentir o tempo mais {runsColdWarm}, conta como {adjustedFeelsLike}: tempo {range}.',
    'layer-cold': '{garment} dá calor abaixo de {threshold}.',
    'layer-wind':
      '{garment} protege do vento a {windSpeed} m/s, acima da sua tolerância de {windThreshold} m/s.',
    'layer-rain':
      '{garment} protege da chuva com probabilidade de {rainPercent}%, acima do seu limite de {rainThresholdPercent}%.',
    'no-layer': 'Com tempo {range}, pode dispensar a camada exterior.',
    'wind-within':
      'Vento a {windSpeed} m/s fica dentro da sua tolerância de {windThreshold} m/s.',
    'rain-within':
      'Uma probabilidade de chuva de {rainPercent}% fica dentro do seu limite de {rainThresholdPercent}%.',
    'liked-first': 'Marcou {look} com Gosto, por isso aparece primeiro.',
    'stale-selection':
      'O conjunto escolhido antes já não é adequado a estas definições, por isso é mostrado {look}.',
    'swap-applied': 'Escolheu {garment} para a categoria {category}.',
    'swap-ignored': 'A troca na categoria {category} ficou de parte: {cause}.',
    'still-suits':
      'Definição alterada: {control}. O conjunto mantém-se porque continua adequado às condições.',
    'all-disliked':
      'Todos os conjuntos adequados a estas definições estão marcados como Não é para mim.',
    'no-eligible':
      'Nenhum conjunto é adequado a estas definições nesta coleção: {collection}.',
  },
  garments: {
    'fleece-zip': {
      name: 'Casaco polar com fecho',
      description: 'Casaco polar verde-salva com fecho de correr completo.',
    },
    'denim-jacket': {
      name: 'Casaco de ganga',
      description: 'Casaco de ganga azul médio com bolsos no peito.',
    },
    'cropped-blazer': {
      name: 'Blazer curto',
      description: 'Blazer de lã cinzento-carvão com lapelas douradas.',
    },
    'wool-overcoat': {
      name: 'Sobretudo de lã',
      description: 'Sobretudo de lã azul-marinho pelo joelho com botões cor de camelo.',
    },
    'puffer-jacket': {
      name: 'Casaco de penas',
      description: 'Casaco de penas preto, acolchoado.',
    },
    'trench-coat': {
      name: 'Gabardina',
      description: 'Gabardina clássica cor de camelo com cinto.',
    },
    'rain-shell': {
      name: 'Impermeável',
      description: 'Impermeável leve verde-azulado com capuz e fecho amarelo.',
    },
    'oxford-shirt': {
      name: 'Camisa Oxford',
      description: 'Camisa de algodão azul-clara com colarinho abotoado.',
    },
    'merino-sweater': {
      name: 'Camisola de merino',
      description: 'Camisola de lã merino bordeaux com gola redonda.',
    },
    'cotton-tee': {
      name: 'T-shirt de algodão',
      description: 'T-shirt de algodão branco-marfim de manga curta.',
    },
    'cable-knit': {
      name: 'Camisola de tranças',
      description: 'Camisola de lã grossa com tranças, cor creme.',
    },
    'silk-blouse': {
      name: 'Blusa de seda',
      description: 'Blusa de seda rosa-pálido com decote em V.',
    },
    'polo-shirt': {
      name: 'Polo',
      description: 'Polo de algodão verde-floresta com gola branca.',
    },
    'flannel-shirt': {
      name: 'Camisa de flanela',
      description: 'Camisa de flanela vermelho-tijolo de manga comprida.',
    },
    'linen-shirt': {
      name: 'Camisa de linho',
      description: 'Camisa de linho cor de areia de manga comprida.',
    },
    'dark-jeans': {
      name: 'Calças de ganga escuras',
      description: 'Calças de ganga direitas índigo-escuro.',
    },
    'wool-trousers': {
      name: 'Calças de lã',
      description: 'Calças de alfaiataria em lã cinzento-carvão.',
    },
    chinos: { name: 'Chinos', description: 'Calças chino de algodão caqui.' },
    'linen-trousers': {
      name: 'Calças de linho',
      description: 'Calças de linho cor de aveia clara.',
    },
    'midi-skirt': { name: 'Saia midi', description: 'Saia midi evasé cor de ameixa.' },
    'pleated-skirt': {
      name: 'Saia plissada',
      description: 'Saia plissada de lã cinzento-ardósia.',
    },
    'tailored-shorts': {
      name: 'Calções de alfaiataria',
      description: 'Calções de algodão verde-azeitona sem pinças.',
    },
    'knit-dress': {
      name: 'Vestido de malha',
      description: 'Vestido de malha castanho-chocolate de manga comprida.',
    },
    'wrap-dress': {
      name: 'Vestido traçado',
      description: 'Vestido traçado azul-petróleo com laço na cintura.',
    },
    sundress: {
      name: 'Vestido de alças',
      description: 'Vestido de algodão amarelo-calêndula com alças finas.',
    },
    'leather-boots': {
      name: 'Botas de pele',
      description: 'Botas de pele castanhas resistentes à água.',
    },
    'ankle-boots': { name: 'Botins', description: 'Botins de pele pretos.' },
    'white-sneakers': {
      name: 'Ténis brancos',
      description: 'Ténis brancos de cano baixo com sola cinzenta.',
    },
    loafers: {
      name: 'Mocassins',
      description: 'Mocassins de pele castanhos, estilo penny.',
    },
    sandals: {
      name: 'Sandálias',
      description: 'Sandálias de tiras em pele castanho-claro.',
    },
    'wool-scarf': {
      name: 'Cachecol de lã',
      description: 'Cachecol de lã vermelho com franjas cor de creme.',
    },
    beanie: {
      name: 'Gorro',
      description: 'Gorro de malha azul-ardósia com banda cor de creme.',
    },
    'canvas-tote': {
      name: 'Saco de lona',
      description: 'Saco tote de lona natural com alças castanhas.',
    },
    sunglasses: {
      name: 'Óculos de sol',
      description: 'Óculos de sol pretos com hastes douradas.',
    },
  },
  looks: {
    'winter-knit': {
      name: 'Malha de inverno',
      description: 'Vestido de malha, botins e cachecol de lã.',
    },
    'city-wool': {
      name: 'Lã na cidade',
      description: 'Camisola de merino, calças de lã e botas de pele.',
    },
    'weekend-flannel': {
      name: 'Flanela de fim de semana',
      description: 'Camisa de flanela, calças de ganga escuras, botas de pele e gorro.',
    },
    'soft-pleats': {
      name: 'Pregas suaves',
      description: 'Camisola de tranças, saia plissada e botins.',
    },
    'office-oxford': {
      name: 'Oxford de escritório',
      description: 'Camisa Oxford, calças de ganga escuras e mocassins.',
    },
    'silk-midi': {
      name: 'Seda e midi',
      description: 'Blusa de seda, saia midi e ténis brancos.',
    },
    'easy-chinos': {
      name: 'Chinos descontraídos',
      description: 'Camisa Oxford, chinos e ténis brancos.',
    },
    'summer-linen': {
      name: 'Linho de verão',
      description: 'T-shirt de algodão, calças de linho, sandálias e óculos de sol.',
    },
    'sun-dress': {
      name: 'Dia de sol',
      description: 'Vestido de alças, sandálias e saco de lona.',
    },
    'wrap-day': {
      name: 'Traçado de dia',
      description: 'Vestido traçado, mocassins e saco de lona.',
    },
    'court-polo': {
      name: 'Polo desportivo',
      description: 'Polo, calções de alfaiataria e ténis brancos.',
    },
    'breezy-linen': {
      name: 'Linho fresco',
      description: 'Camisa de linho, calças de linho, mocassins e saco de lona.',
    },
  },
}
