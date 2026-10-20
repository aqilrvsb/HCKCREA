// Compositions a Laju v2 page can draw. MotionEdit / MotionAd are the very
// same components the Remotion renderer uses (motion/src), compiled against
// the shim; props contract = motion/src/types.ts.
import { MotionEdit } from "../../motion/src/MotionEdit";
import { MotionEditPro } from "../overrides/MotionEditPro.tsx";
import { MotionAd } from "../../motion/src/MotionAd";
import { Probe } from "../experiment/Probe.tsx";

export const COMPOSITIONS = {
  // Laju v2 renders the Pro edit; the plain Laju template stays available for A/B
  MotionEdit: MotionEditPro,
  MotionEditClassic: MotionEdit,
  MotionAd,
  Probe,
};
