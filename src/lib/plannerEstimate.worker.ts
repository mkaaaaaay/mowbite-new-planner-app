import {plannerEstimate, type PlannerEstimateInput} from './plannerEstimate';

// works the estimate out off the page's thread: the map stays smooth while it takes a moment (a phone, a big area)
self.onmessage = (e: MessageEvent<{id: number; input: PlannerEstimateInput}>) => {
  let result = null;
  try {
    result = plannerEstimate(e.data.input);
  } catch {
    // a broken outline: no estimate
  }
  self.postMessage({id: e.data.id, result});
};
