export const ranks = "23456789TJQKA",
  suits = "cdhs";
export const deck = Array.from(ranks, (r) =>
  Array.from(suits, (s) => r + s),
).flat();
export const labels = [
  "High card",
  "One pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
];
function straight(values) {
  const s = new Set(values);
  if (s.has(14)) s.add(1);
  for (let high = 14; high >= 5; high--)
    if ([0, 1, 2, 3, 4].every((d) => s.has(high - d))) return high;
  return 0;
}
function score(category, kickers) {
  return [category, ...kickers, ...Array(5 - kickers.length).fill(0)].reduce(
    (a, n) => a * 15 + n,
    0,
  );
}
export function evaluate(cards) {
  if (
    cards.length < 5 ||
    cards.length > 7 ||
    new Set(cards).size !== cards.length ||
    cards.some((c) => !deck.includes(c))
  )
    throw Error("Enter 5–7 unique valid cards.");
  const values = cards.map((c) => ranks.indexOf(c[0]) + 2),
    counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const desc = [...counts.keys()].sort((a, b) => b - a);
  const flush = suits
    .split("")
    .map((s) => cards.filter((c) => c[1] === s))
    .find((c) => c.length >= 5);
  let cat, k, chosen;
  if (flush && straight(flush.map((c) => ranks.indexOf(c[0]) + 2))) {
    cat = 8;
    k = [straight(flush.map((c) => ranks.indexOf(c[0]) + 2))];
  } else if (groups[0][1] === 4) {
    cat = 7;
    k = [groups[0][0], desc.find((v) => v !== groups[0][0])];
  } else if (groups[0][1] >= 3 && groups[1]?.[1] >= 2) {
    cat = 6;
    k = [groups[0][0], groups[1][0]];
  } else if (flush) {
    cat = 5;
    k = flush
      .map((c) => ranks.indexOf(c[0]) + 2)
      .sort((a, b) => b - a)
      .slice(0, 5);
  } else if (straight(values)) {
    cat = 4;
    k = [straight(values)];
  } else if (groups[0][1] === 3) {
    cat = 3;
    k = [groups[0][0], ...desc.filter((v) => v !== groups[0][0]).slice(0, 2)];
  } else if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    cat = 2;
    const pairs = groups
      .filter((x) => x[1] === 2)
      .map((x) => x[0])
      .sort((a, b) => b - a)
      .slice(0, 2);
    k = [...pairs, desc.find((v) => !pairs.includes(v))];
  } else if (groups[0][1] === 2) {
    cat = 1;
    k = [groups[0][0], ...desc.filter((v) => v !== groups[0][0]).slice(0, 3)];
  } else {
    cat = 0;
    k = desc.slice(0, 5);
  }
  let needs;
  if (cat === 8 || cat === 4)
    needs = [0, 1, 2, 3, 4].map((d) => (k[0] - d === 1 ? 14 : k[0] - d));
  else if (cat === 7) needs = [k[0], k[0], k[0], k[0], k[1]];
  else if (cat === 6) needs = [k[0], k[0], k[0], k[1], k[1]];
  else if (cat === 3) needs = [k[0], k[0], k[0], k[1], k[2]];
  else if (cat === 2) needs = [k[0], k[0], k[1], k[1], k[2]];
  else if (cat === 1) needs = [k[0], k[0], k[1], k[2], k[3]];
  else needs = k;
  const pool = [...(cat === 5 || cat === 8 ? flush : cards)];
  chosen = needs.map((v) => {
    const i = pool.findIndex((c) => ranks.indexOf(c[0]) + 2 === v);
    return pool.splice(i, 1)[0];
  });
  return {
    score: score(cat, k),
    category: cat,
    label: cat === 8 && k[0] === 14 ? "Royal flush" : labels[cat],
    cards: chosen,
  };
}
export function simulate(
  hole,
  board,
  opponents,
  samples = 4000,
  random = Math.random,
) {
  if (
    hole.length !== 2 ||
    board.length > 5 ||
    new Set([...hole, ...board]).size !== hole.length + board.length ||
    [...hole, ...board].some((c) => !deck.includes(c))
  )
    throw Error("Choose two distinct cards that are not on the board.");
  if (!Number.isInteger(opponents) || opponents < 1 || opponents > 9)
    throw Error("Choose 1–9 opponents.");
  const available = deck.filter((c) => ![...hole, ...board].includes(c));
  let wins = 0,
    ties = 0,
    equity = 0,
    improved = 0;
  const categories = Array(9).fill(0),
    current = board.length >= 3 ? evaluate([...hole, ...board]) : null;
  for (let n = 0; n < samples; n++) {
    const pool = [...available];
    let size = pool.length;
    const draw = () => {
      const i = Math.floor(random() * size),
        c = pool[i];
      pool[i] = pool[--size];
      return c;
    };
    const runout = [...board];
    while (runout.length < 5) runout.push(draw());
    const mine = evaluate([...hole, ...runout]);
    categories[mine.category]++;
    if (current && mine.category > current.category) improved++;
    let best = mine.score,
      count = 1,
      beaten = false;
    for (let j = 0; j < opponents; j++) {
      const s = evaluate([draw(), draw(), ...runout]).score;
      if (s > best) {
        best = s;
        count = 1;
        beaten = true;
      } else if (s === best) count++;
    }
    if (!beaten) {
      if (count === 1) wins++;
      else ties++;
      equity += 1 / count;
    }
  }
  return {
    samples,
    win: wins / samples,
    tie: ties / samples,
    equity: equity / samples,
    improve: current ? improved / samples : null,
    categories: categories.map((x) => x / samples),
  };
}
export function draws(hole, board) {
  if (
    hole.length !== 2 ||
    board.length < 3 ||
    board.length >= 5 ||
    [...hole, ...board].some((c) => !deck.includes(c)) ||
    new Set([...hole, ...board]).size !== hole.length + board.length
  )
    return [];
  const cards = [...hole, ...board],
    out = [];
  for (const s of suits) {
    if (cards.filter((c) => c[1] === s).length === 4)
      out.push({
        name: "Flush draw",
        detail: `9 unseen ${{ c: "clubs", d: "diamonds", h: "hearts", s: "spades" }[s]} complete a flush.`,
      });
  }
  const values = new Set(cards.map((c) => ranks.indexOf(c[0]) + 2));
  if (values.has(14)) values.add(1);
  const missing = new Set();
  if (!straight([...values]))
    for (let high = 14; high >= 5; high--) {
      const gap = [0, 1, 2, 3, 4]
        .map((d) => high - d)
        .filter((v) => !values.has(v));
      if (gap.length === 1) missing.add(gap[0] === 1 ? 14 : gap[0]);
    }
  if (missing.size) {
    const rs = [...missing].sort((a, b) => a - b).map((v) => ranks[v - 2]);
    out.push({
      name: "Straight draw",
      detail: `A ${rs.join(" or ")} completes a straight (${rs.length * 4} unseen cards).`,
    });
  }
  return out;
}
