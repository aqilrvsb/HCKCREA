import type { Skill } from "../../types";

export const sceneStreetVoxPop: Skill = {
  id: "street-vox-pop",
  kind: "scene",
  tab: "ugc",
  title: "Street Vox Pop — Mall/Pasar/Mamak Social Proof Interview",
  triggers: ["vox pop", "street interview", "social proof", "testimonial", "public opinion", "mall", "pasar", "street", "random people", "interview"],
  body: `# Street Vox Pop Scene

**Best for:** products needing third-party social proof — supplements, food, skincare, fashion, any product where "stranger approves" is more credible than creator endorsement alone.
**Best persona:** casual-bestie (as interviewer), mak-cik-converter (as subject), chinese-malaysian-codeswitcher (for multi-ethnic social proof).
**Best voice:** callirrhoe (female mid neutral interviewer), achird (male warm interviewer), gacrux (male hype VO for transitions).

## Setting block (paste into prompt body)
"Malaysian mall concourse, pasar malam, or mamak exterior — daytime or early evening. Natural foot-traffic visible but not crowd-dense. Natural ambient light from mall ceiling or overcast outdoor. Creator holds product/phone as mic. Interviewee is a passing real-seeming person (different ethnicity, age group from creator ideally — multi-ethnic MY social proof)."

## Camera + framing
- Selfie handheld: creator holds phone at arm's length, both creator and interviewee in frame (selfie-duo angle).
- Side-by-side medium close-up: creator left, interviewee right — interview panel feel.
- Occasional cutaway to product held between them.
- 9:16 vertical. 24mm wide (fits two people), natural ambient light, slight handheld movement = authentic reportage.

## Lighting
"Available ambient light only — mall artificial overhead or natural overcast outdoor. No fill light (would signal planned/staged). If indoor mall: cool fluorescent 4000K. If outdoor: overcast natural 5500K. Dark/underlit = authenticity kill — choose well-lit mall area."

## Action beats (8s)
- 0–2s: Creator addresses camera mid-walk: "Korang, aku nak tanya orang pasal [PRODUCT] ni — jom." Turns to find interviewee.
- 2–5s: Creator shows interviewee the product. Interviewee reacts — examines, smells, reads label. Brief back-and-forth exchange.
- 5–7s: Interviewee gives verdict. Creator holds product to camera. Reaction captured — genuine approval, curiosity, or converted interest.
- 7–8s: Creator back to camera. Quick CTA. Walk-away shot (creator continues through crowd).

## Dialog patterns (Malay/EN code-switch)
**Hook (0-2s, creator to camera):**
- "Korang, jap — aku nak test public reaction untuk [PRODUCT] ni. Tengok."
- "Eh, tadi aku tanya random orang pasal ni — korang kena tengok respond dia."
- "5 orang aku tanya hari ni — 5 orang cakap perkara yang sama."

**Interview core (2-5s, natural exchange):**
- Creator: "Akak/abang dah pernah try [PRODUCT] ni?" → Interviewee: "Belum lagi, tapi nampak interesting ah."
- Creator: "Cuba bau/cuba tengok — first impression macam mana?" → Interviewee: "Wah, sedap gila bau dia. Nak mana beli ni?"
- Creator: "Korang nak try? Aku ada satu lagi ni." → Interviewee: "Serious? Eh, boleh la."

**Outro (7-8s, creator to camera):**
- "Tu la — orang pun setuju. Tekan beg kuning, korang."
- "Bukan aku sorang cakap. Tengok sendiri — link in bio."
- "Random orang pun tertarik, korang lagi la kena try."

## Audio (5-layer)
- Dialogue: TWO voices — creator + interviewee. Creator voice primary, interviewee voice slightly ambient-mixed.
- SFX: "footstep ambience, product hand-off, paper/packaging rustle, distant mall announcement".
- Ambience: "mall/pasar crowd — continuous foot traffic hum, background conversations, escalator sound, food court distant".
- Music: none during interview. Optional trending 2-bar bridge between cuts.
- Negatives: "no studio sound, no controlled environment feel, no laugh track".

## Veo prompt skeleton
"Selfie POV handheld, 24mm wide, natural handheld movement. <PERSONA_DESCRIPTOR> in busy Malaysian mall, turns from camera to approach random shopper. Shows <PRODUCT> to interviewee — interviewee examines product, reacts with approval. Creator turns back to camera. He/She says: '<HOOK_LINE>'. Available mall ambient overhead light 4000K. SFX: mall footsteps, product hand-off. Ambience: mall crowd hum, distant chatter. Voice direction: <VOICE_ID>. 9:16."

## Common failure modes + fixes
- Interviewee looks planted/staged → "interviewee: different outfit style, age, ethnicity from creator — diverse social proof".
- Mall too empty → "busy concourse — foot traffic continuously moving behind both people in frame".
- Interview too scripted → "creator asks open question, cuts to answer mid-sentence — raw, not polished".
- Sound muddy with crowd → "clip-on lav mic on creator coat — clear voice over mall ambience".
- Legal concern (filming strangers) → specify "clearly consented participants" or "simulated documentary style".

## Persona + voice fit
- **casual-bestie** + callirrhoe: most approachable interviewer — disarming, playful, people open up.
- **mak-cik-converter as interviewee**: if the interviewee is an older woman who converts on camera — extremely high trust moment.
- **chinese-malaysian-codeswitcher**: multi-ethnic interview format — code-switching between BM/Mandarin/EN = authentic MY social proof.

## Cultural notes
- Multi-ethnic casting: show Malay + Chinese + Indian interviewees across series — signals universal appeal.
- Malaysian street interview culture: Malaysians are generally warm to camera — not as reserved as Singapore. Mamak and pasar settings are most cooperative.
- Halal check: if interviewee is Muslim, product must appear halal — don't hand pork/alcohol-adjacent product to visibly Muslim interviewee.
- Ramadan: pasar Ramadan = perfect vox pop setting — high foot traffic, communal buying mood, product discovery mindset.
- Merdeka/Malaysia Day: national celebration backdrop + multi-ethnic cast = powerful brand alignment opportunity.
`,
};
