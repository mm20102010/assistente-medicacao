import WidgetKit
import SwiftUI
import Foundation

private enum AssistenteSharedSnapshot {
    static let suiteName = "group.br.com.mmregistro.assistentemedicacao.watch"
    static let key = "mm.assistente.complication.snapshot.v1"

    static func read() -> (planned: Int, taken: Int, next: Date?) {
        guard let dictionary = UserDefaults(suiteName: suiteName)?.dictionary(forKey: key) else {
            return (0, 0, nil)
        }
        let planned = dictionary["todayPlanned"] as? Int ?? 0
        let taken = dictionary["todayTaken"] as? Int ?? 0
        let next = (dictionary["nextScheduledAt"] as? Double).map(Date.init(timeIntervalSince1970:))
        return (planned, taken, next)
    }
}

private struct AssistenteEntry: TimelineEntry {
    let date: Date
    let planned: Int
    let taken: Int
    let next: Date?
}

private struct AssistenteProvider: TimelineProvider {
    func placeholder(in context: Context) -> AssistenteEntry {
        AssistenteEntry(date: .now, planned: 3, taken: 1, next: Date().addingTimeInterval(3600))
    }

    func getSnapshot(in context: Context, completion: @escaping (AssistenteEntry) -> Void) {
        completion(entry(at: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AssistenteEntry>) -> Void) {
        let now = Date()
        let snapshot = AssistenteSharedSnapshot.read()
        var dates = [now]

        if let next = snapshot.next, next > now {
            let remainingMinutes = max(0, Int(next.timeIntervalSince(now) / 60))
            let maxMinutes = min(180, remainingMinutes)
            for minute in 0...maxMinutes {
                dates.append(now.addingTimeInterval(Double(minute * 60)))
            }
            dates.append(next)
        }

        let uniqueDates = dates.sorted().reduce(into: [Date]()) { result, date in
            if result.last.map({ abs($0.timeIntervalSince(date)) < 0.5 }) != true {
                result.append(date)
            }
        }
        let entries = uniqueDates.map { entry(at: $0) }
        let refresh = max(now.addingTimeInterval(15 * 60), (snapshot.next ?? now.addingTimeInterval(30 * 60)).addingTimeInterval(60))
        completion(Timeline(entries: entries, policy: .after(refresh)))
    }

    private func entry(at date: Date) -> AssistenteEntry {
        let snapshot = AssistenteSharedSnapshot.read()
        return AssistenteEntry(date: date, planned: snapshot.planned, taken: snapshot.taken, next: snapshot.next)
    }
}

private struct AssistenteStatusView: View {
    let entry: AssistenteEntry

    private var progress: Double {
        entry.planned > 0 ? min(1, Double(entry.taken) / Double(entry.planned)) : 0
    }

    private var countdownLabel: String {
        guard let next = entry.next else { return "—" }
        let minutes = Int(next.timeIntervalSince(entry.date) / 60)
        if minutes < 0 {
            let elapsed = -minutes
            return elapsed < 60 ? "-\(elapsed)m" : "-\(elapsed / 60)h"
        }
        if minutes < 1 { return "<1m" }
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h"
    }

    private var accessibilitySummary: String {
        let format = String(localized: "complication.status.accessibility")
        return String(format: format, locale: Locale.current, entry.taken, entry.planned, countdownLabel)
    }

    var body: some View {
        Gauge(value: progress) {
            EmptyView()
        } currentValueLabel: {
            VStack(spacing: 0) {
                Text(countdownLabel)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                Text(verbatim: "\(entry.taken)/\(entry.planned)")
                    .font(.system(size: 8, weight: .semibold, design: .rounded))
            }
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .containerBackground(for: .widget) { Color.clear }
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }
}

private struct AssistenteStatusComplication: Widget {
    let kind = "AssistenteStatusComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AssistenteProvider()) { entry in
            AssistenteStatusView(entry: entry)
        }
        .configurationDisplayName(String(localized: "complication.status.name"))
        .description(String(localized: "complication.status.description"))
        .supportedFamilies([.accessoryCircular])
    }
}

@main
struct AssistenteComplicationsBundle: WidgetBundle {
    var body: some Widget {
        AssistenteStatusComplication()
    }
}
