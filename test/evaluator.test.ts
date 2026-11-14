import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, simulate } from "../public/evaluator.js";
const e = (s) => evaluate(s.split(" "));
test("all categories and wheel", () => {
  const hands = [
    "Ac Kd 9h 7s 4c",
    "Ac Ad 9h 7s 4c",
    "Ac Ad 9h 9s 4c",
    "Ac Ad Ah 7s 4c",
    "Ac 2d 3h 4s 5c",
    "Ac Jc 9c 7c 4c",
    "Ac Ad Ah 7s 7c",
    "Ac Ad Ah As 4c",
    "Ac Kc Qc Jc Tc",
  ];
  hands.forEach((h, i) => assert.equal(e(h).category, i));
  assert.ok(e("2c 3d 4h 5s 6c").score > e("Ac 2d 3h 4s 5c").score);
});
test("two trips choose highest full house; three pairs choose best kicker", () => {
  assert.deepEqual(e("Ac Ad Ah Kc Kd Kh 2s").cards, [
    "Ac",
    "Ad",
    "Ah",
    "Kc",
    "Kd",
  ]);
  assert.ok(e("Ac Ad Kc Kd Qc Qd 2s").score > e("Ac Ad Kc Kd Jc Jd 2s").score);
});
test("board royal flush ties and equity divides", () => {
  const r = simulate(["2d", "3d"], ["Ac", "Kc", "Qc", "Jc", "Tc"], 3, 100);
  assert.equal(r.tie, 1);
  assert.equal(r.equity, 0.25);
});
test("unbeatable royal flush wins", () => {
  const r = simulate(["Ac", "Kc"], ["Qc", "Jc", "Tc", "2d", "3h"], 5, 100);
  assert.equal(r.win, 1);
  assert.equal(r.equity, 1);
});
test("reject duplicate input", () =>
  assert.throws(() => simulate(["Ac", "Ac"], [], 1, 100)));
