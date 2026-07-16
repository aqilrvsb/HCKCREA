// Hard prompt locks appended to the FINAL storyboard image prompt.
//
// These are deliberately NOT part of the planner's system prompt. That prompt
// only instructs the LLM that writes the image prompt — gpt-image-2 itself
// never saw a hard product rule, so it treated the packaging as a design to
// reinterpret. Clients kept reporting the same drift on storyboards even with
// product photos attached: wrong brand colour, different cap/lid colour, warped
// silhouette, re-lettered or invented label text.
//
// Shared by /api/generate/storyboard and .../storyboard/replace so a Tukar
// regenerates under exactly the same lock as the original fire.

/**
 * ABSOLUTE PRODUCT LOCK.
 *
 * Also states WHICH reference images are the product: refImages is ordered
 * avatar-first, so without an explicit index map the model can mistake a
 * presenter photo for the product (or vice versa).
 *
 * Pass the counts ACTUALLY sent to the provider (i.e. after the cap-5 slice),
 * not the counts the user uploaded — a lock pointing at an image that was
 * never attached is worse than no lock at all.
 */
export function productLockRule(avatarCount: number, productCount: number): string {
  if (productCount < 1) return "";
  const first = avatarCount + 1;
  const last = avatarCount + productCount;
  const which =
    productCount === 1
      ? `Reference image ${first} is the PRODUCT`
      : `Reference images ${first}–${last} are the PRODUCT (the SAME product, different angles)`;
  const avatarNote =
    avatarCount > 0
      ? ` Reference image${avatarCount > 1 ? `s 1–${avatarCount} are` : " 1 is"} the presenter's FACE, NOT the product — never blend the two.`
      : "";
  return (
    `\n\nABSOLUTE PRODUCT LOCK — ${which}.${avatarNote} Every frame that shows the product MUST reproduce it EXACTLY as photographed: ` +
    `identical brand colour and colour placement, identical cap/lid colour and shape, identical bottle/tube/jar/pouch silhouette and proportions, ` +
    `identical label artwork and logo, and all label text copied VERBATIM character-for-character in the same font, size and position. ` +
    `Do NOT restyle, recolour, resize, simplify, re-letter, translate, mirror, invent or "improve" any part of the packaging — ` +
    `no alternative colourways, no different cap, no redrawn logo, no substituted or made-up words, no extra badges or stickers. ` +
    `Treat the product as a PHOTOGRAPHIC ASSET to be copied faithfully into each frame, not a design to reinterpret. ` +
    `If a frame cannot render the label sharply and correctly, angle the product away, crop it, or throw it out of focus — ` +
    `NEVER invent text or guess the artwork to fill the gap.`
  );
}
