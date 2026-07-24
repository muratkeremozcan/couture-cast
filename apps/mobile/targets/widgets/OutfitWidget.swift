// Story 3.3 Task 2 step 3 owner: present atomic shared data in small and medium widgets.
import SwiftUI
import WidgetKit

private let widgetAppGroup = "group.com.anonymous.mobile"
private let widgetPayloadKey = "widgetPayload"
private let staleInterval: TimeInterval = 30 * 60
private let onyx = Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255)
private let gold = Color(red: 201 / 255, green: 161 / 255, blue: 74 / 255)
private let cloud = Color(red: 230 / 255, green: 230 / 255, blue: 237 / 255)

struct WidgetData: Codable {
  let currentTemp: String
  let feelsLikeTemp: String
  let currentConditionIcon: String
  let currentConditionText: String
  let nowOutfitSummary: String
  let nextHourTime: String
  let nextHourTemp: String
  let nextHourIcon: String
  let nextHourPrecipitation: String
  let nextOutfitSummary: String
  let lastUpdated: String
  let locale: String
  let nowLabel: String
  let nextHourLabel: String
  let staleLabel: String
  let unavailableLabel: String
  let precipitationLabel: String

  static func empty(locale: String = Locale.current.identifier) -> WidgetData {
    let copy = WidgetCopy(locale: locale)
    return WidgetData(
      currentTemp: "--",
      feelsLikeTemp: "--",
      currentConditionIcon: "unknown",
      currentConditionText: copy.unavailable,
      nowOutfitSummary: copy.unavailable,
      nextHourTime: "",
      nextHourTemp: "--",
      nextHourIcon: "unknown",
      nextHourPrecipitation: "--",
      nextOutfitSummary: copy.unavailable,
      lastUpdated: "",
      locale: locale,
      nowLabel: copy.now,
      nextHourLabel: copy.nextHour,
      staleLabel: copy.stale,
      unavailableLabel: copy.unavailable,
      precipitationLabel: copy.precipitation
    )
  }

  func isStale(at date: Date) -> Bool {
    guard let updatedAt = ISO8601DateFormatter.widgetFormatter.date(from: lastUpdated)
    else {
      return false
    }
    return date.timeIntervalSince(updatedAt) >= staleInterval
  }
}

private struct WidgetCopy {
  let now: String
  let nextHour: String
  let stale: String
  let unavailable: String
  let precipitation: String
  let configurationDescription: String

  init(locale: String) {
    let language = Locale(identifier: locale).languageCode ?? "en"
    switch language {
    case "de":
      self.init(
        now: "JETZT",
        nextHour: "NÄCHSTE STUNDE",
        stale: "Veraltet",
        unavailable: "App für Empfehlungen öffnen",
        precipitation: "Niederschlag",
        configurationDescription: "Wetter- und Outfit-Empfehlungen auf einen Blick."
      )
    case "es":
      self.init(
        now: "AHORA",
        nextHour: "PRÓXIMA HORA",
        stale: "Desactualizado",
        unavailable: "Abre la app para ver recomendaciones",
        precipitation: "Precipitación",
        configurationDescription: "Clima y recomendaciones de atuendos de un vistazo."
      )
    case "fr":
      self.init(
        now: "MAINTENANT",
        nextHour: "HEURE SUIVANTE",
        stale: "Données anciennes",
        unavailable: "Ouvrez l’app pour les recommandations",
        precipitation: "Précipitations",
        configurationDescription: "Météo et recommandations de tenues en un coup d’œil."
      )
    case "it":
      self.init(
        now: "ORA",
        nextHour: "PROSSIMA ORA",
        stale: "Non aggiornato",
        unavailable: "Apri l’app per i consigli",
        precipitation: "Precipitazioni",
        configurationDescription: "Meteo e consigli di abbigliamento a colpo d’occhio."
      )
    case "pt":
      self.init(
        now: "AGORA",
        nextHour: "PRÓXIMA HORA",
        stale: "Desatualizado",
        unavailable: "Abra o app para recomendações",
        precipitation: "Precipitação",
        configurationDescription: "Clima e recomendações de looks de relance."
      )
    case "tr":
      self.init(
        now: "ŞİMDİ",
        nextHour: "SONRAKİ SAAT",
        stale: "Güncel değil",
        unavailable: "Öneriler için uygulamayı açın",
        precipitation: "Yağış",
        configurationDescription: "Hava durumu ve kombin önerilerine hızlıca bakın."
      )
    default:
      self.init(
        now: "NOW",
        nextHour: "NEXT HOUR",
        stale: "Stale",
        unavailable: "Open app for recommendations",
        precipitation: "Precipitation",
        configurationDescription: "Glanceable weather and outfit recommendations."
      )
    }
  }

