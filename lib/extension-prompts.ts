// Extension-exact prompt presets — copied verbatim from
// creative-hack-auto/studio.js. Keeping these in a dedicated file so the
// image tab component stays readable.

// Avatar prompts (10 personas, indexed)
export const AVATAR_PROMPTS = [
  // 0: Young (20s) — Kebaya Elegant
  `A beautiful Malay woman in her mid-20s wearing a soft dusty pink baju kurung kebaya with intricate gold embroidery and lace detailing, paired with a matching mauve hijab. She has smooth glowing skin, natural makeup with soft pink blush, glossy lips, and defined brows. She is smiling gently, showing dimples, with a calm and confident expression.

She is standing in a softly lit elegant indoor setting with a floral backdrop filled with white and blush roses arranged in arches. The background has warm cream tones with subtle drapery, creating a romantic wedding-style atmosphere.

Medium shot, waist-up framing, facing slightly to the side while looking at the camera. Hands gently placed in front of her, relaxed pose.

Lighting is soft, diffused, and warm, with a natural glow highlighting her face and outfit details. Cinematic, high detail, ultra-realistic skin texture, sharp focus, depth of field with slightly blurred floral background.

Style: photorealistic, luxury portrait, bridal fashion photography, high-end editorial, 85mm lens, f/1.8, soft bokeh.`,

  // 1: Young (20s) — Casual Modern
  `A beautiful Malay woman in her early 20s wearing a casual oversized cream cardigan over a simple white top, paired with a soft baby blue chiffon hijab draped loosely. She has fresh dewy skin, minimal natural makeup, soft brown eyes, and a warm genuine smile.

She is sitting casually on a cozy sofa in a modern minimalist living room with soft neutral tones, indoor plants, and warm afternoon sunlight streaming through sheer curtains.

Medium shot, waist-up framing, slightly leaning forward with one hand resting on her knee, relaxed and approachable pose.

Lighting is natural window light, warm and soft, creating gentle shadows. Cinematic, high detail, ultra-realistic skin texture, sharp focus, depth of field with softly blurred cozy interior.

Style: photorealistic, lifestyle portrait, Instagram aesthetic, 50mm lens, f/2.0, warm tones, natural mood.`,

  // 2: Middle Age (35-45) — Baju Kurung
  `A graceful Malay woman in her early 40s wearing a classic emerald green baju kurung with subtle gold thread embroidery along the neckline and sleeves, paired with a matching dark green satin hijab neatly pinned. She has mature warm features, gentle smile lines, defined cheekbones, and a confident motherly expression.

She is standing in a traditional Malay home interior with carved wooden panels, a batik tablecloth visible in the background, and warm tungsten lighting from a traditional lamp.

Medium shot, waist-up framing, standing straight with hands clasped gently in front, poised and dignified pose.

Lighting is warm indoor tungsten mixed with soft daylight from a nearby window, creating rich warm tones. Cinematic, high detail, ultra-realistic skin texture with natural aging, sharp focus, shallow depth of field.

Style: photorealistic, cultural portrait, editorial photography, 85mm lens, f/1.8, warm rich tones.`,

  // 3: Middle Age (35-45) — Kitchen Homely
  `A warm friendly Malay woman in her late 30s wearing a comfortable light blue cotton baju kurung with small floral print, paired with a simple cream jersey hijab. She has a kind motherly face with laugh lines, warm brown eyes, and a big welcoming smile.

She is standing in a bright clean Malaysian kitchen with marble countertop, wooden cabinets, a few cooking ingredients visible, and morning sunlight flooding through the kitchen window.

Medium shot, waist-up framing, one hand resting on the countertop, the other gesturing naturally as if talking to camera, warm and inviting pose.

Lighting is bright natural morning light from kitchen window, clean and fresh atmosphere. Cinematic, high detail, ultra-realistic skin texture, sharp focus, depth of field with softly blurred kitchen background.

Style: photorealistic, lifestyle portrait, homely warmth, 50mm lens, f/2.0, bright clean tones, approachable mood.`,

  // 4: Nenek (55+) — Warm
  `A lovely elderly Malay grandmother (nenek) in her late 60s wearing a traditional loose batik baju kurung in soft purple and gold floral pattern, paired with a neatly folded cream cotton tudung bawal. She has gentle wrinkled skin with warm undertones, kind crinkled eyes, silver-streaked hair peeking from under her tudung, and a loving warm smile showing natural laugh lines.

She is sitting comfortably in a traditional wooden Malay house interior with woven mengkuang mats, old family photos on the wall, and soft warm afternoon light.

Medium close-up, head and shoulders framing, looking directly at camera with a gentle knowing expression, hands folded in her lap.

Lighting is warm golden afternoon light, creating a nostalgic cozy atmosphere. Cinematic, high detail, ultra-realistic aged skin texture with natural wrinkles and spots, sharp focus, shallow depth of field.

Style: photorealistic, emotional portrait, documentary style, 85mm lens, f/1.8, warm golden tones, sentimental mood.`,

  // 5: Nenek (55+) — Garden
  `A cheerful elderly Malay grandmother in her early 60s wearing a comfortable loose turquoise baju kurung with simple stripe pattern, paired with a light grey cotton hijab. She has a round friendly face with deep smile wrinkles, bright expressive eyes, and a joyful toothy smile showing genuine happiness.

She is standing in a lush green Malaysian garden with tropical plants, bunga raya (hibiscus) flowers, and a small vegetable patch visible behind her. Morning dew still visible on leaves.

Medium shot, waist-up framing, one hand raised in a gentle wave, the other holding a small potted herb plant, energetic and lively pose.

Lighting is fresh morning outdoor light, bright and clear with soft green reflections from surrounding foliage. Cinematic, high detail, ultra-realistic aged skin, sharp focus, depth of field with lush blurred garden.

Style: photorealistic, outdoor portrait, vibrant nature, 50mm lens, f/2.0, fresh green tones, joyful mood.`,

  // 6: Young Male (20s) — Baju Melayu
  `A handsome Malay man in his mid-20s wearing a classic navy blue baju Melayu with gold songket sampin, paired with a matching songkok. He has a sharp jawline, clean-shaven face, warm brown skin, defined brows, and a confident charming smile.

He is standing in a softly lit modern Malay interior with wooden accents, subtle Islamic geometric patterns on the wall, and warm ambient lighting.

Medium shot, waist-up framing, standing tall with arms relaxed by his sides, confident and approachable pose.

Lighting is warm and soft, with studio-quality highlights on his face and outfit details. Cinematic, high detail, ultra-realistic skin texture, sharp focus, depth of field with slightly blurred interior background.

Style: photorealistic, fashion portrait, editorial, 85mm lens, f/1.8, warm tones.`,

  // 7: Young Male (20s) — Casual
  `A friendly Malay man in his early 20s wearing a simple white cotton henley shirt with sleeves rolled up, relaxed fit. He has a youthful face, short neat hair, light stubble, warm genuine smile, and bright expressive eyes.

He is sitting casually on a wooden bench in a modern minimalist cafe with exposed brick wall, indoor plants, and warm afternoon light streaming through large windows.

Medium shot, waist-up framing, one arm resting on the table, leaning slightly forward, relaxed and approachable pose.

Lighting is natural window light, warm and soft with gentle shadows. Cinematic, high detail, ultra-realistic skin texture, sharp focus, depth of field with softly blurred cafe interior.

Style: photorealistic, lifestyle portrait, Instagram aesthetic, 50mm lens, f/2.0, warm natural tones.`,

  // 8: Middle Age Male (35-45) — Professional (Abang Pro)
  `A mature Malay man in his early 40s wearing a smart casual batik shirt in deep maroon with gold motifs, well-fitted. He has a strong face with slight stubble, a few distinguished grey hairs at the temples, warm confident eyes, and a calm assured smile.

He is standing in a modern Malaysian office or home study with bookshelves, framed certificates, and warm desk lamp lighting in the background.

Medium shot, waist-up framing, arms crossed casually, standing with confident posture, professional yet approachable.

Lighting is warm indoor lamp light mixed with soft daylight, creating a professional atmosphere. Cinematic, high detail, ultra-realistic skin texture with natural aging, sharp focus, shallow depth of field.

Style: photorealistic, professional portrait, editorial, 85mm lens, f/1.8, warm rich tones.`,

  // 9: Pakcik (55+) — Warm
  `A kind elderly Malay man (pakcik) in his early 60s wearing a comfortable loose light brown baju Melayu with simple kain pelikat, paired with a white kopiah. He has a weathered friendly face with deep smile lines, warm crinkled eyes, grey stubble, and a genuine fatherly smile.

He is sitting on the verandah of a traditional wooden kampung house with potted plants, a rattan chair, and soft golden afternoon light.

Medium close-up, head and shoulders framing, looking directly at camera with a gentle knowing expression, one hand resting on his knee.

Lighting is warm golden afternoon light, creating a nostalgic kampung atmosphere. Cinematic, high detail, ultra-realistic aged skin texture with natural wrinkles, sharp focus, shallow depth of field.

Style: photorealistic, emotional portrait, documentary style, 85mm lens, f/1.8, warm golden tones, sentimental mood.`,
];

