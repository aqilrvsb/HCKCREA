// @remotion/rounded-text-box for the Laju v2 shim: the TikTok-style white box
// that hugs each caption line with rounded (convex / concave) corners — the
// same corner rules as Remotion's createRoundedTextBox.
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function createRoundedTextBox({ textMeasurements: lines, textAlign, horizontalPadding: pad, borderRadius }) {
  const ins = [];
  let maxWidth = 0;
  for (const l of lines) maxWidth = Math.max(maxWidth, l.width + pad * 2);
  const xOf = (l) => (textAlign === "center" ? (maxWidth - (l.width + pad * 2)) / 2 : textAlign === "right" ? maxWidth - (l.width + pad * 2) : 0);
  const rOf = (diff) => (textAlign === "center" ? diff / 4 : textAlign === "left" ? diff / 2 : 0);
  const rOfL = (diff) => (textAlign === "center" ? diff / 4 : textAlign === "right" ? diff / 2 : 0);
  let y = 0;
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[i - 1], cur = lines[i], next = lines[i + 1];
    const x = xOf(cur);
    const maxR = clamp(borderRadius, 0, cur.height / 2);
    if (i === 0) ins.push(["M", x + maxR, y]);
    const tr = clamp(prev ? (textAlign === "right" ? 0 : rOf(prev.width - cur.width)) : -Infinity, -maxR, maxR);
    const right = x + cur.width + pad * 2;
    if (tr !== 0) {
      ins.push(["L", right + tr, y]);
      ins.push(["A", Math.abs(tr), tr < 0, right, y + Math.abs(tr)]);
    } else ins.push(["L", right, y]);
    const br = clamp(next ? (textAlign === "right" ? 0 : rOf(next.width - cur.width)) : -Infinity, -maxR, maxR);
    if (br !== 0) {
      ins.push(["L", right, y + cur.height - Math.abs(br)]);
      ins.push(["A", Math.abs(br), br < 0, right + br, y + cur.height]);
    } else ins.push(["L", right, y + cur.height]);
    y += cur.height;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const cur = lines[i], below = lines[i + 1], above = lines[i - 1];
    const x = xOf(cur);
    const maxR = clamp(borderRadius, 0, cur.height / 2);
    const bl = clamp(below ? (textAlign === "left" ? 0 : rOfL(below.width - cur.width)) : -Infinity, -maxR, maxR);
    if (bl !== 0) {
      ins.push(["L", x - bl, y]);
      ins.push(["A", Math.abs(bl), bl < 0, x, y - Math.abs(bl)]);
    } else ins.push(["L", x, y]);
    const tl = clamp(above ? (textAlign === "left" ? 0 : rOfL(above.width - cur.width)) : -Infinity, -maxR, maxR);
    if (tl !== 0) {
      ins.push(["L", x, y - cur.height + Math.abs(tl)]);
      ins.push(["A", Math.abs(tl), tl < 0, x - tl, y - cur.height]);
    } else ins.push(["L", x, y - cur.height]);
    y -= cur.height;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const parts = ins.map((c) => {
    const [t] = c;
    const px = t === "A" ? c[3] : c[1], py = t === "A" ? c[4] : c[2];
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    return t === "A" ? `A ${c[1]} ${c[1]} 0 0 ${c[2] ? 1 : 0} ${px} ${py}` : `${t} ${px} ${py}`;
  });
  const w = maxX - minX, hgt = maxY - minY;
  return {
    d: parts.join(" ") + " Z",
    boundingBox: { x1: minX, y1: minY, x2: maxX, y2: maxY, width: w, height: hgt, viewBox: `${minX} ${minY} ${w} ${hgt}` },
  };
}
