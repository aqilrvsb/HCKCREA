-- Seedance 2.0 Fast — admin settings for the new Seedance tab.
--
-- P1 (GeminiGen.AI):
--   - Single endpoint /uapi/v1/video-gen/seedance, model "seedance-2-omni"
--   - Optional ref_images / ref_videos / ref_audios for r2v; same call
--     handles t2v when refs are omitted.
--
-- P2 (Crun.ai):
--   - Two separate model names: bytedance/seedance2-0-fast-t2v and
--     bytedance/seedance2-0-fast-r2v. The dispatcher (lib/p2.ts) picks
--     based on whether refs are uploaded.
--
-- Provider toggle (gen_provider_seedance) lets admin rotate between P1
-- and P2 without redeploying. Default p2 to mirror the existing
-- gen_provider_video default and let admin flip to p1 if Crun's
-- queue is slow.

INSERT INTO app_settings (key, value, description, category) VALUES
  ('gen_provider_seedance',
   '{"provider":"p2"}',
   'Active backend for Seedance 2.0 Fast (p1=GeminiGen, p2=Crun.ai).',
   'provider'),
  ('p1_seedance_path',
   '{"path":"/uapi/v1/video-gen/seedance"}',
   'GeminiGen Seedance create-task path. Seedance 2 Omni Fast.',
   'provider'),
  ('seedance_rate',
   '{"per_second":0.40}',
   'Seedance Fast rate per second — RM0.40/sec. 8s clip = RM3.20, 15s = RM6.00.',
   'pricing')
ON CONFLICT (key) DO NOTHING;
