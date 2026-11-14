import { evaluate, labels, ranks, suits, draws } from "./evaluator.js";
const app = document.querySelector("#app"),
  modal = document.querySelector("#modal"),
  dealerView = location.pathname === "/dealer";
let state = null,
  lastVersion = -1,
  busy = false,
  tab = "table",
  hole = ["", ""],
  boardDraft = [],
  odds = null,
  oddsBusy = false,
  worker = null,
  workerId = 0,
  lastHand = null,
  recovery = "",
  connection = "Connecting",
  picker = null,
  lastOnline = "",
  pollTimer;
const symbols = { c: "♣", d: "♦", h: "♥", s: "♠" },
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  fmt = (n) => Number(n || 0).toLocaleString();
const player = (id) => state?.players.find((p) => p.id === id),
  me = () => player(state?.me),
  name = (id) => esc(player(id)?.name || "—");
const card = (c, small = false, highlight = false) =>
  `<span class="card ${small ? "small" : ""} ${c && "dh".includes(c[1]) ? "red" : ""} ${highlight ? "highlight" : ""}">${c ? `<b>${c[0] === "T" ? "10" : c[0]}</b><span>${symbols[c[1]]}</span>` : '<span class="card-back">♠</span>'}</span>`;
const badge = (text, cls = "") => `<span class="badge ${cls}">${text}</span>`;
const button = (text, action, cls = "", attrs = "") =>
  `<button class="${cls}" data-do="${action}" ${attrs}>${text}</button>`;
