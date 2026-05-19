import AppKit
import Foundation

final class StatusBarDelegate: NSObject, NSApplicationDelegate {
    private let targetPid: pid_t
    private let iconPath: String?
    private var statusItem: NSStatusItem?
    private var parentWatcher: Timer?

    init(targetPid: pid_t, iconPath: String?) {
        self.targetPid = targetPid
        self.iconPath = iconPath
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.toolTip = "下班啦"
        item.button?.target = self
        item.button?.action = #selector(handleStatusItemClick)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
        statusItem = item
        applyStatusIcon()

        parentWatcher = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.terminateIfParentExited()
        }
    }

    @objc private func handleStatusItemClick() {
        guard targetPid > 0 else {
            return
        }

        if NSApp.currentEvent?.type == .rightMouseUp {
            kill(targetPid, SIGUSR2)
            return
        }

        kill(targetPid, SIGUSR1)
    }

    private func applyStatusIcon() {
        guard let iconPath, let image = NSImage(contentsOfFile: iconPath), !image.representations.isEmpty else {
            // 图标资源缺失时保留文字入口，避免菜单栏应用没有可点击入口。
            statusItem?.length = NSStatusItem.variableLength
            statusItem?.button?.title = "下班啦"
            statusItem?.button?.image = nil
            return
        }

        image.size = NSSize(width: 18, height: 18)
        image.isTemplate = false
        statusItem?.length = NSStatusItem.squareLength
        statusItem?.button?.title = ""
        statusItem?.button?.image = image
        statusItem?.button?.imagePosition = .imageOnly
    }

    private func terminateIfParentExited() {
        guard targetPid > 0 else {
            NSApp.terminate(nil)
            return
        }

        if kill(targetPid, 0) != 0 {
            NSApp.terminate(nil)
        }
    }
}

func parseArgumentValue(_ name: String) -> String? {
    let arguments = CommandLine.arguments
    guard let flagIndex = arguments.firstIndex(of: name) else {
        return nil
    }

    let valueIndex = arguments.index(after: flagIndex)
    guard valueIndex < arguments.endIndex else {
        return nil
    }

    return arguments[valueIndex]
}

func parseTargetPid() -> pid_t {
    guard let pidValue = parseArgumentValue("--pid") else {
        return 0
    }

    return pid_t(pidValue) ?? 0
}

let app = NSApplication.shared
let delegate = StatusBarDelegate(
    targetPid: parseTargetPid(),
    iconPath: parseArgumentValue("--icon")
)
app.delegate = delegate
app.run()
