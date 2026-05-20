import EventKit
import Foundation

private let maxItemsPerKind = 24
private let lookAheadDays = 60

struct AccessState: Codable {
    let kind: String
    let status: String
    let granted: Bool
    let message: String?
}

struct ExternalItem: Codable {
    let id: String
    let seriesId: String?
    let provider: String
    let title: String
    let startTime: String
    let completed: Bool?
    let completedAt: String?
    let lastModifiedAt: String?
    let isRecurring: Bool?
}

struct BridgeOutput: Codable {
    let events: [ExternalItem]
    let access: [AccessState]
    let message: String
}

struct BridgeFailure: Codable {
    let events: [ExternalItem]
    let access: [AccessState]
    let message: String
}

let command = CommandLine.arguments.dropFirst().first ?? "list"
guard command == "list" else {
    writeJson(BridgeFailure(
        events: [],
        access: [
            AccessState(kind: "calendar", status: "error", granted: false, message: "不支持的日程同步命令"),
            AccessState(kind: "reminders", status: "error", granted: false, message: "不支持的日程同步命令")
        ],
        message: "不支持的日程同步命令"
    ))
    exit(1)
}

let store = EKEventStore()
let calendarAccess = requestCalendarAccess(store)
let remindersAccess = requestRemindersAccess(store)
var items: [ExternalItem] = []

if calendarAccess.granted {
    items.append(contentsOf: fetchCalendarEvents(store))
}

if remindersAccess.granted {
    items.append(contentsOf: fetchReminders(store))
}

items.sort { first, second in
    first.startTime < second.startTime
}

writeJson(BridgeOutput(
    events: items,
    access: [calendarAccess, remindersAccess],
    message: buildMessage(items: items, access: [calendarAccess, remindersAccess])
))

func requestCalendarAccess(_ store: EKEventStore) -> AccessState {
    let currentStatus = EKEventStore.authorizationStatus(for: .event)
    if isReadableCalendarStatus(currentStatus) {
        return AccessState(kind: "calendar", status: statusName(currentStatus), granted: true, message: nil)
    }

    if canRequestCalendarFullAccess(currentStatus) {
        let granted = waitForAccessRequest { completion in
            if #available(macOS 14.0, *) {
                store.requestFullAccessToEvents(completion: completion)
            } else {
                store.requestAccess(to: .event, completion: completion)
            }
        }
        let nextStatus = EKEventStore.authorizationStatus(for: .event)
        if granted && isReadableCalendarStatus(nextStatus) {
            return AccessState(kind: "calendar", status: statusName(nextStatus), granted: true, message: nil)
        }
        return AccessState(
            kind: "calendar",
            status: statusName(nextStatus),
            granted: false,
            message: accessMessage(kind: "日历", status: nextStatus)
        )
    }

    return AccessState(
        kind: "calendar",
        status: statusName(currentStatus),
        granted: false,
        message: accessMessage(kind: "日历", status: currentStatus)
    )
}

func requestRemindersAccess(_ store: EKEventStore) -> AccessState {
    let currentStatus = EKEventStore.authorizationStatus(for: .reminder)
    if isReadableReminderStatus(currentStatus) {
        return AccessState(kind: "reminders", status: statusName(currentStatus), granted: true, message: nil)
    }

    if currentStatus == .notDetermined {
        let granted = waitForAccessRequest { completion in
            if #available(macOS 14.0, *) {
                store.requestFullAccessToReminders(completion: completion)
            } else {
                store.requestAccess(to: .reminder, completion: completion)
            }
        }
        let nextStatus = EKEventStore.authorizationStatus(for: .reminder)
        if granted && isReadableReminderStatus(nextStatus) {
            return AccessState(kind: "reminders", status: statusName(nextStatus), granted: true, message: nil)
        }
        return AccessState(
            kind: "reminders",
            status: statusName(nextStatus),
            granted: false,
            message: accessMessage(kind: "提醒事项", status: nextStatus)
        )
    }

    return AccessState(
        kind: "reminders",
        status: statusName(currentStatus),
        granted: false,
        message: accessMessage(kind: "提醒事项", status: currentStatus)
    )
}

func fetchCalendarEvents(_ store: EKEventStore) -> [ExternalItem] {
    let calendar = Calendar.current
    let start = Date()
    let end = calendar.date(byAdding: .day, value: lookAheadDays, to: start) ?? start
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)

    let items: [ExternalItem] = store.events(matching: predicate)
        .filter { !$0.isAllDay }
        .sorted { $0.startDate < $1.startDate }
        .compactMap { event -> ExternalItem? in
            guard let startDate = event.startDate else {
                return nil
            }

            return ExternalItem(
                id: event.eventIdentifier ?? event.calendarItemIdentifier,
                seriesId: event.calendarItemIdentifier,
                provider: "macos-calendar",
                title: event.title?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? event.title : "未命名日程",
                startTime: isoString(startDate),
                completed: false,
                completedAt: nil,
                lastModifiedAt: event.lastModifiedDate.map { isoString($0) },
                isRecurring: hasRecurrenceRules(event)
            )
        }

    return nextItemsBySeries(items).prefixArray(maxItemsPerKind)
}

