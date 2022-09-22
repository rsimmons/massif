const fs = require('fs');

const BIN_COUNT = 10;

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
const maxSqrt = Math.sqrt(maxIdx+2);

for (let bin = 0; bin < BIN_COUNT; bin++) {
  let knownCount = 0;
  let totalCount = 0;
  const binStart = Math.floor((maxSqrt*bin/BIN_COUNT)**2);
  const binEnd = Math.floor((maxSqrt*(bin+1)/BIN_COUNT)**2);
  for (i = binStart; i < binEnd; i++) {
    const k = idxMap.get(i);
    if (k !== undefined) {
      totalCount++;
      if (k) {
        knownCount++;
      }
    }
  }
  console.log(`${binStart}-${binEnd}\t${knownCount/totalCount}`);
}
