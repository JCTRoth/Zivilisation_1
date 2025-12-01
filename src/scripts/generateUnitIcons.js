const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'assets', 'unit-icons');

const categories = {
  military: { bg: '#b91c1c', accent: '#f87171' },
  siege: { bg: '#6d28d9', accent: '#c4b5fd' },
  naval: { bg: '#2563eb', accent: '#93c5fd' },
  civilian: { bg: '#15803d', accent: '#6ee7b7' },
  scout: { bg: '#b45309', accent: '#fcd34d' }
};

const overlayByCategory = {
  military: '<path d="M20 22 L32 12 L44 22 L40 26 L32 20 L24 26 Z" fill="rgba(255,255,255,0.22)" />',
  siege: '<rect x="18" y="20" width="28" height="18" rx="4" fill="rgba(255,255,255,0.22)" />',
  naval: '<path d="M16 36 L48 36 L42 46 L22 46 Z" fill="rgba(255,255,255,0.22)" /><circle cx="32" cy="22" r="6" fill="rgba(255,255,255,0.25)" />',
  civilian: '<circle cx="32" cy="28" r="12" fill="rgba(255,255,255,0.22)" />',
  scout: '<path d="M32 18 L44 42 H20 Z" fill="rgba(255,255,255,0.22)" />'
};

const units = [
  { id: 'warrior', label: 'WR', category: 'military' },
  { id: 'militia', label: 'ML', category: 'military' },
  { id: 'archer', label: 'AR', category: 'military' },
  { id: 'phalanx', label: 'PH', category: 'military' },
  { id: 'chariot', label: 'CH', category: 'military' },
  { id: 'legion', label: 'LG', category: 'military' },
  { id: 'musketeer', label: 'MK', category: 'military' },
  { id: 'cavalry', label: 'CV', category: 'military' },
  { id: 'tank', label: 'TN', category: 'military' },
  { id: 'scout', label: 'SC', category: 'scout' },
  { id: 'catapult', label: 'CP', category: 'siege' },
  { id: 'cannon', label: 'CN', category: 'siege' },
  { id: 'artillery', label: 'AT', category: 'siege' },
  { id: 'galley', label: 'GY', category: 'naval' },
  { id: 'trireme', label: 'TR', category: 'naval' },
  { id: 'caravel', label: 'CL', category: 'naval' },
  { id: 'frigate', label: 'FR', category: 'naval' },
  { id: 'ironclad', label: 'IC', category: 'naval' },
  { id: 'destroyer', label: 'DS', category: 'naval' },
  { id: 'cruiser', label: 'CR', category: 'naval' },
  { id: 'battleship', label: 'BS', category: 'naval' },
  { id: 'submarine', label: 'SM', category: 'naval' },
  { id: 'settler', label: 'ST', category: 'civilian' },
  { id: 'worker', label: 'WK', category: 'civilian' },
  { id: 'diplomat', label: 'DP', category: 'civilian' },
  { id: 'caravan', label: 'CA', category: 'civilian' },
  { id: 'ferry', label: 'FY', category: 'civilian' }
];

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const toSvg = ({ id, label, category }) => {
  const { bg, accent } = categories[category];
  const overlay = overlayByCategory[category] || '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">\n  <title>${label} icon</title>\n  <defs>\n    <linearGradient id="grad-${id}" x1="0%" y1="0%" x2="0%" y2="100%">\n      <stop offset="0%" stop-color="${accent}" />\n      <stop offset="100%" stop-color="${bg}" />\n    </linearGradient>\n  </defs>\n  <rect x="4" y="4" width="56" height="56" rx="12" fill="url(#grad-${id})" stroke="rgba(255,255,255,0.45)" stroke-width="2" />\n  ${overlay}\n  <text x="32" y="38" text-anchor="middle" font-family="'Fira Sans', 'Arial', sans-serif" font-size="22" font-weight="700" fill="#ffffff" letter-spacing="1">${label}</text>\n</svg>\n`;
};

units.forEach((unit) => {
  const svgContent = toSvg(unit);
  const output = path.join(OUTPUT_DIR, `${unit.id}.svg`);
  fs.writeFileSync(output, svgContent, 'utf8');
  console.log(`Generated icon for ${unit.id}`);
});
