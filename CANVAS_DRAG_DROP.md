# KarnForge Canvas Drag & Drop — Comprehensive Documentation

> **Scope:** Everything related to the interactive canvas in the Workshop tab — drag, drop, resize, selection, pan/zoom, groups, widgets, overlays, undo/redo, and persistence.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [File Map](#2-file-map)
3. [State & Ref Model](#3-state--ref-model)
4. [Canvas Coordinate System](#4-canvas-coordinate-system)
5. [Event Handler Pipeline](#5-event-handler-pipeline)
6. [Draggable Element Types](#6-draggable-element-types)
7. [Drag Lifecycle — Step by Step](#7-drag-lifecycle--step-by-step)
8. [Ghost Card Mechanic](#8-ghost-card-mechanic)
9. [Hit Testing & Group Drop Detection](#9-hit-testing--group-drop-detection)
10. [Group Layout Modes](#10-group-layout-modes)
11. [Multi-Select & Rubber-Band](#11-multi-select--rubber-band)
12. [Resize Handles](#12-resize-handles)
13. [Pan & Zoom](#13-pan--zoom)
14. [Widgets & Overlays on the Canvas](#14-widgets--overlays-on-the-canvas)
15. [Widget Registry & Overlay Registry](#15-widget-registry--overlay-registry)
16. [Widget Editor Modal](#16-widget-editor-modal)
17. [Undo / Redo System](#17-undo--redo-system)
18. [Canvas Serialization & Persistence](#18-canvas-serialization--persistence)
19. [IPC Channel Reference](#19-ipc-channel-reference)
20. [TypeScript Types & Interfaces](#20-typescript-types--interfaces)
21. [Known Constraints & Design Decisions](#21-known-constraints--design-decisions)
22. [Extending the Canvas](#22-extending-the-canvas)

---

## 1. Architecture Overview

The canvas is a **free-form, infinite workspace** rendered inside the Workshop tab of `DeckView.tsx`. It deliberately avoids React state for anything that changes on every animation frame (positions, zoom, pan) — instead, it uses **mutable refs and direct DOM style mutations** to guarantee 60 fps drag performance without triggering React re-renders.

```
┌─────────────────────────────────────────────────────────────┐
│  DeckView.tsx  (Workshop tab)                               │
│                                                             │
│  ┌─────────────────────────────────────────────┐            │
│  │  .canvas-viewport  (overflow:hidden, fills) │            │
│  │  ┌──────────────────────────────────────┐   │            │
│  │  │  .canvas-world  (transform origin)   │   │            │
│  │  │  ┌────────────────────────────────┐  │   │            │
│  │  │  │  .canvas-bg  (the actual ref)  │  │   │            │
│  │  │  │                                │  │   │            │
│  │  │  │  [card] [group] [widget]       │  │   │            │
│  │  │  │  [sticker] [decorator pill]    │  │   │            │
│  │  │  └────────────────────────────────┘  │   │            │
│  │  └──────────────────────────────────────┘   │            │
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

**Rendering pipeline:**

```
User Action
    │
    ▼
Document mousedown/mousemove/mouseup (single listener set)
    │
    ▼
Ref mutations  (dragRef, txRef, tyRef, scRef, resizeRef, selRef)
    │
    ▼
Direct el.style mutations  (no React setState)
    │
    ▼
(on drop/resize end) pushUndoSnapshot() → scheduleAutoSave()
    │
    ▼
JSON serialization → IPC → SQLite
```

---

## 2. File Map

| File | Role |
|------|------|
| `src/renderer/pages/DeckView.tsx` | **All canvas logic** — 2 400+ lines. Events, drag, resize, groups, widgets, serialization. |
| `src/renderer/components/WidgetEditorModal.tsx` | Modal for creating/editing widget panels and card overlays. No drag logic. |
| `src/renderer/widgets/registry.ts` | `WidgetRegistry` — register, render, persist custom widget code. |
| `src/renderer/widgets/overlayRegistry.ts` | `CardDecoratorRegistry` — register, render card overlays. |
| `src/renderer/widgets/builtins.ts` | Built-in widget definitions (mana curve, color distribution, etc.). |
| `src/renderer/widgets/builtinOverlays.ts` | Built-in overlay definitions (EDHREC badge). |
| `src/renderer/hooks/useFilteredDecks.ts` | Unrelated to canvas — deck list filtering. |
| `ipc/cards.js` | IPC handlers for card data & EDHREC fetch. |
| `ipc/library.js` | IPC handlers for canvas save/load, arrangements. |
| `src/renderer/types/electron.d.ts` | TypeScript declarations for all `window.libraryAPI` methods. |

---

## 3. State & Ref Model

### 3.1 React State (triggers re-renders)

```typescript
// Tab selection
const [tab, setTab] = useState<'workshop' | 'list'>('workshop');

// Core data
const [deck, setDeck]             = useState<DeckRow | null>(null);
const [deckCards, setDeckCards]   = useState<CardData[]>([]);
const [cardDetails, setCardDetails] = useState<Map<string, CardDetail>>(new Map());

// UI toggles (toolbar, modals, panels)
const [toolMode, setToolMode]     = useState<'select' | 'hand' | 'text'>('select');
const [showWidgetEditor, setShowWidgetEditor] = useState(false);
```

### 3.2 Imperative Refs (no re-renders)

#### Canvas transform
```typescript
const txRef  = useRef(0);      // Pan X in pixels
const tyRef  = useRef(0);      // Pan Y in pixels
const scRef  = useRef(1);      // Zoom scale: 1.0 – 2.5
const canvasRef = useRef<HTMLDivElement>(null);  // .canvas-bg element

function applyT() {
  canvasRef.current!.style.transform =
    `translate(${txRef.current}px,${tyRef.current}px) scale(${scRef.current})`;
}
```

#### Drag state
```typescript
const dragRef = useRef<{
  type: 'single' | 'multi';
  el?: HTMLDivElement;         // Element being dragged
  elType?: string;             // 'card' | 'card-ghost' | 'widget' | 'group' | 'sticker'
  ox: number;                  // Mouse offset X from element origin
  oy: number;                  // Mouse offset Y from element origin
  init?: Map<HTMLDivElement, { left: number; top: number }>;  // Multi-drag: initial positions
  sourceGroupEl?: HTMLDivElement;  // For card-ghost: the group being exited
} | null>(null);
```

#### Resize state
```typescript
const resizeRef = useRef<{
  el: HTMLDivElement;
  dir: 'left' | 'right' | 'bottom-right';
  startW: number;
  startH: number;
  startX: number;   // clientX at resize start
  startY: number;   // clientY at resize start
  startLeft: number; // left px at resize start (needed for left-anchor resize)
} | null>(null);
```

#### Pan state
```typescript
const panRef = useRef<{ ox: number; oy: number } | null>(null);
```

#### Rubber-band selection
```typescript
const rbandRef = useRef<{
  sx: number; sy: number;   // Start client position
  div: HTMLDivElement;      // The selection rect element
} | null>(null);
```

#### Selection
```typescript
const selRef = useRef<Set<HTMLDivElement>>(new Set());
```

#### Undo / Redo
```typescript
const undoStackRef = useRef<string[]>([]);  // Canvas JSON snapshots
const redoStackRef = useRef<string[]>([]);
```

---

## 4. Canvas Coordinate System

```
Viewport (fixed, fills screen)
  └─ canvasRef (.canvas-bg)
       └─ transform: translate(txRef, tyRef) scale(scRef)
```

**Converting mouse position → canvas position:**

```typescript
function toCanvas(clientX: number, clientY: number) {
  const rect = canvasRef.current!.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / scRef.current,
    y: (clientY - rect.top)  / scRef.current,
  };
}
```

**All element positions are stored in canvas-space pixels** (i.e., `el.style.left` / `el.style.top` values are canvas-space, not viewport-space).

**Zoom range:** `1.0` – `2.5`, set via mouse wheel. The transform origin is the cursor position, allowing zoom-to-cursor behavior.

---

## 5. Event Handler Pipeline

A **single set of document-level listeners** is installed once in a `useEffect` with cleanup. This avoids the per-element handler proliferation common in naive drag implementations.

```
document.addEventListener('mousedown', handleMouseDown)
document.addEventListener('mousemove', handleMouseMove)
document.addEventListener('mouseup',   handleMouseUp)
document.addEventListener('wheel',     handleWheel, { passive: false })
document.addEventListener('keydown',   handleKeyDown)
document.addEventListener('keyup',     handleKeyUp)
```

### 5.1 `handleMouseDown`

Priority order:
1. **Resize handle clicked** → set `resizeRef`, return
2. **Widget/sticker/group/card mousedown** → `makeItemDraggable` per-element handler fires first (stops propagation)
3. **Canvas background clicked with Space held** → start pan (`panRef`)
4. **Canvas background clicked in hand-mode** → start pan
5. **Canvas background clicked in select-mode** → start rubber-band (`rbandRef`), clear selection if Shift not held

### 5.2 `handleMouseMove`

Priority order (checked each frame):
1. `resizeRef` active → update element width/height/left
2. `panRef` active → update `txRef`/`tyRef`, call `applyT()`
3. `rbandRef` active → update rubber-band rect's position/size
4. `dragRef` active:
   a. **Single drag** — update `el.style.left` / `el.style.top`
   b. **Multi drag** — update all elements in `dragRef.init` map
   c. **Card-over-group** — call `hitTest` on all groups, toggle `.group-drop-highlight`

### 5.3 `handleMouseUp`

1. Finalize resize → `pushUndoSnapshot()`
2. Finalize pan
3. Finalize rubber-band → `hitTestRect` to select items
4. Finalize drag:
   - **Card**: `hitTest` groups → `dropIntoGroup()` if match, else leave on canvas
   - **Card-ghost**: dual hit-test (mouse + ghost center) → drop into group or place on canvas
   - **Multi-select**: restore all z-indices, `pushUndoSnapshot()`
   - **Widget/sticker/group**: `pushUndoSnapshot()`
5. Clear `dragRef` / `resizeRef` / `panRef` / `rbandRef`
6. Schedule auto-save (debounced 1500 ms)

### 5.4 `handleWheel`

```typescript
// Zoom to cursor
const delta = e.deltaY > 0 ? -0.1 : 0.1;
const newScale = clamp(scRef.current + delta, 1.0, 2.5);
// Adjust tx/ty so the point under cursor stays fixed
const ratio = newScale / scRef.current;
txRef.current = e.clientX - ratio * (e.clientX - txRef.current);
tyRef.current = e.clientY - ratio * (e.clientY - tyRef.current);
scRef.current = newScale;
applyT();
```

### 5.5 `handleKeyDown`

| Key | Action |
|-----|--------|
| `Space` | Enter pan mode (sets `panMode` flag) |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected canvas items |
| `Ctrl+A` | Select all canvas items |
| `Escape` | Clear selection |

---

## 6. Draggable Element Types

| Type | CSS Class | `dataset.elType` | Can Enter Groups? | Can Exit Groups? |
|------|-----------|-----------------|-------------------|-----------------|
| Loose card | `.canvas-item.card-item` | `card` | ✅ | N/A |
| Card inside group | `.card-in-group` | `card` | ✅ (re-drop) | ✅ (ghost mechanic) |
| Widget panel | `.canvas-item.canvas-widget` | `widget` | ❌ | N/A |
| Group | `.canvas-item.card-group` | `group` | ❌ | N/A |
| Sticker | `.canvas-item.sticker-item` | `sticker` | ❌ | N/A |
| Decorator pill | `.canvas-item.decorator-pill` | `decorator` | ❌ | N/A |
| Ghost card | (dynamic clone) | `card-ghost` | ✅ | N/A |

---

## 7. Drag Lifecycle — Step by Step

### 7.1 `makeItemDraggable(el, elType)`

Called when each element is created or added to the canvas. Attaches a `mousedown` listener to `el`.

**On `mousedown`:**

```
1. Record ox = e.clientX - parseFloat(el.style.left) * scRef
   Record oy = e.clientY - parseFloat(el.style.top)  * scRef

2. If Shift held AND other items selected:
     dragRef.type = 'multi'
     dragRef.init = Map of (el → {left, top}) for all selected

3. Else:
     dragRef.type = 'single'
     dragRef.el   = el
     dragRef.elType = elType

4. Raise z-index: el.style.zIndex = '9999'

5. el.style.cursor = 'grabbing'
```

**For cards inside groups:** There is an **8px movement threshold** before drag begins. Below this threshold, the event is treated as a click (opens detail panel).

### 7.2 `handleMouseMove` (drag phase)

```typescript
if (!dragRef.current) return;

const { type, el, elType, ox, oy, init } = dragRef.current;

if (type === 'single') {
  const newLeft = (e.clientX - ox) / scRef.current;
  const newTop  = (e.clientY - oy) / scRef.current;
  el!.style.left = newLeft + 'px';
  el!.style.top  = newTop  + 'px';

  // Group highlight
  if (elType === 'card' || elType === 'card-ghost') {
    for (const group of canvas.querySelectorAll('.card-group')) {
      group.classList.toggle('group-drop-highlight', hitTest(e, group));
    }
  }
}

if (type === 'multi') {
  const dx = (e.clientX - startClientX) / scRef.current;
  const dy = (e.clientY - startClientY) / scRef.current;
  for (const [itemEl, { left, top }] of init!) {
    itemEl.style.left = (left + dx) + 'px';
    itemEl.style.top  = (top  + dy) + 'px';
  }
}
```

### 7.3 `handleMouseUp` (drop phase)

```typescript
const { el, elType } = dragRef.current;

if (elType === 'card') {
  const targetGroup = findGroupUnderMouse(e);
  if (targetGroup) {
    dropIntoGroup(el, targetGroup);
  }
  // else: leave as canvas-item
}

if (elType === 'card-ghost') {
  // see §8
}

el.style.zIndex = el.dataset.baseZ ?? '20';
el.style.cursor = 'grab';
dragRef.current = null;

pushUndoSnapshot();
scheduleAutoSave();
```

---

## 8. Ghost Card Mechanic

When a card is dragged **out of a group**, the original card element stays in place (invisible placeholder) and a **ghost clone** takes its position on the canvas, following the mouse.

### 8.1 Activation

Triggered when a `.card-in-group` is dragged more than **8px** from its press origin.

```typescript
// Inside card-in-group mousedown handler
let moved = false;
const threshold = 8;

document.addEventListener('mousemove', function trackMove(e) {
  if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) > threshold) {
    moved = true;
    activateGhostDrag(cardEl, groupEl, e);
    document.removeEventListener('mousemove', trackMove);
  }
});
```

### 8.2 `activateGhostDrag(cardEl, groupEl, e)`

```
1. Clone cardEl → ghost
2. ghost.classList.add('card-ghost')
3. ghost.style.position = 'absolute'
4. ghost.style.left = canvasX + 'px'  // convert group-relative to canvas coords
5. ghost.style.top  = canvasY + 'px'
6. canvasRef.current.appendChild(ghost)
7. cardEl.style.visibility = 'hidden'  // Keep as placeholder in group

8. dragRef.current = {
     type: 'single',
     el: ghost,
     elType: 'card-ghost',
     ox, oy,
     sourceGroupEl: groupEl
   }
```

### 8.3 Drop Resolution

On `mouseup` with `elType === 'card-ghost'`:

```
A. hitTest(e, group) OR hitTest(ghostCenter, group)?
   YES → dropIntoGroup(ghost, group)
         cardEl.remove()                  // Remove placeholder
   NO  → // Leave ghost as canvas card
         ghost.classList.remove('card-ghost')
         ghost.classList.add('canvas-item', 'card-item')
         cardEl.remove()                  // Remove placeholder from group
         relayoutGroup(groupEl)           // Fill the gap
```

### 8.4 Dual Hit-Test

Card-ghost uses **two hit-test points** for a more forgiving drop zone:

```
Point 1: mouse cursor (e.clientX, e.clientY)
Point 2: center of ghost element getBoundingClientRect()
```

If **either** point is inside a group, the drop succeeds. This prevents frustrating near-misses when the cursor exits the group boundary slightly before the card visually leaves.

---

## 9. Hit Testing & Group Drop Detection

### `hitTest(mouseEvent, element)`

Tests whether the mouse cursor is inside an element's bounding rect (viewport-space).

```typescript
function hitTest(me: MouseEvent, el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return me.clientX > r.left && me.clientX < r.right &&
         me.clientY > r.top  && me.clientY < r.bottom;
}
```

### `hitTestRect(element, x1, y1, x2, y2)`

Tests whether a canvas-space element overlaps a canvas-space rectangle. Used for rubber-band selection.

```typescript
function hitTestRect(el: HTMLDivElement, x1: number, y1: number, x2: number, y2: number): boolean {
  const l = parseFloat(el.style.left);
  const t = parseFloat(el.style.top);
  return l < x2 && (l + el.offsetWidth)  > x1 &&
         t < y2 && (t + el.offsetHeight) > y1;
}
```

### Group Drop Highlight

During a card drag, the canvas continuously queries all `.card-group` elements and adds/removes `.group-drop-highlight` based on `hitTest`.

---

## 10. Group Layout Modes

Card groups support three internal layout modes, controlled by `group.dataset.layout`:

### `'grid'` (default)

Cards use CSS `flex-wrap` with a configurable gap. Cards reflow automatically as items are added/removed.

```
┌─────────────────────────┐
│ [Card] [Card] [Card]    │
│ [Card] [Card]           │
└─────────────────────────┘
```

### `'stack-h'` (horizontal fan)

Cards are fanned horizontally with a slight vertical offset.

```typescript
const H_OFFSET = 30;  // px between card left edges
const V_GAP    = 20;  // px offset for alternating cards
```

```
┌──────────────────────────────────────┐
│ [Card][Card][Card][Card][Card]       │
│   staggered vertically               │
└──────────────────────────────────────┘
```

### `'stack-v'` (vertical fan)

Cards are fanned vertically with a slight horizontal offset.

```typescript
const V_OFFSET = 22;  // px between card top edges
const H_GAP    = 16;  // px horizontal stagger
```

```
┌───────────────┐
│ [Card]        │
│   [Card]      │
│     [Card]    │
│       [Card]  │
└───────────────┘
```

### `relayoutGroup(groupEl)`

Called after any drop into or removal from a group. Reads `groupEl.dataset.layout` and repositions all `.card-in-group` children accordingly.

---

## 11. Multi-Select & Rubber-Band

### Rubber-Band Selection

Activated by clicking the canvas background in **select mode** (not on any item).

```
1. rbandRef = { sx: e.clientX, sy: e.clientY, div: selectionRectEl }
2. selectionRectEl appended to viewport (fixed position)
3. On mousemove: update left/top/width/height of selectionRectEl
4. On mouseup:
   - Convert viewport rect → canvas space (x1,y1,x2,y2)
   - hitTestRect all .canvas-item elements
   - Add matches to selRef
   - Remove selectionRectEl
```

### Multi-Select Drag

When drag begins on a selected item and `selRef.size > 1`:

```typescript
dragRef.current = {
  type: 'multi',
  init: new Map(
    [...selRef.current].map(el => [el, {
      left: parseFloat(el.style.left),
      top:  parseFloat(el.style.top),
    }])
  ),
};
```

All selected elements move together, maintaining their relative positions.

### Visual Indicators

Selected items receive the `.selected` CSS class, which adds a highlight border. The rubber-band rect is rendered as a semi-transparent blue overlay.

---

## 12. Resize Handles

Widgets and groups have resize handles injected into their DOM:

```html
<div class="resize-handle-left"></div>
<div class="resize-handle-right"></div>
<div class="resize-handle-br"></div>   <!-- bottom-right corner -->
```

### `attachResizeHandlers(el, kind)`

```typescript
el.querySelector('.resize-handle-left')?.addEventListener('mousedown', e => {
  e.stopPropagation();
  resizeRef.current = {
    el, dir: 'left',
    startW: el.offsetWidth,   startH: el.offsetHeight,
    startX: e.clientX,        startY: e.clientY,
    startLeft: parseFloat(el.style.left),
  };
});
```

### Resize Update (in `handleMouseMove`)

```typescript
const { el, dir, startW, startH, startX, startY, startLeft } = resizeRef.current;
const dx = (e.clientX - startX) / scRef.current;
const dy = (e.clientY - startY) / scRef.current;

if (dir === 'right') {
  el.style.width = Math.max(80, startW + dx) + 'px';
}
if (dir === 'left') {
  const newW = Math.max(80, startW - dx);
  el.style.width = newW + 'px';
  el.style.left  = (startLeft + startW - newW) + 'px';  // anchor right edge
}
if (dir === 'bottom-right') {
  el.style.width  = Math.max(80, startW + dx) + 'px';
  el.style.height = Math.max(60, startH + dy) + 'px';
}
```

After resize ends: `pushUndoSnapshot()` + `scheduleAutoSave()`.

---

## 13. Pan & Zoom

### Pan

**Three ways to activate pan:**

| Method | How |
|--------|-----|
| Middle mouse button | Hold `mousedown` with button 1 |
| Space + drag | Hold Space, then `mousedown` on canvas background |
| Hand tool | Select hand tool in toolbar, any canvas `mousedown` |

**Pan update:**

```typescript
txRef.current = e.clientX - panRef.current.ox;
tyRef.current = e.clientY - panRef.current.oy;
applyT();
```

### Zoom

Mouse wheel event, **no passive** (prevents page scroll):

```typescript
e.preventDefault();
const delta    = e.deltaY > 0 ? -0.1 : 0.1;
const oldScale = scRef.current;
const newScale = Math.max(1.0, Math.min(2.5, oldScale + delta));

// Keep point under cursor fixed
const factor   = newScale / oldScale;
txRef.current  = e.clientX - factor * (e.clientX - txRef.current);
tyRef.current  = e.clientY - factor * (e.clientY - tyRef.current);
scRef.current  = newScale;
applyT();
```

**Zoom range:** `1.0` (100%) → `2.5` (250%).

---

## 14. Widgets & Overlays on the Canvas

### Widget Panels

Widget panels are analytics/data panels placed freely on the canvas. They display computed data from the deck (mana curve, color distribution, etc.) rendered as custom HTML.

**Created via:**

```typescript
function makeWidgetEl(defId: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'canvas-item canvas-widget';
  el.dataset.widgetDefId = defId;
  el.dataset.baseZ = '20';
  el.style.cssText = `position:absolute;left:100px;top:100px;z-index:20;cursor:grab;`;

  // Inner structure
  el.innerHTML = `
    <div class="widget-header">
      <span>${def.name}</span>
      <button class="widget-params-btn">⚙</button>
      <button class="widget-close-btn">✕</button>
    </div>
    <div class="widget-body">
      <div class="wbz"><!-- rendered HTML injected here --></div>
    </div>
    <div class="resize-handle-left"></div>
    <div class="resize-handle-right"></div>
  `;

  makeItemDraggable(el, 'widget');
  attachResizeHandlers(el, 'widget');
  attachContextMenu(el);
  return el;
}
```

**Widget content rendering:**

```typescript
function refreshWidgets() {
  const data = buildWidgetDataFromState();  // reads canvas groups + deckCards
  for (const widgetEl of canvas.querySelectorAll('.canvas-widget')) {
    const defId = widgetEl.dataset.widgetDefId;
    const html  = WidgetRegistry.render(defId, data, instanceParams);
    widgetEl.querySelector('.wbz')!.innerHTML = html;
    setWidgetBodyZoom(widgetEl);
  }
}
```

**Widget zoom scaling:**

```typescript
function setWidgetBodyZoom(el: HTMLDivElement) {
  const body      = el.querySelector('.wbz') as HTMLDivElement;
  const designW   = el.dataset.baseWidth ? +el.dataset.baseWidth : 300;
  const currentW  = el.offsetWidth;
  const zoom      = currentW / designW;
  body.style.transform      = `scale(${zoom})`;
  body.style.transformOrigin = 'top left';
  body.style.width           = (designW) + 'px';
}
```

### Card Decorator Overlays

Decorators are small HTML overlays rendered on top of each card. They are positioned by anchor point.

**Anchor positions:**

| Anchor | Location |
|--------|----------|
| `tl` | Top-left |
| `tr` | Top-right |
| `bl` | Bottom-left |
| `br` | Bottom-right |
| `bc` | Bottom-center |
| `tc` | Top-center |

**Decorator pill (canvas item):**

A small draggable button representing the decorator is placed on the canvas:

```typescript
function makeDecoratorEl(defId: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'canvas-item decorator-pill';
  el.dataset.decoratorDefId = defId;
  el.dataset.baseZ = '15';
  el.innerHTML = `<span>${def.icon}</span><span>${def.name}</span>`;
  makeItemDraggable(el, 'decorator');
  return el;
}
```

**Decorator rendering:** `CardDecoratorRegistry.render(defId, card, instanceParams)` returns HTML that is injected into each card's `.card-overlay-{anchor}` slot.

---

## 15. Widget Registry & Overlay Registry

### `WidgetRegistry` (`src/renderer/widgets/registry.ts`)

```typescript
interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: string;           // Material Symbols codepoint or emoji
  readonly: boolean;      // Built-in if true
  width?: number;         // Default/design width in px
  params?: WidgetParam[];
  code: string;           // JS function body: (data, params) => '<html>'
}

WidgetRegistry.register(def: WidgetDef): void
WidgetRegistry.get(id: string): WidgetDef | undefined
WidgetRegistry.render(id, data, instanceParams): string      // Returns HTML
WidgetRegistry.renderCode(code, data, instanceParams, defs): string  // Live preview
WidgetRegistry.persistCustomWidgets(): void  // localStorage
WidgetRegistry.loadCustomWidgets(): void     // localStorage
```

### `CardDecoratorRegistry` (`src/renderer/widgets/overlayRegistry.ts`)

```typescript
interface CardDecoratorDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  anchor: 'tl' | 'tr' | 'bl' | 'br' | 'bc' | 'tc';
  code: string;           // JS: (card, params) => '<html>'
  params?: WidgetParam[];
  asyncLoad?: (cards: OverlayCardData[]) => Promise<Map<string, Partial<OverlayCardData>>>;
}

CardDecoratorRegistry.register(def): void
CardDecoratorRegistry.get(id): CardDecoratorDef | undefined
CardDecoratorRegistry.render(id, card, instanceParams): string
CardDecoratorRegistry.renderCode(code, card, instanceParams, defs): string
```

### `WidgetParam` type

```typescript
interface WidgetParam {
  key: string;
  label: string;
  type: 'number' | 'text' | 'boolean' | 'select';
  default: number | string | boolean;
  min?: number;      // number only
  max?: number;
  step?: number;
  options?: string[]; // select only
}
```

### `WidgetData` (passed to widget render functions)

```typescript
interface WidgetData {
  cards: WidgetCard[];      // Cards in named groups (mainboard)
  allCards: WidgetCard[];   // All deck cards
  deckSize: number;
  groups: WidgetGroup[];
}

interface WidgetCard {
  name: string;
  manaCost: string;
  typeLine: string;
  cmc: number;
  colors: string[];
  qty: number;
}

interface WidgetGroup {
  name: string;
  color: string;
  cards: WidgetCard[];
}
```

---

## 16. Widget Editor Modal

**File:** `src/renderer/components/WidgetEditorModal.tsx`

### Modes

| Mode | Type | Output |
|------|------|--------|
| `widget` | Widget Panel | `WidgetDef` |
| `overlay` | Card Overlay | `CardDecoratorDef` |

### State

```typescript
const [mode, setMode]       = useState<'widget' | 'overlay'>('widget');
const [name, setName]       = useState('');
const [icon, setIcon]       = useState('📊');
const [width, setWidth]     = useState(300);      // widget mode only
const [anchor, setAnchor]   = useState<Anchor>('br'); // overlay mode only
const [code, setCode]       = useState('');
const [params, setParams]   = useState<WidgetParam[]>([]);
const [previewHtml, setPreviewHtml] = useState('');
const [saving, setSaving]   = useState(false);
```

### Live Preview

Debounced 400 ms after any code/params change:

```typescript
useEffect(() => {
  const timer = setTimeout(() => {
    const html = mode === 'widget'
      ? WidgetRegistry.renderCode(code, MOCK_DATA, instanceParams, params)
      : CardDecoratorRegistry.renderCode(code, SAMPLE_CARD, instanceParams, params);
    setPreviewHtml(html);
  }, 400);
  return () => clearTimeout(timer);
}, [code, params, mode]);
```

### Save Flow

```
handleSave()
  ↓
Build WidgetDef | CardDecoratorDef from state
  ↓
WidgetRegistry.register(def) | CardDecoratorRegistry.register(def)
  ↓
persistCustomWidgets()   (localStorage)
  ↓
onSave(def)              (callback to DeckView)
  ↓
DeckView places new widget/decorator element on canvas
```

### Icon Picker

24-icon grid using Material Symbols ligatures. Click to select.

### API Reference Panel

Context-sensitive documentation shown inline in the editor:

- **Widget mode:** Documents `data.cards`, `data.groups`, `data.deckSize`, `params` object
- **Overlay mode:** Documents `card.name`, `card.manaCost`, `card.typeLine`, `card.qty`, anchor positions

---

## 17. Undo / Redo System

### Snapshot Model

The canvas state is serialized to JSON and pushed onto an undo stack:

```typescript
function pushUndoSnapshot() {
  const json = serializeCanvas();          // See §18
  undoStackRef.current.push(json);
  redoStackRef.current = [];               // Clear redo on new action
  if (undoStackRef.current.length > 50) {
    undoStackRef.current.shift();          // Cap at 50 snapshots
  }
}
```

### Undo (`Ctrl+Z`)

```typescript
function undo() {
  if (undoStackRef.current.length === 0) return;
  const current = serializeCanvas();
  redoStackRef.current.push(current);
  const prev = undoStackRef.current.pop()!;
  restoreCanvas(prev);
}
```

### Redo (`Ctrl+Y` or `Ctrl+Shift+Z`)

```typescript
function redo() {
  if (redoStackRef.current.length === 0) return;
  const current = serializeCanvas();
  undoStackRef.current.push(current);
  const next = redoStackRef.current.pop()!;
  restoreCanvas(next);
}
```

### Triggers for `pushUndoSnapshot()`

- Card dropped onto canvas
- Card dropped into group
- Card-ghost resolved
- Widget/sticker/decorator placed or moved
- Resize completed
- Element deleted
- Group created, renamed, recolored, or layout changed
- Multi-select drag completed

---

## 18. Canvas Serialization & Persistence

### `serializeCanvas(): string`

Produces a JSON string capturing the full canvas state. Structure:

```typescript
{
  tx: number,        // Pan X
  ty: number,        // Pan Y
  sc: number,        // Zoom scale
  items: [
    {
      kind: 'card',
      oracleId: string,
      left: number, top: number, zIndex: number,
    },
    {
      kind: 'group',
      name: string, color: string,
      left: number, top: number, zIndex: number,
      layout: 'grid' | 'stack-h' | 'stack-v',
      width: number, height: number,
      cards: string[],   // oracleIds in order
    },
    {
      kind: 'widget',
      defId: string,
      left: number, top: number, zIndex: number,
      width: number,
      instanceParams: Record<string, unknown>,
    },
    {
      kind: 'sticker',
      emoji: string,
      left: number, top: number, zIndex: number,
      width: number, height: number,
    },
    {
      kind: 'decorator',
      defId: string,
      left: number, top: number, zIndex: number,
      instanceParams: Record<string, unknown>,
    },
  ]
}
```

### `restoreCanvas(json: string)`

Clears the canvas DOM, parses the JSON, and re-creates all elements. Called by undo/redo and initial load.

### Auto-Save

```typescript
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    const json = serializeCanvas();
    // Arrangements: save to active arrangement
    if (activeArrangementId) {
      window.libraryAPI.saveArrangementCanvas({ id: activeArrangementId, canvasJson: json });
    } else {
      window.libraryAPI.saveCanvas({ deckId: deck.id, stateJson: json });
    }
  }, 1500);
}
```

### Arrangements

Multiple canvas layouts can be saved per deck:

```typescript
// Load arrangement list on mount
const arrangements = await window.libraryAPI.getArrangements({ deckId: deck.id });

// Switch arrangement
async function switchArrangement(id: number) {
  const { canvasJson } = await window.libraryAPI.loadArrangementCanvas({ id });
  if (canvasJson) restoreCanvas(canvasJson);
}

// Create new
const { id } = await window.libraryAPI.createArrangement({ deckId: deck.id, name });
```

---

## 19. IPC Channel Reference

All channels follow the `lib:` namespace prefix convention.

| Channel | Direction | Args | Returns |
|---------|-----------|------|---------|
| `lib:saveCanvas` | Renderer→Main | `{ deckId, stateJson }` | `void` |
| `lib:loadCanvas` | Renderer→Main | `{ deckId }` | `{ stateJson? }` |
| `lib:getArrangements` | Renderer→Main | `{ deckId }` | `Arrangement[]` |
| `lib:createArrangement` | Renderer→Main | `{ deckId, name }` | `{ id }` |
| `lib:renameArrangement` | Renderer→Main | `{ id, name }` | `void` |
| `lib:deleteArrangement` | Renderer→Main | `{ id }` | `void` |
| `lib:saveArrangementCanvas` | Renderer→Main | `{ id, canvasJson }` | `void` |
| `lib:loadArrangementCanvas` | Renderer→Main | `{ id }` | `{ canvasJson? }` |
| `cards:fetchEdhrecData` | Renderer→Main | `{ cardName }` | `{ pct: number \| null }` |

**Preload bridge** (`preload.js`):

```javascript
window.libraryAPI = {
  saveCanvas:              (args) => ipcRenderer.invoke('lib:saveCanvas', args),
  loadCanvas:              (args) => ipcRenderer.invoke('lib:loadCanvas', args),
  getArrangements:         (args) => ipcRenderer.invoke('lib:getArrangements', args),
  createArrangement:       (args) => ipcRenderer.invoke('lib:createArrangement', args),
  renameArrangement:       (args) => ipcRenderer.invoke('lib:renameArrangement', args),
  deleteArrangement:       (args) => ipcRenderer.invoke('lib:deleteArrangement', args),
  saveArrangementCanvas:   (args) => ipcRenderer.invoke('lib:saveArrangementCanvas', args),
  loadArrangementCanvas:   (args) => ipcRenderer.invoke('lib:loadArrangementCanvas', args),
};
```

---

## 20. TypeScript Types & Interfaces

```typescript
// Core deck types
interface DeckRow {
  id: number;
  name: string;
  format: string;
  // ...
}

interface CardData {
  oracleId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  imageUrl: string;
  qty: number;
  board: 'main' | 'side' | 'maybe';
}

// Canvas serialization types
interface RawCanvasCard {
  kind: 'card';
  oracleId: string;
  left: number; top: number; zIndex: number;
}

interface RawCanvasGroup {
  kind: 'group';
  name: string; color: string;
  left: number; top: number; zIndex: number;
  layout: 'grid' | 'stack-h' | 'stack-v';
  width: number; height: number;
  cards: string[];
}

interface RawCanvasWidget {
  kind: 'widget';
  defId: string;
  left: number; top: number; zIndex: number;
  width: number;
  instanceParams: Record<string, unknown>;
}

// Arrangements
interface Arrangement {
  id: number;
  name: string;
  canvas_json: string | null;
}

// Widget system types
interface WidgetDef { /* see §15 */ }
interface WidgetParam { /* see §15 */ }
interface WidgetData { /* see §15 */ }
interface CardDecoratorDef { /* see §15 */ }
```

---

## 21. Known Constraints & Design Decisions

### No Grid Snapping
All positioning is free-form pixel placement. There is no snap-to-grid or snap-to-element. This was a deliberate choice for flexibility.

### No Custom Drag Events
The implementation uses raw `mousedown`/`mousemove`/`mouseup` instead of the HTML5 Drag and Drop API. This was chosen because:
- HTML5 DnD does not support custom drag images easily in Electron
- HTML5 DnD `dragover` fires less frequently, causing stuttering
- Mouse events give full control over the ghost element and coordinate transforms

### Imperative DOM Manipulation
React state is deliberately avoided for anything that mutates on every frame (positions, zoom). This keeps frame rate high with many elements. The tradeoff is that the canvas DOM is largely outside React's control.

### No Virtual DOM / Virtualization
All card elements (potentially 100+) are always in the DOM. Performance at extreme deck sizes (>200 cards) may degrade.

### Ghost-Only Group Exit
Cards cannot be moved between groups by dragging directly between them. You must drag a card out to the canvas (ghost mechanic) and then drag again into a different group. This simplifies collision resolution logic.

### Undo Stack Limit
The undo stack is capped at **50 snapshots** to prevent memory bloat. Each snapshot is a full JSON serialization of the canvas.

### Auto-Save Debounce
Auto-save fires **1500 ms** after the last mutation. If the app is closed before the timer fires, unsaved work is lost. There is no crash-recovery mechanism.

### Widget Code Execution
Widget and overlay code is executed via `new Function(code)` in the renderer process. Since KarnForge is a local Electron app, there is no sandbox concern — all code is user-authored.

---

## 22. Extending the Canvas

### Adding a New Built-in Widget

1. Open `src/renderer/widgets/builtins.ts`
2. Call `WidgetRegistry.register({...})` with your `WidgetDef`
3. The widget automatically appears in the "Add Widget" toolbar picker

### Adding a New Built-in Overlay

1. Open `src/renderer/widgets/builtinOverlays.ts`
2. Call `CardDecoratorRegistry.register({...})` with your `CardDecoratorDef`
3. The overlay appears in the "Add Overlay" picker

### Adding a New Canvas Item Type

1. Add a new `kind` to the serialization types in `§20`
2. Create a `make<Type>El()` factory function in `DeckView.tsx`
3. Call `makeItemDraggable(el, '<yourType>')` in the factory
4. Handle the new `elType` in `handleMouseUp` drop logic
5. Add serialization/deserialization in `serializeCanvas()` / `restoreCanvas()`
6. Add undo triggers in relevant operations

### Adding a New IPC Channel

1. Add the handler in `ipc/library.js`:
   ```javascript
   ipcMain.handle('lib:myNewAction', (_e, args) => lib.myNewAction(getDb(), args));
   ```
2. Expose via preload in `preload.js`
3. Add the TypeScript declaration in `src/renderer/types/electron.d.ts`
4. Use `window.libraryAPI.myNewAction(args)` in the renderer

---

*Documentation generated from source analysis of KarnForge — main branch, commit `197f41e`.*