  private init(
    now: String,
    nextHour: String,
    stale: String,
    unavailable: String,
    precipitation: String,
    configurationDescription: String
  ) {
    self.now = now
    self.nextHour = nextHour
    self.stale = stale
    self.unavailable = unavailable
    self.precipitation = precipitation
    self.configurationDescription = configurationDescription
  }
}

private extension ISO8601DateFormatter {
  static let widgetFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}

struct SimpleEntry: TimelineEntry {
  let date: Date
  let data: WidgetData
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> SimpleEntry {
    SimpleEntry(date: Date(), data: .empty())
  }

  func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> Void) {
    completion(SimpleEntry(date: Date(), data: loadWidgetData()))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<SimpleEntry>) -> Void
  ) {
    let now = Date()
    let entry = SimpleEntry(date: now, data: loadWidgetData())
    let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: now)
      ?? now.addingTimeInterval(15 * 60)
    completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
  }

  private func loadWidgetData() -> WidgetData {
    guard
      let sharedDefaults = UserDefaults(suiteName: widgetAppGroup),
      let payload = sharedDefaults.string(forKey: widgetPayloadKey),
      let data = payload.data(using: .utf8),
      let decoded = try? JSONDecoder().decode(WidgetData.self, from: data)
    else {
      return .empty()
    }
    return decoded
  }
}

private func weatherSymbol(for condition: String) -> String {
  switch condition {
  case "clear":
    return "sun.max.fill"
  case "partly_cloudy":
    return "cloud.sun.fill"
  case "cloudy":
    return "cloud.fill"
  case "fog":
    return "cloud.fog.fill"
  case "drizzle":
    return "cloud.drizzle.fill"
  case "rain":
    return "cloud.rain.fill"
  case "sleet":
    return "cloud.sleet.fill"
  case "snow":
    return "cloud.snow.fill"
  case "thunderstorm":
    return "cloud.bolt.rain.fill"
  case "wind":
    return "wind"
  default:
    return "questionmark.circle"
  }
}

private func makeWidgetURL(size: String, slot: String) -> URL {
  URL(string: "mobile://(tabs)?source=widget&size=\(size)&slot=\(slot)")!
}

private struct StaleFooter: View {
  let data: WidgetData
  let date: Date

  var body: some View {
    if data.isStale(at: date) {
      Text(data.staleLabel)
        .font(.custom("Space Grotesk", size: 9).weight(.semibold))
        .foregroundStyle(gold)
        .lineLimit(1)
    }
  }
}

struct SmallWidgetView: View {
  let entry: SimpleEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      HStack(alignment: .firstTextBaseline) {
        Text(entry.data.feelsLikeTemp)
          .font(.custom("Space Grotesk", size: 24).weight(.bold))
          .foregroundStyle(onyx)
          .minimumScaleFactor(0.7)
        Spacer(minLength: 4)
        Image(systemName: weatherSymbol(for: entry.data.currentConditionIcon))
          .font(.system(size: 18, weight: .semibold))
          .foregroundStyle(gold)
          .accessibilityLabel(entry.data.currentConditionText)
      }

      Rectangle()
        .fill(gold)
        .frame(width: 30, height: 2)

      Text(entry.data.nowLabel)
        .font(.custom("Space Grotesk", size: 9).weight(.bold))
        .tracking(1)
        .foregroundStyle(onyx)

      Text(entry.data.nowOutfitSummary)
        .font(.custom("Space Grotesk", size: 11))
        .foregroundStyle(onyx.opacity(0.72))
        .lineLimit(3)

