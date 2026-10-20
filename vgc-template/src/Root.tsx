import { AbsoluteFill, Composition } from "remotion";

// Starter only — the VGC engine (Claude Code) replaces this with the real video.
const Blank: React.FC = () => <AbsoluteFill style={{ backgroundColor: "#111" }} />;

export const Root: React.FC = () => (
  <Composition id="Video" component={Blank} durationInFrames={90} fps={30} width={1080} height={1920} />
);
