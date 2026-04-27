// Central skill registry — every skill in the library is imported and
// added to allSkills. Adding a new skill = create the file + add the
// import here.

import type { Skill } from "./types";

// ── UGC SCENES ─────────────────────────────────────────────────────────
import { sceneKitchenSambal } from "./ugc/scenes/kitchen-sambal";
import { sceneGymSupplement } from "./ugc/scenes/gym-supplement";
import { sceneInCarDrivingCta } from "./ugc/scenes/in-car-driving-cta";
import { sceneMukbangFood } from "./ugc/scenes/mukbang-food";
import { sceneOfficeVitamin } from "./ugc/scenes/office-vitamin";
import { sceneCafeAspirational } from "./ugc/scenes/cafe-aspirational";
import { sceneConfessionStorytime } from "./ugc/scenes/confession-storytime";
import { sceneStopMotionClay } from "./ugc/scenes/stop-motion-clay";
import { sceneBeachSunset } from "./ugc/scenes/beach-sunset";
import { sceneMomMorningRoutine } from "./ugc/scenes/mom-morning-routine";
import { sceneFoodieReaction } from "./ugc/scenes/foodie-reaction";
import { sceneAsmrProduct } from "./ugc/scenes/asmr-product";
import { sceneTalkingProduct3d } from "./ugc/scenes/talking-product-3d";
import { sceneVintageVhsUnbox } from "./ugc/scenes/vintage-vhs-unbox";
import { sceneGrwm } from "./ugc/scenes/grwm";
import { sceneBeforeAfterSkin } from "./ugc/scenes/before-after-skin";
import { sceneUnboxing } from "./ugc/scenes/unboxing";
import { scenePovDateNight } from "./ugc/scenes/pov-date-night";
import { sceneStreetVoxPop } from "./ugc/scenes/street-vox-pop";
import { sceneCommentResponse } from "./ugc/scenes/comment-response";
import { sceneVirtualTryOn } from "./ugc/scenes/virtual-try-on";
import { sceneTutorialHowTo } from "./ugc/scenes/tutorial-how-to";
import { sceneHyperMotionProduct } from "./ugc/scenes/hyper-motion-product";
import { sceneDocumentaryVox } from "./ugc/scenes/documentary-vox";

// ── UGC PERSONAS ───────────────────────────────────────────────────────
import { personaUrbanHijabiBestie } from "./ugc/personas/urban-hijabi-bestie";
import { personaIbuMuda } from "./ugc/personas/ibu-muda";
import { personaGymBro } from "./ugc/personas/gym-bro";
import { personaChineseMalaysianCodeswitcher } from "./ugc/personas/chinese-malaysian-codeswitcher";
import { personaSkepticConverted } from "./ugc/personas/skeptic-converted";
import { personaMakCikConverter } from "./ugc/personas/mak-cik-converter";
import { personaCasualBestie } from "./ugc/personas/casual-bestie";
import { personaPolishedPro } from "./ugc/personas/polished-pro";
import { personaComedicFoodie } from "./ugc/personas/comedic-foodie";
import { personaConfessionalIntimate } from "./ugc/personas/confessional-intimate";
import { personaInspirationalSoft } from "./ugc/personas/inspirational-soft";
import { personaEducationalExpert } from "./ugc/personas/educational-expert";
import { personaProductWhisperer } from "./ugc/personas/product-whisperer";
import { personaPiousReligiousTone } from "./ugc/personas/pious-religious-tone";

// ── UGC HOOKS ──────────────────────────────────────────────────────────
import { hookPainConfession } from "./ugc/hooks/pain-confession";
import { hookPov } from "./ugc/hooks/pov";
import { hookConfession } from "./ugc/hooks/confession";
import { hookNumber } from "./ugc/hooks/number";
import { hookComparison } from "./ugc/hooks/comparison";
import { hookDont } from "./ugc/hooks/dont";
import { hookRoastHotTake } from "./ugc/hooks/roast-hot-take";
import { hookInsider } from "./ugc/hooks/insider";
import { hookRedFlag } from "./ugc/hooks/red-flag";
import { hookProblemQualification } from "./ugc/hooks/problem-qualification";
import { hookRevealSuspense } from "./ugc/hooks/reveal-suspense";
import { hookHandRaise } from "./ugc/hooks/hand-raise";
import { hookEnemy } from "./ugc/hooks/enemy";
import { hookFomoSocialProof } from "./ugc/hooks/fomo-social-proof";

