import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin")
  throw new Error(
    "The background service is for macOS. Use npm start on other systems.",
  );
const root = fileURLToPath(new URL("..", import.meta.url));
const data = path.join(root, "data");
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.pocket-table.local</string>
<key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-i</string><string>${xml(process.execPath)}</string><string>${xml(path.join(root, "server.ts"))}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path.dirname(process.execPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(path.join(data, "server.log"))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(data, "server-error.log"))}</string>
</dict></plist>`;
const destination = path.join(data, "service.plist");
fs.writeFileSync(destination, plist, { mode: 0o600 });
console.log(destination);
