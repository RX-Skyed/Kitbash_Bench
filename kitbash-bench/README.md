# Kitbash Bench

A workbench in your browser for putting together 3D-printable miniatures. Load STL files, snap the parts together, pose them, and export a single print-ready model, or lay everything out as a model kit on sprues.

Nothing to install, and nothing is uploaded: your files stay on your computer.

---

## What it can do

- **Snap parts together:** click the faces, balls, sockets or surfaces that meet, and the bench fits them: pegs into holes, ball joints into cups, notched surfaces into each other.
- **Pose figures:** snapped parts become a jointed skeleton. Turn an arm, head or weapon at its joint and everything attached follows.
- **Auto-assemble:** if your files were exported in their assembled places, the bench finds where they touch and builds the joints for you.
- **Colour it in:** brush paint onto the model, fill whole parts, and switch the bare plastic between grey plastic, resins, bone, or black, grey or white primer to preview a scheme.
- **Magnets:** pairs of magnet holes where parts meet, in common disc sizes or your own, with clearance for resin or FDM. They move with the parts and are cut into the exported files.
- **Swap options:** heads, weapons or arms that fit the same spot share one joint. Pick a choice for each, save sets, and export every combination.
- **Model kit mode:** pieces go onto sprues (copies too, from names like `Leg x8`), sealed in a shrink-wrapped box with the box art and instruction booklet from the folder. Unbox it on the bench.
- **Instructions:** a PDF in the folder becomes a booklet you can flip through.
- **Export for printing:** the whole model as one STL, just a selection, each part separately, or whole sprues. **Fill seams** closes the hairline gaps between parts so they print as one solid piece.
- **Projects save automatically** in your browser. Save a project file to back up your work or move it to another computer.

## Quick start

1. Open the page and choose **File › Open folder** (or drag a folder of STLs onto the bench).
2. Choose how they come in: **Model kit**, **Off the sprue, spread out**, or **Where the files put them**.
3. Pick a snap tool on the left (**Face** is a good start), click the area on the part that moves, then the area it attaches to.
4. Fine-tune in the **Adjust** panel (bottom left) if needed. The **Fit check** (bottom right) shows cross-sections of the joint.
5. **File › Export…** when you're done.

Try **File › Load sample kit** to play without your own files.

## Tools

| Tool | Key | Use it for |
|---|---|---|
| Select | `1` | Pick parts (Ctrl-click or Ctrl-drag for several) |
| Move / Rotate | `G` / `R` | Drag parts, the kit box or a whole sprue |
| Pose | `P` | Turn a part about its joint |
| Orient | `O` | Lay a face flat or square a part to the grid |
| Magnet | `N` | Click where two parts meet for a pair of magnet holes (common sizes, or your own, with print clearance) |
| Colour | `C` | Brush paint or fill parts (Alt-click picks a colour, `E` erases, Alt-wheel sizes the brush) |
| Ball | `B` | Ball into socket |
| Face | `H` | Flat face to flat face, pegs into holes |
| Mid | `M` | Centre a part in a gap |
| 3-Point | `T` | Match three points on each part |
| Match | `J` | Fit shaped or notched surfaces: pick areas on the moving part, then on one or more parts it fits against, then **Fit parts** |

Each tool's settings appear in the bar under the menus while it's active.

## Getting around

- **Left-drag** to orbit, **right-drag** or **Shift-drag** to pan, **wheel** to zoom
- **F** frames the selection; **double-click** centres the view on a spot
- **Numpad 1 / 3 / 7** for front, right and top views; the cube in the corner does the same
- **Ctrl+Z / Ctrl+Shift+Z** to undo and redo; **Esc** cancels
- **Ctrl+O** imports STLs, **Ctrl+E** exports, **Ctrl+,** opens Preferences

## Tips

- Name files like `Leg x8.stl` or `2x Sword.stl` to bring in that many copies.
- A folder with an image gets a printed kit box; a folder with a PDF gets a booklet.
- Select a part and use **Swap with…** or **Make base** in Properties to change which part is the parent.
- When you move a part that hangs off another, you're asked whether to bring the whole group along.
- The last piece of a puzzle? In Match, pick areas on every part it touches and it fits against them all at once.
- Printing in resin? Kit › Check for hollow pockets finds air sealed inside the model; tick **Fill hollow pockets** in Export and the file comes out solid there. Your parts stay as they are.
- Paint is for previewing: STL files don't carry colour, so exports are plain geometry.

## Files

```
index.html       page layout: menus, panels, dialogs
css/styles.css   all the styling
js/app.js        the app: scene, tools, kit, export
js/math.js       the geometry (snapping, fitting, seams, sprues), with no page code
```

Because the scripts are separate files, the page has to be served from a web address (GitHub Pages, or any local server such as `python -m http.server`). Double-clicking `index.html` to open it from disk won't run it: browsers block scripts loaded that way.

## Requirements

A recent desktop browser (Chrome, Edge, Firefox or Safari) and an internet connection the first time the page loads. It works on phones and tablets, though a mouse is much easier.

## Privacy

Everything runs in your browser. Your STL files, box art and instructions are never uploaded; projects are stored in your browser's own storage.

## Built with

[three.js](https://threejs.org) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) and [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) (MIT), [JSZip](https://stuk.github.io/jszip/) (MIT), [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), and the Barlow and IBM Plex fonts (SIL Open Font License).
