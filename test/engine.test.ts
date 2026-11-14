import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  addPlayer,
  dealer,
  act,
  startHand,
  setBoard,
  award,
  pots,
  legal,
  assertGame,
  approveVoid,
} from "../engine.ts";
function game(stacks = [1000, 1000, 1000]) {
  const g = createGame();
  for (let i = 0; i < stacks.length; i++) {
    const p = addPlayer(g, "P" + i);
    dealer(g, "approve", { id: p.id });
    p.stack = stacks[i];
    p.buyIn = stacks[i];
  }
  return g;
}
function action(g, a, n) {
  act(g, g.turn, a, n);
  assertGame(g);
}
function runBoard(g) {
  for (const cards of [["2c", "3d", "4h"], ["8s"], ["9c"]]) {
    setBoard(g, cards);
    while (g.phase === "betting")
      action(
        g,
        legal(
          g,
          g.players.find((p) => p.id === g.turn),
        ).check
          ? "check"
          : "call",
      );
  }
}
test("heads up: button small blind acts first preflop and last postflop", () => {
  const g = game([1000, 1000]);
  startHand(g);
  assert.equal(g.sb, g.button);
  assert.equal(g.turn, g.button);
  action(g, "call");
  assert.equal(g.turn, g.bb);
  action(g, "check");
  assert.equal(g.phase, "awaiting_board");
  setBoard(g, ["2c", "3d", "4h"]);
  assert.equal(g.turn, g.bb);
});
test("checks through every street, ties and conservation", () => {
  const g = game();
  startHand(g);
  while (g.phase === "betting")
    action(
      g,
      legal(
        g,
        g.players.find((p) => p.id === g.turn),
      ).check
        ? "check"
        : "call",
    );
  runBoard(g);
  assert.equal(g.phase, "showdown");
  assert.equal(pots(g)[0].amount, 60);
  award(g, [[g.players[0].id, g.players[1].id]]);
  assertGame(g);
  assert.equal(g.players[0].stack, 1010);
  assert.equal(g.players[2].stack, 980);
});
test("side pots and unmatched all-in refund", () => {
  const g = game([100, 200, 300]);
  startHand(g);
  action(g, "allin");
  action(g, "allin");
  action(g, "call");
  assert.deepEqual(
    pots(g).map((p) => p.amount),
    [300, 200],
  );
  assert.equal(g.players[2].stack, 100);
  runBoard(g);
  award(g, [[g.players[0].id], [g.players[1].id]]);
  assert.deepEqual(
    g.players.map((p) => p.stack),
    [300, 200, 100],
  );
  assertGame(g);
});
test("fold win and unmatched return", () => {
  const g = game();
  startHand(g);
  action(g, "raise", 100);
  action(g, "fold");
  action(g, "fold");
  assert.equal(g.phase, "complete");
  assert.equal(g.players[0].stack, 1030);
  assertGame(g);
});
test("reject invalid turn, check, raise, duplicate board", () => {
  const g = game();
  startHand(g);
  assert.throws(() => act(g, g.players[1].id, "call"));
  assert.throws(() => action(g, "check"));
  assert.throws(() => action(g, "raise", 30));
  action(g, "call");
  action(g, "call");
  action(g, "check");
  assert.throws(() => setBoard(g, ["2c", "2c", "3h"]));
});
test("short all-in does not reopen a previous full raise", () => {
  const g = game([1000, 150, 1000]);
  startHand(g);
  action(g, "raise", 100);
  action(g, "allin");
  action(g, "call");
  const l = legal(g, g.players[0]);
  assert.equal(l.canRaise, false);
  assert.equal(l.fullCall, 50);
  action(g, "call");
  assert.equal(g.phase, "awaiting_board");
});
test("cumulative short all-ins reopen action", () => {
  const g = game([150, 200, 1000, 1000]);
  startHand(g);
  action(g, "raise", 100);
  action(g, "allin");
  action(g, "allin");
  action(g, "call");
  assert.equal(g.currentBet, 200);
  assert.equal(g.turn, g.players[3].id);
  assert.equal(legal(g, g.players[3]).canRaise, true);
  assert.equal(legal(g, g.players[3]).minRaise, 280);
});
test("short blind heads up only calls actual opposing chips", () => {
  const g = game([100, 5]);
  startHand(g);
  assert.equal(g.phase, "awaiting_board");
  assert.equal(g.players[0].stack, 95);
  assert.deepEqual(
    pots(g).map((p) => p.amount),
    [10],
  );
  assertGame(g);
});
test("void requires every involved player, restores original chips", () => {
  const g = game();
  startHand(g);
  action(g, "raise", 100);
  dealer(g, "void-request", { reason: "Wrong board" });
  approveVoid(g, g.players[0].id);
  assert.equal(g.phase, "betting");
  approveVoid(g, g.players[1].id);
  approveVoid(g, g.players[2].id);
  assert.equal(g.phase, "complete");
  assert.deepEqual(
    g.players.map((p) => p.stack),
    [1000, 1000, 1000],
  );
  assertGame(g);
});
test("folded player cannot win side pot", () => {
  const g = game();
  startHand(g);
  action(g, "fold");
  action(g, "call");
  action(g, "check");
  runBoard(g);
  assert.throws(() => award(g, [[g.players[0].id]]));
});
test("seat removal preserves remaining balances", () => {
  const g = game();
  dealer(g, "remove", { id: g.players[1].id });
  assert.equal(g.players.length, 2);
  assertGame(g);
});