// ── UGC FRAMEWORKS ─────────────────────────────────────────────────────
import { frameworkPas } from "./ugc/frameworks/pas";
import { frameworkAida } from "./ugc/frameworks/aida";
import { frameworkBabExtended } from "./ugc/frameworks/bab-extended";
import { frameworkSss } from "./ugc/frameworks/sss";
import { frameworkPrp } from "./ugc/frameworks/prp";
import { frameworkDrr } from "./ugc/frameworks/drr";
import { frameworkRdr } from "./ugc/frameworks/rdr";
import { frameworkMbt } from "./ugc/frameworks/mbt";
import { frameworkCoi } from "./ugc/frameworks/coi";
import { frameworkIab } from "./ugc/frameworks/iab";
import { frameworkArp } from "./ugc/frameworks/arp";
import { frameworkQah } from "./ugc/frameworks/qah";
import { frameworkCov } from "./ugc/frameworks/cov";
import { frameworkDitl } from "./ugc/frameworks/ditl";
import { frameworkDirectResponse } from "./ugc/frameworks/direct-response";

// ── UGC CTAS ───────────────────────────────────────────────────────────
import { ctaTapBegKuning } from "./ugc/ctas/tap-beg-kuning";
import { ctaUrgency } from "./ugc/ctas/urgency";
import { ctaScarcity } from "./ugc/ctas/scarcity";
import { ctaSocialProof } from "./ugc/ctas/social-proof";
import { ctaCommentTrigger } from "./ugc/ctas/comment-trigger";
import { ctaSaveTrigger } from "./ugc/ctas/save-trigger";
import { ctaShareTrigger } from "./ugc/ctas/share-trigger";
import { ctaIfThen } from "./ugc/ctas/if-then";
import { ctaPermission } from "./ugc/ctas/permission";
import { ctaTryAndShow } from "./ugc/ctas/try-and-show";
import { ctaDemoTap } from "./ugc/ctas/demo-tap";
import { ctaDirectBenefit } from "./ugc/ctas/direct-benefit";

// ── UGC VOICES ─────────────────────────────────────────────────────────
import { voiceAchernar } from "./ugc/voices/achernar";
import { voiceAchird } from "./ugc/voices/achird";
import { voiceAlgenib } from "./ugc/voices/algenib";
import { voiceCallirrhoe } from "./ugc/voices/callirrhoe";
import { voiceCharon } from "./ugc/voices/charon";
import { voiceEnceladus } from "./ugc/voices/enceladus";
import { voiceGacrux } from "./ugc/voices/gacrux";
import { voiceIapetus } from "./ugc/voices/iapetus";

// ── UGC LOCKS ──────────────────────────────────────────────────────────
import { lockAnatomy } from "./ugc/locks/anatomy";
import { lockAudio } from "./ugc/locks/audio";
import { lockProductRef } from "./ugc/locks/product-ref";
import { lockUgcAuthenticity } from "./ugc/locks/ugc-authenticity";
import { lockVisualClean } from "./ugc/locks/visual-clean";
import { lockNegativeBlock } from "./ugc/locks/negative-block";

// ── UGC CULTURAL ───────────────────────────────────────────────────────
import { culturalHalalProducts } from "./ugc/cultural/halal-products";
import { culturalRamadan } from "./ugc/cultural/ramadan";
import { culturalRayaSeason } from "./ugc/cultural/raya-season";
import { culturalReligiousSensitivities } from "./ugc/cultural/religious-sensitivities";
import { culturalCodeSwitch } from "./ugc/cultural/code-switch";

// ── CINEMA DIRECTORS ───────────────────────────────────────────────────
import { directorWongKarWai } from "./cinema/directors/wong-kar-wai";
import { directorVilleneuve } from "./cinema/directors/villeneuve";
import { directorLynch } from "./cinema/directors/lynch";
import { directorShinkai } from "./cinema/directors/shinkai";
import { directorGhibli } from "./cinema/directors/ghibli";
import { directorLeone } from "./cinema/directors/leone";
import { directorRidleyScott } from "./cinema/directors/ridley-scott";

