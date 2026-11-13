import { compare } from './core.js';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: compare(data) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
