# VectorInk — Handwriting Plugin for Obsidian

VectorInk lets you create and edit handwritten notes directly inside Obsidian. Drawings are stored as vector data (Bézier curves) in `.ink` files, keeping them resolution-independent and compact. Notes can be embedded inline in any Markdown file and exported to SVG or PNG.

---

## Creating Ink Notes

There are three ways to create a new `.ink` file:

- Click the **pencil icon** in the left ribbon.
- Run the command **Create Ink Note** from the Command Palette (`Ctrl/Cmd + P`).
- Create a file manually with the `.ink` extension — Obsidian will open it in the ink editor automatically.

---

## The Editor

The editor consists of a **toolbar** at the top and a scrollable **canvas area** below. Each document is made up of one or more *blocks*, each with its own canvas.

### Tools

Three tools are available, selectable via the toolbar or keyboard shortcuts:

| Tool | Shortcut | Description |
|---|---|---|
| ✏️ Pen | `Ctrl+P` | Draw strokes on the canvas |
| 🧽 Eraser | `Ctrl+E` | Remove strokes by touching them |
| ↖️ Selection | — | Select, move, copy, and delete strokes |

### Pen Properties

When the pen or selection tool is active, the following controls appear in the toolbar:

- **Color** — stroke color (color picker)
- **Opacity** — stroke transparency (0–100%)
- **Width** — base stroke width in logical pixels (1–20)
- **Format** — semantic style applied to the stroke:
  - `N` Normal
  - `B` Bold
  - `I` Italic

Pen settings apply to all new strokes. When strokes are selected, changing these properties immediately restyles the selection.

### Blocks

A document is divided into blocks — independent drawing areas stacked vertically. Each block has its own canvas, display settings, and resizable height.

**Block types** available:

| Type | Description |
| ---|---|
| `paragraph` | General freehand writing area |
| `heading1` – `heading5` | Heading levels (add a separator line below by default) |
| `quote` | Quote block (adds a left bar decoration by default) |
| `math` | Mathematical content area |
| `drawing` | General illustration area |

**Adding blocks:** Click **＋ Block** in the toolbar to append a new block. Within the canvas area, a **(+)** button appears between blocks to insert one at a specific position.

**Reordering blocks:** Each block has **▲ / ▼** buttons to move it up or down.

**Clearing blocks:** Each block has a **🗑** clear button.

**Delating blocks:** Each block has a **X** delate button.

New blocks inherit the currently active toolbar settings (stroke weight, grid, color mode, etc.).

### Block Settings

Each block has independent display settings, editable from the toolbar when that block is selected:

- **Colors** (checkbox) — when enabled, strokes render in their saved colors. When disabled, all strokes render in a single neutral color, making the note style-agnostic for embed previews.
- **BG** — background color of the block canvas (only visible when Colors is off).
- **Grid** — optional background grid overlay with the following options:
  - Enable/disable toggle
  - Type: `Grid` (crosshatch), `Lines` (horizontal only), `Dots`
  - Size (cell size in logical pixels)
  - Opacity
  - Color
  - Line width

#### Decorations

For heading and quote blocks, additional decoration toggles appear:

- **─ Separator** (headings) — renders a horizontal rule below the block in embed previews.
- **❝ Quote bar** (quotes) — renders a left vertical bar and indent in embed previews.

### Stroke Weight

The **Stroke weight** slider scales all stroke widths in the selected block(s) uniformly. This is non-destructive: the original stroke widths are preserved in the data; the multiplier is applied at render time. Useful for adjusting visual weight without redrawing.

### View Zoom

The **View** slider scales the entire editor canvas for comfortable writing.

### Smoothing

The **Smoothing** slider controls the Bézier fitting epsilon (0.0 – 5.0). Lower values produce curves that closely follow raw input points and require more storage space; higher values produce smoother, more generalized curves that require less storage space.

---

## Selection & Editing

Switch to the **Selection tool** to interact with existing strokes.

---

## Undo & Redo

All drawing and editing actions are undoable. The history is per-session (up to 100 steps) and is cleared when switching to a different file.

| Action | Toolbar | Shortcut |
|---|---|---|
| Undo | ↩ | `Ctrl+Z` |
| Redo | ↪ | `Ctrl+Y` or `Ctrl+Shift+Z` |

Actions tracked by history:

- Drawing a stroke
- Erasing strokes
- Deleting selected strokes
- Pasting strokes
- Moving strokes
- Restyling strokes
- Changing block display settings (color mode, background)

---

## Embedding in Markdown

`.ink` files can be embedded in any Markdown note using Obsidian's standard embed syntax:

```
![[my-note.ink]]
```

The embed renders as an SVG preview in both Reading Mode and Live Preview.

---

## Export

The toolbar provides two export options that save files alongside the `.ink` source:

- **↓ SVG** — exports a vector SVG file. All blocks are combined into a single image. File path: same folder as the `.ink` file, with `.svg` extension.
- **↓ PNG** — exports a rasterized PNG at 2× resolution. File path: same folder, `.png` extension.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Switch to Pen tool |
| `Ctrl+E` | Switch to Eraser tool |
| `Escape` | Switch to Selection tool / clear selection |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save |
| `Ctrl+A` | Select all strokes in current block |
| `Ctrl+C` | Copy selected strokes |
| `Ctrl+V` | Paste strokes |
| `Del` | Delete selected strokes |

---

## Buy me a coffee

Feel free to support my work: https://buymeacoffee.com/theodorkaiser