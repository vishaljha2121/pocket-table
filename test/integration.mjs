import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { spawn } from "node:child_process";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pocket-integration-"));
let child;
async function boot() {
  child = spawn(process.execPath, ["server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: dir,
      PORT: "8791",
      TLS_PORT: "8792",
      LAN_IP: "127.0.0.2",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (x) => (errors += x));
  await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(Error("Startup timeout " + errors)),
      10000,
    );
    child.stdout.on("data", (x) => {
      output += x;
      if (output.includes("Players:")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(Error("Server exited " + code + " " + errors));
    });
  });
}
function request(route, body, cookie = "", extra = {}) {
  return new Promise((resolve, reject) => {
    const secure = extra.secure;
    const options = {
      hostname: "127.0.0.1",
      port: secure ? 8792 : 8791,
      path: route,
      method: body ? "POST" : "GET",
      headers: {
        Host: secure ? "localhost:8792" : "localhost:8791",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra.headers,
      },
      ...(secure
        ? {
            ca: fs.readFileSync(path.join(dir, "local-cert.pem")),
            servername: "localhost",
          }
        : {}),
    };
    const req = (secure ? https : http).request(options, (res) => {
      let text = "";
      res.on("data", (x) => (text += x));
      res.on("end", () => {
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        resolve({
          status: res.statusCode,
          data,
          cookie: res.headers["set-cookie"]?.[0]?.split(";")[0],
          headers: res.headers,
        });
      });
    });
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
async function stop() {
  if (!child) return;
  const c = child;
  await new Promise((resolve) => {
    c.once("exit", resolve);
    c.kill("SIGTERM");
  });
  child = null;
}
try {
  await boot();
  assert.equal((await request("/api/state")).status, 401);
  const bootRes = await request("/api/bootstrap", {});
  assert.equal(bootRes.status, 200);
  const dc = bootRes.cookie;
  let s = (await request("/api/state", null, dc)).data;
  const room = s.room;
  assert.ok(room);
  assert.equal(
    (
      await request("/api/bootstrap", {}, "", {
        headers: { Origin: "http://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/bootstrap", {}, "", {
        headers: { Host: "127.0.0.2:8791" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/join", { name: "Wrong", room: "000000" })).status,
    403,
  );
  const clients = [];
  for (const name of ["QA Alice", "QA Bob", "QA Cara"]) {
    const j = await request("/api/join", { name, room });
    assert.equal(j.status, 200);
    const p = (await request("/api/state", null, j.cookie)).data;
    assert.equal(p.role, "player");
    assert.equal(p.room, undefined);
    assert.equal(p.joinURL, undefined);
    assert.equal(p.handStart, undefined);
    clients.push({ cookie: j.cookie, id: p.me, recovery: j.data.recovery });
    s = (await request("/api/state", null, dc)).data;
    assert.equal(
      (
        await request(
          "/api/dealer",
          {
            action: "approve",
            data: { id: p.me },
            version: s.version,
            requestId: crypto.randomUUID(),
          },
          dc,
        )
      ).status,
      200,
    );
  }
  s = (await request("/api/state", null, dc)).data;
  assert.equal(
    (
      await request(
        "/api/dealer",
        { action: "start", version: s.version, requestId: "forbidden" },
        clients[0].cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/action",
        { action: "allin", version: s.version, requestId: "premature" },
        clients[0].cookie,
      )
    ).status,
    400,
  );
  let mut = async (action, data = {}) => {
    s = (await request("/api/state", null, dc)).data;
    const r = await request(
      "/api/dealer",
      { action, data, version: s.version, requestId: crypto.randomUUID() },
      dc,
    );
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r;
  };
  await mut("start");
  s = (await request("/api/state", null, dc)).data;
  const current = clients.find((c) => c.id === s.turn),
    wrong = clients.find((c) => c.id !== s.turn);
  assert.equal(
    (
      await request(
        "/api/action",
        { action: "call", version: s.version, requestId: "wrong-turn" },
        wrong.cookie,
      )
    ).status,
    400,
  );
  const payload = {
    action: "call",
    version: s.version,
    requestId: "same-request",
  };
  assert.equal(
    (await request("/api/action", payload, current.cookie)).status,
    200,
  );
  assert.equal(
    (await request("/api/action", payload, current.cookie)).data.duplicate,
    true,
  );
  assert.equal(
    (
      await request(
        "/api/action",
        { ...payload, requestId: "stale" },
        current.cookie,
      )
    ).status,
    409,
  );
  for (let n = 0; n < 80; n++) {
    s = (await request("/api/state", null, dc)).data;
    if (s.phase === "betting") {
      const c = clients.find((c) => c.id === s.turn),
        ps = (await request("/api/state", null, c.cookie)).data;
      assert.equal(
        (
          await request(
            "/api/action",
            {
              action: ps.legal.check ? "check" : "call",
              version: s.version,
              requestId: crypto.randomUUID(),
            },
            c.cookie,
          )
        ).status,
        200,
      );
    } else if (s.phase === "awaiting_board") {
      await mut("board", {
        cards:
          s.street === "preflop"
            ? ["Ac", "Kd", "Qh"]
            : s.street === "flop"
              ? ["Js"]
              : ["Tc"],
      });
    } else if (s.phase === "showdown") {
      await mut("award", { winners: s.pots.map((p) => p.eligible) });
    } else if (s.phase === "complete") break;
    else throw Error(s.phase);
  }
  s = (await request("/api/state", null, dc)).data;
  assert.equal(s.phase, "complete");
  assert.equal(
    s.players.reduce((sum, p) => sum + p.stack, 0),
    3000,
  );
  const ssl = await request("/api/health", null, "", { secure: true });
  assert.equal(ssl.status, 200);
  const privateRecovery = clients[0].recovery;
  const recovered = await request("/api/recover", { code: privateRecovery });
  assert.equal(recovered.status, 200);
  assert.equal(
    (await request("/api/state", null, clients[0].cookie)).status,
    401,
  );
  clients[0].cookie = recovered.cookie;
  await mut("start");
  const before = (await request("/api/state", null, dc)).data;
  await stop();
  await boot();
  const after = (await request("/api/state", null, dc)).data;
  assert.equal(after.hand, before.hand);
  assert.deepEqual(
    after.players.map((p) => p.stack),
    before.players.map((p) => p.stack),
  );
  assert.equal(after.paused, true);
  assert.equal(
    (await request("/api/state", null, clients[0].cookie)).status,
    200,
  );
  assert.equal(
    (await request("/api/export", null, clients[0].cookie)).status,
    404,
  );
  assert.equal((await request("/api/export", null, dc)).status, 200);
  console.log(
    "PASS: authenticated 3-player game, permissions, turn enforcement, duplicate/stale requests, trusted TLS, recovery-token rotation, privacy projection, exports and restart persistence.",
  );
  console.log("Test data:", dir);
} finally {
  await stop();
}
