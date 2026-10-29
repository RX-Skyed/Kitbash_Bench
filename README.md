# Kitbash Bench

A workbench in your browser for putting together 3D-printable miniatures. Load STL files, snap the parts together, pose them, and export a single print-ready model, or lay everything out as a model kit on sprues.

Nothing to install, and nothing is uploaded: your files stay on your computer.

---

## What it can do

- **Snap parts together:** click the faces, balls, sockets or surfaces that meet, and the bench fits them: pegs into holes, ball joints into cups, notched surfaces into each other.
- **Do ya feel lucky?:** click two parts and nothing else. The bench tries every way one could sit on the other and puts it where the most surface sits flush with nothing overlapping. Step through its other guesses if the first isn't right.
- **Pose figures:** snapped parts become a jointed skeleton. Turn an arm, head or weapon at its joint and everything attached follows.
- **Connection types:** each link is **Pinned** (turns any way, the default), **Hinge** (turns about one axis, with optional angle limits), **Roller** (slides along one of the part's own axes, with optional travel limits, and turns any way as it goes, like a ball riding in a channel) or **Fixed**. A hinge, roller or rail can also take its direction from faces you pick: **Pick faces…**, click the faces (a groove's walls, a flat strip), then **Along**, **Across** or **Out**.
- **Pistons and linkages:** a part can also be pinned to a second part, or ride a rail on it, as well as hanging off its parent. Make one with the snap tools: snap a part that's already on a joint (a piston pinned in its socket) to a second part and choose **Slide in it** (the default) or **Pin to it too** in Adjust. It turns on its own joint to reach, then rides a rail down the channel you snapped it to, with the rail's direction and ends read from the channel itself. Pose the leg and the pistons turn and slide to stay connected; slide a piston and the leg bends to match. If a piston can't reach, the pose stops where the real model would jam.
- **Auto-assemble:** if your files were exported in their assembled places, the bench finds where they touch and builds the joints for you. Before it builds, you can change what hangs off what, joint or fixed, and which parts are options of each other.
- **Reference images:** drop a picture on the view (or View › Add reference image…). It faces your view, behind the parts; size it, make it see-through, move and turn it to line it up, and pose the model against it. **Match pose** (experimental) bends the joints until the model's outline covers the figure in the picture.
- **Fit check any time:** press **K** (or View › Fit check) to keep the cross-sections up while you work. They cut through the selected part where it meets what it's attached to (or the two parts you've selected, or a loose part's nearest neighbour) and update live as you move, turn or pose, so you can watch a gap close or an overlap appear. × or K hides it.
- **Orthographic view:** View › Orthographic (Numpad 5, or the Persp/Ortho button under the view cube) for a flat, no-perspective view that lines up with references.
- **Colour it in:** brush paint onto the model, fill whole parts, and switch the bare plastic between grey plastic, resins, bone, or black, grey or white primer to preview a scheme.
- **Connections you can come back to:** click a joint's marker in the view, the joint icon in the Parts list, or ⌖ in Properties to select the connection itself rather than a part. Then Move (G) drags its point and Rotate (R) turns its axes while the parts stay put, and Properties shows its type, axis and limits, offsets you can type or nudge (the point, and the part away from the point; for an extra pin or rail, each end), **Clear offsets**, and magnets at it.
- **Magnets:** pairs of magnet holes where parts meet, in common disc sizes or your own, with clearance for resin or FDM. They move with the parts and are cut into the exported files.
- **Mirror and array:** mirror parts in place or make mirrored copies ("Right Arm" → "Left Arm", attached on the other side with its own joint), copy along a line, or round an axis through any centre: the part's own, its joint, what it's attached to, another part, or a spot you click. Copies bring everything attached to them. Shift+M and Shift+A, or Edit › Mirror… / Array….
- **Swap options:** heads, weapons or arms that fit the same spot share one joint. Pick a choice for each, save sets, and export every combination.
- **Model kit mode:** pieces go onto sprues (copies too, from names like `Leg x8`), sealed in a shrink-wrapped box with the box art and instruction booklet from the folder. Unbox it on the bench.
- **Instructions:** a PDF in the folder becomes a booklet you can flip through.
- **Export for printing:** the whole model as one STL, just a selection, each part separately, or whole sprues. **Merge into one clean solid** (on by default) joins every overlapping part and piece into a single closed shell, so no surfaces are left inside to print as walls or voids, fuses pieces that only touch face to face, fills any hollow sealed inside, smooths out hairline slivers, and cuts magnet holes exactly. Small **loose bits** within 2 mm of the rest that don't touch it (a fin floating beside a barrel) are joined on with a slim bridge as thick as the bit, or kept separate or left out if you choose. **Fill seams** closes the hairline gaps between parts that only nearly touch, so they merge too.
- **Projects save automatically** in your browser. Save a project file to back up your work or move it to another computer.

## Quick start

1. Open the page and choose **File › Open folder** (or drag a folder of STLs onto the bench).
2. Choose how they come in: **Model kit**, **Off the sprue, spread out**, or **Where the files put them**.
3. Pick a snap tool on the left (**Face** is a good start), click the area on the part that moves, then the area it attaches to.
4. Fine-tune in the **Adjust** panel (bottom left) if needed. The **Fit check** (bottom right) shows cross-sections of the joint; press **K** to keep it up any time.
5. **File › Export…** when you're done.

Try **File › Load sample kit** to play without your own files.

## Tools

