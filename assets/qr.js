/* Hubzone e-Dziennik — minimal QR code generator (byte mode, error correction M).
   Based on the public QR specification (ISO/IEC 18004); no external libraries. */
(function(){
"use strict";
const ECC = [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
const BLK = [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
const bit = (x, i) => ((x >>> i) & 1) !== 0;
const rawModules = v => { let r = (16 * v + 128) * v + 64; if (v >= 2){ const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
const dataCodewords = v => Math.floor(rawModules(v) / 8) - ECC[v] * BLK[v];
function gfMul(x, y){ let z = 0; for (let i = 7; i >= 0; i--){ z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
function rsDivisor(deg){ const r = new Array(deg).fill(0); r[deg - 1] = 1; let root = 1;
  for (let i = 0; i < deg; i++){ for (let j = 0; j < r.length; j++){ r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; } root = gfMul(root, 2); } return r; }
function rsRemainder(data, div){ const r = div.map(() => 0);
  for (const b of data){ const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); } return r; }
function alignPos(v, size){ if (v === 1) return []; const n = Math.floor(v / 7) + 2;
  const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2; const r = [6];
  for (let p = size - 7; r.length < n; p -= step) r.splice(1, 0, p); return r; }

function encode(text){
  const bytes = Array.from(new TextEncoder().encode(text));
  let v = 1; for (; v <= 40; v++){ const cc = v < 10 ? 8 : 16; if (4 + cc + bytes.length * 8 <= dataCodewords(v) * 8) break; }
  if (v > 40) throw new Error("Tekst za długi na kod QR");
  const bits = []; const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  const cap = dataCodewords(v) * 8; put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  // error correction + interleave
  const nb = BLK[v], el = ECC[v], raw = Math.floor(rawModules(v) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
  const div = rsDivisor(el), blocks = [];
  for (let i = 0, k = 0; i < nb; i++){ const d = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1)); k += d.length;
    const e = rsRemainder(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(e)); }
  const all = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) all.push(b[i]); });
  // matrix
  const size = v * 4 + 17, M = [], F = [];
  for (let y = 0; y < size; y++){ M.push(new Array(size).fill(false)); F.push(new Array(size).fill(false)); }
  const setF = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
  for (let i = 0; i < size; i++){ setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++){ const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4); }
  const ap = alignPos(v, size), last = ap.length - 1;
  ap.forEach((ax, i) => ap.forEach((ay, j) => { if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
  const drawFormat = mask => { const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(b, i));
    setF(8, 7, bit(b, 6)); setF(8, 8, bit(b, 7)); setF(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(b, i));
    setF(8, size - 8, true); };
  drawFormat(0);
  if (v >= 7){ let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); const b = (v << 12) | r;
    for (let i = 0; i < 18; i++){ const a = size - 11 + i % 3, c = Math.floor(i / 3); setF(a, c, bit(b, i)); setF(c, a, bit(b, i)); } }
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2){ if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++){ const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!F[y][x] && i < all.length * 8){ M[y][x] = bit(all[i >>> 3], 7 - (i & 7)); i++; } } }
  const MASKS = [(x,y) => (x + y) % 2 === 0, (x,y) => y % 2 === 0, x => x % 3 === 0, (x,y) => (x + y) % 3 === 0,
    (x,y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x,y) => x * y % 2 + x * y % 3 === 0,
    (x,y) => (x * y % 2 + x * y % 3) % 2 === 0, (x,y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const applyMask = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
  const penalty = () => { let p = 0, dark = 0;
    const line = get => { let run = 1; for (let k = 1; k < size; k++){ if (get(k) === get(k - 1)){ run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } };
    const pat = [1,0,1,1,1,0,1], test = get => { for (let k = 0; k + 7 <= size; k++){ if (!pat.every((b, t) => get(k + t) === !!b)) continue;
      const before = k >= 4 && [1,2,3,4].every(t => !get(k - t)), after = k + 11 <= size && [7,8,9,10].every(t => !get(k + t)); if (before || after) p += 40; } };
    for (let y = 0; y < size; y++){ line(x => M[y][x]); test(x => M[y][x]); }
    for (let x = 0; x < size; x++){ line(y => M[y][x]); test(y => M[y][x]); }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++){ const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (M[y][x]) dark++;
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10; return p; };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++){ applyMask(m); drawFormat(m); const pp = penalty(); if (pp < bestP){ bestP = pp; best = m; } applyMask(m); }
  applyMask(best); drawFormat(best);
  return M;
}

/* SVG element (always dark on white, so it scans in dark mode too) */
function svg(text, px){
  const M = encode(text), n = M.length, q = 4, S = n + q * 2, NS = "http://www.w3.org/2000/svg";
  let d = ""; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (M[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", `0 0 ${S} ${S}`); s.setAttribute("shape-rendering", "crispEdges"); s.setAttribute("role", "img"); s.setAttribute("aria-label", "Kod QR z linkiem");
  if (px){ s.setAttribute("width", px); s.setAttribute("height", px); }
  const bg = document.createElementNS(NS, "rect"); bg.setAttribute("width", S); bg.setAttribute("height", S); bg.setAttribute("fill", "#fff");
  const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); p.setAttribute("fill", "#000");
  s.append(bg, p); return s;
}
window.HZQR = { encode, svg };
})();
