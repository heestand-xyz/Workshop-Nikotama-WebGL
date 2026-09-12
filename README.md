# Nikotama-WebGL

## Node.js
v19.7.0

## Setup
```bash
  npm install  
  npm run dev
```

## URL Query Specification

The displayed version and its runtime options are selected with URL query parameters.
Parameter names and values are case-sensitive.

### Versions

| Version | Query | Local URL |
| --- | --- | --- |
| Type 1 | `cubeType=type1` | `http://localhost:5173/?cubeType=type1` |
| Type 2 (default) | `cubeType=type2` | `http://localhost:5173/?cubeType=type2` |
| Type 3 | `cubeType=type3` | `http://localhost:5173/?cubeType=type3` |

### Parameters

| Parameter | Accepted values | Default | Description |
| --- | --- | --- | --- |
| `cubeType` | `type1`, `type2`, `type3` | `type2` | Selects the cube layout/version. |
| `debug` | `true` or `1` to enable; any other supplied value disables | `true` | Selects the debug camera and separated cube-face view. Use `debug=false` for the composed output. |
| `debugProjection` | `true` or `1` to enable; any other supplied value disables | `false` | Shows the projector source image flat at 768 × 768, before it is mapped onto the cube faces. Overrides the canvas size. |
| `debugImage` | `true` or `1` to enable; any other supplied value disables | `false` | Shows the live Tama River camera paired with the selected `cubeType`, with its key colours in a row beneath. Overrides the canvas size. |
| `lilGUI` | `true` or `1` to enable; any other supplied value disables | `false` | Shows the lil-gui control panel, including the key colour thresholds. |

### Reference cameras

`debugImage` shows the live camera nearest the site each cube refers to. The
feeds come from the MLIT 川の防災情報 network; the URLs are in
`src/modules/Artwork.ts`.

| Cube | Camera |
| --- | --- |
| `type1` | 多摩川二子玉川ライズタワーオフィス屋上 — Tama River Futako-Tamagawa Rise Tower Office Rooftop |
| `type2` | 多摩川二子橋 — Tama River Futako Bridge |
| `type3` | 多摩川田園調布出張所 — Tama River Denenchōfu Branch Office |

Under the frame, up to five key colours are shown as circles. They are picked
by farthest-point sampling in RGB over the pixels of a copy of the frame scaled
to fit 50 × 50, keeping only those with HSB saturation and brightness above the
current thresholds (`src/modules/keyColors.ts`), then sorted from low to high
luminance.

### Camera-driven gradient

These key colours are the gradient the artwork samples, in every mode — not
only under `debugImage`. The frame is fetched on load and refreshed every
60 seconds, so the palette follows the light on the river through the day.

The colours are redistributed over the fixed number of gradient stops the
shader is compiled for. When a frame yields fewer than two qualifying colours —
common on overcast days — the gradient falls back to red, green, blue. The two
thresholds are `minSaturation` and `minBrightness`, both 0.1 by default and
adjustable live under **Key Colours** in the lil-gui panel (`lilGUI=true`).

Because the artwork fetches from `cam.river.go.jp` on every run, it needs
network access, and a published copy hotlinks a third party's live feed.

The host returns `Access-Control-Allow-Origin: *`, so the browser can use the
frame as a texture, but it rejects any client that does not send a browser
User-Agent. Fetching these with `curl` or a script returns 403 by design.

Combine parameters with `&`. For example, the composed Type 3 version is:

```text
http://localhost:5173/?cubeType=type3&debug=false
```

Use the same query string after the path in deployed environments. Unsupported
parameter values are not part of the specification and should not be relied upon.