// Livehost Avatar tab — hardcoded host-pose prompts for the live-commerce
// talking-head avatar, grouped by gender + pose (sit / stand). Each entry is a
// picker chip that fills the prompt box.
export type AvatarPosePreset = { label: string; pose: "sit" | "stand"; val: string };

export const LIVEHOST_AVATAR_MALE: AvatarPosePreset[] = [
  { label: "20s · polo", pose: "sit", val: `Photorealistic studio portrait of a Malaysian Malay man in his mid 20s, modern short hairstyle, sitting on a chair behind a clean white desk like a live-stream product review host, hands resting on the desk, perfectly frontal symmetrical pose like a TV news anchor, both shoulders squared to the camera, face looking dead-center into the lens, friendly energetic smile, casual smart polo shirt, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "40s · biz casual", pose: "sit", val: `Photorealistic studio portrait of a Malaysian Malay man in his mid 40s, neat short hair, sitting on a chair behind a clean white desk like a live-stream product review host, hands resting on the desk, perfectly frontal symmetrical pose, both shoulders squared to the camera, face looking dead-center into the lens, trustworthy warm smile, business casual shirt, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "55 · songkok", pose: "stand", val: `Photorealistic studio portrait of a Malaysian Malay man around 55 years old, grey-streaked hair, wearing a songkok and baju melayu, standing in a perfectly frontal symmetrical pose like a TV news anchor, both shoulders squared and equally visible to the camera, no body turn, face looking dead-center into the lens, warm wise smile, half-body, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "30s · beard", pose: "stand", val: `Photorealistic studio portrait of a Malaysian Malay man in his mid 30s, short black hair with neat beard, standing in a perfectly frontal symmetrical pose like a TV news anchor, both shoulders squared and equally visible to the camera, no body turn, face looking dead-center into the lens, warm professional smile, business shirt, half-body, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "20s · casual", pose: "stand", val: `Photorealistic studio portrait of a Malaysian Malay man in his early 20s, short neat black hair, standing in a perfectly frontal symmetrical pose like a TV news anchor, both shoulders squared and equally visible to the camera, no body turn, face looking dead-center into the lens, friendly confident smile, smart casual shirt, half-body, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
];

export const LIVEHOST_AVATAR_FEMALE: AvatarPosePreset[] = [
  { label: "20s · cardigan", pose: "sit", val: `A beautiful Malay woman in her early 20s wearing a casual oversized cream cardigan over a simple white top, paired with a soft baby blue chiffon hijab draped loosely. She has fresh dewy skin, minimal natural makeup, soft brown eyes, and a warm genuine smile.

She is sitting casually on a cozy sofa in a modern minimalist living room with soft neutral tones, indoor plants, and warm afternoon sunlight streaming through sheer curtains.

Medium shot, waist-up framing, slightly leaning forward with one hand resting on her knee, relaxed and approachable pose.

Lighting is natural window light, warm and soft, creating gentle shadows. Cinematic, high detail, ultra-realistic skin texture, sharp focus, depth of field with softly blurred cozy interior.

Style: photorealistic, lifestyle portrait, Instagram aesthetic, 50mm lens, f/2.0, warm tones, natural mood.` },
  { label: "50s · no hijab", pose: "sit", val: `Photorealistic studio portrait of a Malaysian Malay woman around 50 years old without hijab, neat short hair, sitting on a chair behind a clean white desk like a live-stream product review host, hands resting on the desk, perfectly frontal symmetrical pose like a TV news anchor, both shoulders squared to the camera, face looking dead-center into the lens, kind motherly smile, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "30s · no hijab", pose: "sit", val: `Photorealistic studio portrait of a Malaysian Malay woman in her late 30s without hijab, shoulder-length hair, sitting on a chair behind a clean white desk like a live-stream product review host, hands resting on the desk, perfectly frontal symmetrical pose like a TV news anchor, both shoulders squared to the camera, face looking dead-center into the lens, professional warm smile, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "20s · no hijab", pose: "sit", val: `Photorealistic studio portrait of a Malaysian Malay woman in her mid 20s without hijab, long dark hair, sitting on a chair behind a clean white desk like a live-stream product review host, hands resting on the desk, perfectly frontal symmetrical pose like a TV news anchor, both shoulders squared to the camera, face looking dead-center into the lens, warm smile, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "40s · hijab", pose: "sit", val: `Photorealistic studio portrait of a Malaysian Malay woman in her late 40s wearing a charcoal grey hijab, sitting on a chair behind a clean white desk like a live-stream product review host, hands resting on the desk, body and face facing directly straight toward the camera, kind warm smile, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "30s · hijab", pose: "sit", val: `Photorealistic studio portrait of a Malaysian Malay woman in her mid 30s wearing a teal hijab, sitting on a chair behind a clean white desk like a live-stream product review host, hands resting on the desk, body and face facing directly straight toward the camera, confident professional smile, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "20s · hijab", pose: "sit", val: `Photorealistic studio portrait of a Malaysian Malay woman in her mid 20s wearing a soft peach hijab, sitting on a chair behind a clean white desk like a live-stream product review host, hands resting on the desk, body and face facing directly straight toward the camera, warm friendly smile, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "20s · long hair", pose: "stand", val: `Photorealistic studio portrait of a Malaysian Malay woman in her early 20s without hijab, long black hair, standing in a perfectly frontal symmetrical pose like a TV news anchor, both shoulders squared and equally visible to the camera, no body turn, face looking dead-center into the lens, bright cheerful smile, smart casual outfit, half-body, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "30s · blouse", pose: "stand", val: `Photorealistic studio portrait of a Malaysian Malay woman in her mid 30s without hijab, shoulder-length dark hair, standing upright half-body, body and face facing directly straight toward the camera, elegant professional smile, business blouse, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
  { label: "20s · upright", pose: "stand", val: `Photorealistic studio portrait of a Malaysian Malay woman in her early 20s without hijab, long black hair, standing upright half-body, body and face facing directly straight toward the camera, bright cheerful smile, smart casual outfit, plain solid light grey studio background, soft even lighting, ultra realistic, high detail` },
];

// Product prompts (7 backdrops)
export const PRODUCT_PROMPTS = [
  // 0: Smoke Rock
  `The product floats perfectly still at the center of the frame on a rustic driftwood pedestal. Surrounding it are dark volcanic rocks and dried botanical elements. Ethereal wisps of smoke rise gracefully from behind the rocks, curling upward. Background is deep teal gradient, moody and dramatic. Premium studio lighting from above creates highlights on the product surface and gentle shadows on the rocks. Fresh mint leaves and a halved lemon placed beside the rocks as accent. Ultra sharp focus on the product, 9:16 vertical, commercial photography, premium luxury aesthetic, dark mood, high contrast, 85mm lens, f/2.8.`,

  // 1: Floating Wood
  `The product is floating weightlessly at a slight angle in the center of the frame, as if suspended in air. A piece of aged tree bark curves beneath it, also floating. White orchid flowers and a vanilla pod drift around the product. Small particles and fragments of spice scatter dynamically through the air. Background is warm golden brown gradient, smooth and clean. Dramatic studio lighting with warm golden tones. Ultra sharp product detail, every label text readable. 9:16 vertical, luxury product photography, levitation effect, premium editorial, high-end commercial, 100mm macro lens.`,

  // 2: Burst Spice
  `The product is centered and floating against a rich warm orange gradient background. An explosion of natural ingredients bursts outward from behind the product — green leaves, dried bark fragments, crushed spices, small nuts, and botanical elements flying dynamically in all directions. Dramatic motion blur on flying elements, ultra sharp focus on the product itself. Warm dramatic studio lighting from the side. Premium luxury commercial photography, dynamic energy, high contrast, vibrant colors, 9:16 vertical, 85mm lens, f/2.0.`,

  // 3: Moss Garden
  `The product is nestled into a bed of thick, soft green moss, viewed from a slightly elevated angle. Tiny wildflowers, clover leaves, and delicate ferns grow naturally around the product. Small dewdrops visible on the moss and product surface. Background is shallow depth of field showing more lush greenery, creating a dreamy natural garden scene. Soft diffused daylight filtering through, creating dappled light patterns. Fresh, organic, botanical aesthetic. 9:16 vertical, nature product photography, editorial beauty, macro detail, 90mm lens, f/2.0, green tones.`,

  // 4: Water Drop
  `The product is floating elegantly in the center of the frame, surrounded by large crystal-clear water droplets and bubbles of various sizes, also floating weightlessly. Background is soft mint green gradient, clean and refreshing. The product surface has fine water condensation droplets. Light refracts beautifully through the water bubbles creating rainbow prisms. Bottom of frame shows a reflective wet surface. Premium studio lighting, clean and bright. 9:16 vertical, cosmetic commercial photography, fresh aquatic mood, ultra clean, high detail, 100mm macro lens.`,

  // 5: Stone Leaf
  `The product stands upright on a smooth natural river stone, slightly wet with water droplets on the stone surface. Fresh green centella asiatica (pegaga) leaves with visible veins are arranged naturally around the base. Clean white minimalist background with soft shadows. Morning sunlight creates a gentle glow from the left side. Water droplets on the stone catch and reflect light. Clean, premium, organic skincare aesthetic. 9:16 vertical, beauty product photography, minimalist botanical, editorial clean, 85mm lens, f/2.8, bright natural tones.`,

  // 6: Mist Powder
  `The product stands boldly on top of a textured natural powder mound or fine sand hill. Thick atmospheric mist and fog swirl around the base and behind the product, creating a mysterious ethereal mood. Background is a rich saturated color gradient matching the product's brand color. Dramatic underlighting creates a glow through the mist from below. The product is crystal clear and sharp against the soft foggy atmosphere. Cinematic, moody, premium beauty aesthetic. 9:16 vertical, luxury cosmetic photography, atmospheric fog, dramatic lighting, 85mm lens, f/2.0.`,
];

// Soft Sell Facebook ad prompt
export const SOFT_SELL_PROMPT = `Create a high-converting soft-sell Facebook advertising poster WITHOUT showing any product.

---

PRIMARY GOAL:
Trigger curiosity, emotion, and relatability to make viewers stop scrolling and want to learn more.

---

VISUAL STYLE:
- Clean, minimal, premium design
- Soft lighting, warm tones
- Lifestyle or symbolic scene (NOT product-based)
- Cinematic, emotional atmosphere

---

SCENE IDEAS (choose ONE):
- Child studying calmly with focus
- Peaceful study desk setup (books, pencil, soft light)
- Before/after concept (blur → clear focus)
- Parent observing child quietly with relief (optional silhouette, not face-focused)
- Symbolic visual (glowing brain, light bulb, clarity effect)

---

EMOTIONAL DIRECTION:
- Calm
- Hopeful
- Reassuring
- Subtle transformation

---

TEXT STRUCTURE:

Headline (curiosity-driven):
"[e.g. Kenapa Ada Anak Lebih Mudah Fokus?]"

Subheadline:
"[e.g. Ramai ibu bapa dah mula nampak perubahan ini]"

Soft CTA:
"Ketahui Lebih Lanjut"

---

DESIGN RULES:
- Strong visual hierarchy
- Large readable headline
- Plenty of negative space
- Max 2–3 colors
- No clutter, no aggressive elements

---

PSYCHOLOGY:
- Curiosity gap (no clear answer shown)
- Relatability (parent situation)
- Subtle promise (improvement possible)

---

QUALITY:
- Photorealistic or cinematic illustration
- High-end advertising style
- 4K, sharp, clean

---

CONSTRAINTS:
- DO NOT show product
- DO NOT include price or promotion
- DO NOT use hard-sell elements
- Keep it subtle and intriguing

---

OUTPUT:
- Feels like a story, not an ad
- Makes people stop and think
- Encourages clicks out of curiosity`;

// Hard Sell Facebook ad prompt
export const HARD_SELL_PROMPT = `Create a scroll-stopping HARD SELL Facebook ad poster using the two reference images.

REFERENCE MAPPING (STRICT):
- IMAGE 1 = the model/character. Keep her EXACT face, skin tone, hijab style, color, fabric, and outfit. Do not age her up, slim her down, or change ethnicity. Match lighting warmth to her original photo.
- IMAGE 2 = the product packaging. Reproduce the packaging 1:1 — every letter, logo, color, illustration, and shape must match the reference EXACTLY. No guessed text, no warped labels, no re-designed packaging. Treat it like a real product photo composited into the poster.

CANVAS & FORMAT:
- 9:16 vertical poster (mobile-first Facebook / TikTok / Instagram Reels feed)
- 1080x1920 safe area, nothing critical touches the edges
- Image must read clearly at thumbnail size (stop the scroll in <1 second)

LAYOUT (TOP TO BOTTOM, Z-ORDER):
1. BACKGROUND BAND (top 15%): solid bold color block (red, orange, or yellow) with subtle comic-style burst rays behind the headline. This is the "attention layer".
2. HEADLINE (top 15-30%): HUGE bold sans-serif Malay headline. ALL CAPS. Max 6 words. Slight outline or drop shadow for pop. Example placeholder: "[PAIN HOOK — e.g. PEDAS TAPI TAK PUAS?]"
3. CHARACTER (30-65%): the model from IMAGE 1, cut out cleanly, facing 3/4 toward the product. Expression: excited, shocked, or mouth-watering reaction. Natural hand gesture pointing or reaching toward the product. Realistic contact shadow under her.
4. PRODUCT HERO (55-80%): the packaging from IMAGE 2, large, tilted 5-10 degrees dynamic, with a soft glow halo behind it. Product must be the visual anchor — at least 35% of the poster height. Sharp, punchy, premium lighting. Realistic reflection / floor shadow.
5. BENEFIT BADGES (around character + product): 3 small rounded pill or starburst badges with short Malay benefits. Examples: "[Benefit 1 — e.g. 100% HALAL]", "[Benefit 2 — e.g. PEDAS GILA]", "[Benefit 3 — e.g. READY STOCK]". Yellow fill, black text, red outline.
6. PROMO BURST (right side near product): comic-style starburst badge. Red fill, yellow text. Short promo. Example placeholder: "[PROMO — e.g. 3 PEKET RM50]" or "[DISCOUNT — e.g. JIMAT 40%]".
7. CTA BAR (bottom 10-15%): solid red or black bar, full width, bold white text. Example placeholder: "[CTA — e.g. ORDER SEKARANG!]" with a small arrow icon or "Klik Shop" button mock.

TEXT RULES (CRITICAL — GPT IMAGE 2 MUST RENDER LEGIBLE TEXT):
- Headline, subheadline, badges, promo, and CTA text MUST be sharp, legible, correctly spelled Malay.
- Font: bold geometric sans-serif (Montserrat / Poppins / Bebas Neue style). NEVER handwritten, NEVER decorative script.
- Letter spacing: tight on headlines, normal on benefits.
- Max 3 font sizes total across the whole poster.
- NO made-up words, NO garbled letters, NO partial text overlays. If you cannot render a word cleanly, simplify it.
- Keep all real product packaging text EXACTLY as IMAGE 2 shows (brand name, weight, logo, certifications).

COLOR SYSTEM (HARD SELL STANDARD — MAX 4 COLORS):
- Primary: bold red (#E31E24 or similar)
- Accent: bright yellow (#FFD600)
- Support: deep black for text
- Neutral: white or cream for breathing room
- No pastels. No muted tones. No gradients softer than 70% contrast.

PSYCHOLOGY STACK (BAKE IN, DON'T LIST):
- PAIN: headline names the problem the buyer already feels.
- DESIRE: character's face shows the emotional payoff after using the product.
- PROOF: benefit badges = instant credibility.
- URGENCY: promo burst + CTA drive now-or-never action.
- TRUST: relatable local Malaysian aunty/makcik/abang vibe, not generic Western model.

VISUAL QUALITY:
- 4K photorealistic compositing with editorial ad-poster polish.
- Character and product must look like they belong in the same scene (matched lighting, shared shadows on the same floor plane).
- Subtle paper / print texture optional. NO heavy filter, NO Instagram preset look.

ABSOLUTE CONSTRAINTS (DO NOT VIOLATE):
- DO NOT redesign or retype the product packaging — use IMAGE 2 as-is.
- DO NOT change the model's hijab style, face shape, or skin tone from IMAGE 1.
- DO NOT add a second person, a second product, or background characters.
- DO NOT leave placeholder words like "HEADLINE" or "[CTA]" in the final render — replace them with real Malay copy before rendering.
- DO NOT clutter: max 1 headline + 1 subheadline + 3 badges + 1 promo + 1 CTA. That is the ceiling.
- DO NOT render Latin lorem ipsum, fake logos, watermarks, or social media UI overlays.

OUTPUT:
A finished, print-ready Malaysian Facebook hard-sell poster that looks like a top-spending winning ad in the Ads Library — stops the scroll in <1 second, communicates offer in <3 seconds, and converts on mobile feed.`;

// Virtualize example — recreate poster with new product
export const VIRT_EXAMPLE_PROMPT = `Recreate the uploaded poster with pixel-perfect accuracy.

STRICT INSTRUCTIONS:
- Keep EXACT layout, composition, spacing, and alignment
- Keep EXACT background, colors, gradients, and visual effects
- Keep EXACT typography style, size, and text positions
- Keep ALL elements (badges, shapes, decorations) in the SAME position
- Maintain original visual hierarchy and proportions

ONLY CHANGE:
1. Replace the original product with the provided product image
2. Replace all text with new content if specified

---

PRODUCT REPLACEMENT RULES:
- Match the original product's position exactly
- Match scale and size proportion
- Match camera angle and perspective
- Match lighting direction and intensity
- Add realistic shadows and reflections
- Blend naturally into the scene (NO cut-paste look)

---

TEXT RULES:
- Keep same font style and layout
- Only change wording, NOT design

---

STRICT CONSTRAINTS:
- DO NOT redesign anything
- DO NOT move elements
- DO NOT simplify or enhance
- DO NOT change layout structure
- DO NOT add new elements

---

OUTPUT:
- Must look like the SAME advertisement design
- Only product and text are different
- Clean, sharp, professional Facebook ad quality`;

// Edit-image default negative prompt — used when user opens edit modal
export const EDIT_NEGATIVE_PROMPT = `

🚫 Negative Prompt (VERY IMPORTANT)
extra hands, extra fingers, deformed hands, mutated fingers, bad anatomy, blurry, low quality, duplicate limbs, poorly drawn hands, distorted face, unrealistic proportions, extra arms, cropped hands, missing fingers`;

// Chip metadata — labels, colors per persona index (matches extension's
// pink/purple/orange/blue/teal/brown coloring)
export const AVATAR_LABELS = [
  { idx: 0, label: "Kebaya 20s", color: "#e91e63" },
  { idx: 1, label: "Casual 20s", color: "#e91e63" },
  { idx: 2, label: "Makcik", color: "#9c27b0" },
  { idx: 3, label: "Kitchen", color: "#9c27b0" },
  { idx: 4, label: "Nenek", color: "#ff9800" },
  { idx: 5, label: "Nenek Garden", color: "#ff9800" },
  { idx: 6, label: "Baju Melayu 20s", color: "#2196f3" },
  { idx: 7, label: "Casual 20s", color: "#2196f3", male: true },
  { idx: 8, label: "Abang Pro", color: "#009688" },
  { idx: 9, label: "Pakcik", color: "#795548" },
];

export const PRODUCT_LABELS = [
  { idx: 0, label: "Smoke Rock", color: "#00bcd4" },
  { idx: 1, label: "Floating Wood", color: "#795548" },
  { idx: 2, label: "Burst Spice", color: "#ff9800" },
  { idx: 3, label: "Moss Garden", color: "#4caf50" },
  { idx: 4, label: "Water Drop", color: "#2196f3" },
  { idx: 5, label: "Stone Leaf", color: "#9c27b0" },
  { idx: 6, label: "Mist Powder", color: "#009688" },
];
