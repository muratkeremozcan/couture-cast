// Story 3.4 Task 3 step 1 owner: provide WidgetKit watch complications reading from watch App Group in apps/mobile/targets/watchos/WatchComplication.swift
import SwiftUI
import WidgetKit

private let watchAppGroup = "group.com.anonymous.mobile.watch"
private let widgetPayloadKey = "widgetPayload"
private let onyx = Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255)
private let gold = Color(red: 201 / 255, green: 161 / 255, blue: 74 / 255)

struct SimpleEntry: TimelineEntry {
  let date: Date
  let data: WidgetData
}

struct ComplicationProvider: TimelineProvider {
  typealias Entry = SimpleEntry

  func placeholder(in context: Context) -> SimpleEntry {
    SimpleEntry(date: Date(), data: .empty())
  }

  func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> Void) {
    completion(SimpleEntry(date: Date(), data: loadWidgetData()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SimpleEntry>) -> Void) {
    let now = Date()
    let entry = SimpleEntry(date: now, data: loadWidgetData())
    // Refresh complications every 15 minutes
    let nextUpdate =
      Calendar.current.date(byAdding: .minute, value: 15, to: now)
      ?? now.addingTimeInterval(15 * 60)
    completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
  }

  private func loadWidgetData() -> WidgetData {
    guard let sharedDefaults = UserDefaults(suiteName: watchAppGroup),
      let payload = sharedDefaults.string(forKey: widgetPayloadKey),
      let data = payload.data(using: .utf8),
      let decoded = try? JSONDecoder().decode(WidgetData.self, from: data),
      !decoded.isStale(at: Date())
    else {
      return .empty()
    }
    return decoded
  }
}

struct ComplicationView: View {
  var entry: ComplicationProvider.Entry
  @Environment(\.widgetFamily) var family

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular:
        VStack(spacing: 0) {
          Image(systemName: "tshirt.fill")
            .font(.system(size: 11))
          Text(entry.data.feelsLikeTemp)
            .font(.custom("SpaceGrotesk-Regular", size: 9).weight(.bold))
            .minimumScaleFactor(0.7)
        }
        .widgetCanvas()

      case .accessoryCorner:
        Image(systemName: "tshirt.fill")
          .font(.system(size: 14))
          .widgetLabel {
            Text(entry.data.feelsLikeTemp)
          }

      case .accessoryInline:
        Label {
          Text(
            entry.data.nowOutfitSummary.isEmpty
              ? entry.data.unavailableLabel
              : entry.data.nowOutfitSummary
          )
        } icon: {
          Image(systemName: "tshirt.fill")
        }

      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 1) {
          HStack(spacing: 3) {
            Image(systemName: "tshirt.fill")
              .font(.system(size: 11))
            Image(systemName: weatherSymbol(for: entry.data.currentConditionIcon))
              .font(.system(size: 12))
            Text(entry.data.feelsLikeTemp)
              .font(.custom("SpaceGrotesk-Regular", size: 12).weight(.bold))
            Text(entry.data.nowLabel)
              .font(.custom("SpaceGrotesk-Regular", size: 7).weight(.semibold))
              .foregroundStyle(.secondary)
          }
          Text(entry.data.nowOutfitSummary)
            .font(.custom("SpaceGrotesk-Regular", size: 9))
            .lineLimit(2)
        }
        .widgetCanvas()

      default:
        VStack(spacing: 0) {
          Image(systemName: "tshirt.fill")
            .font(.system(size: 11))
          Text(entry.data.feelsLikeTemp)
            .font(.custom("SpaceGrotesk-Regular", size: 9).weight(.bold))
        }
        .widgetCanvas()
      }
    }
    .widgetURL(URL(string: "couturecast-watch://handoff?slot=now"))
  }
}

extension View {
  @ViewBuilder
  fileprivate func widgetCanvas() -> some View {
    if #available(watchOS 10.0, *) {
      containerBackground(for: .widget) {}
    }
  }
}

@main
struct WatchWidget: Widget {
  let kind = "WatchWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ComplicationProvider()) { entry in
      ComplicationView(entry: entry)
    }
    .configurationDisplayName("CoutureCast")
    .description("CoutureCast outfit and weather cues.")
    .supportedFamilies([
      .accessoryCircular,
      .accessoryCorner,
      .accessoryInline,
      .accessoryRectangular,
    ])
  }
}

// MARK: - Weather Symbol Helpers

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
