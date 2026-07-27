import Foundation

private let watchPayloadStaleInterval: TimeInterval = 30 * 60

struct WidgetData: Codable {
  let currentTemp: String
  let feelsLikeTemp: String
  let currentConditionIcon: String
  let currentConditionText: String
  let nowOutfitSummary: String
  let nextHourTime: String
  let nextHourTemp: String
  let nextHourIcon: String
  let nextConditionText: String
  let nextHourPrecipitation: String
  let nextOutfitSummary: String
  let lastUpdated: String
  let locale: String
  let nowLabel: String
  let nextHourLabel: String
  let staleLabel: String
  let unavailableLabel: String
  let precipitationLabel: String
  let alertsEnabled: Bool
  let hasSevereAlert: Bool
  let severeAlertId: String?
  let severeAlertTitle: String
  let severeAlertDescription: String
  let severeAlertStart: String?
  let severeAlertEnd: String?
  let quietHoursEnabled: Bool
  let quietHoursStart: String
  let quietHoursEnd: String
  let timezone: String

  private enum CodingKeys: String, CodingKey {
    case currentTemp
    case feelsLikeTemp
    case currentConditionIcon
    case currentConditionText
    case nowOutfitSummary
    case nextHourTime
    case nextHourTemp
    case nextHourIcon
    case nextConditionText
    case nextHourPrecipitation
    case nextOutfitSummary
    case lastUpdated
    case locale
    case nowLabel
    case nextHourLabel
    case staleLabel
    case unavailableLabel
    case precipitationLabel
    case alertsEnabled
    case hasSevereAlert
    case severeAlertId
    case severeAlertTitle
    case severeAlertDescription
    case severeAlertStart
    case severeAlertEnd
    case quietHoursEnabled
    case quietHoursStart
    case quietHoursEnd
    case timezone
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let decodedLocale =
      try container.decodeIfPresent(String.self, forKey: .locale)
      ?? Locale.current.identifier
    let fallback = Self.empty(locale: decodedLocale)

