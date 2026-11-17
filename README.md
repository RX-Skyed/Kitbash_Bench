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
- **Image to relief:** File › Image to relief… (or **Make a relief…** on a reference image) turns a picture into a solid, with no AI involved. **Outline** raises the logo's shape to an even height with an optional bevelled edge, **Depth map** uses the picture's brightness as height (light or dark raised), and **Whole picture** makes a plaque. You can set the threshold, smoothing, width, height, bevel and backing plate. **Place on a part…** puts it wherever you click on a surface; then turn, resize (across; it keeps its height) and sink it, and **Wrap to surface** bends it to follow the curve. While placing, click elsewhere on the same face (or use **Move →/↑**) to slide it along the face; **Centre on the face** puts it in the middle and **Square to the face** lines it up with the face's edges. **Repeat** makes a **Grid** of copies, or **Fill the face** with as many as cover it (gap 0 for a seamless pattern, like a checkerboard), and **Trim to the face's edges** (with an optional margin) cuts the pattern off cleanly where the face ends. **Carry on round corners** takes it across creases onto the faces next to it (as far as **Up to °** from the face you clicked), unfolded so the picture keeps its shape round a bent armour plate, with mitred corners; rivets and small bumps are left out of the unfolding and the relief sits over them. The faces it covers are outlined in blue; Shift-click faces to add them or take them out. It stays attached to that part and merges into one solid on export.
- **Scatter on a face:** select one or more parts (three different skulls, say), then **Scatter…** (or Edit › Scatter on a face…) and click the face of another part, a shield. Copies land at random spots over the face, mixed at random, kept apart by the **Spacing** and inside the face's edges (with an optional margin), each standing straight out of the surface where it lands and sunk in a little so it joins on export. Set **How many**, a **Size %** range, **Turn** (random, or lined up with a little wobble), **Tilt**, and which way each piece **Faces out**; **Shuffle** for a new pattern. **Carry on round corners** and Shift-clicking faces work as for reliefs. The copies share their part's mesh and are fixed to the part they're on. **Push through, out the back by** sinks each one right through the part so it pokes out of the back (a bolt through a shield).
- **Merge or cut:** when you click **Done** on a relief or a scatter, it asks whether its parts go on as **Separate parts** (fixed on, still movable), **Merge into** the part (a mesh boolean add) or **Cut into** it (a boolean subtract: their shape pressed in as deep as they sink, or holes right through when pushed through). It's a modifier either way, so you can switch later, and Apply makes it permanent.
- **Popups you can move and resize:** drag any popup card or dialog (crack, relief, placing, scatter, mirror/array, orient, auto-assemble, fit check, export, preferences, projects) by its title bar, and resize it from the grip in its bottom-right corner. Each one remembers where you left it and its size; double-click the title bar to put it back. They're kept on screen when the window shrinks.
- **Modifiers:** like Blender's modifier stack. A part keeps its mesh as it came in, and a list of modifiers worked on it in order, under Properties › **Modifiers**. Each one can be turned **on or off** (the tick), **reordered** (▲ ▼), **applied** (made part of the mesh for good, with any above it that are on) or **removed** (✕), and its settings changed right there. **Crack & cave in** shows all its settings plus **Shuffle** and **Move the hit**. A **Relief** or **Scatter** has a **Result** of Separate (its parts sit on this one), Merge (joined into the mesh) or Cut (taken away from it), and **Change placement…** opens the placing card again as it was set (Shuffle, for a scatter, re-rolls the pattern). Add one from **Add modifier…**, or by finishing a crack, relief or scatter, which now become modifiers instead of changing the mesh for good. The stack is worked out in the background, each step kept so only what changed is redone; it's saved with the project (with the mesh as it came in) and worked out again on opening, and Undo covers every change.
- **Split / break in two:** select a part, then **Split…** (or Edit › Split / break in two…, or Add modifier › Split) and click where to cut it; the cut runs up the screen through that spot. It's a modifier: pick the **Break** (**Snapped**: broad angular facets, splintered; **Torn**: ragged teeth and ridges; **Melted (lance)**: a wavering burn line with drag lines, a burnt-away gap and optional **slag beads** along the edges; **Clean cut**), its **Roughness** and **Feature size**, how much is **cut away** between the halves, how far they're **pulled apart**, **Turn** and **Tilt** the cut, and **Keep** both halves or one side. **Shuffle** for a new break, **Move the cut**, or **Line up with the view** to set it across the screen again. **Apply** makes the second half a part of its own.
- **Ooze & growths:** Edit › Ooze & growths… (or **Ooze…** in Properties), then click spots on any parts, one after another, and organic ooze is strung between them: it leaves each surface with a splat, droops under its own weight, necks thin as it stretches, and swells in lumps, with pustules and drips hanging off the low points. Pick a **Look** to start from (**Thick ooze**, **Slime strings & webs**, **Lumpy growth**), then set the **Thickness**, how **Lumpy**, how much it **Sags**, how **Stretched** thin it's pulled in the middle, **Threads** (thin strings of slime across spans, along it and down to the surface, beaded) and their thickness, 1–4 **Strands** twisted round each other, **Pustules** on the strands (and their **size**), pustules **On the surface** round where it sticks (found on the part itself, so none hang off an edge), **Webbing**: sheets of goo **In the bends**, **Between strands** (which spreads them apart, a webbed rope) and **Down to the surface**, with its **reach**, **thickness**, **Web style** (a **Torn sheet**, or a **Net of cells**, most of them open, ringed by thick rims, like stretched slime) and **holes**, **Drips** and their length, the **Splat** size and the **Detail**; **Shuffle** for new lumps and drips; Backspace or **Take off last spot** to step back. It's its own part, fixed to the part it starts on, and keeps its spots on the parts they're on, so **Change ooze…** opens it again to carry it on or change it (and it follows those parts if they've moved). A closed solid, ready to merge on export. No AI: it's a blobby field made into a mesh with Manifold.
- **Clean out insides:** select a part, then **Clean inside** (or Edit › Clean out insides) to keep its outside skin and nothing within it: overlapping pieces, parts buried inside others (a body under its armour, pegs, inner copies), sealed hollows and stray bits inside all go, leaving one clean model to print. Closed pieces are joined exactly with Manifold; bits that aren't closed (open sheets, broken shells) are kept only where they can be seen from outside, tested by casting rays from each one. **Keep** every outside piece or the **biggest piece only**; **Open bits** kept where they're outside, or all removed; **Check** Quick, Normal or Thorough (Thorough keeps more of the deep crevices on a very open mesh, and takes longer). It's a modifier, showing what it removed; a big open mesh can take a minute. No AI.
- **Crack & cave in:** select a part, then **Crack…** (or Edit › Crack & cave in…) and click where it got hit. Round that spot it's cracked into slabs, with jagged rings round the hit and cracks running out from it. Each slab is tipped and pushed in, deepest in the middle, like a broken sidewalk or a punched armour panel, and hairline **spider cracks** run on past the edge. Set the **Radius**, how far it **caves in**, how many **rings** and **cracks**, **crack width**, how **jagged**, how much each slab **tumbles**, and whether the middle is **caved in** or **punched through**. **Goes**: **Through the part** (the whole thickness breaks; by default the cracks stop short of the back, **Hold together**, so it stays one piece to print, or **Break right through** lets the slabs come apart), or **Surface only**: just a layer at the top breaks up, as on a thick block or a sidewalk, with a **Crack depth** (how deep the cracks cut, at most) and an **Effect depth** (how thick the layer is that breaks into slabs and caves in); under it the part stays whole. Click elsewhere to hit it there instead, **Shuffle** for new cracks. It works from the part as it was, on curved panels too. One Undo takes it back. It copes with messy meshes (pieces touching only at an edge, stray triangles, doubled faces): it cuts the solid that Merge finds, separate pieces of the part (a toe, a rivet) are cut or kept as they are, and triangles that aren't part of any closed solid go through untouched, so nothing of the part goes missing; **Split** does the same. No AI: it's a random crack pattern cut with Manifold.
- **Magnets:** pairs of magnet holes where parts meet, in common disc sizes or your own, with clearance for resin or FDM. They move with the parts and are cut into the exported files. By default (**Holes: Square to the seam**) both holes of a pair sit on one shared axis, straight across where the parts meet (taken from the average of each surface around the spot, so rivets and texture don't tip it), so the magnets go in straight and meet face to face, even if your two clicks aren't opposite each other. A hole already close by in either part is reused, so every option for one spot (left pads, swap arms) lines up with the same hole in the body, and it's cut only once. **Line up** in a magnet's row, or **Line up all** in the bar, does this to magnets you already have; **As clicked** puts each hole along the surface where you click.
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

- **Workspaces**, like a slicer's: tabs across the top for each stage of the job, **F1–F5** to switch. Each one shows its own tools down the left, its operations as big buttons at the top of the right-hand panel, and only the part buttons that belong to it in Properties. The menus still hold everything, and a tool's shortcut key takes you to a workspace that has it.
  - **Files**: import STLs, open a folder, the sample kit, new / open / save projects, saved projects, reference images, import settings
  - **Assemble**: move, rotate, pose, orient and the snap tools (ball, face, mid, 3-point, match, lucky); auto-assemble, lay out, mirror, array, the box and sprues, option slots, joints, fit check
  - **Modify**: crack, split, scatter, ooze, relief, mirror, array, paint
  - **Prepare**: clean out insides, hollow pockets, seams, magnets, drop to grid, square up, fit check
  - **Export**: whole model, selected, every part, sprues, option sets, with the export settings open beside them
- **Left-drag** to orbit, **right-drag** or **Shift-drag** to pan, **wheel** to zoom
- **K** shows or hides the Fit check
- **F** frames the selection; **double-click** centres the view on a spot
- **Numpad 1 / 3 / 7** for front, right and top views; the cube in the corner does the same; **Numpad 5** switches perspective and orthographic
- **Ctrl+Z / Ctrl+Shift+Z** to undo and redo; **Esc** cancels
- **Ctrl+O** imports STLs, **Ctrl+E** exports, **Ctrl+,** opens Preferences

## Tips

- Name files like `Leg x8.stl` or `2x Sword.stl` to bring in that many copies.
- Name files like `Pauldron mirror.stl`, `Arm_L (mirror for R).stl` or `Shin + mirror.stl` to bring in one as it is and a mirrored twin (one per copy with `x2` and the like). The twin is named for the other side where it can be (`Arm_R`), or after what it's for. Turn it off, or choose which way to mirror (X, Y or Z), under Preferences › Importing.
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
js/solid-worker.js  runs the merge and relief building in the background
js/relief.js     image to relief: reads the picture, traces outlines, builds the raised solid
js/crack.js      crack & cave in: the crack pattern, cutting the slabs and pushing them in
js/clean.js      clean out insides: the outside skin only (union, then a sight test for open bits)
js/split.js      split: the break surface (snapped, torn, melted, clean) and cutting the part in two
js/ooze.js       ooze & growths: the strands, lumps, drips and splats, made into one closed mesh
js/vendor/       Manifold, the exact mesh-boolean library the merge uses (manifold.js and manifold.wasm)
```

Because the scripts are separate files, the page has to be served from a web address (GitHub Pages, or any local server such as `python -m http.server`). Double-clicking `index.html` to open it from disk won't run it: browsers block scripts loaded that way.

## Requirements

A recent desktop browser (Chrome, Edge, Firefox or Safari) and an internet connection the first time the page loads. It works on phones and tablets, though a mouse is much easier.

## Privacy

Everything runs in your browser. Your STL files, box art and instructions are never uploaded; projects are stored in your browser's own storage.

## Built with

[three.js](https://threejs.org) and [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) and [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) (MIT), [Manifold](https://github.com/elalish/manifold) (Apache 2.0, bundled in js/vendor), [JSZip](https://stuk.github.io/jszip/) (MIT), [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), and the Barlow and IBM Plex fonts (SIL Open Font License).