      Spacer(minLength: 0)
      StaleFooter(data: entry.data, date: entry.date)
    }
    .padding(12)
    .background(Color.white)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    .widgetURL(makeWidgetURL(size: "small", slot: "now"))
  }
}

private struct CurrentColumn: View {
  let entry: SimpleEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(entry.data.feelsLikeTemp)
          .font(.custom("Space Grotesk", size: 20).weight(.bold))
          .foregroundStyle(onyx)
          .minimumScaleFactor(0.7)
        Spacer(minLength: 4)
        Image(systemName: weatherSymbol(for: entry.data.currentConditionIcon))
          .foregroundStyle(gold)
          .accessibilityLabel(entry.data.currentConditionText)
      }
      Rectangle().fill(gold).frame(width: 24, height: 2)
      Text(entry.data.nowLabel)
        .font(.custom("Space Grotesk", size: 9).weight(.bold))
        .tracking(1)
        .foregroundStyle(onyx)
      Text(entry.data.nowOutfitSummary)
        .font(.custom("Space Grotesk", size: 10))
        .foregroundStyle(onyx.opacity(0.72))
        .lineLimit(2)
      Spacer(minLength: 0)
      StaleFooter(data: entry.data, date: entry.date)
    }
  }
}

private struct NextColumn: View {
  let entry: SimpleEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Image(systemName: weatherSymbol(for: entry.data.nextHourIcon))
          .foregroundStyle(gold)
        Text(entry.data.nextHourTemp)
          .font(.custom("Space Grotesk", size: 17).weight(.bold))
          .foregroundStyle(onyx)
          .minimumScaleFactor(0.7)
        Spacer(minLength: 3)
        Text(entry.data.nextHourTime)
          .font(.custom("Space Grotesk", size: 9))
          .foregroundStyle(onyx.opacity(0.62))
      }
      Text("\(entry.data.precipitationLabel) \(entry.data.nextHourPrecipitation)")
        .font(.custom("Space Grotesk", size: 9))
        .foregroundStyle(onyx.opacity(0.62))
        .lineLimit(1)
      Text(entry.data.nextHourLabel)
        .font(.custom("Space Grotesk", size: 9).weight(.bold))
        .tracking(0.8)
        .foregroundStyle(onyx)
      Text(entry.data.nextOutfitSummary)
        .font(.custom("Space Grotesk", size: 10))
        .foregroundStyle(onyx.opacity(0.72))
        .lineLimit(2)
      Spacer(minLength: 0)
    }
  }
}

struct MediumWidgetView: View {
  let entry: SimpleEntry

  var body: some View {
    HStack(spacing: 10) {
      Link(destination: makeWidgetURL(size: "medium", slot: "now")) {
        CurrentColumn(entry: entry)
      }
      .buttonStyle(.plain)

      Rectangle()
        .fill(cloud)
        .frame(width: 1)
        .padding(.vertical, 2)

      Link(destination: makeWidgetURL(size: "medium", slot: "next")) {
        NextColumn(entry: entry)
      }
      .buttonStyle(.plain)
    }
    .padding(12)
    .background(Color.white)
    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
  }
}

struct OutfitWidgetEntryView: View {
  var entry: Provider.Entry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    Group {
      switch family {
      case .systemMedium:
        MediumWidgetView(entry: entry)
      default:
        SmallWidgetView(entry: entry)
      }
    }
    .widgetCanvas()
  }
}

private extension View {
  @ViewBuilder
  func widgetCanvas() -> some View {
    if #available(iOSApplicationExtension 17.0, *) {
      containerBackground(for: .widget) {
        Color.white
      }
    } else {
      background(Color.white)
    }
  }
}

@main
struct OutfitWidget: Widget {
  let kind = "OutfitWidget"

  var body: some WidgetConfiguration {
    let copy = WidgetCopy(locale: Locale.current.identifier)
    return StaticConfiguration(kind: kind, provider: Provider()) { entry in
      OutfitWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("CoutureCast")
    .description(copy.configurationDescription)
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
