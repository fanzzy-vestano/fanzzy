// Draw character outlines rather than SVG text, so the answer is not present
// as selectable text in the response. Shared by the Node and Edge handlers.
const glyphs: Record<string, string> = {
  "2": "M2 3 Q3 0 6 0 Q10 0 10 4 Q10 6 2 12 L11 12",
  "3": "M2 1 Q10 -1 10 3 Q10 6 6 6 Q11 6 10 10 Q9 13 2 12",
  "4": "M8 12 L8 0 L1 8 L11 8",
  "5": "M10 0 L2 0 L2 6 Q10 4 10 9 Q10 13 2 12",
  "6": "M10 1 Q2 -2 2 7 Q2 13 6 12 Q11 12 10 8 Q9 4 2 7",
  "7": "M1 0 L11 0 L4 12",
  "8": "M6 6 Q1 5 2 2 Q3 -1 7 0 Q11 1 10 3 Q10 5 6 6 Q0 7 2 10 Q3 13 7 12 Q12 11 10 8 Q9 6 6 6",
  "9": "M10 5 Q3 8 2 4 Q1 0 6 0 Q11 0 10 6 Q10 13 2 12",
  A: "M1 12 L5 0 L7 0 L11 12 M3 8 L9 8",
  B: "M2 12 L2 0 L7 0 Q11 0 10 3 Q10 6 6 6 L2 6 M6 6 Q11 6 11 9 Q11 12 7 12 Z",
  C: "M10 1 Q2 -2 2 6 Q2 14 10 11",
  D: "M2 12 L2 0 L6 0 Q11 0 11 6 Q11 12 6 12 Z",
  E: "M10 0 L2 0 L2 12 L10 12 M2 6 L8 6",
  F: "M2 12 L2 0 L10 0 M2 6 L8 6",
  G: "M10 1 Q2 -2 2 6 Q2 14 10 11 L10 7 L7 7",
  H: "M2 0 L2 12 M10 0 L10 12 M2 6 L10 6",
  J: "M10 0 L10 9 Q10 13 5 12 Q2 12 2 9",
  K: "M2 0 L2 12 M10 0 L2 7 M5 5 L11 12",
  L: "M2 0 L2 12 L10 12",
  M: "M1 12 L2 0 L6 7 L10 0 L11 12",
  N: "M2 12 L2 0 L10 12 L10 0",
  P: "M2 12 L2 0 L7 0 Q11 0 10 4 Q10 7 2 7",
  Q: "M6 0 Q1 0 1 6 Q1 12 6 12 Q11 12 11 6 Q11 0 6 0 M7 9 L11 13",
  R: "M2 12 L2 0 L7 0 Q11 0 10 4 Q10 7 2 7 M6 7 L11 12",
  S: "M10 1 Q2 -2 2 3 Q2 5 6 6 Q10 7 10 9 Q10 14 2 11",
  T: "M1 0 L11 0 M6 0 L6 12",
  U: "M2 0 L2 8 Q2 12 6 12 Q10 12 10 8 L10 0",
  V: "M1 0 L5 12 L7 12 L11 0",
  W: "M1 0 L3 12 L6 5 L9 12 L11 0",
  X: "M2 0 L10 12 M10 0 L2 12",
  Y: "M1 0 L6 6 L11 0 M6 6 L6 12",
  Z: "M2 0 L10 0 L2 12 L10 12",
  a: "M9 4 Q2 1 2 8 Q2 13 7 12 Q9 11 9 8 M9 4 L9 12",
  b: "M2 0 L2 12 M2 5 Q10 1 10 8 Q10 14 2 11",
  c: "M10 5 Q2 2 2 8 Q2 14 10 11",
  d: "M10 0 L10 12 M10 5 Q2 1 2 8 Q2 14 10 11",
  e: "M2 8 L10 8 Q10 3 6 3 Q2 3 2 8 Q2 14 10 11",
  f: "M4 12 L4 3 Q4 0 8 0 M2 5 L8 5",
  g: "M9 4 Q2 1 2 7 Q2 12 9 10 M9 4 L9 11 Q9 15 3 15",
  h: "M2 0 L2 12 M2 6 Q4 3 7 4 Q10 4 10 7 L10 12",
  j: "M8 4 L8 12 Q8 15 4 15 M8 0 L8 0.2",
  k: "M2 0 L2 12 M9 4 L2 9 M5 7 L10 12",
  m: "M1 12 L1 4 M1 6 Q4 2 6 5 L6 12 M6 6 Q9 2 11 5 L11 12",
  n: "M2 12 L2 4 M2 6 Q4 3 7 4 Q10 4 10 7 L10 12",
  p: "M2 4 L2 15 M2 5 Q10 1 10 8 Q10 13 2 11",
  q: "M10 4 L10 15 M10 5 Q2 1 2 8 Q2 13 10 11",
  r: "M3 12 L3 4 M3 7 Q5 3 9 4",
  s: "M9 4 Q2 2 2 5 Q2 7 6 8 Q10 9 9 11 Q8 14 2 11",
  t: "M5 1 L5 9 Q5 12 9 12 M2 4 L9 4",
  u: "M2 4 L2 9 Q2 13 6 12 Q9 12 10 9 M10 4 L10 12",
  v: "M2 4 L6 12 L10 4",
  w: "M1 4 L3 12 L6 7 L9 12 L11 4",
  x: "M2 4 L10 12 M10 4 L2 12",
  y: "M2 4 L6 12 L10 4 M6 12 L4 15",
  z: "M2 4 L10 4 L2 12 L10 12",
};

// Avoid ambiguous characters while including uppercase and lowercase forms.
export const CAPTCHA_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

export function applyCaptchaCase(answer: string, noise: Uint8Array) {
  return [...answer].map((character, index) =>
    (index + (noise[0] % 2)) % 2 === 1 ? character.toLowerCase() : character,
  ).join("");
}

export function renderCaptchaImage(answer: string, noise: Uint8Array) {
  const paths = [...answer].map((character, index) => {
    const tilt = (noise[index] % 35) - 17;
    const x = 77 + [0, 17, 40, 61, 82][index];
    const lower = character !== character.toUpperCase();
    const y = (lower ? 34 : 25) + (noise[index + 5] % 8);
    const height = lower ? 1.95 : 2.50;
    return `<path d="${glyphs[character]}" transform="translate(${x} ${y}) rotate(${tilt} 12 20) scale(1.8 ${height})"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="255" height="80" viewBox="0 0 255 80"><rect width="255" height="80" fill="#ffffff"/><g fill="none" stroke="#4b1c2b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