func fetchReminders(_ store: EKEventStore) -> [ExternalItem] {
    let calendar = Calendar.current
    let start = calendar.startOfDay(for: Date())
    let end = calendar.date(byAdding: .day, value: lookAheadDays, to: start) ?? start
    let predicate = store.predicateForReminders(in: nil)
    let semaphore = DispatchSemaphore(value: 0)
    var reminders: [EKReminder] = []

    let request = store.fetchReminders(matching: predicate) { fetchedReminders in
        reminders = fetchedReminders ?? []
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 15) == .timedOut {
        store.cancelFetchRequest(request)
        return []
    }

    let items: [ExternalItem] = reminders
        .filter { reminder in
            guard let dueDate = reminderDate(reminder) else {
                return false
            }
            return dueDate >= start && dueDate <= end
        }
        .sorted {
            (reminderDate($0) ?? Date.distantFuture) < (reminderDate($1) ?? Date.distantFuture)
        }
        .compactMap { reminder -> ExternalItem? in
            guard let dueDate = reminderDate(reminder) else {
                return nil
            }

            return ExternalItem(
                id: reminder.calendarItemIdentifier,
                seriesId: reminder.calendarItemIdentifier,
                provider: "macos-reminders",
                title: reminder.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "未命名提醒事项" : reminder.title,
                startTime: isoString(dueDate),
                completed: reminder.isCompleted,
                completedAt: reminder.completionDate.map { isoString($0) },
                lastModifiedAt: reminder.lastModifiedDate.map { isoString($0) },
                isRecurring: hasRecurrenceRules(reminder)
            )
        }

    return nextItemsBySeries(items).prefixArray(maxItemsPerKind)
}

func nextItemsBySeries(_ items: [ExternalItem]) -> [ExternalItem] {
    var seen = Set<String>()
    var nextItems: [ExternalItem] = []

    for item in items.sorted(by: { $0.startTime < $1.startTime }) {
        let seriesKey = "\(item.provider):\(item.seriesId ?? item.id)"
        if seen.contains(seriesKey) {
            continue
        }
        seen.insert(seriesKey)
        nextItems.append(item)
    }

    return nextItems
}

func hasRecurrenceRules(_ item: EKCalendarItem) -> Bool {
    return item.recurrenceRules?.isEmpty == false
}

extension Array {
    func prefixArray(_ maxLength: Int) -> [Element] {
        return Array(prefix(maxLength))
    }
}

func reminderDate(_ reminder: EKReminder) -> Date? {
    guard let dueDateComponents = reminder.dueDateComponents else {
        return nil
    }

    var components = dueDateComponents
    if components.hour == nil {
        components.hour = 9
    }
    if components.minute == nil {
        components.minute = 0
    }
    if components.second == nil {
        components.second = 0
    }

    return components.calendar?.date(from: components) ?? Calendar.current.date(from: components)
}

func isReadableCalendarStatus(_ status: EKAuthorizationStatus) -> Bool {
    if #available(macOS 14.0, *) {
        return status == .fullAccess || status == .authorized
    }

    return status == .authorized
}

func isReadableReminderStatus(_ status: EKAuthorizationStatus) -> Bool {
    if #available(macOS 14.0, *) {
        return status == .fullAccess || status == .authorized
    }

    return status == .authorized
}

func canRequestCalendarFullAccess(_ status: EKAuthorizationStatus) -> Bool {
    if status == .notDetermined {
        return true
    }

    if #available(macOS 14.0, *) {
        return status == .writeOnly
    }

    return false
}

func statusName(_ status: EKAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
        return "not-determined"
    case .restricted:
        return "restricted"
    case .denied:
        return "denied"
    case .authorized:
        return "authorized"
    default:
        if #available(macOS 14.0, *) {
            if status == .fullAccess {
                return "full-access"
            }
            if status == .writeOnly {
                return "write-only"
            }
        }
        return "error"
    }
}

func accessMessage(kind: String, status: EKAuthorizationStatus) -> String {
    let settingsPath = accessSettingsPath(kind: kind)

    if status == .denied || status == .restricted {
        return "未获得\(kind)访问权限。请打开 \(settingsPath)，允许“下班啦”访问后再重试。"
    }

    if status == .notDetermined {
        return "尚未完成\(kind)授权。请在系统弹窗中点击“允许”；如果没有看到弹窗，请打开 \(settingsPath)，允许“下班啦”访问后再重试。"
    }

    if #available(macOS 14.0, *), status == .writeOnly {
        return "当前只有日历写入权限，读取日历日程需要完整访问权限。请打开 \(settingsPath)，将“下班啦”改为完整访问后再重试。"
    }

    return "无法读取本机\(readableName(kind: kind))。请打开 \(settingsPath)，确认“下班啦”已允许访问后再重试。"
}

func accessSettingsPath(kind: String) -> String {
    return "系统设置 > 隐私与安全性 > \(kind)"
}

func readableName(kind: String) -> String {
    return kind == "日历" ? "日历日程" : "提醒事项"
}

func waitForAccessRequest(_ request: (@escaping (Bool, Error?) -> Void) -> Void) -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false

    request { nextGranted, _ in
        granted = nextGranted
        semaphore.signal()
    }

    if semaphore.wait(timeout: .now() + 45) == .timedOut {
        return false
    }

    return granted
}

func buildMessage(items: [ExternalItem], access: [AccessState]) -> String {
    if let blockedAccess = access.first(where: { !$0.granted && $0.message != nil }) {
        return blockedAccess.message ?? "无法读取本机日程和提醒事项"
    }

    if items.isEmpty {
        return "没有读取到可绑定的外部项目"
    }

    return "读取到 \(items.count) 个外部项目"
}

func isoString(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

func writeJson<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    do {
        let data = try encoder.encode(value)
        if let text = String(data: data, encoding: .utf8) {
            print(text)
            return
        }
    } catch {
        // stdout 必须保持 JSON 格式，主进程才能给出可读错误。
    }

    print("{\"events\":[],\"access\":[],\"message\":\"日程同步助手编码返回值失败\"}")
}
