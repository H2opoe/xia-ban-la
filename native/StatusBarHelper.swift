import AppKit
import Foundation

final class StatusBarDelegate: NSObject, NSApplicationDelegate {
    private let targetPid: pid_t
    private let iconPath: String?
    private let boundsFilePath: String?
    private var statusItem: NSStatusItem?
    private var parentWatcher: Timer?

    init(targetPid: pid_t, iconPath: String?, boundsFilePath: String?) {
        self.targetPid = targetPid
        self.iconPath = iconPath
        self.boundsFilePath = boundsFilePath
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
        writeStatusItemBounds()
        DispatchQueue.main.async { [weak self] in
            self?.writeStatusItemBounds()
        }

        parentWatcher = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.terminateIfParentExited()
        }
    }

    @objc private func handleStatusItemClick() {
        guard targetPid > 0 else {
            return
        }

        writeStatusItemBounds()
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
        // 这里必须使用模板图标，否则白色 SVG 在浅色菜单栏里会看起来像入口消失。
        image.isTemplate = true
        statusItem?.length = NSStatusItem.squareLength
        statusItem?.button?.title = ""
        statusItem?.button?.image = image
        statusItem?.button?.imagePosition = .imageOnly
        writeStatusItemBounds()
    }

    private func writeStatusItemBounds() {
        guard let boundsFilePath,
              let button = statusItem?.button,
              let window = button.window,
              let screen = window.screen else {
            return
        }

        let screenBounds = screen.frame
        let buttonBounds = window.convertToScreen(button.frame)
        // Electron 使用屏幕左上角为原点；AppKit 的全局坐标以左下角为原点，需要在同一块屏幕内转换。
        let electronY = screenBounds.maxY - buttonBounds.maxY + screenBounds.minY
        let payload = """
        {"x":\(Int(buttonBounds.origin.x.rounded())),"y":\(Int(electronY.rounded())),"width":\(Int(buttonBounds.width.rounded())),"height":\(Int(buttonBounds.height.rounded()))}
        """

        do {
            try payload.write(toFile: boundsFilePath, atomically: true, encoding: .utf8)
        } catch {
            NSLog("Failed to write status item bounds: \(error.localizedDescription)")
        }
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
    iconPath: parseArgumentValue("--icon"),
    boundsFilePath: parseArgumentValue("--bounds-file")
)
app.delegate = delegate
app.run()
