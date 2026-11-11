import * as fs from 'fs';

const fileContent = fs.readFileSync('/CensusTracts_位置.csv', 'utf-8');
const lines = fileContent.split('\n');

console.log("Total lines:", lines.length);
for (let i = 0; i < Math.min(25, lines.length); i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  
  // Extract tract info
  // Let's do a simple parse of columns
  const firstQuote = line.indexOf('"');
  let geom = "";
  let rest = line;
  if (firstQuote !== -1) {
    const endQuote = line.indexOf('"', firstQuote + 1);
    if (endQuote !== -1) {
      geom = line.substring(firstQuote, endQuote + 1);
      rest = line.substring(endQuote + 2);
    }
  }
  const parts = rest.split(',');
  const name10 = parts[4] || "N/A";
  const namelsad = parts[5] || "N/A";
  const notes = parts[parts.length - 1] || "N/A";
  console.log(`Line ${i + 1}: Name10: ${name10}, Namelsad: ${namelsad}, Notes: ${notes}, Geom: ${geom.substring(0, 40)}...`);
}