    currentTemp =
      try container.decodeIfPresent(String.self, forKey: .currentTemp)
      ?? fallback.currentTemp
    feelsLikeTemp =
      try container.decodeIfPresent(String.self, forKey: .feelsLikeTemp)
      ?? fallback.feelsLikeTemp
    currentConditionIcon =
      try container.decodeIfPresent(String.self, forKey: .currentConditionIcon)
      ?? fallback.currentConditionIcon
    currentConditionText =
      try container.decodeIfPresent(String.self, forKey: .currentConditionText)
      ?? fallback.currentConditionText
    nowOutfitSummary =
      try container.decodeIfPresent(String.self, forKey: .nowOutfitSummary)
      ?? fallback.nowOutfitSummary
    nextHourTime =
      try container.decodeIfPresent(String.self, forKey: .nextHourTime)
      ?? fallback.nextHourTime
    nextHourTemp =
      try container.decodeIfPresent(String.self, forKey: .nextHourTemp)
      ?? fallback.nextHourTemp
    nextHourIcon =
      try container.decodeIfPresent(String.self, forKey: .nextHourIcon)
      ?? fallback.nextHourIcon
    nextConditionText =
      try container.decodeIfPresent(String.self, forKey: .nextConditionText)
      ?? fallback.nextConditionText
    nextHourPrecipitation =
      try container.decodeIfPresent(String.self, forKey: .nextHourPrecipitation)
      ?? fallback.nextHourPrecipitation
    nextOutfitSummary =
      try container.decodeIfPresent(String.self, forKey: .nextOutfitSummary)
      ?? fallback.nextOutfitSummary
    lastUpdated =
      try container.decodeIfPresent(String.self, forKey: .lastUpdated)
      ?? fallback.lastUpdated
    locale = decodedLocale
    nowLabel =
      try container.decodeIfPresent(String.self, forKey: .nowLabel)
      ?? fallback.nowLabel
    nextHourLabel =
      try container.decodeIfPresent(String.self, forKey: .nextHourLabel)
      ?? fallback.nextHourLabel
    staleLabel =
      try container.decodeIfPresent(String.self, forKey: .staleLabel)
      ?? fallback.staleLabel
    unavailableLabel =
      try container.decodeIfPresent(String.self, forKey: .unavailableLabel)
      ?? fallback.unavailableLabel
    precipitationLabel =
      try container.decodeIfPresent(String.self, forKey: .precipitationLabel)
      ?? fallback.precipitationLabel
    alertsEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .alertsEnabled)
      ?? fallback.alertsEnabled
    hasSevereAlert =
      try container.decodeIfPresent(Bool.self, forKey: .hasSevereAlert)
      ?? fallback.hasSevereAlert
    severeAlertId = try container.decodeIfPresent(String.self, forKey: .severeAlertId)
    severeAlertTitle =
      try container.decodeIfPresent(String.self, forKey: .severeAlertTitle)
      ?? fallback.severeAlertTitle
    severeAlertDescription =
      try container.decodeIfPresent(String.self, forKey: .severeAlertDescription)
      ?? fallback.severeAlertDescription
    severeAlertStart = try container.decodeIfPresent(String.self, forKey: .severeAlertStart)
    severeAlertEnd = try container.decodeIfPresent(String.self, forKey: .severeAlertEnd)
    quietHoursEnabled =
      try container.decodeIfPresent(Bool.self, forKey: .quietHoursEnabled)
      ?? fallback.quietHoursEnabled
    quietHoursStart =
      try container.decodeIfPresent(String.self, forKey: .quietHoursStart)
      ?? fallback.quietHoursStart
    quietHoursEnd =
      try container.decodeIfPresent(String.self, forKey: .quietHoursEnd)
      ?? fallback.quietHoursEnd
    timezone =
      try container.decodeIfPresent(String.self, forKey: .timezone)
      ?? fallback.timezone
  }

  init(
    currentTemp: String,
    feelsLikeTemp: String,
    currentConditionIcon: String,
    currentConditionText: String,
    nowOutfitSummary: String,
    nextHourTime: String,
    nextHourTemp: String,
    nextHourIcon: String,
    nextConditionText: String,
    nextHourPrecipitation: String,
    nextOutfitSummary: String,
    lastUpdated: String,
    locale: String,
    nowLabel: String,
    nextHourLabel: String,
    staleLabel: String,
    unavailableLabel: String,
    precipitationLabel: String,
    alertsEnabled: Bool,
    hasSevereAlert: Bool,
    severeAlertId: String?,
    severeAlertTitle: String,
    severeAlertDescription: String,
    severeAlertStart: String?,
    severeAlertEnd: String?,
    quietHoursEnabled: Bool,
    quietHoursStart: String,
    quietHoursEnd: String,
    timezone: String
  ) {
    self.currentTemp = currentTemp
    self.feelsLikeTemp = feelsLikeTemp
    self.currentConditionIcon = currentConditionIcon
    self.currentConditionText = currentConditionText
    self.nowOutfitSummary = nowOutfitSummary
    self.nextHourTime = nextHourTime
    self.nextHourTemp = nextHourTemp
    self.nextHourIcon = nextHourIcon
    self.nextConditionText = nextConditionText
    self.nextHourPrecipitation = nextHourPrecipitation
    self.nextOutfitSummary = nextOutfitSummary
    self.lastUpdated = lastUpdated
    self.locale = locale
    self.nowLabel = nowLabel
    self.nextHourLabel = nextHourLabel
    self.staleLabel = staleLabel
    self.unavailableLabel = unavailableLabel
    self.precipitationLabel = precipitationLabel
    self.alertsEnabled = alertsEnabled
    self.hasSevereAlert = hasSevereAlert
    self.severeAlertId = severeAlertId
    self.severeAlertTitle = severeAlertTitle
    self.severeAlertDescription = severeAlertDescription
    self.severeAlertStart = severeAlertStart
    self.severeAlertEnd = severeAlertEnd
    self.quietHoursEnabled = quietHoursEnabled
    self.quietHoursStart = quietHoursStart
    self.quietHoursEnd = quietHoursEnd
    self.timezone = timezone
  }

  static func empty(locale: String = Locale.current.identifier) -> WidgetData {
    WidgetData(
      currentTemp: "--",
      feelsLikeTemp: "--",
      currentConditionIcon: "unknown",
      currentConditionText: "Weather unavailable",
      nowOutfitSummary: "Open app for recommendations",
      nextHourTime: "",
      nextHourTemp: "--",
      nextHourIcon: "unknown",
      nextConditionText: "Weather unavailable",
      nextHourPrecipitation: "--",
      nextOutfitSummary: "Open app for recommendations",
      lastUpdated: "",
      locale: locale,
      nowLabel: "NOW",
      nextHourLabel: "NEXT HOUR",
      staleLabel: "Stale",
      unavailableLabel: "Open app for recommendations",
      precipitationLabel: "Precipitation",
      alertsEnabled: false,
      hasSevereAlert: false,
      severeAlertId: nil,
      severeAlertTitle: "",
      severeAlertDescription: "",
      severeAlertStart: nil,
      severeAlertEnd: nil,
      quietHoursEnabled: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      timezone: "UTC"
    )
  }

  func isStale(at date: Date) -> Bool {
    guard let updatedAt = WatchTimestamp.parse(lastUpdated) else {
      return true
    }
    let age = date.timeIntervalSince(updatedAt)
    return age < 0 || age >= watchPayloadStaleInterval
  }

  func hasActiveSevereAlert(at date: Date) -> Bool {
    guard alertsEnabled, hasSevereAlert,
      let startValue = severeAlertStart,
      let endValue = severeAlertEnd,
      let start = WatchTimestamp.parse(startValue),
      let end = WatchTimestamp.parse(endValue)
    else {
      return false
    }
    return start <= date && date < end
  }

  var alertFingerprint: String? {
    guard let severeAlertId, !severeAlertId.isEmpty else {
      return nil
    }
    return severeAlertId
  }
}