// ── CINEMA CAMERAS ─────────────────────────────────────────────────────
import { cameraDollyIn } from "./cinema/cameras/dolly-in";
import { cameraOrbit } from "./cinema/cameras/orbit";
import { cameraHandheld } from "./cinema/cameras/handheld";
import { cameraDutchAngle } from "./cinema/cameras/dutch-angle";
import { cameraCraneShot } from "./cinema/cameras/crane-shot";
import { cameraTrackingShot } from "./cinema/cameras/tracking-shot";
import { cameraWhipPan } from "./cinema/cameras/whip-pan";
import { cameraDronefpv } from "./cinema/cameras/drone-fpv";
import { cameraBulletTime } from "./cinema/cameras/bullet-time";

// ── CINEMA ERAS ────────────────────────────────────────────────────────
import { era90sVhs } from "./cinema/eras/90s-vhs";
import { era80sNeonSynth } from "./cinema/eras/80s-neon-synth";
import { era60sSpaghettiWestern } from "./cinema/eras/60s-spaghetti-western";
import { era70sCinemaVerite } from "./cinema/eras/70s-cinema-verite";
import { era40sNoir } from "./cinema/eras/40s-noir";

// ── CINEMA FILM STOCKS ─────────────────────────────────────────────────
import { filmStockKodakPortra400 } from "./cinema/film-stocks/kodak-portra-400";
import { filmStockCinestill800t } from "./cinema/film-stocks/cinestill-800t";
import { filmStockFujiVelvia } from "./cinema/film-stocks/fuji-velvia";
import { filmStock35mmAnamorphic } from "./cinema/film-stocks/35mm-anamorphic";

// ── CINEMA MOODS ───────────────────────────────────────────────────────
import { moodNeonNoir } from "./cinema/moods/neon-noir";
import { moodAtmosphericDread } from "./cinema/moods/atmospheric-dread";
import { moodEpicFantasy } from "./cinema/moods/epic-fantasy";
import { moodRomanticIntimate } from "./cinema/moods/romantic-intimate";
import { moodSurrealDream } from "./cinema/moods/surreal-dream";

// ── CINEMA TECHNIQUES ──────────────────────────────────────────────────
import { techniqueHyperMotion } from "./cinema/techniques/hyper-motion";
import { techniqueShotSwitch } from "./cinema/techniques/shot-switch";
import { techniqueIdentityMotionLock } from "./cinema/techniques/identity-motion-lock";
import { techniqueFiveLayerVideoFormula } from "./cinema/techniques/five-layer-video-formula";

// ── IMAGE PHOTOGRAPHERS ────────────────────────────────────────────────
import { photographerAnnieLeibovitz } from "./image/photographers/annie-leibovitz";
import { photographerHelmutNewton } from "./image/photographers/helmut-newton";
import { photographerPeterLindbergh } from "./image/photographers/peter-lindbergh";
import { photographerMarioTestino } from "./image/photographers/mario-testino";
import { photographerVivianeSassen } from "./image/photographers/viviane-sassen";

// ── IMAGE BRAND STYLES ─────────────────────────────────────────────────
import { brandAppleProductShot } from "./image/brands/apple-product-shot";
import { brandMujiAesthetic } from "./image/brands/muji-aesthetic";
import { brandGlossierFlatLay } from "./image/brands/glossier-flat-lay";
import { brandVogueArabia } from "./image/brands/vogue-arabia";
import { brandKinfolkAesthetic } from "./image/brands/kinfolk-aesthetic";
import { brandA24Cinematography } from "./image/brands/a24-cinematography";

// ── IMAGE COMPOSITES ───────────────────────────────────────────────────
import { compositeCharacterProduct } from "./image/composites/character-product";
import { compositeVirtualTryOn } from "./image/composites/virtual-try-on";
import { compositeAmazonListing } from "./image/composites/amazon-listing";
import { compositeBillboardWithText } from "./image/composites/billboard-with-text";

// ── IMAGE DECISION TREES ───────────────────────────────────────────────
import { decisionBananaVsGpt2 } from "./image/decision-tree";

