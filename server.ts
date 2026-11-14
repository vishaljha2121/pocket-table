import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import QRCode from "qrcode";
import {
  createGame,
  addPlayer,
  dealer,
  act,
  legal,
  pots,
  assertGame,
  approveVoid,
  note,
} from "./engine.ts";
const ROOT = import.meta.dirname,
  DIR = process.env.DATA_DIR || path.join(ROOT, "data");
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(DIR, "table.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, player TEXT, recovery TEXT); CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, result TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, state TEXT NOT NULL);",
);
const get = (k) => {
  const r = db.prepare("SELECT value FROM meta WHERE key=?").get(k);
  return r ? JSON.parse(r.value) : null;
};
const put = (k, v) =>
  db
    .prepare("INSERT OR REPLACE INTO meta VALUES (?,?)")
    .run(k, JSON.stringify(v));
let game = get("game") || createGame();
if (!["lobby", "complete"].includes(game.phase)) {
  game.paused = true;
  note(game, "Server restarted. Dealer must resume after players reconnect.");
}
put("game", game);
const room = get("room") || String(crypto.randomInt(100000, 1000000));
put("room", room);
const nets = Object.entries(os.networkInterfaces()).flatMap(([name, x]) =>
  (x || [])
    .filter(
      (n) => n.family === "IPv4" && !n.internal && !name.startsWith("utun"),
    )
    .map((n) => n.address),
);
const ip = process.env.LAN_IP || nets[0] || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787),
  TLS_PORT = Number(process.env.TLS_PORT || 8788);
const allowed = new Set(["localhost", "127.0.0.1", ...nets, ip]);
const joinURL = `https://${ip}:${TLS_PORT}/play?room=${room}`;
const key = path.join(DIR, "local-key.pem"),
  cert = path.join(DIR, "local-cert.pem");
