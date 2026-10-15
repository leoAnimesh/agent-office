# Mobile Devices (Android emulator and iOS Simulator) — Design Spec

Date: 2026-10-15
Status: Draft for review

## 1. Summary

Parts 2 and 3 of the team-device work. Employees can start an Android emulator or an iOS Simulator, install and launch the app they built, read the screen as a list of elements, tap, type, swipe, press keys, open local URLs and take screenshots, with the same tool server, per-employee tokens and Preview tab as the browser (part 1). The Preview tab gains the devices next to the browser tabs, shows them live and takes clicks and typing.

The app drives the devices with the platform tools the user already has: `adb` + `emulator` from the Android SDK, and `xcrun simctl` from Xcode, plus Facebook's `idb` for taps and typing on iOS. Nothing is bundled; missing tools are detected and explained.

## 2. Goals and non-goals

**Goals**
- An employee can check a mobile app or a mobile web page on Android and (on macOS) iOS without help.
- One device of each kind per project, used by one employee at a time; the others are told who has it.
- The user watches and uses a device from the Preview tab.
- Devices the app started are shut down when the project closes; devices the user started are left running.
- Works with what is installed: Android on macOS, Windows and Linux; iOS on macOS only.

**Non-goals**
- Real phones and tablets (only emulators and simulators).
- Creating Android virtual devices or downloading SDKs and simulator runtimes (the user does that in Android Studio / Xcode; the app explains how).
- Building the app (employees build with the project's own tools in their worktree, then install the result).
- Video-rate mirroring (the live view is a few frames per second; see §6).
- Several emulators per project.

## 3. Platform tools

### 3.1 Detection (`src/main/devices/detect.ts`)

| Kind | Needs | Found by |
| --- | --- | --- |
| Android | `adb`, `emulator`, at least one AVD | `ANDROID_HOME` / `ANDROID_SDK_ROOT`, else the default SDK folder per OS (`~/Library/Android/sdk`, `%LOCALAPPDATA%\Android\Sdk`, `~/Android/Sdk`), else `PATH`; AVDs from `emulator -list-avds` |
| iOS | macOS, `xcrun simctl`, at least one available iPhone simulator | `xcrun simctl list devices available -j` |
| iOS input | `idb` (optional) | `PATH` (after the GUI PATH fix) |

`detectDevices()` returns `{ android: { ok, sdk?, avds: string[], reason? }, ios: { ok, devices: { udid, name, runtime }[], idb: boolean, reason? } }` and is cached for 60 s.

### 3.2 Android (`src/main/devices/android.ts`)

- **Start:** if an emulator is already running (`adb devices` shows `emulator-NNNN device`), use it. Otherwise start the AVD chosen in project settings (default: the first in `-list-avds`) with `emulator -avd <name> -no-window -no-audio -no-boot-anim -no-snapshot-save -port <free even port 5554–5682>`, then wait for `adb -s emulator-<port> wait-for-device` and `getprop sys.boot_completed` = `1` (up to 180 s). Started emulators are remembered so they are killed (`adb -s … emu kill`, then `killTree`) on project close.
- **Screen as elements:** `adb exec-out uiautomator dump /dev/tty` → XML → nodes with `text`, `content-desc`, `resource-id`, `class`, `clickable`, `bounds`; shown to the agent as an indented outline with refs `[ref=a12]`, keeping clickable nodes and nodes with text or a description (≤ 40 KB).
- **Actions:** tap → `adb shell input tap x y` at the centre of the ref's bounds (or given x,y); type → `adb shell input text` with the text escaped for `input` (spaces as `%s`, shell-special characters escaped, sent as argv, never a shell string); swipe → `input swipe` (up/down/left/right across the middle 60 %); keys → `input keyevent` (`BACK`, `HOME`, `ENTER`, `DEL`, `TAB`, `APP_SWITCH`).
- **Apps:** install → `adb install -r <path>` (`.apk` inside the employee's worktree); launch → `adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1`; open URL → `adb shell am start -a android.intent.action.VIEW -d <url>`, with `localhost` / `127.0.0.1` rewritten to `10.0.2.2` (the host as seen from the emulator).
- **Screenshot:** `adb exec-out screencap -p` (PNG).
- **Logs:** `adb logcat -d -t 200 *:W` (warnings and errors), filtered to the launched package's process when known.

### 3.3 iOS (`src/main/devices/ios.ts`, macOS only)

- **Start:** use a booted simulator if one is booted; else boot the one chosen in project settings (default: the newest available iPhone) with `xcrun simctl boot <udid>` and wait for `xcrun simctl bootstatus <udid>` (up to 180 s). The Simulator app window is not opened. Simulators the app booted are shut down (`simctl shutdown`) on project close.
- **Screen as elements:** with idb: `idb ui describe-all --udid <udid> --json` → elements with `AXLabel`, `AXValue`, `type`, `frame` → the same outline with refs `[ref=i7]`. Without idb: the tool says "Reading the screen needs idb" and suggests `device_screenshot`.
- **Actions (idb):** tap → `idb ui tap x y`; type → `idb ui text`; swipe → `idb ui swipe`; keys → `idb ui key` (Enter, Delete, Tab) and `idb ui button HOME`. Without idb these return the install hint: "Tapping and typing on iOS need idb: `brew install facebook/fb/idb-companion` and `pip3 install fb-idb`".
- **Apps:** install → `xcrun simctl install <udid> <path>` (`.app` folder inside the worktree); launch → `xcrun simctl launch <udid> <bundle id>`; open URL → `xcrun simctl openurl <udid> <url>` (the simulator shares the host's network, so `localhost` works).
- **Screenshot:** `xcrun simctl io <udid> screenshot --type=png -` (stdout).
- **Logs:** `xcrun simctl spawn <udid> log show --last 2m --style compact --predicate 'messageType >= 16'` (errors and faults), cut to the last 200 lines.

### 3.4 Process rules

All commands run with argument arrays via `cross-spawn`, a 30 s timeout (boot waits excepted), and output caps (screenshots ≤ 10 MB, text ≤ 1 MB). Paths given by employees (`.apk`, `.app`) must resolve inside that employee's worktree (no `..`, no symlink escape: `realpath` is checked).

## 4. Sharing a device

- `DeviceService` (per project) holds at most one Android and one iOS device: `{ kind, id (serial / udid), name, startedByApp, holder: agentId | null }`.
- A device tool call by an employee takes the device if it is free or already theirs; otherwise it fails with "The Android emulator is in use by Byte (T-104). Try again when that task is finished, or ask the boss to sequence the work."
- The hold is released when the holder's work ends (`work-ended`, already emitted for tasks and plain questions) or the holder is fired. Releasing does not shut the device down.
- The user can always use a device from the Preview tab; the holder gets the same "the user used your device" note on its next tool result as with the browser.

## 5. Employee tools (on the existing `office` MCP server)

All take `platform: 'android' | 'ios'`.

| Tool | Input | Result |
| --- | --- | --- |
| `device_start` | `platform` | `{ name, id, booted: true }` (starts or reuses; takes the device) |
| `device_install` | `platform`, `path` | `{ installed: path }` |
| `device_launch` | `platform`, `app_id` (Android package / iOS bundle id) | `{ launched }` |
| `device_open_url` | `platform`, `url` (local only, rule from part 1) | `{ opened }` |
| `device_snapshot` | `platform` | outline with refs |
| `device_tap` | `platform`, `ref` or `x`,`y` | `{ ok }` |
| `device_type` | `platform`, `text` (≤ 2,000) | `{ ok }` |
| `device_swipe` | `platform`, `direction` | `{ ok }` |
| `device_press` | `platform`, `key` (`back` Android only, `home`, `enter`, `delete`, `tab`) | `{ ok }` |
| `device_screenshot` | `platform` | image (scaled so the long side ≤ 1568 px) |
| `device_logs` | `platform` | recent warnings and errors |
| `device_release` | `platform` | `{ released }` |

- The employee prompt's browser line is joined by: "For mobile apps: `device_start` (android or ios), install what you built with `device_install`, `device_launch`, then `device_snapshot` / `device_tap` / `device_type` and `device_screenshot` to verify. Use `device_open_url` for mobile web."
- The tools are part of the same "Employees can use a browser" project switch, renamed "Employees can use a browser and mobile devices".
- Unavailable platform → the detection reason (e.g. "No Android emulator found: create one in Android Studio (Device Manager)", "The iOS Simulator needs macOS with Xcode").

## 6. Preview tab

- The employee picker becomes a "Show" picker listing browser tabs ("Pixel · browser") and devices ("Android · Medium_Phone (Byte)", "iOS · iPhone 17 (free)").
- Devices stream by screenshot polling: about 3 frames per second while watched (Android `screencap`, iOS `simctl io screenshot`), a new screenshot only after the previous one was drawn (same back-pressure as part 1), paused when nothing is watched.
- Input on a device: click → tap (iOS needs idb; without it the view is read-only and says so), wheel → swipe, keys → the device keys above, printable characters → type.
- Buttons for a device: **Start** (if not running), **Home**, **Back** (Android), **Shut down** (only for devices the app started).
- Status line: "Android · Medium_Phone · used by Byte (T-104)" / "free".
- App Settings shows a "Mobile devices" section: what was found (SDK path, AVDs, simulators, idb) and how to install what is missing. Project Settings gets "Android device" and "iOS device" pickers (default: automatic).

## 7. Security

- Employees never pass binaries or shell strings: only enums, refs, short text and paths inside their own worktree; commands are argv arrays.
- URLs keep the local-only rule; Android's `10.0.2.2` rewrite happens in main after the check.
- A device is used by one employee at a time; the Preview tab is the user's and agents have no channel to it.
- The app only shuts down devices it started.

## 8. Error handling

| Case | Behaviour |
| --- | --- |
| SDK / Xcode / AVD / simulator missing | Tool error with the detection reason and how to fix it; Preview and Settings show the same. |
| Boot takes longer than 180 s | Error with the last emulator output lines; a device the app started is killed. |
| Device busy | Error naming the holder and task (§4). |
| iOS input without idb | Error with the install commands; screenshots and the read-only live view still work. |
| `uiautomator dump` fails (screen changing, secure window) | Retried once after 500 ms, then an error suggesting `device_screenshot`. |
| Device killed by the user | Next call reports it and `device_start` starts or attaches again. |
| Project closed / app quits | Holds dropped; devices the app started are shut down and awaited. |

## 9. Testing

- Unit (pure): uiautomator XML → outline and refs (fixture XML); idb JSON → outline and refs (fixture JSON); `input text` escaping; key mapping; host rewrite for Android URLs; worktree path check (incl. `..` and symlinks); detection parsing (`adb devices`, `-list-avds`, `simctl list -j` fixtures); hold rules (take, busy, release on work end and fire).
- Service tests with a fake `adb` / `xcrun` / `emulator` / `idb` (small Node scripts on `PATH` in a temp dir, recording argv and answering like the real tools), covering start/attach, boot wait, tap at the ref centre, install path checks, shutdown only for devices the app started.
- e2e with the fake tools: an employee (fake CLI) calls `device_start` and `device_snapshot`; the Preview tab lists "Android" and shows a frame (the fake `screencap` returns a PNG); a click reaches the fake `adb` as `input tap`.
- Real devices are not started in CI. A manual check on this Mac: boot `Medium_Phone` and an iPhone simulator through the tools, snapshot, tap, screenshot, shut down.
- Gates: `npm run typecheck && npm test && npm run test:e2e`.
