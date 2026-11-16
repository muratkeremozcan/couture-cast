// Story 6.16 guest preview strings for tr-TR. Keys mirror en-us.ts exactly.
import type { GuestPreviewStrings } from './en-us'

export const trTR: GuestPreviewStrings = {
  chrome: {
    entry: 'Örnek gardırobu deneyin',
    exampleLabel: 'Örnek',
    welcomeHeading: 'Bugünün havasına göre kombinler',
    welcomeBody:
      'Önce örnek gardırobu deneyin ya da kendi dolabınızdan kombinler görmek için giriş yapın.',
    sampleLabel:
      'Örnek gardırop. Örnek hava ve kombinler; sizin dolabınız veya canlı hava tahmini değildir.',
    supporting: 'Bu örneğin nasıl değiştiğini görmek için bir tercihi değiştirin.',
    conversion:
      'Kıyafetlerinizi eklemek için hesap oluşturun. Giriş yaptıktan sonra konfor tercihlerinizi kaydetmeyi seçebilirsiniz. Örnek parçalar ve önizlemedeki beğeniler bu önizlemede kalır.',
    createAccount: 'Hesap oluşturun',
    signIn: 'Giriş yapın',
    resetPreview: 'Önizlemeyi sıfırlayın',
    exitPreview: 'Önizlemeden çıkın',
    storageUnavailable: 'Bu önizleme, kapattığınızda sıfırlanabilir.',
    connectionNeeded: 'Hesap oluşturmak için internet bağlantısı gerekir.',
    navLabel: 'Önizleme bölümleri',
    navOutfit: 'Kombin',
    navWardrobe: 'Örnek gardırop',
    navPreferences: 'Tercihler',
    close: 'Kapatın',
    checkingSession: 'Oturumunuz kontrol ediliyor…',
    sessionUnavailable: 'Oturumunuz doğrulanamadı. Bu cihazda oturumunuz hâlâ açık.',
    retry: 'Tekrar deneyin',
  },
  gate: {
    heading: 'Örnek gardırobu denemeden önce',
    body: 'Doğum tarihinizi girin. Yalnızca bu cihazda kontrol edilir; kaydedilmez ve gönderilmez.',
    field: 'Doğum tarihi (YYYY-MM-DD)',
    submit: 'Devam edin',
    selfReported: 'Bu, beyana dayalı bir yaş kontrolüdür; kimlik doğrulaması değildir.',
    underage: '13 yaşında veya daha büyük olmalısınız',
    invalid: 'Doğum tarihinizi YYYY-MM-DD biçiminde girin',
    exit: 'Ana sayfaya dönün',
  },
  outfit: {
    heading: 'Örnek kombin',
    whyThisWorks: 'Neden uygun',
    tryAnother: 'Başka bir görünüm deneyin',
    noAlternative:
      'Bu ayarlara uyan tek örnek görünüm bu. Başka bir hava örneği veya konfor ayarı deneyin.',
    browseWardrobe: 'Örnek gardıroba göz atın',
    swap: 'Değiştirin: {category}',
    swapTitle: 'Bir {category} seçin',
    current: 'Mevcut',
    noSuitableAlternative: 'Bu örnek gardıropta uygun bir alternatif yok.',
    undoSwaps: 'Değişiklikleri geri alın',
    swapped: '{garment} artık kombinde.',
    updated: 'Kombin güncellendi: {look}.',
    allDisliked:
      'Bu ayarlara uyan tüm görünümleri "Bana göre değil" olarak işaretlediniz.',
    noEligible:
      'Bu koleksiyonda bu ayarlara uyan örnek görünüm yok. Başka bir koleksiyon veya hava örneği deneyin.',
    reviewChoices: 'Seçimleri gözden geçirin',
    resetChoices: 'Seçimleri sıfırlayın',
  },
  preferences: {
    heading: 'Tercihler',
    weather: 'Örnek hava',
    weatherDetail:
      'Örnek: hissedilen {temperature}, rüzgâr {windSpeed} m/s, yağmur ihtimali %{rainPercent}.',
    thermal: 'Sıcaklık konforu',
    wind: 'Rüzgâr toleransı',
    rain: 'Yağmur hazırlığı',
    collection: 'Koleksiyon',
  },
  feedback: {
    heading: 'Örnek görünümleri puanlayın (isteğe bağlı)',
    body: 'Beğeniler bir görünümü öne taşır. "Bana göre değil" olarak işaretlenen görünümler, işareti kaldırana kadar atlanır.',
    like: 'Beğendim',
    dislike: 'Bana göre değil',
    progress: '{total} görünümden {reviewed} tanesi değerlendirildi',
    previous: 'Önceki görünüm',
    next: 'Sonraki görünüm',
    skip: 'Şimdilik atlayın',
  },
  wardrobe: {
    heading: 'Örnek gardırop',
    category: 'Kategori',
    allCategories: 'Tümü',
    details: 'Ayrıntılar',
    material: 'Malzeme',
    comfortRange: 'Konfor aralığı',
    windResistant: 'Rüzgâr geçirmez',
    waterResistant: 'Suya dayanıklı',
    yes: 'Evet',
    no: 'Hayır',
    backToOutfit: 'Kombine dönün',
    empty: 'Bu koleksiyonda bu kategoride örnek parça yok.',
    count: '{count} örnek parça',
  },
  conversionDetail: {
    canSave: 'Giriş yaptıktan sonra kaydedilebilir',
    canSaveBody: 'Üç konfor ayarınız.',
    previewOnly: 'Yalnızca önizlemede',
    previewOnlyBody:
      'Örnek parçalar, kombinler, beğeniler, koleksiyon filtresi ve değişiklikler.',
    stillRequired: 'Yine de gerekli',
    stillRequiredBody: 'Hesap kurulumu ve doğrulanmış giriş.',
    backToPreview: 'Önizlemeye dönün',
    signInToContinue: 'Devam etmek için giriş yapın',
  },
  review: {
    heading: 'Bu konfor tercihleri kullanılsın mı?',
    account: 'Hesabınız',
    proposed: 'Önizlemeden',
    use: 'Önizleme ayarlarını kullanın',
    keep: 'Hesap tercihlerini koruyun',
    saving: 'Kaydediliyor…',
    saved: 'Konfor tercihleriniz kaydedildi.',
    kept: 'Hesap tercihleriniz değişmedi.',
    rejected: 'Hesabınız henüz tercihleri kaydedemez. Önce yaş kontrolü gerekiyor.',
    failed: 'Tercihleriniz kaydedilemedi. Seçiminiz korunuyor, tekrar deneyebilirsiniz.',
    loadFailed: 'Hesap tercihleriniz yüklenemedi.',
    continue: 'Devam edin',
  },
  values: {
    runsColdWarm: {
      cold: 'Genelde üşürüm',
      neutral: 'Ortalama',
      warm: 'Genelde sıcaklarım',
    },
    windTolerance: {
      low: 'Rüzgâr beni rahatsız eder',
      medium: 'Biraz rüzgâr sorun değil',
      high: 'Rüzgâr beni nadiren rahatsız eder',
    },
    precipPreparedness: {
      low: 'Yalnızca şiddetli yağmurda',
      medium: 'Yağmur olasılığı yüksekse',
      high: 'En küçük yağmur ihtimalinde',
    },
    weather: {
      'cool-windy': 'Serin ve rüzgârlı',
      'mild-dry': 'Ilık ve kuru',
      'warm-rainy': 'Sıcak ve yağmurlu',
    },
    collection: {
      all: 'Tüm örnekler',
      womenswear: 'Kadın',
      menswear: 'Erkek',
    },
    category: {
      top: 'üst giyim',
      bottom: 'alt giyim',
      outerwear: 'dış giyim',
      dress: 'elbise',
      shoes: 'ayakkabı',
      accessory: 'aksesuar',
    },
    categoryTitle: {
      top: 'Üst giyim',
      bottom: 'Alt giyim',
      outerwear: 'Dış giyim',
      dress: 'Elbiseler',
      shoes: 'Ayakkabılar',
      accessory: 'Aksesuarlar',
    },
    material: {
      cotton: 'Pamuk',
      wool: 'Yün',
      linen: 'Keten',
      leather: 'Deri',
      denim: 'Denim',
      fleece: 'Polar',
      synthetic: 'Sentetik',
      down: 'Kaz tüyü',
      silk: 'İpek',
    },
    range: {
      cold: 'soğuk',
      cool: 'serin',
      mild: 'ılık',
      warm: 'sıcak',
      hot: 'çok sıcak',
    },
    control: {
      weather: 'örnek hava',
      runsColdWarm: 'sıcaklık konforu',
      windTolerance: 'rüzgâr toleransı',
      precipPreparedness: 'yağmur hazırlığı',
    },
    swapCause: {
      unknown: 'bu parça bu örnek gardıropta yok',
      category: 'bu parça başka bir kategoriye ait',
      collection: 'bu parça bu koleksiyonda yok',
      range: 'bu parça bu sıcaklığa uygun değil',
      protection: 'bu katman bu havanın gerektirdiği korumayı sağlamıyor',
    },
  },
  explanation: {
    weather: 'Örnek hava: {weather}, hissedilen {feelsLike}.',
    'thermal-neutral': 'Ortalama konforda bu hava {range} sayılır.',
    'thermal-adjusted':
      'Havayı genelde daha {runsColdWarm} hissediyorsunuz, bu yüzden {adjustedFeelsLike} olarak ele alınıyor: {range} hava.',
    'layer-cold': '{garment}, {threshold} altında sıcak tutar.',
    'layer-wind':
      '{garment}, {windSpeed} m/s rüzgârı keser; bu, {windThreshold} m/s olan toleransınızın üzerinde.',
    'layer-rain':
      '{garment}, %{rainPercent} yağmur ihtimalinde sizi kuru tutar; bu, %{rainThresholdPercent} olan eşiğinizin üzerinde.',
    'no-layer': 'Hava {range}, dış giyime gerek yok.',
    'layer-unavailable':
      'Bu örnek gardıropta bu havanın gerektirdiği korumayı sağlayan dış giyim yok.',
    'wind-within':
      '{windSpeed} m/s rüzgâr, {windThreshold} m/s olan toleransınızın içinde.',
    'rain-within':
      '%{rainPercent} yağmur ihtimali, %{rainThresholdPercent} olan eşiğinizin içinde.',
    'liked-first': 'Beğendiğiniz için öne alındı: {look}.',
    'stale-selection':
      'Önceki görünümünüz bu ayarlara artık uymuyor, bu yüzden şu görünüm gösteriliyor: {look}.',
    'swap-applied': 'Seçtiğiniz {category}: {garment}.',
    'swap-ignored': 'Değişikliğiniz ({category}) kenara alındı: {cause}.',
    'still-suits': 'Değişen ayar: {control}. Kombin aynı kalıyor, koşullara hâlâ uyuyor.',
    'all-disliked': 'Bu ayarlara uyan tüm görünümler "Bana göre değil" olarak işaretli.',
    'no-eligible': 'Koleksiyon: {collection}. Bu ayarlara uyan görünüm yok.',
  },
  garments: {
    'fleece-zip': {
      name: 'Fermuarlı polar ceket',
      description: 'Boydan fermuarlı, adaçayı yeşili polar ceket.',
    },
    'denim-jacket': {
      name: 'Kot ceket',
      description: 'Göğüs cepli, orta mavi kot ceket.',
    },
    'cropped-blazer': {
      name: 'Kısa blazer',
      description: 'Altın rengi yakalı, antrasit yün blazer.',
    },
    'wool-overcoat': {
      name: 'Yün palto',
      description: 'Deve tüyü rengi düğmeli, diz boyu lacivert yün palto.',
    },
    'puffer-jacket': { name: 'Şişme mont', description: 'Siyah kapitone kaz tüyü mont.' },
    'trench-coat': {
      name: 'Trençkot',
      description: 'Kemerli, klasik deve tüyü rengi trençkot.',
    },
    'rain-shell': {
      name: 'Yağmurluk',
      description: 'Sarı fermuarlı, kapüşonlu, açık camgöbeği hafif yağmurluk.',
    },
    'oxford-shirt': {
      name: 'Oxford gömlek',
      description: 'Açık mavi, düğmeli yaka pamuklu gömlek.',
    },
    'merino-sweater': {
      name: 'Merinos kazak',
      description: 'Bordo, bisiklet yaka merinos yünü kazak.',
    },
    'cotton-tee': {
      name: 'Pamuklu tişört',
      description: 'Kırık beyaz, kısa kollu pamuklu tişört.',
    },
    'cable-knit': {
      name: 'Saç örgülü kazak',
      description: 'Krem rengi, kalın saç örgülü yün kazak.',
    },
    'silk-blouse': { name: 'İpek bluz', description: 'Pudra pembe, V yaka ipek bluz.' },
    'polo-shirt': {
      name: 'Polo tişört',
      description: 'Beyaz yakalı, orman yeşili pamuklu polo tişört.',
    },
    'flannel-shirt': {
      name: 'Flanel gömlek',
      description: 'Kiremit kırmızısı, uzun kollu flanel gömlek.',
    },
    'linen-shirt': {
      name: 'Keten gömlek',
      description: 'Kum rengi, uzun kollu keten gömlek.',
    },
    'dark-jeans': {
      name: 'Koyu kot pantolon',
      description: 'Koyu indigo, düz paça kot pantolon.',
    },
    'wool-trousers': {
      name: 'Yün pantolon',
      description: 'Antrasit, kalıplı yün pantolon.',
    },
    chinos: { name: 'Chino pantolon', description: 'Haki pamuklu chino pantolon.' },
    'linen-trousers': {
      name: 'Keten pantolon',
      description: 'Açık yulaf rengi keten pantolon.',
    },
    'midi-skirt': { name: 'Midi etek', description: 'Mürdüm rengi, A kesim midi etek.' },
    'pleated-skirt': {
      name: 'Pliseli etek',
      description: 'Arduvaz grisi, pliseli yün etek.',
    },
    'tailored-shorts': {
      name: 'Kalıplı şort',
      description: 'Pilesiz, zeytin yeşili pamuklu şort.',
    },
    'knit-dress': {
      name: 'Triko elbise',
      description: 'Çikolata kahvesi, uzun kollu triko elbise.',
    },
    'wrap-dress': {
      name: 'Kruvaze elbise',
      description: 'Beli bağlamalı, camgöbeği kruvaze elbise.',
    },
    sundress: {
      name: 'Yazlık elbise',
      description: 'İnce askılı, kadife çiçeği sarısı pamuklu yazlık elbise.',
    },
    'leather-boots': {
      name: 'Deri bot',
      description: 'Suya dayanıklı, kahverengi deri bot.',
    },
    'ankle-boots': { name: 'Kısa bot', description: 'Siyah deri kısa bot.' },
    'white-sneakers': {
      name: 'Beyaz spor ayakkabı',
      description: 'Gri tabanlı, beyaz alçak bilekli spor ayakkabı.',
    },
    loafers: { name: 'Loafer', description: 'Kahverengi deri penny loafer.' },
    sandals: { name: 'Sandalet', description: 'Taba rengi, bantlı deri sandalet.' },
    'wool-scarf': { name: 'Yün atkı', description: 'Krem saçaklı, kırmızı yün atkı.' },
    beanie: { name: 'Bere', description: 'Krem şeritli, arduvaz mavisi örgü bere.' },
    'canvas-tote': {
      name: 'Kanvas çanta',
      description: 'Kahverengi saplı, doğal kanvas çanta.',
    },
    sunglasses: {
      name: 'Güneş gözlüğü',
      description: 'Altın rengi saplı, siyah güneş gözlüğü.',
    },
  },
  looks: {
    'winter-knit': {
      name: 'Kış örgüsü',
      description: 'Triko elbise, kısa bot ve yün atkı.',
    },
    'city-wool': {
      name: 'Şehirde yün',
      description: 'Merinos kazak, yün pantolon ve deri bot.',
    },
    'weekend-flannel': {
      name: 'Hafta sonu flaneli',
      description: 'Flanel gömlek, koyu kot pantolon, deri bot ve bere.',
    },
    'soft-pleats': {
      name: 'Yumuşak pliseler',
      description: 'Saç örgülü kazak, pliseli etek ve kısa bot.',
    },
    'office-oxford': {
      name: 'Ofiste oxford',
      description: 'Oxford gömlek, koyu kot pantolon ve loafer.',
    },
    'silk-midi': {
      name: 'İpek ve midi',
      description: 'İpek bluz, midi etek ve beyaz spor ayakkabı.',
    },
    'easy-chinos': {
      name: 'Rahat chino',
      description: 'Oxford gömlek, chino pantolon ve beyaz spor ayakkabı.',
    },
    'summer-linen': {
      name: 'Yazlık keten',
      description: 'Pamuklu tişört, keten pantolon, sandalet ve güneş gözlüğü.',
    },
    'sun-dress': {
      name: 'Güneşli gün',
      description: 'Yazlık elbise, sandalet ve kanvas çanta.',
    },
    'wrap-day': {
      name: 'Kruvaze gün',
      description: 'Kruvaze elbise, loafer ve kanvas çanta.',
    },
    'court-polo': {
      name: 'Kort polosu',
      description: 'Polo tişört, kalıplı şort ve beyaz spor ayakkabı.',
    },
    'breezy-linen': {
      name: 'Esintili keten',
      description: 'Keten gömlek, keten pantolon, loafer ve kanvas çanta.',
    },
  },
}
