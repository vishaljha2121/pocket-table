let cookie = "";
async function req(route, body, c = cookie) {
  const r = await fetch("http://localhost:8797" + route, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(c ? { Cookie: c } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw Error(JSON.stringify(d));
  return { d, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
cookie = (await req("/api/bootstrap", {})).cookie;
let s = (await req("/api/state")).d;
await req("/api/join", { room: s.room, name: "QA Friend" }, "");
s = (await req("/api/state")).d;
for (const p of s.players.filter((p) => !p.approved)) {
  const current = (await req("/api/state")).d;
  await req("/api/dealer", {
    action: "approve",
    data: { id: p.id },
    version: current.version,
    requestId: crypto.randomUUID(),
  });
}
s = (await req("/api/state")).d;
await req("/api/dealer", {
  action: "start",
  version: s.version,
  requestId: crypto.randomUUID(),
});
s = (await req("/api/state")).d;
console.log(s.players.map((p) => ({ name: p.name, stack: p.stack })));
console.log("QA hand started.");
