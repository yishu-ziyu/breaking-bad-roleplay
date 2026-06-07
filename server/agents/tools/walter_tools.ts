import fs from 'fs';
import path from 'path';

interface CookResult {
  yield: number;
  purity: number;
  contaminated: boolean;
  message: string;
}

export function walter_cook(precursor_p2p: number, temperature: number): CookResult {
  const memoryDir = path.join(process.cwd(), 'server', 'agents', 'memory', 'walter');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  // Linear yield multiplier abstraction (Design A Safety Guidelines)
  const randomMod = 0.95 + Math.random() * 0.1; // RandomModifier(0.95, 1.05)
  const yieldAmount = precursor_p2p * 0.991 * randomMod;
  
  let contaminated = false;
  let purity = 99.1;
  let message = `Yield calculated perfectly: ${yieldAmount.toFixed(2)} lbs at ${purity}% purity.`;

  // Temperature deviation check
  if (Math.abs(temperature - 185) > 2) {
    contaminated = true;
    purity = clamp(purity - (Math.abs(temperature - 185) * 5), 10, 80);
    message = `contamination alarm: structural fly interference detected. Temperature deviated to ${temperature}°C. Yield purity collapsed to ${purity.toFixed(1)}%.`;
  }

  // Update precursor stock file
  const precursorFile = path.join(memoryDir, 'precursor_stock.json');
  let currentStock = 100;
  if (fs.existsSync(precursorFile)) {
    try {
      currentStock = JSON.parse(fs.readFileSync(precursorFile, 'utf-8')).stock;
    } catch {
      currentStock = 100;
    }
  }
  currentStock = Math.max(0, currentStock - precursor_p2p);
  fs.writeFileSync(precursorFile, JSON.stringify({ stock: currentStock, last_cook_yield: yieldAmount }));

  // Append encrypted journal entry
  const journalPath = path.join(memoryDir, 'scientific_journal.txt');
  const journalEntry = `[${new Date().toISOString()}] COOK EVENT: P2P Consumed = ${precursor_p2p}L, Temperature = ${temperature}°C, Yield = ${yieldAmount.toFixed(2)} lbs, Purity = ${purity.toFixed(1)}%, Contaminated = ${contaminated}. Ledger balance synchronized.\n`;
  fs.appendFileSync(journalPath, journalEntry);

  return {
    yield: yieldAmount,
    purity,
    contaminated,
    message
  };
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
