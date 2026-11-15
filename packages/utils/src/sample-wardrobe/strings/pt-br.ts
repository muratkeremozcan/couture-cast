// Story 6.16 guest preview strings for pt-BR. Keys mirror en-us.ts exactly.
import type { GuestPreviewStrings } from './en-us'

export const ptBR: GuestPreviewStrings = {
  chrome: {
    entry: 'Experimente um guarda-roupa de exemplo',
    sampleLabel:
      'Guarda-roupa de exemplo. Clima e looks são exemplos, não o seu armário nem uma previsão em tempo real.',
    supporting: 'Mude uma preferência para ver como este exemplo responde.',
    conversion:
      'Crie uma conta para adicionar suas roupas. Depois de entrar, você pode escolher salvar suas preferências de conforto. Os itens de exemplo e as curtidas da prévia ficam nesta prévia.',
    createAccount: 'Criar conta',
    signIn: 'Entrar',
    resetPreview: 'Redefinir prévia',
    exitPreview: 'Sair da prévia',
    storageUnavailable: 'Esta prévia pode ser redefinida quando você fechá-la.',
    connectionNeeded: 'Para criar uma conta, é preciso estar conectado à internet.',
    navLabel: 'Seções da prévia',
    navOutfit: 'Look',
    navWardrobe: 'Guarda-roupa de exemplo',
    navPreferences: 'Preferências',
    close: 'Fechar',
    checkingSession: 'Verificando sua sessão…',
    sessionUnavailable:
      'Não foi possível confirmar sua sessão. Seu login continua ativo neste dispositivo.',
    retry: 'Tentar novamente',
  },
  gate: {
    heading: 'Antes de experimentar o guarda-roupa de exemplo',
    body: 'Informe sua data de nascimento. Ela é verificada só neste dispositivo e não é salva nem enviada.',
    field: 'Data de nascimento (YYYY-MM-DD)',
    submit: 'Continuar',
    selfReported:
      'Esta é uma verificação de idade autodeclarada, não uma verificação de identidade.',
    underage: 'Você precisa ter 13 anos ou mais',
    invalid: 'Informe sua data de nascimento no formato YYYY-MM-DD',
    exit: 'Voltar ao início',
  },
  outfit: {
    heading: 'Look de exemplo',
    whyThisWorks: 'Por que funciona',
    tryAnother: 'Ver outro look',
    noAlternative:
      'Este é o único look de exemplo que combina com essas configurações. Experimente outro clima de exemplo ou outra configuração de conforto.',
    browseWardrobe: 'Ver o guarda-roupa de exemplo',
    swap: 'Trocar {category}',
    swapTitle: 'Escolha: {category}',
    current: 'Atual',
    noSuitableAlternative: 'Nenhuma alternativa adequada neste guarda-roupa de exemplo.',
    undoSwaps: 'Desfazer trocas',
    swapped: '{garment} agora faz parte do look.',
    updated: 'Look atualizado: {look}.',
    allDisliked:
      'Você marcou todos os looks que combinam com essas configurações como Não é para mim.',
    noEligible:
      'Nenhum look de exemplo desta coleção combina com essas configurações. Experimente outra coleção ou outro clima de exemplo.',
    reviewChoices: 'Revisar escolhas',
    resetChoices: 'Redefinir escolhas',
  },
  preferences: {
    heading: 'Preferências',
    weather: 'Clima de exemplo',
    weatherDetail:
      'Exemplo: sensação de {temperature}, vento de {windSpeed} m/s, {rainPercent}% de chance de chuva.',
    thermal: 'Conforto térmico',
    wind: 'Tolerância ao vento',
    rain: 'Preparo para chuva',
    collection: 'Coleção',
  },
  feedback: {
    heading: 'Avalie os looks de exemplo (opcional)',
    body: 'Curtidas fazem um look subir. Looks marcados como Não é para mim são pulados até você limpar essa marcação.',
    like: 'Curtir',
    dislike: 'Não é para mim',
    progress: '{reviewed} de {total} avaliados',
    previous: 'Look anterior',
    next: 'Próximo look',
    skip: 'Pular por enquanto',
  },
  wardrobe: {
    heading: 'Guarda-roupa de exemplo',
    category: 'Categoria',
    allCategories: 'Todas',
    details: 'Detalhes',
    material: 'Material',
    comfortRange: 'Faixa de conforto',
    windResistant: 'Corta-vento',
    waterResistant: 'Resistente à água',
    yes: 'Sim',
    no: 'Não',
    backToOutfit: 'Voltar ao look',
    empty: 'Nenhum item de exemplo nesta categoria para esta coleção.',
    count: 'Itens de exemplo: {count}',
  },
  conversionDetail: {
    canSave: 'Pode ser salvo depois de entrar',
    canSaveBody: 'Suas três configurações de conforto.',
    previewOnly: 'Só na prévia',
    previewOnlyBody:
      'Itens de exemplo, looks, curtidas, o filtro de coleção e as trocas.',
    stillRequired: 'Ainda é necessário',
    stillRequiredBody:
      'Configuração da conta, login verificado e aprovação do responsável, quando se aplica.',
    backToPreview: 'Voltar à prévia',
    signInToContinue: 'Entre para continuar',
  },
  review: {
    heading: 'Usar estas preferências de conforto?',
    account: 'Sua conta',
    proposed: 'Da prévia',
    use: 'Usar configurações da prévia',
    keep: 'Manter preferências da conta',
    saving: 'Salvando…',
    saved: 'Suas preferências de conforto foram salvas.',
    kept: 'As preferências da sua conta não mudaram.',
    failed:
      'Não foi possível salvar suas preferências. Sua escolha foi mantida para você tentar de novo.',
    loadFailed: 'Não foi possível carregar as preferências da sua conta.',
    continue: 'Continuar',
  },
  values: {
    runsColdWarm: {
      cold: 'Costumo sentir frio',
      neutral: 'Na média',
      warm: 'Costumo sentir calor',
    },
    windTolerance: {
      low: 'O vento me incomoda',
      medium: 'Um pouco de vento tudo bem',
      high: 'O vento raramente me incomoda',
    },
    precipPreparedness: {
      low: 'Só com chuva forte',
      medium: 'Quando a chuva é provável',
      high: 'Com qualquer chance de chuva',
    },
    weather: {
      'cool-windy': 'Fresco e com vento',
      'mild-dry': 'Ameno e seco',
      'warm-rainy': 'Quente e chuvoso',
    },
    collection: {
      all: 'Todos os exemplos',
      womenswear: 'Feminino',
      menswear: 'Masculino',
    },
    category: {
      top: 'parte de cima',
      bottom: 'parte de baixo',
      outerwear: 'camada externa',
      dress: 'vestido',
      shoes: 'calçado',
      accessory: 'acessório',
    },
    categoryTitle: {
      top: 'Partes de cima',
      bottom: 'Partes de baixo',
      outerwear: 'Camadas externas',
      dress: 'Vestidos',
      shoes: 'Calçados',
      accessory: 'Acessórios',
    },
    material: {
      cotton: 'Algodão',
      wool: 'Lã',
      linen: 'Linho',
      leather: 'Couro',
      denim: 'Jeans',
      fleece: 'Fleece',
      synthetic: 'Sintético',
      down: 'Plumas',
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
      weather: 'clima de exemplo',
      runsColdWarm: 'conforto térmico',
      windTolerance: 'tolerância ao vento',
      precipPreparedness: 'preparo para chuva',
    },
    swapCause: {
      unknown: 'esse item não está neste guarda-roupa de exemplo',
      category: 'esse item é de outra categoria',
      collection: 'esse item não está nesta coleção',
      range: 'esse item não combina com esta temperatura',
      protection: 'essa camada não dá a proteção que este clima pede',
    },
  },
  explanation: {
    weather: '{weather} (exemplo), sensação de {feelsLike}.',
    'thermal-neutral': 'Com conforto na média, isso equivale a um tempo {range}.',
    'thermal-adjusted':
      'Como você tende a sentir o tempo mais {runsColdWarm}, ele conta como {adjustedFeelsLike}: tempo {range}.',
    'layer-cold': '{garment} aquece abaixo de {threshold}.',
    'layer-wind':
      '{garment} bloqueia vento de {windSpeed} m/s, acima da sua tolerância de {windThreshold} m/s.',
    'layer-rain':
      '{garment} protege da chuva com {rainPercent}% de chance, acima do seu limite de {rainThresholdPercent}%.',
    'no-layer': 'Com tempo {range}, dá para dispensar a camada externa.',
    'layer-unavailable':
      'Este guarda-roupa de exemplo não tem camada externa com a proteção que este tempo pede.',
    'wind-within':
      'Vento de {windSpeed} m/s está dentro da sua tolerância de {windThreshold} m/s.',
    'rain-within':
      '{rainPercent}% de chance de chuva está dentro do seu limite de {rainThresholdPercent}%.',
    'liked-first': 'Você curtiu {look}, então ele aparece primeiro.',
    'stale-selection':
      'O look que você escolheu antes não combina mais com essas configurações, então mostramos {look}.',
    'swap-applied': 'Você escolheu {garment} para a categoria {category}.',
    'swap-ignored': 'A troca na categoria {category} ficou de lado: {cause}.',
    'still-suits':
      'Configuração alterada: {control}. O look continua o mesmo porque ainda combina com as condições.',
    'all-disliked':
      'Todos os looks que combinam com essas configurações estão marcados como Não é para mim.',
    'no-eligible':
      'Nenhum look combina com essas configurações nesta coleção: {collection}.',
  },
  garments: {
    'fleece-zip': {
      name: 'Jaqueta de fleece com zíper',
      description: 'Jaqueta de fleece verde-sálvia com zíper inteiro.',
    },
    'denim-jacket': {
      name: 'Jaqueta jeans',
      description: 'Jaqueta jeans azul médio com bolsos no peito.',
    },
    'cropped-blazer': {
      name: 'Blazer cropped',
      description: 'Blazer de lã cinza-chumbo com lapelas douradas.',
    },
    'wool-overcoat': {
      name: 'Sobretudo de lã',
      description: 'Casaco de lã azul-marinho na altura do joelho com botões caramelo.',
    },
    'puffer-jacket': {
      name: 'Jaqueta puffer',
      description: 'Jaqueta de plumas preta e acolchoada.',
    },
    'trench-coat': {
      name: 'Trench coat',
      description: 'Trench coat clássico caramelo com cinto.',
    },
    'rain-shell': {
      name: 'Jaqueta corta-chuva',
      description: 'Jaqueta de chuva leve verde-água com capuz e zíper amarelo.',
    },
    'oxford-shirt': {
      name: 'Camisa oxford',
      description: 'Camisa de algodão azul-clara com colarinho abotoado.',
    },
    'merino-sweater': {
      name: 'Suéter de merino',
      description: 'Suéter de lã merino bordô com gola redonda.',
    },
    'cotton-tee': {
      name: 'Camiseta de algodão',
      description: 'Camiseta de algodão off-white de manga curta.',
    },
    'cable-knit': {
      name: 'Suéter de tricô trançado',
      description: 'Suéter de lã creme com tranças grossas.',
    },
    'silk-blouse': {
      name: 'Blusa de seda',
      description: 'Blusa de seda rosa-claro com decote em V.',
    },
    'polo-shirt': {
      name: 'Camisa polo',
      description: 'Polo de algodão verde-floresta com gola branca.',
    },
    'flannel-shirt': {
      name: 'Camisa de flanela',
      description: 'Camisa de flanela vermelho-tijolo de manga longa.',
    },
    'linen-shirt': {
      name: 'Camisa de linho',
      description: 'Camisa de linho cor de areia de manga longa.',
    },
    'dark-jeans': {
      name: 'Jeans escuro',
      description: 'Calça jeans reta índigo escuro.',
    },
    'wool-trousers': {
      name: 'Calça de lã',
      description: 'Calça de alfaiataria de lã cinza-chumbo.',
    },
    chinos: { name: 'Calça chino', description: 'Calça chino de algodão cáqui.' },
    'linen-trousers': {
      name: 'Calça de linho',
      description: 'Calça de linho em tom aveia claro.',
    },
    'midi-skirt': { name: 'Saia midi', description: 'Saia midi evasê cor de ameixa.' },
    'pleated-skirt': {
      name: 'Saia plissada',
      description: 'Saia plissada de lã cinza-ardósia.',
    },
    'tailored-shorts': {
      name: 'Short de alfaiataria',
      description: 'Short de algodão verde-oliva sem pregas na frente.',
    },
    'knit-dress': {
      name: 'Vestido de tricô',
      description: 'Vestido de tricô marrom-chocolate de manga longa.',
    },
    'wrap-dress': {
      name: 'Vestido envelope',
      description: 'Vestido envelope azul-petróleo com amarração na cintura.',
    },
    sundress: {
      name: 'Vestido de verão',
      description: 'Vestido de verão de algodão amarelo-calêndula com alças finas.',
    },
    'leather-boots': {
      name: 'Botas de couro',
      description: 'Botas de couro marrom resistentes à água.',
    },
    'ankle-boots': { name: 'Botinhas', description: 'Botinhas de couro pretas.' },
    'white-sneakers': {
      name: 'Tênis brancos',
      description: 'Tênis brancos de cano baixo com sola cinza.',
    },
    loafers: {
      name: 'Mocassins',
      description: 'Mocassins de couro marrom estilo penny loafer.',
    },
    sandals: { name: 'Sandálias', description: 'Sandálias de couro caramelo com tiras.' },
    'wool-scarf': {
      name: 'Cachecol de lã',
      description: 'Cachecol de lã vermelho com franjas creme.',
    },
    beanie: {
      name: 'Gorro',
      description: 'Gorro de tricô azul-ardósia com faixa creme.',
    },
    'canvas-tote': {
      name: 'Bolsa de lona',
      description: 'Bolsa tote de lona natural com alças marrons.',
    },
    sunglasses: {
      name: 'Óculos de sol',
      description: 'Óculos de sol pretos com hastes douradas.',
    },
  },
  looks: {
    'winter-knit': {
      name: 'Tricô de inverno',
      description: 'Vestido de tricô, botinhas e cachecol de lã.',
    },
    'city-wool': {
      name: 'Lã na cidade',
      description: 'Suéter de merino, calça de lã e botas de couro.',
    },
    'weekend-flannel': {
      name: 'Flanela de fim de semana',
      description: 'Camisa de flanela, jeans escuro, botas de couro e gorro.',
    },
    'soft-pleats': {
      name: 'Pregas suaves',
      description: 'Suéter de tricô trançado, saia plissada e botinhas.',
    },
    'office-oxford': {
      name: 'Oxford de escritório',
      description: 'Camisa oxford, jeans escuro e mocassins.',
    },
    'silk-midi': {
      name: 'Seda e midi',
      description: 'Blusa de seda, saia midi e tênis brancos.',
    },
    'easy-chinos': {
      name: 'Chino descomplicado',
      description: 'Camisa oxford, calça chino e tênis brancos.',
    },
    'summer-linen': {
      name: 'Linho de verão',
      description: 'Camiseta de algodão, calça de linho, sandálias e óculos de sol.',
    },
    'sun-dress': {
      name: 'Dia de sol',
      description: 'Vestido de verão, sandálias e bolsa de lona.',
    },
    'wrap-day': {
      name: 'Envelope no dia a dia',
      description: 'Vestido envelope, mocassins e bolsa de lona.',
    },
    'court-polo': {
      name: 'Polo esportiva',
      description: 'Camisa polo, short de alfaiataria e tênis brancos.',
    },
    'breezy-linen': {
      name: 'Linho leve',
      description: 'Camisa de linho, calça de linho, mocassins e bolsa de lona.',
    },
  },
}
