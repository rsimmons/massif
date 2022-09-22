const FREQ_LIST = require('./freqlist_drama_20k');

const STEP = 100;
const picked = new Set();
for (let i = 0; i <= (FREQ_LIST.length - STEP); i += STEP) {
  while (true) {
    const idx = i + Math.floor(STEP*Math.random());
    if ((idx < FREQ_LIST.length) && (!picked.has(idx))) {
      console.log(`${FREQ_LIST[idx]},${idx}`);
      picked.add(idx);
      break;
    }
  }
}
