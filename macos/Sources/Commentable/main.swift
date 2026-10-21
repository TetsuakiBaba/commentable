import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Dock には出さず、メニューバーのアイコンから操作する（Info.plist の LSUIElement と同じ）
app.setActivationPolicy(.accessory)
app.run()