enum WatchTimestamp {
  private static let fractionalFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let standardFormatter = ISO8601DateFormatter()

  static func parse(_ value: String) -> Date? {
    fractionalFormatter.date(from: value) ?? standardFormatter.date(from: value)
  }
}

enum WatchPayloadAcceptance {
  static func shouldAccept(incoming: WidgetData, current: WidgetData?) -> Bool {
    guard let current else {
      return true
    }
    guard let incomingDate = WatchTimestamp.parse(incoming.lastUpdated) else {
      return false
    }
    guard let currentDate = WatchTimestamp.parse(current.lastUpdated) else {
      return true
    }
    return incomingDate > currentDate
  }
}

enum WatchQuietHours {
  static func contains(
    date: Date,
    start: String,
    end: String,
    timeZoneIdentifier: String
  ) -> Bool {
    guard let startMinute = minuteOfDay(start),
      let endMinute = minuteOfDay(end),
      startMinute != endMinute
    else {
      return true
    }

    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timeZoneIdentifier) ?? .current
    let components = calendar.dateComponents([.hour, .minute], from: date)
    guard let hour = components.hour, let minute = components.minute else {
      return true
    }
    let currentMinute = hour * 60 + minute
    if startMinute < endMinute {
      return currentMinute >= startMinute && currentMinute < endMinute
    }
    return currentMinute >= startMinute || currentMinute < endMinute
  }

  private static func minuteOfDay(_ value: String) -> Int? {
    let components = value.split(separator: ":", omittingEmptySubsequences: false)
    guard components.count == 2,
      components[0].count == 2,
      components[1].count == 2,
      let hour = Int(components[0]),
      let minute = Int(components[1]),
      (0...23).contains(hour),
      (0...59).contains(minute)
    else {
      return nil
    }
    return hour * 60 + minute
  }
}
