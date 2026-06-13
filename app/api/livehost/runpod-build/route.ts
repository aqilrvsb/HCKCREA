import { NextResponse } from "next/server";
import { getSetting, getSettings } from "@/lib/settings";
import { LIVEHOST_BOX_BUNDLE_B64 } from "@/lib/livehost-box-bundle";

export const dynamic = "force-dynamic";

// RUNPOD POC BUILDER. A RunPod L40S pod (network volume mounted at /workspace)
// runs this as its container command:
//   bash -c 'apt-get update && apt-get install -y curl ca-certificates &&
//            curl -fsSL "https://peninglab.com/api/livehost/runpod-build?s=SECRET" -o /b.sh &&
//            bash /b.sh'
// It self-builds AVTR-1 + TRT engines + our mods + NVENC conda swap + cloudflared
// ONTO THE VOLUME (idempotent, ~30-40 min first time, then instant). Unlike the
// Novita bootstrap there is NO per-client tunnel / sshd auto-boot here: the
// volume is generic, and the serverless worker brings up the client's tunnel +
// streamer per session. After building, it starts the streamer locally so the
// pod's HTTP proxy (:8000) can be used to verify /avatars + /encoders.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = await getSetting<string>("livehost_box_secret");
  if (!secret || url.searchParams.get("s") !== secret) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const s = await getSettings([
    "livehost_hf_token",
    "livehost_minimax_key",
    "livehost_turn_key_id",
    "livehost_turn_key_token",
    "or_key",
  ]);
  const hf = s["livehost_hf_token"] || "";
  const minimax = s["livehost_minimax_key"] || "";
  const turnId = s["livehost_turn_key_id"] || "";
  const turnTok = s["livehost_turn_key_token"] || "";
  const orKey = typeof s["or_key"] === "object" ? s["or_key"]?.key || "" : s["or_key"] || "";
  const origin = `${url.protocol}//${url.host}`;

  const script = `#!/bin/bash
# PeningLab Livehost — RunPod volume self-build. Idempotent.
set -x
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y --no-install-recommends \\
  git curl tmux ca-certificates xz-utils python3
mkdir -p /workspace
[ -f /workspace/.build_done ] && BUILD_DONE=1 || BUILD_DONE=0

# ---- secrets / env (no novita, no per-client tunnel) ----
cat > /workspace/turn.env <<'ENVEOF'
export CLOUDFLARE_TURN_KEY_ID=${turnId}
export CLOUDFLARE_TURN_KEY_TOKEN=${turnTok}
export MINIMAX_API_KEY=${minimax}
export OPENROUTER_API_KEY=${orKey}
export OPENROUTER_MODEL=openai/gpt-4.1
export LIVEHOST_CONFIG_URL=${origin}/api/livehost/engine-config
export LIVEHOST_BOX_SECRET=${secret}
ENVEOF
printf '%s' '${hf}' > /root/hf_token
chmod 600 /workspace/turn.env /root/hf_token

# ---- cloudflared ----
if [ ! -x /usr/local/bin/cloudflared ]; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi

# ---- AVTR-1 build (skipped when already on the volume) ----
export PATH="$HOME/.pixi/bin:$PATH"
if [ "$BUILD_DONE" = "0" ]; then
  export HF_TOKEN=$(cat /root/hf_token)
  export HUGGING_FACE_HUB_TOKEN=$HF_TOKEN
  cd /workspace
  curl -fsSL https://pixi.sh/install.sh | bash
  export PATH="$HOME/.pixi/bin:$PATH"
  [ -d avtr-1 ] || git clone https://github.com/avaturn-live/avtr-1.git
  cd avtr-1
  export AVTR1_LOCAL_STORAGE=/workspace/avtr1_storage
  pixi install
  pixi run python scripts/download_artifacts.py
  pixi run build-trt-engines
  rm -rf /root/.cache/huggingface /root/.cache/pip /root/.cache/rattler /var/lib/apt/lists/*
  touch /workspace/.build_done
fi

# ---- our modifications (bundled) ----
echo '${LIVEHOST_BOX_BUNDLE_B64}' | base64 -d > /tmp/lhbox.tar.gz
tar -xzf /tmp/lhbox.tar.gz -C /tmp
B=/workspace/avtr-1/src/avaturn_live_streamer
cp /tmp/lhbox/mods/events.py /tmp/lhbox/mods/constant.py /tmp/lhbox/mods/local_stream_cli.py $B/
cp /tmp/lhbox/mods/conversation_engines/*.py $B/conversation_engines/
cp /tmp/lhbox/mods/localrtc/*.py $B/localrtc/
cp /tmp/lhbox/mods/renderer/app.py /workspace/avtr-1/src/avtr1_renderer/api/app.py
cp /tmp/lhbox/mods/renderer/pipeline.py /workspace/avtr-1/src/avtr1_renderer/pipeline.py
sed -i "s/ready_timeout: float = 5.0/ready_timeout: float = 30.0/" $B/event_bus.py || true

# ---- enable NVENC (GPU hardware H264) in the streamer env ----
cd /workspace/avtr-1
if [ ! -f /workspace/.nvenc_done ]; then
  cp pixi.toml /workspace/pixi.toml.bak
  python3 - <<'PYEOF' || cp /workspace/pixi.toml.bak pixi.toml
src = open("pixi.toml").read().splitlines()
out = []
i = 0
while i < len(src):
    ln = src[i]
    if ln.strip() == 'av = ">=12.0.0"':
        i += 1
        continue
    out.append(ln)
    if ln.strip() == "[feature.streamer.dependencies]" and i + 1 < len(src):
        out.append(src[i + 1])
        out.append('ffmpeg = "*"')
        out.append('av = "*"')
        i += 1
    i += 1
open("pixi.toml", "w").write("\\n".join(out) + "\\n")
PYEOF
  if pixi install -e streamer > /workspace/nvenc_install.log 2>&1 && \\
     pixi run -e streamer python -c "import av; import sys; sys.exit(0 if 'h264_nvenc' in av.codec.codecs_available else 1)"; then
    echo OK > /workspace/.nvenc_ok
  else
    cp /workspace/pixi.toml.bak pixi.toml
    pixi install -e streamer > /workspace/nvenc_revert.log 2>&1 || true
  fi
  touch /workspace/.nvenc_done
fi

# ---- start streamer locally (no tunnel) for proxy verification ----
cat > /workspace/start_streamer.sh <<'SSEOF'
#!/bin/bash
cd /workspace/avtr-1
export PATH="$HOME/.pixi/bin:$PATH"
. /workspace/turn.env
export AVTR1_LOCAL_STORAGE=/workspace/avtr1_storage
export STREAMER_HOST=0.0.0.0 STREAMER_PORT=8000 RENDERER_PORT=8001
exec pixi run interactive-demo
SSEOF
chmod +x /workspace/start_streamer.sh
tmux kill-session -t avtr 2>/dev/null
tmux new-session -d -s avtr "/workspace/start_streamer.sh > /workspace/streamer.log 2>&1"

# ---- register stock avatars (once the streamer is up) ----
for i in $(seq 1 40); do
  sleep 10
  c=$(curl -s -m 4 -o /dev/null -w '%{http_code}' http://localhost:8000/avatars)
  [ "$c" = "200" ] && break
done
mkdir -p /workspace/stock
for i in $(seq -w 1 18); do
  curl -fsSL "${origin}/avatars/stock-$i.png" -o /workspace/stock/stock-$i.png || true
  curl -s -m 60 -X POST "http://localhost:8000/register-avatar?avatar_id=stock-$i" \\
    --data-binary @/workspace/stock/stock-$i.png -H "Content-Type: image/png" || true
done
echo RUNPOD_BUILD_COMPLETE > /workspace/runpod_status.txt
echo "=== build complete; streamer running on :8000 ==="
# keep the container alive so the proxy stays reachable for verification
tail -f /workspace/streamer.log
`;

  return new NextResponse(script, {
    headers: { "content-type": "text/x-shellscript" },
  });
}
