import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  addPlayer,
  dealer,
  act,
  startHand,
  setBoard,
  pots,
  award,
  legal,
  assertGame,
} from "../engine.ts";
let seed = 911;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
test("500 randomized complete games conserve chips and terminate", () => {
  for (let t = 0; t < 500; t++) {
    const g = createGame(),
      n = 2 + Math.floor(rand() * 9);
    for (let i = 0; i < n; i++) {
      const p = addPlayer(g, "P" + i);
      dealer(g, "approve", { id: p.id });
      p.stack = p.buyIn = 1 + Math.floor(rand() * 1000);
    }
    startHand(g);
    let steps = 0;
    while (g.phase !== "complete") {
      assertGame(g);
      assert.ok(++steps < 200, "game must terminate");
      if (g.phase === "betting") {
        const l = legal(
            g,
            g.players.find((p) => p.id === g.turn),
          ),
          r = rand();
        if (r < 0.12) act(g, g.turn, "fold");
        else if (r < 0.3 && l.allIn) act(g, g.turn, "allin");
        else if (r < 0.45 && l.canRaise)
          act(g, g.turn, "raise", Math.min(l.minRaise, l.maxRaise));
        else act(g, g.turn, l.check ? "check" : "call");
      } else if (g.phase === "awaiting_board")
        setBoard(
          g,
          g.street === "preflop"
            ? ["2c", "3d", "4h"]
            : g.street === "flop"
              ? ["8s"]
              : ["Tc"],
        );
      else if (g.phase === "showdown") {
        const winners = pots(g).map((p) => {
          assert.ok(p.eligible.length > 0);
          return rand() < 0.2
            ? p.eligible
            : [p.eligible[Math.floor(rand() * p.eligible.length)]];
        });
        award(g, winners);
      } else throw Error(g.phase);
    }
    assertGame(g);
    const leaving = g.players[Math.floor(rand() * g.players.length)];
    dealer(g, "remove", { id: leaving.id });
    assertGame(g);
  }
});
