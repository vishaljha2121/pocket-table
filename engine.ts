import { randomUUID } from "node:crypto";
export const STREETS = ["preflop", "flop", "turn", "river"];
export function createGame() {
  return {
    version: 0,
    hand: 0,
    phase: "lobby",
    street: "preflop",
    board: [],
    players: [],
    button: null,
    turn: null,
    currentBet: 0,
    lastRaise: 20,
    smallBlind: 10,
    bigBlind: 20,
    startingStack: 1000,
    paused: false,
    log: [],
    result: null,
    handStart: null,
    correction: null,
  };
}
export function note(g, text) {
  g.log.push({ time: Date.now(), hand: g.hand, text });
  g.log = g.log.slice(-200);
}
export function integer(n, min = 0, max = 100000000) {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw Error(`Enter a whole number from ${min} to ${max}.`);
  return n;
}
function need(ok, msg) {
  if (!ok) throw Error(msg);
}
export function addPlayer(g, name) {
  need(
    typeof name === "string" &&
      name.trim().length >= 1 &&
      name.trim().length <= 24,
    "Use a name of 1–24 characters.",
  );
  need(g.players.length < 20, "Table is full.");
  const p = {
    id: randomUUID(),
    name: name.trim(),
    approved: false,
    sitOut: false,
    stack: 0,
    buyIn: 0,
    status: "out",
    bet: 0,
    committed: 0,
    actedAt: null,
  };
  g.players.push(p);
  note(g, `${p.name} requested a seat.`);
  return p;
}
export function seated(g) {
  return g.players.filter((p) => p.approved);
}
export function live(g) {
  return g.players.filter((p) => ["active", "allin"].includes(p.status));
}
export function next(g, id, predicate) {
  const i = g.players.findIndex((p) => p.id === id);
  for (let n = 1; n <= g.players.length; n++) {
    const p = g.players[(i + n + g.players.length) % g.players.length];
    if (predicate(p)) return p;
  }
  return null;
}
function pay(p, amount) {
  integer(amount);
  need(amount <= p.stack, "Not enough chips.");
  p.stack -= amount;
  p.bet += amount;
  p.committed += amount;
  if (p.stack === 0) p.status = "allin";
}
export function effectiveBet(g, p) {
  const actors = live(g).filter((x) => x.status === "active");
  return actors.length <= 1
    ? Math.max(
        0,
        ...live(g)
          .filter((x) => x.id !== p.id)
          .map((x) => x.bet),
      )
    : g.currentBet;
}
export function legal(g, p) {
  if (
    !p ||
    g.phase !== "betting" ||
    g.paused ||
    g.turn !== p.id ||
    p.status !== "active"
  )
    return null;
  const target = effectiveBet(g, p),
    call = Math.max(0, target - p.bet),
    max = p.bet + p.stack;
  const reopen =
    p.actedAt === null ||
    g.currentBet - p.actedAt >= g.lastRaise ||
    (p.actedAt === 0 && g.currentBet > 0 && g.currentBet < g.bigBlind);
  const opposition = live(g).some(
    (x) => x.id !== p.id && x.status === "active",
  );
  const min =
    g.currentBet < g.bigBlind ? g.bigBlind : g.currentBet + g.lastRaise;
  return {
    call: Math.min(call, p.stack),
    fullCall: call,
    check: call === 0,
    canRaise: reopen && opposition && max > g.currentBet,
    minRaise: min,
    maxRaise: max,
    allIn: max <= target || (reopen && opposition),
  };
}
function refund(g) {
  const sorted = g.players
    .filter((p) => p.bet > 0)
    .sort((a, b) => b.bet - a.bet);
  if (!sorted.length) return;
  const top = sorted[0],
    diff = top.bet - (sorted[1]?.bet || 0);
  if (diff > 0) {
    top.bet -= diff;
    top.committed -= diff;
    top.stack += diff;
    if (top.status === "allin") top.status = "active";
    note(g, `${diff} unmatched chips returned to ${top.name}.`);
  }
}
function finishRound(g) {
  refund(g);
  g.turn = null;
  g.phase = g.street === "river" ? "showdown" : "awaiting_board";
  note(
    g,
    g.phase === "showdown"
      ? "Showdown: verify physical cards and award each pot."
      : `Betting complete. Dealer: enter the ${STREETS[STREETS.indexOf(g.street) + 1]}.`,
  );
}
function advance(g, after) {
  const remaining = live(g);
  if (remaining.length === 1) {
    refund(g);
    const winner = remaining[0],
      amount = g.players.reduce((s, p) => s + p.committed, 0);
    winner.stack += amount;
    g.result = {
      text: `${winner.name} wins ${amount} chips — everyone else folded.`,
      awards: [{ id: winner.id, amount }],
    };
    for (const p of g.players) {
      p.committed = 0;
      p.bet = 0;
    }
    g.phase = "complete";
    g.turn = null;
    note(g, g.result.text);
    return;
  }
  const active = remaining.filter((p) => p.status === "active");
  if (
    active.length === 0 ||
    (active.length === 1 && active[0].bet >= effectiveBet(g, active[0]))
  ) {
    finishRound(g);
    return;
  }
  const candidate = next(
    g,
    after,
    (p) =>
      p.status === "active" && (p.actedAt === null || p.bet < g.currentBet),
  );
  if (!candidate) {
    finishRound(g);
    return;
  }
  g.turn = candidate.id;
}
export function startHand(g) {
  need(
    ["lobby", "complete"].includes(g.phase),
    "Finish the current hand first.",
  );
  need(!g.correction, "Resolve the correction first.");
  const ready = seated(g).filter((p) => !p.sitOut && p.stack > 0);
  need(
    ready.length >= 2 && ready.length <= 10,
    "Need 2–10 seated players with chips.",
  );
  g.handStart = g.players.map((p) => ({ id: p.id, stack: p.stack }));
  g.hand++;
  g.board = [];
  g.result = null;
  g.street = "preflop";
  g.phase = "betting";
  g.paused = false;
  g.currentBet = g.bigBlind;
  g.lastRaise = g.bigBlind;
  for (const p of g.players) {
    p.status = ready.includes(p) ? "active" : "out";
    p.bet = 0;
    p.committed = 0;
    p.actedAt = null;
  }
  g.button = next(g, g.button, (p) => p.status === "active").id;
  const button = g.players.find((p) => p.id === g.button);
  const sb =
    ready.length === 2
      ? button
      : next(g, button.id, (p) => p.status === "active");
  const bb = next(g, sb.id, (p) => p.status === "active");
  g.sb = sb.id;
  g.bb = bb.id;
  pay(sb, Math.min(sb.stack, g.smallBlind));
  pay(bb, Math.min(bb.stack, g.bigBlind));
  note(
    g,
    `Hand ${g.hand}: ${sb.name} posts ${sb.bet}; ${bb.name} posts ${bb.bet}.`,
  );
  advance(g, bb.id);
}
export function act(g, id, action, amount) {
  const p = g.players.find((x) => x.id === id);
  const l = legal(g, p);
  need(l, "It is not your turn, or the table is paused.");
  if (action === "fold") {
    p.status = "folded";
    note(g, `${p.name} folds.`);
  } else if (action === "check") {
    need(l.check, "You must call or fold.");
    p.actedAt = g.currentBet;
    note(g, `${p.name} checks.`);
  } else if (action === "call") {
    need(l.fullCall > 0, "There is nothing to call.");
    pay(p, l.call);
    p.actedAt = g.currentBet;
    note(
      g,
      `${p.name} calls ${l.call}${p.status === "allin" ? " (all-in)" : ""}.`,
    );
  } else if (action === "raise" || action === "allin") {
    let to = action === "allin" ? l.maxRaise : integer(amount, 1);
    if (to <= effectiveBet(g, p)) {
      need(action === "allin" && l.allIn, "Use Call.");
      pay(p, p.stack);
      p.actedAt = g.currentBet;
      note(g, `${p.name} calls all-in for ${to}.`);
    } else {
      need(l.canRaise, "Raising is not available.");
      need(to <= l.maxRaise && to > g.currentBet, "Invalid raise amount.");
      need(
        to >= l.minRaise || to === l.maxRaise,
        `Minimum raise is to ${l.minRaise}, unless all-in.`,
      );
      const old = g.currentBet;
      pay(p, to - p.bet);
      if (to >= l.minRaise) g.lastRaise = old < g.bigBlind ? to : to - old;
      g.currentBet = to;
      p.actedAt = to;
      note(
        g,
        `${p.name} ${old === 0 ? "bets" : "raises to"} ${to}${p.status === "allin" ? " (all-in)" : ""}.`,
      );
    }
  } else throw Error("Unknown action.");
  advance(g, p.id);
}
export function setBoard(g, cards) {
  need(g.phase === "awaiting_board", "Finish betting before dealing.");
  need(!g.paused, "Resume the table first.");
  const street = STREETS[STREETS.indexOf(g.street) + 1],
    count = street === "flop" ? 3 : 1;
  need(
    Array.isArray(cards) && cards.length === count,
    `Enter ${count} card${count > 1 ? "s" : ""}.`,
  );
  need(
    cards.every((c) => /^[2-9TJQKA][cdhs]$/.test(c)),
    "Invalid card.",
  );
  need(
    new Set([...g.board, ...cards]).size === g.board.length + cards.length,
    "A card cannot appear twice.",
  );
  g.board.push(...cards);
  g.street = street;
  g.currentBet = 0;
  g.lastRaise = g.bigBlind;
  for (const p of g.players) {
    p.bet = 0;
    p.actedAt = null;
  }
  g.phase = "betting";
  note(g, `${street.toUpperCase()}: ${cards.join(" ")}.`);
  advance(g, g.button);
}
export function pots(g) {
  const levels = [
    ...new Set(g.players.map((p) => p.committed).filter((x) => x > 0)),
  ].sort((a, b) => a - b);
  let prev = 0;
  const result = [];
  for (const level of levels) {
    const contributors = g.players.filter((p) => p.committed >= level),
      eligible = contributors
        .filter((p) => ["active", "allin"].includes(p.status))
        .map((p) => p.id),
      amount = (level - prev) * contributors.length;
    prev = level;
    const existing = result.find(
      (p) => JSON.stringify(p.eligible) === JSON.stringify(eligible),
    );
    if (existing) existing.amount += amount;
    else result.push({ index: result.length, amount, eligible });
  }
  return result;
}
export function award(g, selections) {
  need(g.phase === "showdown" && !g.paused, "Showdown is not ready.");
  const ps = pots(g);
  need(
    Array.isArray(selections) && selections.length === ps.length,
    "Select winners for every pot.",
  );
  const awards = new Map();
  ps.forEach((pot, i) => {
    const ids = selections[i];
    need(
      Array.isArray(ids) &&
        ids.length > 0 &&
        new Set(ids).size === ids.length &&
        ids.every((id) => pot.eligible.includes(id)),
      "Winner must be eligible for that pot.",
    );
    const ordered = [];
    let pos = g.button;
    for (let n = 0; n < g.players.length; n++) {
      const p = next(g, pos, () => true);
      pos = p.id;
      if (ids.includes(pos)) ordered.push(pos);
    }
    const share = Math.floor(pot.amount / ids.length);
    let odd = pot.amount % ids.length;
    for (const id of ordered)
      awards.set(id, (awards.get(id) || 0) + share + (odd-- > 0 ? 1 : 0));
  });
  for (const [id, amount] of awards)
    g.players.find((p) => p.id === id).stack += amount;
  g.result = {
    text: [...awards]
      .map(([id, n]) => `${g.players.find((p) => p.id === id).name} +${n}`)
      .join(" · "),
    awards: [...awards].map(([id, amount]) => ({ id, amount })),
  };
  for (const p of g.players) {
    p.committed = 0;
    p.bet = 0;
  }
  g.phase = "complete";
  g.turn = null;
  note(g, `Payout confirmed: ${g.result.text}.`);
}
export function dealer(g, action, data = {}) {
  const idle = ["lobby", "complete"].includes(g.phase);
  switch (action) {
    case "approve": {
      need(idle, "Seat players between hands.");
      need(seated(g).length < 10, "Maximum 10 seats.");
      const p = g.players.find((p) => p.id === data.id);
      need(p && !p.approved, "Player not pending.");
      p.approved = true;
      p.stack = g.startingStack;
      p.buyIn = g.startingStack;
      note(g, `${p.name} seated with ${p.stack} chips.`);
      break;
    }
    case "remove": {
      need(idle, "Remove players between hands.");
      const p = g.players.find((p) => p.id === data.id);
      need(p, "Player not found.");
      note(
        g,
        `${p.name} leaves with ${p.stack} chips (net ${p.stack - p.buyIn}).`,
      );
      g.cashOutAdjustment = (g.cashOutAdjustment || 0) + p.stack - p.buyIn;
      if (g.button === p.id) {
        const i = g.players.indexOf(p);
        g.button =
          g.players.length > 1
            ? g.players[(i - 1 + g.players.length) % g.players.length].id
            : null;
      }
      g.players = g.players.filter((x) => x.id !== p.id);
      break;
    }
    case "settings":
      need(idle, "Change settings between hands.");
      integer(data.smallBlind, 1, 100000);
      integer(data.bigBlind, data.smallBlind, 100000);
      integer(data.startingStack, 1, 10000000);
      Object.assign(g, {
        smallBlind: data.smallBlind,
        bigBlind: data.bigBlind,
        startingStack: data.startingStack,
      });
      note(g, `Blinds set to ${g.smallBlind}/${g.bigBlind}.`);
      break;
    case "rebuy": {
      need(idle, "Rebuy between hands.");
      const p = g.players.find((p) => p.id === data.id && p.approved);
      need(p, "Player not found.");
      const amount = integer(data.amount, 1, 10000000);
      p.stack += amount;
      p.buyIn += amount;
      note(g, `${p.name} adds ${amount} chips.`);
      break;
    }
    case "sitout": {
      need(idle, "Change participation between hands.");
      const p = g.players.find((p) => p.id === data.id);
      need(p, "Player not found.");
      p.sitOut = !p.sitOut;
      note(g, `${p.name} ${p.sitOut ? "sits out" : "returns"}.`);
      break;
    }
    case "move": {
      need(idle, "Move seats between hands.");
      const i = g.players.findIndex((p) => p.id === data.id),
        j = i + data.direction;
      need(
        i >= 0 &&
          j >= 0 &&
          j < g.players.length &&
          [-1, 1].includes(data.direction),
        "Cannot move this seat.",
      );
      [g.players[i], g.players[j]] = [g.players[j], g.players[i]];
      break;
    }
    case "start":
      startHand(g);
      break;
    case "board":
      setBoard(g, data.cards);
      break;
    case "award":
      award(g, data.winners);
      break;
    case "pause":
      g.paused = !g.paused;
      note(
        g,
        g.paused ? "Dealer paused the table." : "Dealer resumed the table.",
      );
      break;
    case "act":
      act(g, data.id, data.action, data.amount);
      note(g, "Action entered by dealer on behalf of player.");
      break;
    case "void-request":
      need(!idle && g.handStart, "No active hand.");
      need(
        typeof data.reason === "string" && data.reason.trim().length >= 3,
        "Explain the correction.",
      );
      g.paused = true;
      g.correction = {
        reason: data.reason.trim().slice(0, 160),
        votes: [],
        required: g.players.filter((p) => p.status !== "out").map((p) => p.id),
      };
      note(
        g,
        `Dealer requests void/refund: ${g.correction.reason}. All involved players must approve.`,
      );
      break;
    case "void-cancel":
      g.correction = null;
      note(g, "Void request cancelled. Table remains paused.");
      break;
    default:
      throw Error("Unknown dealer action.");
  }
}
export function approveVoid(g, id) {
  need(
    g.correction && g.correction.required.includes(id),
    "No correction to approve.",
  );
  if (!g.correction.votes.includes(id)) g.correction.votes.push(id);
  if (g.correction.required.every((x) => g.correction.votes.includes(x))) {
    for (const entry of g.handStart) {
      const p = g.players.find((p) => p.id === entry.id);
      if (p) p.stack = entry.stack;
    }
    for (const p of g.players) {
      p.bet = 0;
      p.committed = 0;
      p.status = "out";
    }
    g.phase = "complete";
    g.turn = null;
    g.correction = null;
    g.paused = false;
    g.result = {
      text: "Hand voided with unanimous approval. All chips refunded.",
      awards: [],
    };
    note(g, g.result.text);
  }
}
export function assertGame(g) {
  const total = g.players.reduce((s, p) => s + p.stack + p.committed, 0),
    buyin =
      g.players.reduce((s, p) => s + p.buyIn, 0) - (g.cashOutAdjustment || 0);
  need(total === buyin, `Chip conservation failed: ${total} / ${buyin}.`);
  for (const p of g.players)
    need(
      Number.isSafeInteger(p.stack) &&
        p.stack >= 0 &&
        p.committed >= 0 &&
        p.bet >= 0 &&
        p.bet <= p.committed,
      "Invalid chip state.",
    );
  need(
    !g.turn || g.players.some((p) => p.id === g.turn && p.status === "active"),
    "Invalid turn.",
  );
}
