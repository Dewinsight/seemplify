// Recreates dark-mode versions of the product screenshots.
// usage: node scripts/darken-screenshots.js public/images/product-showcases
// Needs the Playwright install under recruiter/frontend (uses the installed Chrome).
// Neutral pixels (page whites, greys, dark text) have their lightness inverted into
// the site's dark palette with the hue kept; saturated fills keep their colour; light
// marks sitting on saturated fills (button labels, header bands) are left alone.
// Output: <name>-dark.png beside each <name>.png
const { chromium } = require(require('path').join(__dirname, '../../recruiter/frontend/node_modules/@playwright/test'));
const fs = require('fs');
const path = require('path');

const PROCESS = `
(function (imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const chroma = new Float32Array(n);
  const light = new Float32Array(n);
  const fill = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    chroma[i] = max - min;
    light[i] = (max + min) / 2;
    fill[i] = chroma[i] >= 0.25 && light[i] > 0.2 && light[i] < 0.8 ? 1 : 0;
  }

  // Grow the saturated-fill mask so anything drawn on a button or band is treated as "on a fill".
  const radius = 3;
  const near = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!fill[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= width) continue;
          near[yy * width + xx] = 1;
        }
      }
    }
  }

  const setLightness = (i, targetL) => {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    const L = light[i];
    let nr, ng, nb;
    if (L < 0.02 || chroma[i] < 0.02) {
      nr = ng = nb = targetL;
    } else {
      const k = targetL / L;
      nr = r * k; ng = g * k; nb = b * k;
      const m = Math.max(nr, ng, nb);
      if (m > 1) { nr /= m; ng /= m; nb /= m; }
    }
    // Dark results take on the site's violet-black cast.
    const cast = Math.max(0, 1 - targetL * 2);
    data[i * 4] = Math.round(255 * Math.min(1, nr + 0.012 * cast));
    data[i * 4 + 1] = Math.round(255 * Math.max(0, ng - 0.006 * cast));
    data[i * 4 + 2] = Math.round(255 * Math.min(1, nb + 0.04 * cast));
  };

  for (let i = 0; i < n; i++) {
    const c = chroma[i], L = light[i];
    if (fill[i]) continue;                         // saturated fill: keep
    if (near[i] && L > 0.45) continue;             // light mark on a fill: keep
    const neutral = c < 0.12 || (L < 0.35 && c < 0.32) || (L > 0.7 && c < 0.2);
    if (neutral) {
      let target = 0.075 + (1 - L) * 0.85;
      if (L > 0.985) target = 0.09;                // page white -> dark surface
      setLightness(i, target);
    } else if (L > 0.7) {
      setLightness(i, 0.16 + (1 - L) * 0.55);      // pale tinted surface -> dark tinted surface
    } else if (L < 0.3) {
      setLightness(i, 0.52);                        // dark saturated mark -> readable on dark
    }
  }
  return imageData;
})`;

(async () => {
  const dir = process.argv[2];
  const files = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f) && !/-dark\.png$/i.test(f));
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');

  for (const file of files) {
    const src = path.join(dir, file);
    const out = path.join(dir, file.replace(/\.png$/i, '-dark.png'));
    const b64 = fs.readFileSync(src).toString('base64');
    const result = await page.evaluate(async ({ b64, PROCESS }) => {
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
      ctx.putImageData(fn(imageData), 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { b64, PROCESS });
    fs.writeFileSync(out, Buffer.from(result, 'base64'));
    console.log('wrote', path.basename(out));
  }
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
