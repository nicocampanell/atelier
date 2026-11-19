import type { Reference } from '../types';

const u = (id: string, w = 640) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;

export const REFERENCES: Reference[] = [
  { id: 'r-sofa', kind: 'image', title: 'Green velvet sofa', source: 'are.na', tags: ['interior', 'furniture', 'green'], color: '#6f8a6a', src: u('1555041469-a586c61ea9bc'), w: 280, h: 186 },
  { id: 'r-chair-corner', kind: 'image', title: 'Reading chair corner', source: 'pinterest.com', tags: ['interior', 'furniture', 'chair'], color: '#d8cbb8', src: u('1586023492125-27b2c045efd7'), w: 220, h: 275 },
  { id: 'r-chair-1', kind: 'image', title: 'Sculptural lounge chair', source: 'x.com/@objectstudio', tags: ['furniture', 'chair', 'object'], color: '#c9b79c', src: u('1567538096630-e0c55bd6374c'), w: 220, h: 300 },
  { id: 'r-chair-2', kind: 'image', title: 'Wooden chair study', source: 'Screenshot', tags: ['furniture', 'chair', 'wood'], color: '#a68a6d', src: u('1506439773649-6e0eb8cfb237'), w: 240, h: 300 },
  { id: 'r-stool', kind: 'image', title: 'Minimal stool', source: 'instagram.com', tags: ['furniture', 'chair', 'object'], color: '#e3ded6', src: u('1503602642458-232111445657'), w: 220, h: 290 },
  { id: 'r-living', kind: 'image', title: 'Warm living room', source: 'are.na', tags: ['interior', 'warm'], color: '#cdb89d', src: u('1493809842364-78817add7ffb'), w: 300, h: 200 },
  { id: 'r-office', kind: 'image', title: 'Studio workspace', source: 'pinterest.com', tags: ['interior', 'workspace'], color: '#b9b2a6', src: u('1524758631624-e2822e304c36'), w: 300, h: 200 },
  { id: 'r-bedroom', kind: 'image', title: 'Soft bedroom light', source: 'Screenshot', tags: ['interior', 'light'], color: '#d9d1c4', src: u('1519710164239-da123dc03ef4'), w: 260, h: 200 },
  { id: 'r-interior-plants', kind: 'image', title: 'Interior with plants', source: 'are.na', tags: ['interior', 'green'], color: '#a9ac92', src: u('1513519245088-0e12902e5a38'), w: 260, h: 340 },
  { id: 'r-lake', kind: 'image', title: 'Golden Gate from above', source: 'x.com/@quietplaces', tags: ['architecture', 'landscape', 'blue'], color: '#7f97a8', src: u('1501594907352-04cda38ebc29'), w: 300, h: 200 },
  { id: 'r-fog', kind: 'image', title: 'Fog over hills', source: 'instagram.com', tags: ['landscape', 'mood'], color: '#9aa39b', src: u('1470071459604-3b5ec3a7fe05'), w: 300, h: 200 },
  { id: 'r-forest', kind: 'image', title: 'Forest light rays', source: 'are.na', tags: ['landscape', 'green', 'light'], color: '#4f6a45', src: u('1441974231531-c6227db76b6e'), w: 300, h: 200 },
  { id: 'r-arch-white', kind: 'image', title: 'White facade curves', source: 'pinterest.com', tags: ['architecture', 'white', 'form'], color: '#dfe2e6', src: u('1487958449943-2429e8be8625'), w: 240, h: 300 },
  { id: 'r-arch-2', kind: 'image', title: 'Concrete geometry', source: 'x.com/@brutal_arch', tags: ['architecture', 'form'], color: '#9ea4ab', src: u('1511818966892-d7d671e672a2'), w: 240, h: 320 },
  { id: 'r-towers', kind: 'image', title: 'Glass towers', source: 'Screenshot', tags: ['architecture', 'blue'], color: '#5d7a96', src: u('1486406146926-c627a92ad1ab'), w: 240, h: 320 },
  { id: 'r-paint', kind: 'image', title: 'Fluid paint texture', source: 'are.na', tags: ['texture', 'color', 'abstract'], color: '#c45a7a', src: u('1541701494587-cb58502866ab'), w: 260, h: 260 },
  { id: 'r-grad-1', kind: 'image', title: 'Gradient study — dusk', source: 'dribbble.com', tags: ['gradient', 'color', 'abstract'], color: '#8a6fd0', src: u('1550684376-efcbd6e3f031'), w: 240, h: 300 },
  { id: 'r-grad-2', kind: 'image', title: 'Gradient study — warm', source: 'dribbble.com', tags: ['gradient', 'color'], color: '#e48b6a', src: u('1557672172-298e090bd0f1'), w: 260, h: 260 },
  { id: 'r-grad-3', kind: 'image', title: 'Gradient study — neon', source: 'Screenshot', tags: ['gradient', 'color'], color: '#5b6be0', src: u('1579546929518-9e396f3cc809'), w: 260, h: 200 },
  { id: 'r-watch', kind: 'image', title: 'Watch product shot', source: 'instagram.com', tags: ['product', 'object'], color: '#d6d2cb', src: u('1523275335684-37898b6baf30'), w: 240, h: 240 },
  { id: 'r-headphones', kind: 'image', title: 'Headphones on yellow', source: 'pinterest.com', tags: ['product', 'yellow', 'object'], color: '#e8c24a', src: u('1505740420928-5e560c06d30e'), w: 240, h: 240 },
  { id: 'r-shoe', kind: 'image', title: 'Red sneaker', source: 'x.com/@productlab', tags: ['product', 'red'], color: '#d2453a', src: u('1542291026-7eec264c27ff'), w: 260, h: 260 },
  { id: 'r-flower', kind: 'image', title: 'Pink flower close-up', source: 'are.na', tags: ['nature', 'color'], color: '#e7a3b6', src: u('1490750967868-88aa4486c946'), w: 240, h: 300 },
  { id: 'r-cat', kind: 'image', title: 'Cat portrait', source: 'Screenshot', tags: ['animal', 'mood'], color: '#a99886', src: u('1518791841217-8f162f1e1131'), w: 240, h: 240 },

  { id: 'f-spread', kind: 'image', title: 'Dinner spread, top down', source: 'instagram.com', tags: ['food', 'table'], color: '#7a6a55', src: u('1504674900247-0877df9cc836'), w: 280, h: 186 },
  { id: 'f-poke', kind: 'image', title: 'Salmon poke bowl', source: 'pinterest.com', tags: ['food', 'bowl', 'color'], color: '#e8e3dc', src: u('1546069901-ba9599a7e63c'), w: 240, h: 300 },
  { id: 'f-pizza', kind: 'image', title: 'Pizza on a board', source: 'are.na', tags: ['food', 'warm'], color: '#5a3b26', src: u('1565299624946-b28f40a0ae38'), w: 260, h: 260 },
  { id: 'f-salad', kind: 'image', title: 'Salad on a dark plate', source: 'x.com/@plated', tags: ['food', 'green', 'mood'], color: '#2d3a3f', src: u('1540189549336-e6e99c3679fe'), w: 240, h: 300 },
  { id: 'f-pancakes', kind: 'image', title: 'Pancake stack, syrup pour', source: 'Screenshot', tags: ['food', 'mood'], color: '#3a3f47', src: u('1567620905732-2d1ec7ab7445'), w: 240, h: 300 },
  { id: 'f-rainbow', kind: 'image', title: 'Rainbow veggie bowl', source: 'pinterest.com', tags: ['food', 'bowl', 'color', 'green'], color: '#8d9a6a', src: u('1512621776951-a57141f2eefd'), w: 260, h: 260 },
  { id: 'f-toast', kind: 'image', title: 'Avocado toast and eggs', source: 'instagram.com', tags: ['food', 'green'], color: '#3d3a33', src: u('1482049016688-2d3e1b311543'), w: 240, h: 300 },
  { id: 'f-pasta', kind: 'image', title: 'Farfalle pasta salad', source: 'are.na', tags: ['food', 'color'], color: '#e9e2c9', src: u('1473093295043-cdd812d0e601'), w: 280, h: 186 },
  { id: 'f-prep', kind: 'image', title: 'Kitchen prep, chopping', source: 'Screenshot', tags: ['food', 'process'], color: '#c9c4bc', src: u('1551218808-94e220e084d2'), w: 280, h: 186 },
  { id: 'f-plating', kind: 'image', title: 'Restaurant plating', source: 'x.com/@plated', tags: ['food', 'interior', 'mood'], color: '#4a3d33', src: u('1414235077428-338989a2e8c0'), w: 300, h: 200 },
  { id: 'f-latte', kind: 'image', title: 'Latte cheers', source: 'instagram.com', tags: ['food', 'coffee', 'warm'], color: '#6b4e3a', src: u('1495474472287-4d71bcdd2085'), w: 240, h: 300 },
  { id: 'f-bread', kind: 'image', title: 'Rustic bread loaves', source: 'pinterest.com', tags: ['food', 'texture', 'warm'], color: '#5a4636', src: u('1509440159596-0249088772ff'), w: 280, h: 186 },
  { id: 'n-food', kind: 'note', title: 'Menu photography', source: 'Note', tags: ['food'], color: '#fffdf6', body: 'Dark plates + top-down light for the menu. Keep one warm hero shot (pizza or bread) per page.', w: 240, h: 130 },

  { id: 'n-chairs', kind: 'note', title: 'Why these chairs', source: 'Note', tags: ['chair', 'furniture'], color: '#fffdf6', body: 'All three lean on a single continuous form — the seat and back read as one gesture. Try this for the lobby bench.', w: 240, h: 150 },
  { id: 'n-palette', kind: 'note', title: 'Palette direction', source: 'Note', tags: ['color'], color: '#fffdf6', body: 'Warm neutrals first, one saturated accent. The gradients are mood only — not the UI palette.', w: 240, h: 130 },
  { id: 'n-light', kind: 'note', title: 'Light, not lamps', source: 'Note', tags: ['light', 'interior'], color: '#fffdf6', body: 'Keep looking for rooms where the light source is hidden. Bedroom + forest refs both do this.', w: 240, h: 130 },

  { id: 'l-surface', kind: 'link', title: 'Surface Field', source: 'github.com/angelolibero', tags: ['canvas', 'motion'], color: '#e9e6e0', body: 'A field of dots and lines that makes room around surfaces.', w: 260, h: 96 },
  { id: 'l-pond', kind: 'link', title: 'Pond — visual library', source: 'github.com/raphaelsalaja', tags: ['library', 'reference'], color: '#e9e6e0', body: 'Quiet capture and a dense, image-led grid.', w: 260, h: 96 },
];

export const REFERENCE_BY_ID: Record<string, Reference> = Object.fromEntries(
  REFERENCES.map((r) => [r.id, r]),
);

/** Initial board placement so the first view is not empty (world px). */
export const SEED_LAYOUT: { refId: string; x: number; y: number }[] = [
  // Card positions; each block's frame adds 14px around the card, so cards sit 60px apart (32px between frames).
  { refId: 'r-chair-1', x: -560, y: -300 },
  { refId: 'r-chair-2', x: -280, y: -300 },
  { refId: 'r-stool', x: 20, y: -300 },
  { refId: 'r-living', x: 300, y: -300 },
  { refId: 'n-chairs', x: -560, y: 60 },
  { refId: 'r-grad-2', x: -280, y: 60 },
  { refId: 'n-light', x: 20, y: 50 },
  { refId: 'r-forest', x: 300, y: -40 },
];
