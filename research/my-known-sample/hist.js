const fs = require('fs');

const BIN_SIZE = 2000;

const idxMap = new Map();
const d = fs.readFileSync('graded.tsv', 'utf-8');
for (const line of d.split('\n')) {
  const tline = line.trim();
  if (tline !== '') {
    const [word, idx, known] = tline.split('\t');
    if ((known !== '0') && (known !== '1')) {
      throw new Error();
    }
    idxMap.set(+idx, known === '1');
  }
}

const maxIdx = Math.max(...idxMap.keys());

for (let bin = 0; bin <= Math.floor(maxIdx/BIN_SIZE); bin++) {
  let knownCount = 0;
  let totalCount = 0;
  const binStart = bin*BIN_SIZE;
  for (i = binStart; i < (binStart+BIN_SIZE); i++) {
    const k = idxMap.get(i);
    if (k !== undefined) {
      totalCount++;
      if (k) {
        knownCount++;
      }
    }
  }
  console.log(knownCount/totalCount);
}
