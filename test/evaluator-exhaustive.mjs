import assert from "node:assert/strict";
import { deck, evaluate, simulate, draws } from "../public/evaluator.js";
const counts = Array(9).fill(0);
const started = Date.now();
for (let a = 0; a < 48; a++)
  for (let b = a + 1; b < 49; b++)
    for (let c = b + 1; c < 50; c++)
      for (let d = c + 1; d < 51; d++)
        for (let e = d + 1; e < 52; e++)
          counts[
            evaluate([deck[a], deck[b], deck[c], deck[d], deck[e]]).category
          ]++;
assert.deepEqual(
  counts,
  [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40],
);
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let n = 0; n < 1000; n++) {
  const p = [...deck],
    cards = [];
  while (cards.length < 7)
    cards.push(p.splice(Math.floor(rand() * p.length), 1)[0]);
  const best = evaluate(cards);
  let max = 0;
  for (let i = 0; i < 7; i++)
    for (let j = i + 1; j < 7; j++)
      max = Math.max(
        max,
        evaluate(cards.filter((_, k) => k !== i && k !== j)).score,
      );
  assert.equal(best.score, max);
  assert.equal(evaluate(best.cards).score, best.score);
}
const aa = simulate(["Ac", "Ah"], [], 1, 4000, rand);
assert.ok(aa.win > 0.8 && aa.win < 0.9);
assert.equal(draws(["Ah", "Kh"], ["Qh", "Jh", "2c"]).length, 2);
assert.equal(draws(["Ac", "2d"], ["3h", "4s", "9c"])[0].name, "Straight draw");
console.log(
  `PASS: all 2,598,960 five-card hands match standard category frequencies; 1,000 seven-card hands match exhaustive five-card subsets; draw and AA equity checks pass. ${(Date.now() - started) / 1000}s`,
);
