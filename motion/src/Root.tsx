import React from 'react';
import { Composition } from 'remotion';
import { MotionAd } from './MotionAd';
import { MotionEdit } from './MotionEdit';
import { SAMPLE_AD, SAMPLE_EDIT } from './sample';
import type { AdProps, EditProps } from './types';

// Duration + fps come from the job props (the VO timeline / the client video),
// so one bundle renders any length.
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="MotionAd"
      component={MotionAd as unknown as React.FC<Record<string, unknown>>}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={SAMPLE_AD.durationInFrames}
      defaultProps={SAMPLE_AD as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as AdProps;
        return { durationInFrames: Math.max(30, Math.round(p.durationInFrames || 300)), fps: p.fps || 30 };
      }}
    />
    <Composition
      id="MotionEdit"
      component={MotionEdit as unknown as React.FC<Record<string, unknown>>}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={SAMPLE_EDIT.durationInFrames}
      defaultProps={SAMPLE_EDIT as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as EditProps;
        return { durationInFrames: Math.max(30, Math.round(p.durationInFrames || 300)), fps: p.fps || 30 };
      }}
    />
  </>
);
