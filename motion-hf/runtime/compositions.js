// Compositions a Laju v2 page can draw. MotionEdit / MotionAd are the very
// same components the Remotion renderer uses (motion/src), compiled against
// the shim; props contract = motion/src/types.ts.
import { MotionEdit } from "../../motion/src/MotionEdit";
import { MotionAd } from "../../motion/src/MotionAd";
import { Probe } from "../experiment/Probe.tsx";

export const COMPOSITIONS = {
  MotionEdit,
  MotionAd,
  Probe,
};
