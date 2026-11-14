import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  addPlayer,
  dealer,
  startHand,
  act,
  legal,
  setBoard,
  pots,
  award,
  assertGame,
} from "../engine.ts";
function setup(stacks) {
  const g = createGame();
  for (let i = 0; i < stacks.length; i++) {
    const p = addPlayer(g, "P" + i);
    dealer(g, "approve", { id: p.id });
    p.stack = p.buyIn = stacks[i];
  }
  return g;
}
test("folded contribution levels merge for identical eligible players", () => {
  const g = setup([100, 100, 100]);
  g.players.forEach((p, i) => {
    p.committed = i === 0 ? 10 : 20;
    p.stack -= p.committed;
    p.bet = p.committed;
    p.status = i === 0 ? "folded" : "active";
  });
  assert.equal(pots(g).length, 1);
  assert.equal(pots(g)[0].amount, 50);
});
test("odd chips awarded clockwise left of button", () => {
  const g = setup([100, 100, 100]);
  g.phase = "showdown";
  g.button = g.players[0].id;
  for (const p of g.players) {
    p.stack -= 5;
    p.committed = 5;
    p.status = "active";
  }
  award(g, [[g.players[0].id, g.players[1].id]]);
  assert.deepEqual(
    g.players.map((p) => p.stack),
    [102, 103, 95],
  );
  assertGame(g);
});
test("button rotates to next eligible seat across hands", () => {
  const g = setup([100, 100, 100]);
  startHand(g);
  const first = g.button;
  act(g, g.turn, "fold");
  act(g, g.turn, "fold");
  startHand(g);
  assert.notEqual(g.button, first);
  assert.equal(g.button, g.players[1].id);
});
test("short opening bet allows checkers to raise and complete to big blind", () => {
  const g = setup([100, 25, 100]);
  startHand(g);
  while (g.phase === "betting") {
    const p = g.players.find((p) => p.id === g.turn);
    act(g, p.id, legal(g, p).check ? "check" : "call");
  }
  setBoard(g, ["2c", "3d", "4h"]);
  act(g, g.turn, "allin");
  const l = legal(
    g,
    g.players.find((p) => p.id === g.turn),
  );
  assert.equal(g.currentBet, 5);
  assert.equal(l.minRaise, 20);
  act(g, g.turn, "raise", 20);
  assert.equal(g.lastRaise, 20);
});
test("concurrent side-pot winners must each be eligible", () => {
  const g = setup([100, 200, 300]);
  startHand(g);
  act(g, g.turn, "allin");
  act(g, g.turn, "allin");
  act(g, g.turn, "call");
  for (const c of [["2c", "3d", "4h"], ["8s"], ["Tc"]]) setBoard(g, c);
  const before = structuredClone(g);
  assert.throws(() => award(g, [[g.players[0].id], [g.players[0].id]]));
  assert.deepEqual(g, before);
});
