import { simulate } from "./evaluator.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      result: simulate(data.hole, data.board, data.opponents, data.samples),
    });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