function toast(s) {
  const e = document.querySelector("#toast");
  e.textContent = s;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 4500);
}
async function api(url, data) {
  const r = await fetch(url, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await r.json();
  if (!r.ok) {
    const e = Error(body.error || "Connection failed");
    e.status = r.status;
    throw e;
  }
  return body;
}
function invalidateOdds() {
  worker?.terminate();
  worker = null;
  odds = null;
  oddsBusy = false;
  workerId++;
}
async function refresh() {
  try {
    const next = await api("/api/state");
    if (state && next.version < state.version) return;
    connection = "Live";
    if (
      lastHand !== null &&
      (next.hand !== lastHand ||
        (next.phase === "complete" && state?.phase !== "complete"))
    ) {
      hole = ["", ""];
      invalidateOdds();
    }
    if (
      state &&
      (JSON.stringify(state.board) !== JSON.stringify(next.board) ||
        state.players.filter((p) => ["active", "allin"].includes(p.status))
          .length !==
          next.players.filter((p) => ["active", "allin"].includes(p.status))
            .length)
    )
      invalidateOdds();
    lastHand = next.hand;
    const changed =
      next.version !== lastVersion ||
      lastOnline !== next.players.map((p) => p.online).join(",") ||
      !state;
    state = next;
    if (changed) {
      lastVersion = next.version;
      lastOnline = next.players.map((p) => p.online).join(",");
      render();
    } else
      document
        .querySelectorAll(".connection")
        .forEach((e) => (e.textContent = "Live"));
  } catch (e) {
    connection = "Reconnecting";
    document
      .querySelectorAll(".connection")
      .forEach((el) => (el.textContent = connection));
    if (e.status === 401) {
      state = null;
      renderJoin();
    } else if (!state)
      app.innerHTML = `<div class="welcome"><div class="brand">♠ Pocket Table</div><h1>Connecting to the Mac</h1><p>${esc(e.message)}</p>${button("Try again", "refresh", "primary")}</div>`;
  }
}
async function mutate(action, data = {}, endpoint = "/api/dealer") {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  try {
    await api(endpoint, {
      action,
      data,
      ...(endpoint === "/api/action" ? data : {}),
      version: state.version,
      requestId: crypto.randomUUID(),
    });
    boardDraft = [];
    await refresh();
  } catch (e) {
    toast(e.message);
    await refresh();
  } finally {
    busy = false;
    document.body.classList.remove("busy");
  }
}
function header() {
  return `<header><a class="brand" href="${dealerView ? "/dealer" : "/play"}"><span class="brand-icon">♠</span> Pocket Table<span class="brand-sub">REAL CARDS. VIRTUAL CHIPS.</span></a><div class="header-right"><span class="live-dot"></span><span class="connection">${connection}</span>${badge(dealerView ? "DEALER" : "PLAYER")}</div></header>`;
}
function renderJoin() {
  if (document.querySelector("#join-form")) return;
  app.innerHTML = `<div class="welcome"><div class="brand"><span class="brand-icon">♠</span> Pocket Table</div><div class="eyebrow">GOOD FRIENDS. GREAT HANDS.</div><h1>Your seat<br>at the table.</h1><p>Keep the cards in your hands.<br>Keep the chips right here.</p><form id="join-form"><label>Your name<input name="name" required maxlength="24" placeholder="What should we call you?" autocomplete="given-name"></label><label>Table code<input name="room" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" value="${esc(new URLSearchParams(location.search).get("room") || "")}" placeholder="6 digits on the Mac"></label><button class="primary" type="submit">Take a seat <span>↗</span></button></form><details><summary>Returning on a different browser?</summary><form id="recover-form"><label>Private recovery code<input name="code" required placeholder="Your 16-character code" autocomplete="off"></label><button type="submit">Recover my seat</button></form></details><div class="fineprint">Stay on the same Wi-Fi as the dealer’s Mac.<br>Your private cards stay on this phone.</div></div>`;
}
function board() {
  return `<section class="board-panel"><div class="section-top"><span class="eyebrow">${state.hand ? "HAND " + String(state.hand).padStart(2, "0") : "YOUR TABLE IS READY"}</span><span class="street">${state.phase === "lobby" ? "Waiting for players" : state.phase === "complete" ? "Hand complete" : state.street.replace("preflop", "Pre-flop")}</span></div><div class="community">${Array.from({ length: 5 }, (_, i) => card(state.board[i])).join("")}</div><div class="pot-display"><span>TOTAL POT</span><strong>${fmt(state.pots.reduce((s, p) => s + p.amount, 0))}<small> chips</small></strong></div>${state.pots.length > 1 && state.phase !== "betting" ? `<div class="pot-chips">${state.pots.map((p, i) => badge(`${i === 0 ? "Main" : "Side " + i} · ${fmt(p.amount)}`)).join("")}</div>` : ""}<div class="table-message">${state.paused ? "⏸ Table paused" : state.phase === "betting" ? `<span class="pulse"></span> ${name(state.turn)} to act` : state.phase === "awaiting_board" ? "Waiting for the dealer to enter the next cards" : state.phase === "showdown" ? "Showdown · reveal physical cards to the dealer" : state.phase === "complete" ? esc(state.result?.text) : "Join on your phone. The dealer will approve your seat."}</div></section>`;
}
function seats() {
  const ps = state.players.filter((p) => p.approved);
  return `<section class="panel"><div class="section-top"><h2>At the table <span class="muted">${ps.length}/10</span></h2><span class="muted">Blinds ${fmt(state.smallBlind)} / ${fmt(state.bigBlind)}</span></div>${ps.length ? `<div class="seats">${ps.map((p, i) => `<div class="seat ${p.id === state.turn ? "turn" : ""} ${p.status === "folded" ? "folded" : ""}"><div class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}<span class="presence ${p.online ? "online" : ""}"></span></div><div class="seat-person"><strong>${esc(p.name)} ${p.id === state.me ? '<span class="you">YOU</span>' : ""}</strong><div>${p.id === state.button ? badge("D", "gold") : ""}${p.id === state.sb ? badge("SB") : ""}${p.id === state.bb ? badge("BB") : ""}<span class="status">${p.sitOut ? "Sitting out" : p.status === "out" ? "Ready" : p.status === "allin" ? "All-in" : p.status === "folded" ? "Folded" : p.id === state.turn ? "Thinking…" : "In hand"}</span></div></div><div class="seat-chips"><strong>${fmt(p.stack)}</strong><small>${p.bet ? "Bet " + fmt(p.bet) : "chips"}</small></div>${dealerView && ["lobby", "complete"].includes(state.phase) ? `<button class="icon-button" aria-label="Manage ${esc(p.name)}" data-do="manage" data-id="${p.id}">•••</button>` : ""}</div>`).join("")}</div>` : `<div class="empty">A great poker night starts with a full table.<br>Scan the QR code to join.</div>`}</section>`;
}
function history() {
  return `<section class="panel history"><div class="section-top"><h2>Table activity</h2>${dealerView ? '<a class="text-link" href="/api/export">Export</a>' : ""}</div>${
    [...state.log]
      .reverse()
      .slice(0, 40)
      .map(
        (l) =>
          `<div class="log"><time>${new Date(l.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><span>${esc(l.text)}</span></div>`,
      )
      .join("") || '<p class="muted">Your game story starts here.</p>'
  }</section>`;
}
function correction() {
  return state.correction
    ? `<section class="notice"><strong>Refund request · everyone must approve</strong><p>${esc(state.correction.reason)}</p><p>${state.correction.votes.length} / ${state.correction.required.length} approved</p>${!dealerView && state.correction.required.includes(state.me) ? button(state.correction.votes.includes(state.me) ? "You approved" : "Approve void & refund", "void-approve", "primary", state.correction.votes.includes(state.me) ? "disabled" : "") : ""}${dealerView ? button("Cancel request", "void-cancel") : ""}</section>`
    : "";
}
function dealerControls() {
  const idle = ["lobby", "complete"].includes(state.phase),
    pending = state.players.filter((p) => !p.approved);
  return `<aside class="dealer-side"><section class="panel join-panel"><div><div class="eyebrow">INVITE YOUR FRIENDS</div><h2>Scan. Sit. Play.</h2><p>Open your phone camera on the same Wi-Fi.</p><div class="room-code">${state.room}</div></div><img src="/api/qr" alt="QR code to join this poker table" width="116" height="116"><a class="join-url" href="${esc(state.joinURL)}" target="_blank">${esc(state.joinURL.split("?")[0])}</a><p class="fineprint full">Local HTTPS: on first visit, your phone will ask you to accept this Mac’s self-signed certificate.</p></section>${pending.length ? `<section class="panel"><h2>Waiting for a seat</h2>${pending.map((p) => `<div class="pending"><span>${esc(p.name)}</span>${button("Seat player", "approve", "primary small-btn", `data-id="${p.id}" ${!idle ? "disabled" : ""}`)}</div>`).join("")}${!idle ? '<p class="fineprint">New players join between hands.</p>' : ""}</section>` : ""}<section class="panel"><div class="section-top"><h2>Dealer controls</h2>${badge("MAC ONLY")}</div>${idle ? `${button(state.hand ? "Deal next hand" : "Start first hand", "start", "primary wide", state.players.filter((p) => p.approved && !p.sitOut && p.stack > 0).length < 2 ? "disabled" : "")}<p class="fineprint">Deal two physical cards to each player, then start.</p>` : `${button(state.paused ? "Resume table" : "Pause table", "pause", "wide")}`}${state.phase === "awaiting_board" ? `<div class="deal-entry"><h3>Enter the ${state.street === "preflop" ? "flop" : state.street === "flop" ? "turn" : "river"}</h3><div class="draft-cards">${Array.from({ length: state.street === "preflop" ? 3 : 1 }, (_, i) => `<button class="card-button" data-do="pick" data-target="board" data-index="${i}">${card(boardDraft[i])}</button>`).join("")}</div>${button("Confirm community cards", "board", "primary wide", state.paused ? "disabled" : "")}</div>` : ""}${state.phase === "showdown" ? `<form id="award-form"><p>Verify physical cards. Select all tied winners for each pot.</p>${state.pots.map((pot, i) => `<fieldset><legend>${i ? "Side pot " + i : "Main pot"} · ${fmt(pot.amount)}</legend>${pot.eligible.map((id) => `<label class="check"><input type="checkbox" name="pot${i}" value="${id}">${name(id)}</label>`).join("")}</fieldset>`).join("")}<button class="primary wide" ${state.paused ? "disabled" : ""}>Review & award pots</button></form>` : ""}${state.phase === "betting" ? `<details class="manual"><summary>Record a player’s verbal action</summary><p class="fineprint">For ${name(state.turn)}. This is visible in the table history.</p><div class="manual-actions">${button("Fold", "manual-fold")}${button("Check", "manual-check")}${button("Call", "manual-call")}${button("Raise / bet", "manual-raise")}${button("All-in", "manual-allin")}</div></details>` : ""}${!idle && !state.correction ? `<details><summary>Correct a dealing mistake</summary><p class="fineprint">Pause and request a complete refund of this hand. Every involved player must approve on their phone.</p>${button("Request void & refund", "void-request", "danger")}</details>` : ""}</section><section class="panel"><details ${state.phase === "lobby" ? "open" : ""}><summary>Table settings</summary><form id="settings-form"><div class="form-row"><label>Small blind<input name="smallBlind" type="number" min="1" value="${state.smallBlind}" required ${!idle ? "disabled" : ""}></label><label>Big blind<input name="bigBlind" type="number" min="1" value="${state.bigBlind}" required ${!idle ? "disabled" : ""}></label></div><label>Starting chips for new players<input name="startingStack" type="number" min="1" value="${state.startingStack}" required ${!idle ? "disabled" : ""}></label><button class="wide" ${!idle ? "disabled" : ""}>Save settings</button><p class="fineprint">Existing stacks stay unchanged. Use a player’s ••• menu for rebuys, seat order, and sitting out.</p></form></details></section></aside>`;
}
function bank() {
  const p = me();
  return `<section class="bank"><div><span class="eyebrow">${esc(p.name)} · YOUR STACK</span><strong>${fmt(p.stack)}<small>chips</small></strong></div><div class="bank-right"><span>In this hand <b>${fmt(p.committed)}</b></span><span>Session net <b class="${p.stack + p.committed - p.buyIn >= 0 ? "positive" : ""}">${p.stack + p.committed - p.buyIn >= 0 ? "+" : ""}${fmt(p.stack + p.committed - p.buyIn)}</b></span></div></section>`;
}
function actions() {
  const p = me(),
    l = state.legal;
  if (!p?.approved) return "";
  return `<section class="action-dock">${l ? `<div class="action-context"><strong>${l.check ? "Your move" : "To call: " + fmt(l.call)}</strong><span>${l.check ? "Check or open the betting" : l.fullCall > l.call ? "Calling puts you all-in" : "Only legal actions are available"}</span></div><div class="action-buttons">${button("Fold", "fold", "fold-btn")}${button(l.check ? "Check" : "Call " + fmt(l.call), l.check ? "check" : "call", "primary")}${l.canRaise ? button(state.currentBet ? "Raise" : "Bet", "raise", "gold-button") : ""}${l.allIn ? button("All-in", "allin", "outline") : ""}</div>` : `<div class="waiting-action">${state.paused ? "⏸ Paused — waiting for the dealer" : p.status === "folded" ? "You folded · stay for the next hand" : p.status === "allin" ? "You’re all-in · let the cards fall" : state.phase === "betting" ? `Waiting for ${name(state.turn)}` : ["lobby", "complete"].includes(state.phase) ? "The next hand starts with the dealer" : "Waiting for the dealer"}</div>`}</section>`;
}
function handHelper() {
  let ev = null,
    error = "";
  if (hole.every(Boolean) && state.board.length >= 3)
    try {
      ev = evaluate([...hole, ...state.board]);
    } catch (e) {
      error = e.message;
    }
  const opponents = Math.max(
    1,
    state.players.filter(
      (p) => ["active", "allin"].includes(p.status) && p.id !== state.me,
    ).length ||
      state.players.filter((p) => p.approved && p.id !== state.me).length,
  );
  return `<section class="panel helper"><div class="section-top"><h2>Your private hand</h2>${badge("ON THIS PHONE", "green")}</div><p class="muted">Tap to enter the two cards you’re holding.</p><div class="hole-cards">${hole.map((c, i) => `<button class="card-button" data-do="pick" data-target="hole" data-index="${i}" aria-label="Choose hole card ${i + 1}">${card(c)}</button>`).join("")}</div>${error ? `<p class="error">${esc(error)}</p>` : ev ? `<div class="hand-result"><span class="eyebrow">YOUR BEST HAND NOW</span><h2>${ev.label}</h2><div class="best-five">${ev.cards.map((c) => card(c, true)).join("")}</div></div>` : `<p class="fineprint">${hole.every(Boolean) ? "Your best five-card hand appears after the flop." : "Cards are optional and never sent to the Mac."}</p>`}${
    hole.every(Boolean) && !error
      ? draws(hole, state.board)
          .map(
            (d) =>
              `<div class="draw-note"><strong>${d.name}</strong><span>${d.detail}</span></div>`,
          )
          .join("")
      : ""
  }<div class="odds-section"><div class="section-top"><h2>Odds lab</h2>${badge("ESTIMATE")}</div><p class="muted">Your hand against ${opponents} random opponent${opponents === 1 ? "" : "s"}, through the river.</p>${button(oddsBusy ? "Calculating…" : odds ? "Recalculate odds" : "Calculate my chances", "odds", "primary wide", !hole.every(Boolean) || error || oddsBusy ? "disabled" : "")}${
    odds
      ? `<div class="odds-grid"><div><strong>${(odds.win * 100).toFixed(1)}%</strong><span>Win outright</span></div><div><strong>${(odds.tie * 100).toFixed(1)}%</strong><span>Tie for best</span></div><div><strong>${(odds.equity * 100).toFixed(1)}%</strong><span>Pot equity*</span></div></div>${odds.improve !== null && state.board.length < 5 ? `<p><b>${(odds.improve * 100).toFixed(1)}%</b> chance of a higher hand category by the river.</p>` : ""}<details><summary>Possible final hands</summary>${odds.categories
          .map((v, i) =>
            v > 0
              ? `<div class="probability"><span>${labels[i]}</span><div><i style="width:${v * 100}%"></i></div><b>${(v * 100).toFixed(1)}%</b></div>`
              : "",
          )
          .reverse()
          .join(
            "",
          )}</details><p class="fineprint">${fmt(odds.samples)} simulated deals · approximate results. Unknown cards are sampled without replacement. Opponents’ actions and folded cards are unknown. *Equity is your average share of a single equal-eligibility pot; it is not expected winnings across side pots.</p>`
      : ""
  }<p class="fineprint">A probability helper, not a GTO solver or a prediction of opponents’ cards. Available to every player.</p></div></section><section class="panel legend"><h2>Hand-ranking legend</h2><p class="muted">Strongest to weakest. Best five cards win.</p>${[
    ["Royal flush", "A♠ K♠ Q♠ J♠ 10♠"],
    ["Straight flush", "9♥ 8♥ 7♥ 6♥ 5♥"],
    ["Four of a kind", "A♠ A♥ A♦ A♣ K♠"],
    ["Full house", "K♠ K♥ K♦ 7♣ 7♠"],
    ["Flush", "A♦ J♦ 8♦ 6♦ 2♦"],
    ["Straight", "8♠ 7♥ 6♦ 5♣ 4♠"],
    ["Three of a kind", "Q♠ Q♥ Q♦ 8♣ 3♠"],
    ["Two pair", "J♠ J♥ 4♦ 4♣ A♠"],
    ["One pair", "10♠ 10♥ A♦ 7♣ 2♠"],
    ["High card", "A♠ J♥ 9♦ 6♣ 3♠"],
  ]
    .map(
      ([a, b], i) =>
        `<div class="legend-row"><span>${i + 1}</span><strong>${a}</strong><small>${b}</small></div>`,
    )
    .join(
      "",
    )}<p class="fineprint">Use any combination of your two cards and the five community cards—even just the board. Aces can be low in A–2–3–4–5. Suits do not break ties; kickers can.</p></section>`;
}
function render() {
  if (!state) return renderJoin();
  const focus = document.activeElement,
    focusName = focus?.getAttribute("name"),
    focusValue = focus?.value;
  app.innerHTML =
    header() +
    `<main class="${dealerView ? "dealer-layout" : "player-layout"}">${dealerView ? `<div class="dealer-main"><div class="page-title"><div><div class="eyebrow">THE HOME GAME, SIMPLIFIED</div><h1>Let’s play a hand.</h1></div>${badge("NO-LIMIT HOLD’EM", "green")}</div>${correction()}${board()}${seats()}${history()}</div>${dealerControls()}` : !me()?.approved ? `<div class="pending-screen"><span class="big-spade">♠</span><h1>You’re on the list, ${esc(me()?.name)}.</h1><p>The dealer will approve your seat on the Mac.</p>${recoveryPanel()}</div>` : `${bank()}${recoveryPanel()}${correction()}<nav class="tabs">${["table", "hand", "history"].map((t) => button(t === "hand" ? "My hand & odds" : t === "table" ? "The table" : "Activity", "tab", tab === t ? "selected" : "", `data-tab="${t}"`)).join("")}</nav>${tab === "table" ? board() + seats() : tab === "hand" ? handHelper() : history()}${actions()}`}</main><footer>Pocket Table <span>♠</span> Real cards. Good company.</footer>`;
  if (focusName) {
    const input = document.querySelector(`[name="${CSS.escape(focusName)}"]`);
    if (input && input.tagName === "INPUT" && input.type !== "checkbox") {
      input.value = focusValue;
      input.focus();
    }
  }
}
function recoveryPanel() {
  return recovery
    ? `<section class="notice recovery"><strong>Save your private seat recovery code</strong><code>${esc(recovery)}</code><p>Use it if you switch browsers or clear cookies. Anyone with it can control your seat.</p>${button("I saved it", "dismiss-recovery")}</section>`
    : "";
}
function openPicker(target, index) {
  picker = { target, index };
  const selected = target === "hole" ? hole : boardDraft;
  const used = [...state.board, ...selected.filter((_, i) => i !== index)];
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal card-picker"><div class="section-top"><h2>Choose a card</h2>${button("✕", "close-modal", "icon-button", 'aria-label="Close"')}</div><p class="muted">${target === "hole" ? "Visible only on this phone." : "Match the physical card on the table."}</p>${suits
    .split("")
    .map(
      (s) =>
        `<div class="suit-row ${"dh".includes(s) ? "red" : ""}"><span>${symbols[s]}</span><div>${ranks
          .split("")
          .map(
            (r) =>
              `<button data-do="choose-card" data-card="${r + s}" ${used.includes(r + s) ? "disabled" : ""}>${r === "T" ? "10" : r}</button>`,
          )
          .join("")}</div></div>`,
    )
    .join(
      "",
    )}${button("Clear this card", "clear-card", "wide")}</section></div>`;
}
function raiseModal() {
  const l = state.legal;
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal"><div class="section-top"><h2>${state.currentBet ? "Raise" : "Bet"} amount</h2>${button("✕", "close-modal", "icon-button")}</div><p>Total chips you will have bet this street, including your current ${fmt(me().bet)}.</p><form id="raise-form"><label>${state.currentBet ? "Raise to" : "Bet"}<input name="amount" type="number" inputmode="numeric" min="${Math.min(l.minRaise, l.maxRaise)}" max="${l.maxRaise}" value="${Math.min(l.minRaise, l.maxRaise)}" required autofocus></label><p class="fineprint">Minimum ${fmt(l.minRaise)} · maximum ${fmt(l.maxRaise)}. A smaller raise is allowed only when all-in.</p><button class="primary wide">Confirm ${state.currentBet ? "raise" : "bet"}</button></form></section></div>`;
}
function manage(id) {
  const p = player(id);
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal"><div class="section-top"><h2>${esc(p.name)}</h2>${button("✕", "close-modal", "icon-button")}</div><p>Stack ${fmt(p.stack)} · total buy-in ${fmt(p.buyIn)} · net ${fmt(p.stack - p.buyIn)}</p><div class="manage-buttons">${button("Add chips / rebuy", "rebuy", "primary", `data-id="${id}"`)}${button(p.sitOut ? "Return to table" : "Sit out next hand", "sitout", "", `data-id="${id}"`)}${button("Move seat earlier", "move", "", `data-id="${id}" data-direction="-1"`)}${button("Move seat later", "move", "", `data-id="${id}" data-direction="1"`)}${button("Remove from table", "remove", "danger", `data-id="${id}"`)}</div></section></div>`;
}
function calculate() {
  const opponents = Math.max(
    1,
    state.players.filter(
      (p) => ["active", "allin"].includes(p.status) && p.id !== state.me,
    ).length ||
      state.players.filter((p) => p.approved && p.id !== state.me).length,
  );
  invalidateOdds();
  oddsBusy = true;
  const id = ++workerId;
  worker = new Worker("/odds-worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.id !== workerId) return;
    oddsBusy = false;
    if (data.error) toast(data.error);
    else odds = data.result;
    worker.terminate();
    worker = null;
    render();
  };
  worker.onerror = () => {
    oddsBusy = false;
    toast("Could not calculate odds. Please try again.");
    render();
  };
  worker.postMessage({
    id,
    hole: [...hole],
    board: [...state.board],
    opponents,
    samples: 4000,
  });
  render();
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-do]");
  if (!el || el.disabled) return;
  const a = el.dataset.do,
    id = el.dataset.id;
  try {
    if (a === "tab") {
      tab = el.dataset.tab;
      render();
    } else if (a === "refresh") refresh();
    else if (a === "close-modal") modal.innerHTML = "";
    else if (a === "pick")
      openPicker(el.dataset.target, Number(el.dataset.index));
    else if (a === "choose-card" || a === "clear-card") {
      (picker.target === "hole" ? hole : boardDraft)[picker.index] =
        a === "clear-card" ? "" : el.dataset.card;
      invalidateOdds();
      modal.innerHTML = "";
      render();
    } else if (a === "dismiss-recovery") {
      recovery = "";
      render();
    } else if (a === "odds") calculate();
    else if (a === "raise") raiseModal();
    else if (["fold", "call", "check", "allin"].includes(a)) {
      if (
        ["fold", "allin"].includes(a) &&
        !confirm(
          a === "fold"
            ? "Fold your hand? This cannot be undone individually."
            : `Put all ${fmt(me().stack)} remaining chips in?`,
        )
      )
        return;
      await mutate(a, {}, "/api/action");
    } else if (a === "void-approve") {
      if (
        confirm(
          "Void this hand and refund every player to their starting stack?",
        )
      )
        await mutate("", {}, "/api/void-approve");
    } else if (a === "manage") manage(id);
    else if (a === "rebuy") {
      const amount = Number(prompt("How many chips should be added?", "1000"));
      if (amount > 0) {
        modal.innerHTML = "";
        await mutate("rebuy", { id, amount });
      }
    } else if (a === "remove") {
      if (
        confirm(
          `Remove ${player(id).name} with ${fmt(player(id).stack)} chips?`,
        )
      ) {
        modal.innerHTML = "";
        await mutate("remove", { id });
      }
    } else if (a === "sitout" || a === "move") {
      modal.innerHTML = "";
      await mutate(a, { id, direction: Number(el.dataset.direction) });
    } else if (a === "approve") await mutate(a, { id });
    else if (["start", "pause", "void-cancel"].includes(a)) await mutate(a);
    else if (a === "board") await mutate("board", { cards: boardDraft });
    else if (a === "void-request") {
      const reason = prompt(
        "What went wrong? Every player must approve the refund.",
      );
      if (reason) await mutate(a, { reason });
    } else if (a.startsWith("manual-")) {
      let action = a.slice(7),
        amount;
      if (action === "raise") {
        amount = Number(prompt("Raise TO how many total chips this street?"));
        if (!amount) return;
      }
      if (
        confirm(
          `Record ${action}${amount ? " to " + amount : ""} for ${player(state.turn).name}?`,
        )
      )
        await mutate("act", { id: state.turn, action, amount });
    }
  } catch (e) {
    toast(e.message);
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target,
    data = new FormData(form);
  try {
    if (form.id === "join-form" || form.id === "recover-form") {
      const b = await api(
        form.id === "join-form" ? "/api/join" : "/api/recover",
        Object.fromEntries(data),
      );
      recovery = b.recovery || "";
      lastVersion = -1;
      await refresh();
    } else if (form.id === "settings-form")
      await mutate(
        "settings",
        Object.fromEntries([...data].map(([k, v]) => [k, Number(v)])),
      );
    else if (form.id === "raise-form") {
      const amount = Number(data.get("amount"));
      modal.innerHTML = "";
      await mutate("raise", { amount }, "/api/action");
    } else if (form.id === "award-form") {
      const winners = state.pots.map((_, i) => data.getAll("pot" + i));
      if (winners.some((w) => !w.length))
        return toast("Select at least one winner for every pot.");
      const summary = state.pots
        .map(
          (p, i) =>
            `${i ? "Side pot " + i : "Main pot"} (${p.amount}): ${winners[i].map((id) => player(id).name).join(" + ")}`,
        )
        .join("\n");
      if (
        confirm(
          `Confirm physical cards and these payouts:\n\n${summary}\n\nAward chips?`,
        )
      )
        await mutate("award", { winners });
    }
  } catch (e) {
    toast(e.message);
  }
});
async function start() {
  if (dealerView) {
    try {
      await api("/api/bootstrap", {});
    } catch (e) {
      app.innerHTML = `<div class="welcome"><h1>Dealer access is on the Mac.</h1><p>Open <b>http://localhost:8787/dealer</b> on the hosting Mac.</p><p>${esc(e.message)}</p></div>`;
      return;
    }
  }
  await refresh();
  pollTimer = setInterval(refresh, 1400);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
}
start();