export const allSkills: Skill[] = [
  // UGC scenes
  sceneKitchenSambal,
  sceneGymSupplement,
  sceneInCarDrivingCta,
  sceneMukbangFood,
  sceneOfficeVitamin,
  sceneCafeAspirational,
  sceneConfessionStorytime,
  sceneStopMotionClay,
  sceneBeachSunset,
  sceneMomMorningRoutine,
  sceneFoodieReaction,
  sceneAsmrProduct,
  sceneTalkingProduct3d,
  sceneVintageVhsUnbox,
  sceneGrwm,
  sceneBeforeAfterSkin,
  sceneUnboxing,
  scenePovDateNight,
  sceneStreetVoxPop,
  sceneCommentResponse,
  sceneVirtualTryOn,
  sceneTutorialHowTo,
  sceneHyperMotionProduct,
  sceneDocumentaryVox,
  // UGC personas
  personaUrbanHijabiBestie,
  personaIbuMuda,
  personaGymBro,
  personaChineseMalaysianCodeswitcher,
  personaSkepticConverted,
  personaMakCikConverter,
  personaCasualBestie,
  personaPolishedPro,
  personaComedicFoodie,
  personaConfessionalIntimate,
  personaInspirationalSoft,
  personaEducationalExpert,
  personaProductWhisperer,
  personaPiousReligiousTone,
  // UGC hooks
  hookPainConfession,
  hookPov,
  hookConfession,
  hookNumber,
  hookComparison,
  hookDont,
  hookRoastHotTake,
  hookInsider,
  hookRedFlag,
  hookProblemQualification,
  hookRevealSuspense,
  hookHandRaise,
  hookEnemy,
  hookFomoSocialProof,
  // UGC frameworks
  frameworkPas,
  frameworkAida,
  frameworkBabExtended,
  frameworkSss,
  frameworkPrp,
  frameworkDrr,
  frameworkRdr,
  frameworkMbt,
  frameworkCoi,
  frameworkIab,
  frameworkArp,
  frameworkQah,
  frameworkCov,
  frameworkDitl,
  frameworkDirectResponse,
  // UGC CTAs
  ctaTapBegKuning,
  ctaUrgency,
  ctaScarcity,
  ctaSocialProof,
  ctaCommentTrigger,
  ctaSaveTrigger,
  ctaShareTrigger,
  ctaIfThen,
  ctaPermission,
  ctaTryAndShow,
  ctaDemoTap,
  ctaDirectBenefit,
  // UGC voices
  voiceAchernar,
  voiceAchird,
  voiceAlgenib,
  voiceCallirrhoe,
  voiceCharon,
  voiceEnceladus,
  voiceGacrux,
  voiceIapetus,
  // UGC locks
  lockAnatomy,
  lockAudio,
  lockProductRef,
  lockUgcAuthenticity,
  lockVisualClean,
  lockNegativeBlock,
  // UGC cultural
  culturalHalalProducts,
  culturalRamadan,
  culturalRayaSeason,
  culturalReligiousSensitivities,
  culturalCodeSwitch,
  // Cinema
  directorWongKarWai,
  directorVilleneuve,
  directorLynch,
  directorShinkai,
  directorGhibli,
  directorLeone,
  directorRidleyScott,
  cameraDollyIn,
  cameraOrbit,
  cameraHandheld,
  cameraDutchAngle,
  cameraCraneShot,
  cameraTrackingShot,
  cameraWhipPan,
  cameraDronefpv,
  cameraBulletTime,
  era90sVhs,
  era80sNeonSynth,
  era60sSpaghettiWestern,
  era70sCinemaVerite,
  era40sNoir,
  filmStockKodakPortra400,
  filmStockCinestill800t,
  filmStockFujiVelvia,
  filmStock35mmAnamorphic,
  moodNeonNoir,
  moodAtmosphericDread,
  moodEpicFantasy,
  moodRomanticIntimate,
  moodSurrealDream,
  techniqueHyperMotion,
  techniqueShotSwitch,
  techniqueIdentityMotionLock,
  techniqueFiveLayerVideoFormula,
  // Image
  photographerAnnieLeibovitz,
  photographerHelmutNewton,
  photographerPeterLindbergh,
  photographerMarioTestino,
  photographerVivianeSassen,
  brandAppleProductShot,
  brandMujiAesthetic,
  brandGlossierFlatLay,
  brandVogueArabia,
  brandKinfolkAesthetic,
  brandA24Cinematography,
  compositeCharacterProduct,
  compositeVirtualTryOn,
  compositeAmazonListing,
  compositeBillboardWithText,
  decisionBananaVsGpt2,
];