| Tool | Key | Use it for |
|---|---|---|
| Select | `1` | Pick parts (Ctrl-click or Ctrl-drag for several) |
| Move / Rotate | `G` / `R` | Drag parts, the kit box or a whole sprue. **Axes** in the bar: the world's, the part's own, or those of what it's attached to (its joint, or its parent) |
| Pose | `P` | Turn a part about its joint. For a roller, **Turn** or **Slide** in the bar picks the rings or the slide arrow |
| Orient | `O` | Lay a face flat or square a part to the grid |
| Magnet | `N` | Click where two parts meet for a pair of magnet holes (common sizes, or your own, with print clearance). Parts that are connected get their pair at the connection, and it follows if you change the connection later; click a connection's marker for the same, or Shift-click to put it exactly where you click |
| Colour | `C` | Brush paint or fill parts (Alt-click picks a colour, `E` erases, Alt-wheel sizes the brush) |
| Ball | `B` | Ball into socket |
| Face | `H` | Flat face to flat face, pegs into holes |
| Mid | `M` | Centre a part in a gap |
| 3-Point | `T` | Match three points on each part |
| Match | `J` | Fit shaped or notched surfaces: pick areas on the moving part, then on one or more parts it fits against, then **Fit parts** |
| Lucky | `L` | Do ya feel lucky? Click the part that moves, then the part it fits onto (or select both and press Enter) and the bench works out how they go together |

Each tool's settings appear in the bar under the menus while it's active.

## Getting around

- **Left-drag** to orbit, **right-drag** or **Shift-drag** to pan, **wheel** to zoom
- **K** shows or hides the Fit check
- **F** frames the selection; **double-click** centres the view on a spot
- **Numpad 1 / 3 / 7** for front, right and top views; the cube in the corner does the same; **Numpad 5** switches perspective and orthographic
- **Ctrl+Z / Ctrl+Shift+Z** to undo and redo; **Esc** cancels
- **Ctrl+O** imports STLs, **Ctrl+E** exports, **Ctrl+,** opens Preferences

## Tips

- Name files like `Leg x8.stl` or `2x Sword.stl` to bring in that many copies.
- A folder with an image gets a printed kit box; a folder with a PDF gets a booklet.
- Select a part and use **Swap with…** or **Make base** in Properties to change which part is the parent.
- Armour plates and pistons that ride a channel: Ball the plate's bottom ball into its socket, then Ball (or Face, or Match) its top end into the channel on the leg. Adjust shows **Slide in it**: the plate keeps its socket, turns to reach the channel, faces away from the leg, and slides up and down the channel as you pose the leg, keeping that facing (Properties › **Keep facing this way**; turn the plate itself in Pose to set a new one). **Turn on its axis** spins it if it faces the wrong way; **Slides along** changes the direction (Channel, Across, Out, the part's X/Y/Z, or **Pick faces…**); untick **Stop at the channel's ends** to let it run free. Repeat for each plate.
- Set a part's connection type in Properties. A two-piece piston: the cylinder **Pinned** to one part, the rod a **Roller** in the cylinder, and the rod's end **Connect also to…** the other part with a pin. A one-piece piston: **Pinned** at the bottom, its top end on a rail on the other part. In Auto-assemble, contacts the tree leaves out are listed under **Also connect**: tick a piston's far end there.
- Rearrange by dragging in the Parts list (and in the Auto-assemble review): drop a part on another part's name to attach it (with a joint where they touch), on the right end of its row to make it an option of that part, or on the strip below the list to set it loose.
- When you move a part that hangs off another, you're asked whether to bring the whole group along.
- The last piece of a puzzle? In Match, pick areas on every part it touches and it fits against them all at once.
- Feeling lucky works best on parts made to fit: cut faces, pegs, sockets and seams that sit flush. A search takes from a few seconds to a minute depending on the parts and your computer; **Quick** in the options bar is faster, **Thorough** looks harder. Its guesses are listed in Adjust, best first.
- Printing in resin? Merge already fills hollows that are sealed completely. Kit › Check for hollow pockets also finds air whose only way out is a crack too narrow to drain, and shows it shaded red with a bold outline; tick **Fill hollow pockets** in Export to fill those too. Your parts stay as they are.
- Merging takes a moment on detailed sculpts (several seconds for half a million triangles), and the file often comes out smaller: triangles that change the shape by less than 5 microns are merged away. A piece with holes too big to close goes into the file as it was, and the export note says so.
- Match pose works from the picture's point of view: line the picture up with the figure (similar size, overlapping, square on), and use a cut-out or a plain background. One picture can't show turns toward or away from it, so check the result from the side.
- Paint is for previewing: STL files don't carry colour, so exports are plain geometry.

## Files

```
index.html       page layout: menus, panels, dialogs
css/styles.css   all the styling
js/app.js        the app: scene, tools, kit, export
js/math.js       the geometry (snapping, fitting, seams, sprues), with no page code
js/lucky.js      the "Do ya feel lucky?" search, plain number crunching
js/lucky-worker.js  runs that search in the background, one per spare processor core
js/solid.js      merging parts into one clean solid for export
js/solid-worker.js  runs the merge in the background
js/vendor/       Manifold, the exact mesh-boolean library the merge uses (manifold.js and manifold.wasm)
```

Because the scripts are separate files, the page has to be served from a web address (GitHub Pages, or any local server such as `python -m http.server`). Double-clicking `index.html` to open it from disk won't run it: browsers block scripts loaded that way.

## Requirements

A recent desktop browser (Chrome, Edge, Firefox or Safari) and an internet connection the first time the page loads. It works on phones and tablets, though a mouse is much easier.

## Privacy

Everything runs in your browser. Your STL files, box art and instructions are never uploaded; projects are stored in your browser's own storage.

## Built with

[three.js](https://threejs.org) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) and [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) (MIT), [Manifold](https://github.com/elalish/manifold) (Apache 2.0, bundled in js/vendor), [JSZip](https://stuk.github.io/jszip/) (MIT), [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), and the Barlow and IBM Plex fonts (SIL Open Font License).