if (!fs.existsSync(cert) || get("certIP") !== ip) {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "365",
      "-subj",
      "/CN=Pocket Table Local",
      "-addext",
      `subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${ip}`,
    ],
    { stdio: "ignore" },
  );
  fs.chmodSync(key, 0o600);
  put("certIP", ip);
}
const qr = await QRCode.toString(joinURL, {
  type: "svg",
  margin: 1,
  color: { dark: "#112b25", light: "#ffffff" },
});
const seen = new Map(),
  rates = new Map();
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const local = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
const cookie = (req) => {
  const m = (req.headers.cookie || "").match(
    /(?:^|; )pocket_session=([a-f0-9]{64})(?:;|$)/,
  );
  return m ? m[1] : null;
};
function session(req) {
  const t = cookie(req);
  return t
    ? db.prepare("SELECT * FROM sessions WHERE token=?").get(hash(t))
    : null;
}
function issue(res, secure, role, player = null, recovery = null) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(
    hash(token),
    role,
    player,
    recovery ? hash(recovery) : null,
  );
  res.setHeader(
    "Set-Cookie",
    `pocket_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`,
  );
  return token;
}
function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
function publicGame(s) {
  const { handStart, ...out } = game;
  return {
    ...out,
    players: game.players.map((p) => ({
      ...p,
      online: Date.now() - (seen.get(p.id) || 0) < 30000,
    })),
    pots: pots(game),
    me: s.player,
    role: s.role,
    legal: s.player
      ? legal(
          game,
          game.players.find((p) => p.id === s.player),
        )
      : null,
    joinURL: s.role === "dealer" ? joinURL : undefined,
    room: s.role === "dealer" ? room : undefined,
  };
}
function save(candidate, requestKey = null) {
  assertGame(candidate);
  candidate.version = game.version + 1;
  db.exec("BEGIN IMMEDIATE");
  try {
    put("game", candidate);
    if (requestKey)
      db.prepare("INSERT INTO requests VALUES (?,?)").run(requestKey, "ok");
    db.prepare("INSERT INTO history(time,state) VALUES (?,?)").run(
      Date.now(),
      JSON.stringify(candidate),
    );
    db.exec("COMMIT");
    game = candidate;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function rate(req) {
  const addr = req.socket.remoteAddress,
    now = Date.now(),
    r = rates.get(addr) || { start: now, count: 0 };
  if (now - r.start > 60000) {
    r.start = now;
    r.count = 0;
  }
  rates.set(addr, r);
  if (++r.count > 40) throw Error("Too many requests. Please wait a minute.");
}
async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 12000) throw Error("Request too large.");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw Error("Invalid request.");
  }
}
async function handler(req, res) {
  const secure = Boolean(req.socket.encrypted);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    const url = new URL(
      req.url,
      `${secure ? "https" : "http"}://${req.headers.host}`,
    );
    if (!allowed.has(url.hostname))
      return json(res, 403, { error: "Unknown host." });
    if (!secure && !local(req)) {
      res.writeHead(302, {
        Location: `https://${ip}:${TLS_PORT}${url.pathname}${url.search}`,
      });
      return res.end();
    }
    if (url.pathname === "/api/health") return json(res, 200, { ok: true });
    if (
      req.headers.origin &&
      req.headers.origin !==
        `${secure ? "https" : "http"}://${req.headers.host}`
    )
      return json(res, 403, { error: "Cross-origin request refused." });
    if (url.pathname === "/api/bootstrap" && req.method === "POST") {
      if (!local(req) || !["localhost", "127.0.0.1"].includes(url.hostname))
        return json(res, 403, {
          error: "Open the dealer dashboard on the Mac at localhost.",
        });
      const existing = session(req);
      if (existing?.role !== "dealer") issue(res, secure, "dealer");
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/join" && req.method === "POST") {
      rate(req);
      const b = await body(req);
      if (b.room !== room)
        return json(res, 403, {
          error: "Incorrect table code. Scan the QR on the Mac.",
        });
      const old = session(req);
      if (
        old?.role === "player" &&
        game.players.some((p) => p.id === old.player)
      )
        return json(res, 200, { ok: true });
      const candidate = structuredClone(game),
        p = addPlayer(candidate, b.name),
        recovery = crypto.randomBytes(8).toString("hex");
      save(candidate);
      issue(res, secure, "player", p.id, recovery);
      seen.set(p.id, Date.now());
      return json(res, 200, { ok: true, recovery });
    }
    if (url.pathname === "/api/recover" && req.method === "POST") {
      rate(req);
      const b = await body(req);
      if (typeof b.code !== "string") throw Error("Enter your recovery code.");
      const s = db
        .prepare("SELECT * FROM sessions WHERE recovery=? AND role=?")
        .get(hash(b.code.trim()), "player");
      if (!s || !game.players.some((p) => p.id === s.player))
        return json(res, 403, { error: "Recovery code not found." });
      db.prepare("DELETE FROM sessions WHERE player=?").run(s.player);
      issue(res, secure, "player", s.player, b.code.trim());
      seen.set(s.player, Date.now());
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/")) {
      const s = session(req);
      if (
        !s ||
        (s.role === "player" && !game.players.some((p) => p.id === s.player))
      )
        return json(res, 401, { error: "Join the table to continue." });
      if (s.player) seen.set(s.player, Date.now());
      if (url.pathname === "/api/state" && req.method === "GET")
        return json(res, 200, publicGame(s));
      if (url.pathname === "/api/qr" && s.role === "dealer") {
        res.writeHead(200, { "Content-Type": "image/svg+xml" });
        return res.end(qr);
      }
      if (url.pathname === "/api/export" && s.role === "dealer") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition":
            'attachment; filename="pocket-table-history.json"',
        });
        return res.end(
          JSON.stringify(
            db
              .prepare("SELECT time,state FROM history ORDER BY id")
              .all()
              .map((r) => ({ time: r.time, game: JSON.parse(r.state) })),
          ),
        );
      }
      if (req.method !== "POST") return json(res, 404, { error: "Not found." });
      const b = await body(req);
      if (typeof b.requestId !== "string" || b.requestId.length > 100)
        throw Error("Missing request ID.");
      const requestKey = s.token + ":" + b.requestId;
      const prior = db
        .prepare("SELECT result FROM requests WHERE id=?")
        .get(requestKey);
      if (prior) return json(res, 200, { ok: true, duplicate: true });
      if (b.version !== game.version)
        return json(res, 409, {
          error: "The table changed. Review the updated state and try again.",
        });
      const candidate = structuredClone(game);
      if (url.pathname === "/api/action" && s.role === "player")
        act(candidate, s.player, b.action, b.amount);
      else if (url.pathname === "/api/void-approve" && s.role === "player")
        approveVoid(candidate, s.player);
      else if (url.pathname === "/api/dealer" && s.role === "dealer")
        dealer(candidate, b.action, b.data);
      else return json(res, 403, { error: "Not permitted." });
      save(candidate, requestKey);
      return json(res, 200, { ok: true });
    }
    const route = ["/", "/play", "/dealer"].includes(url.pathname)
      ? "index.html"
      : url.pathname.slice(1);
    const assets = new Set([
      "index.html",
      "app.js",
      "style.css",
      "evaluator.js",
      "odds-worker.js",
      "icon.svg",
    ]);
    if (!assets.has(route)) return json(res, 404, { error: "Not found." });
    const file = path.join(ROOT, "public", route);
    const type = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    }[path.extname(file)];
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 400, { error: e.message || "Something went wrong." });
  }
}
const httpServer = http.createServer(handler),
  httpsServer = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    handler,
  );
httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(`Dealer: http://localhost:${PORT}/dealer`),
);
httpsServer.listen(TLS_PORT, "0.0.0.0", () =>
  console.log(
    `Players: ${joinURL}\nLocal HTTPS uses a self-signed certificate.\nData: ${DIR}`,
  ),
);
setInterval(() => {
  if (
    game.phase === "betting" &&
    !game.paused &&
    game.turn &&
    Date.now() - (seen.get(game.turn) || 0) > 45000
  ) {
    const candidate = structuredClone(game);
    candidate.paused = true;
    note(
      candidate,
      "Current player disconnected. Table paused; reconnect, then dealer resumes.",
    );
    save(candidate);
  }
}, 5000).unref();
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    httpServer.close();
    httpsServer.close();
    db.close();
    process.exit(0);
  });
