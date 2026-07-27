import SwiftUI

private let onyx = Color(red: 17 / 255, green: 17 / 255, blue: 17 / 255)
private let gold = Color(red: 201 / 255, green: 161 / 255, blue: 74 / 255)
private let cloud = Color(red: 240 / 255, green: 240 / 255, blue: 245 / 255)

struct WatchContentView: View {
  @ObservedObject var connectivityManager: WatchConnectivityManager
  @State private var selectedTab = 0
  private let injectedData: WidgetData?

  init(
    connectivityManager: WatchConnectivityManager = .shared,
    injectedPayload: String? = WatchUITestConfiguration.payload
  ) {
    self.connectivityManager = connectivityManager
    injectedData =
      injectedPayload
      .flatMap { $0.data(using: .utf8) }
      .flatMap { try? JSONDecoder().decode(WidgetData.self, from: $0) }
  }

  var data: WidgetData {
    if let injectedData {
      return injectedData
    }
    if let payload = connectivityManager.currentPayload,
      let data = payload.data(using: .utf8),
      let decoded = try? JSONDecoder().decode(WidgetData.self, from: data),
      !decoded.isStale(at: Date())
    {
      return decoded
    }
    return loadLocalData()
  }

  var body: some View {
    VStack(spacing: 0) {
      TabView(selection: $selectedTab) {
        // Page 1: NOW forecast & outfit
        NowView(data: data)
          .tag(0)

        // Page 2: NEXT forecast & outfit
        NextView(data: data)
          .tag(1)
      }
      .tabViewStyle(PageTabViewStyle())
      .background(Color.white)

      // Luxury bottom branding indicator
      HStack(spacing: 4) {
        Circle()
          .fill(selectedTab == 0 ? gold : onyx.opacity(0.2))
          .frame(width: 5, height: 5)
        Circle()
          .fill(selectedTab == 1 ? gold : onyx.opacity(0.2))
          .frame(width: 5, height: 5)
      }
      .padding(.bottom, 6)
      .background(Color.white)
    }
    .ignoresSafeArea(.all, edges: .bottom)
  }

  private func loadLocalData() -> WidgetData {
    guard let sharedDefaults = UserDefaults(suiteName: "group.com.anonymous.mobile.watch"),
      let payload = sharedDefaults.string(forKey: "widgetPayload"),
      let data = payload.data(using: .utf8),
      let decoded = try? JSONDecoder().decode(WidgetData.self, from: data),
      !decoded.isStale(at: Date())
    else {
      return WidgetData.empty()
    }
    return decoded
  }
}

// MARK: - Now View (Page 1)

struct NowView: View {
  let data: WidgetData

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(data.nowLabel)
              .font(.custom("SpaceGrotesk-Regular", size: 10).weight(.bold))
              .tracking(1)
              .foregroundColor(onyx)
              .accessibilityIdentifier("watch.now.label")

            Text(data.feelsLikeTemp)
              .font(.custom("SpaceGrotesk-Regular", size: 28).weight(.bold))
              .foregroundColor(onyx)
              .accessibilityIdentifier("watch.now.feelsLikeTemp")
          }

          Spacer()

          Image(systemName: weatherSymbol(for: data.currentConditionIcon))
            .font(.system(size: 26))
            .foregroundColor(gold)
            .accessibilityLabel(data.currentConditionText)
            .accessibilityIdentifier("watch.now.condition")
        }

        Divider()
          .background(gold.opacity(0.3))

        Text(data.nowOutfitSummary)
          .font(.custom("SpaceGrotesk-Regular", size: 12))
          .foregroundColor(onyx.opacity(0.85))
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("watch.now.outfitSummary")

        Button(action: {
          WatchConnectivityManager.shared.handoffToPhone(slot: "now")
        }) {
          HStack {
            Spacer()
            Text(data.unavailableLabel)
              .font(.custom("SpaceGrotesk-Regular", size: 10).weight(.semibold))
              .foregroundColor(.white)
            Spacer()
          }
          .padding(.vertical, 6)
          .background(onyx)
          .cornerRadius(6)
        }
        .buttonStyle(PlainButtonStyle())
        .padding(.top, 4)
        .accessibilityIdentifier("watch.now.handoff")
      }
      .padding(.horizontal, 8)
      .padding(.top, 4)
    }
    .accessibilityIdentifier("watch.page.now")
  }
}

// MARK: - Next View (Page 2)

struct NextView: View {
  let data: WidgetData

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
              Text(
                data.nextHourTime.isEmpty
                  ? data.unavailableLabel
                  : data.nextHourLabel
              )
              .font(.custom("SpaceGrotesk-Regular", size: 10).weight(.bold))
              .foregroundColor(onyx)
              .accessibilityIdentifier("watch.next.label")

              Text(data.nextHourTime)
                .font(.custom("SpaceGrotesk-Regular", size: 9))
                .foregroundColor(onyx.opacity(0.6))
                .accessibilityIdentifier("watch.next.time")
            }

            Text(data.nextHourTemp.isEmpty ? "--" : data.nextHourTemp)
              .font(.custom("SpaceGrotesk-Regular", size: 26).weight(.bold))
              .foregroundColor(onyx)
              .accessibilityIdentifier("watch.next.temperature")
          }

          Spacer()

          Image(systemName: weatherSymbol(for: data.nextHourIcon))
            .font(.system(size: 26))
            .foregroundColor(gold)
            .accessibilityLabel(
              data.nextConditionText.isEmpty
                ? data.unavailableLabel
                : data.nextConditionText
            )
            .accessibilityIdentifier("watch.next.condition")
        }

        if !data.nextHourPrecipitation.isEmpty && data.nextHourPrecipitation != "--" {
          Text("\(data.precipitationLabel) \(data.nextHourPrecipitation)")
            .font(.custom("SpaceGrotesk-Regular", size: 9))
            .foregroundColor(onyx.opacity(0.6))
            .accessibilityIdentifier("watch.next.precipitation")
        }

        Divider()
          .background(gold.opacity(0.3))

        Text(
          data.nextOutfitSummary.isEmpty
            ? data.unavailableLabel
            : data.nextOutfitSummary
        )
        .font(.custom("SpaceGrotesk-Regular", size: 12))
        .foregroundColor(onyx.opacity(0.85))
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("watch.next.outfitSummary")

        Button(action: {
          WatchConnectivityManager.shared.handoffToPhone(slot: "next")
        }) {
          HStack {
            Spacer()
            Text(data.unavailableLabel)
              .font(.custom("SpaceGrotesk-Regular", size: 10).weight(.semibold))
              .foregroundColor(.white)
            Spacer()
          }
          .padding(.vertical, 6)
          .background(onyx)
          .cornerRadius(6)
        }
        .buttonStyle(PlainButtonStyle())
        .padding(.top, 4)
        .accessibilityIdentifier("watch.next.handoff")
      }
      .padding(.horizontal, 8)
      .padding(.top, 4)
    }
    .accessibilityIdentifier("watch.page.next")
  }
}

enum WatchUITestConfiguration {
  static var isEnabled: Bool {
    ProcessInfo.processInfo.arguments.contains("-CoutureCastWatchUITestMode")
  }

  static var payload: String? {
    guard isEnabled else {
      return nil
    }
    return ProcessInfo.processInfo.environment["COUTURECAST_WATCH_UI_TEST_PAYLOAD"]
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
