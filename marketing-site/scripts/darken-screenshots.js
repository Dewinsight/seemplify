// Recreates dark-mode versions of the product screenshots.
// usage: node scripts/darken-screenshots.js public/images/product-showcases
// Needs the Playwright install under recruiter/frontend (uses the installed Chrome).
//
// Every pixel is handled in OKLab so hue never flips: neutral pixels (page whites,
// greys, text) have their lightness inverted into the site's violet-black palette
// with their own tint kept; genuine saturated fills (buttons, badges, charts) keep
// their colour, and light labels sitting on them are left alone. Thin colourful
// pixels that are not part of a fill — ClearType fringes on text, coloured
// figures — are desaturated and lifted so they read as light text instead of
// turning into stray bright blocks.
// Output: <name>-dark.png beside each <name>.png
const { chromium } = require(require('path').join(__dirname, '../../recruiter/frontend/node_modules/@playwright/test'));
const fs = require('fs');
const path = require('path');

const PROCESS = `
(function (imageData) {
  const { data, width, height } = imageData;
  const n = width * height;

  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  // sRGB 0-255 -> OKLab
  const lab = new Float32Array(n * 3);
  const chroma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = toLinear(data[i * 4] / 255), g = toLinear(data[i * 4 + 1] / 255), b = toLinear(data[i * 4 + 2] / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    lab[i * 3] = L; lab[i * 3 + 1] = A; lab[i * 3 + 2] = B;
    chroma[i] = Math.sqrt(A * A + B * B);
  }

  // A capture that is already a dark UI needs no inversion: hand it back as it is.
  let sumL = 0;
  for (let i = 0; i < n; i++) sumL += lab[i * 3];
  if (sumL / n < 0.5) return { imageData, unchanged: true };

  // Saturated-fill candidates, then keep only solid regions (erode) and grow them back (dilate)
  // so a button survives but a one-pixel colour fringe on a glyph does not.
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const L = lab[i * 3];
    cand[i] = chroma[i] >= 0.09 && L > 0.22 && L < 0.92 ? 1 : 0;
  }
  const morph = (src, radius, grow) => {
    const out = new Uint8Array(n);
    // separable: horizontal then vertical
    const tmp = new Uint8Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = grow ? 0 : 1;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          const s = xx < 0 || xx >= width ? 0 : src[y * width + xx];
          if (grow) { if (s) { v = 1; break; } } else if (!s) { v = 0; break; }
        }
        tmp[y * width + x] = v;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = grow ? 0 : 1;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          const s = yy < 0 || yy >= height ? 0 : tmp[yy * width + x];
          if (grow) { if (s) { v = 1; break; } } else if (!s) { v = 0; break; }
        }
        out[y * width + x] = v;
      }
    }
    return out;
  };
  const core = morph(cand, 1, false);                       // solid colour at least 3px thick
  const closed = morph(morph(core, 12, true), 12, false);   // the fill with its label and button holes filled in
  const nearCore = morph(core, 6, true);                    // strokes drawn on the fill sit within this
  const rim = morph(closed, 2, true);                       // the fill's anti-aliased edge
  const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

  for (let i = 0; i < n; i++) {
    const L = lab[i * 3];
    let A = lab[i * 3 + 1], B = lab[i * 3 + 2];
    const C = chroma[i];
    const pageWhite = L > 0.93 && C < 0.03;

    // A fill that stays as it is keeps everything drawn on it too, so labels never lose their contrast.
    // White is kept only where it is a label on the fill, never as page white beside it, so no halos.
    const keep = closed[i] ? !pageWhite || nearCore[i] : rim[i] && !pageWhite;
    if (keep) {
      if (core[i] && L < 0.32) writePixel(i, L + 0.1, A, B); // lift the darkest fills a little off the page
      continue;
    }

    // Everything else is inverted in lightness, hue kept. Coloured strokes (text, ClearType fringes)
    // are toned down and lifted so they read; the blend is continuous in chroma so neighbouring
    // pixels of one glyph never land on opposite sides of a threshold.
    const inverted = L > 0.965 ? 0.2 : 0.16 + (1 - L) * 0.78;
    const w = smoothstep(0.03, 0.12, C);
    const target = inverted + (Math.max(inverted, 0.72) - inverted) * w;
    const scale = 1 - 0.45 * w;
    A *= scale; B *= scale;
    // Dark results take on the site's violet-black cast.
    const cast = Math.max(0, 1 - target * 2.2);
    A += 0.012 * cast;
    B -= 0.03 * cast;
    writePixel(i, target, A, B);
  }
  return { imageData, unchanged: false };

  function writePixel(i, L, A, B) {
    const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
    const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
    const s_ = L - 0.0894841775 * A - 1.291485548 * B;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    data[i * 4] = Math.round(255 * clamp01(toSrgb(clamp01(r))));
    data[i * 4 + 1] = Math.round(255 * clamp01(toSrgb(clamp01(g))));
    data[i * 4 + 2] = Math.round(255 * clamp01(toSrgb(clamp01(b))));
  }
})`;

(async () => {
  const dir = process.argv[2];
  const only = process.argv[3];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.png$/i.test(f) && !/-dark\.png$/i.test(f))
    .filter((f) => !only || f.includes(only));
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');

  for (const file of files) {
    const src = path.join(dir, file);
    const out = path.join(dir, file.replace(/\.png$/i, '-dark.png'));
    const b64 = fs.readFileSync(src).toString('base64');
    const result = await page.evaluate(
      async ({ b64, PROCESS }) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const canvas = document.getElementById('c');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const fn = eval(PROCESS);
        const { imageData: processed, unchanged } = fn(imageData);
        ctx.putImageData(processed, 0, 0);
        return { png: canvas.toDataURL('image/png').split(',')[1], unchanged };
      },
      { b64, PROCESS },
    );
    if (result.unchanged) {
      fs.copyFileSync(src, out);
      console.log('copied (already dark)', path.basename(out));
    } else {
      fs.writeFileSync(out, Buffer.from(result.png, 'base64'));
      console.log('wrote', path.basename(out));
    }
  }
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
