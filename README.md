# MSM Rig Studio 🐸

Two browser-based monster animation editors, published through GitHub Pages.

## Pages
- **[Original four-monster rig editor](https://minuteandone.github.io/My-singing-editor/)**: Fwog, Shrubb, Pummel, and Tweedle with reconstructed controls, IK for eligible limbs, simple keyframes, and sprite-based artwork already in the original prototype.
- **[Rig Lab — actual Aniviewer animation data](https://minuteandone.github.io/My-singing-editor/rig-lab.html)**: separate non-destructive editor for the source frame hierarchy, clip playback, layer offsets, limits, IK where the source hierarchy permits, and added keyframes.

## Load your data.zip directly

1. Open Rig Lab and select **Choose files / ZIP**.
2. Choose your MSM data.zip (containing the data/xml_bin, data/xml_resources, and data/gfx/monsters folders). The editor scans the archive directory and reads only the selected files. It does **not** extract the full archive.
3. Search for monster_cd.json for Fwog, monster_bcd.json for Pummel, monster_a.json for Tweedle, or another converted monster_*.json. Select a result.
4. Rig Lab reads the Rev-6 animation JSON, its referenced XML texture atlas, and the matching AVIF image. Select a clip and scrub the timeline.
5. Select a layer to adjust its transform, rotation range, or visibility. Select an endpoint with two parents to add a **two-joint IK target**; grab the purple target to move it.
6. Set editable pose keyframes, then **Export edits**. To reopen, load the original source data, then **Import edits JSON**.

Instead of ZIP, choose an Aniviewer-converted JSON and its matching monster_XXX_sheet.xml and monster_XXX_sheet.avif or PNG files together.

## What's source-authentic vs. reconstructed?

**Source:** Animation clips, names, hierarchy/parent IDs, layer pivots and per-sprite anchor maps, source textures, per-channel key timings and interpolation modes, sprite switches, scale/rotation/position/opacity, and basic depth ordering.

**Editor additions:** Layer transform offsets and visibility, rotation constraints, target-based two-segment IK, pose overlay keyframes, PNG export and editable project overlay JSON. Original source JSON remains unmodified.

**Not fully implemented:** Exact game-specific rendering for every animation revision, complex shaders/color materials, mesh or polygon trim geometries, and dynamic draw orders not represented as depth keys. IK is only available for source layers with a parent and grandparent and is an approximation if they use unusual nonuniform transforms. Original Fwog's two source feet are separate roots, so source-chain IK cannot be applied to them without authoring extra joints. The older original four-rig editor has reconstructed two-joint IK controls instead.

**Important:** MSM uses sprite and hierarchical transforms for this use case, so this project deliberately **does not use mesh deformation or skin weights**.

## Import format and references
The monster_*.json exports came from [LennyFaze0/MSM-Aniviewer](https://github.com/LennyFaze0/MSM-Aniviewer), especially its web-app/src/core/animation.ts and atlas/renderer implementation. No original MSM sprite atlases, animation JSON, or game audio are distributed with the new Rig Lab: users provide their own local assets. The earlier prototype's previously embedded example art is left unchanged.

### Browser requirements
A current browser that supports HTML canvas, Blob.stream(), and DecompressionStream('deflate-raw') to browse ZIPs directly. If the browser lacks ZIP decompression, pick extracted individual JSON/XML/AVIF files instead.

All selected asset processing runs inside the page; it is not uploaded to the repository or a server. GitHub Pages serves only the editor code.

## Development
rig-lab.html is the advanced editor, rig-lab.css its styles, and rig-lab.js its implementation. The Pages workflow is .github/workflows/pages.yml. JavaScript syntax verification is performed by .github/workflows/rig-lab-check.yml.
