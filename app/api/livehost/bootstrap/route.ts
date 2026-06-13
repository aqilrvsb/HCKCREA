import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting, getSettings } from "@/lib/settings";
import { LIVEHOST_BOX_BUNDLE_B64 } from "@/lib/livehost-box-bundle";

export const dynamic = "force-dynamic";

// SELF-BUILDING GPU BOX. A freshly created Novita instance runs:
//   curl -fsSL "https://peninglab.com/api/livehost/bootstrap?s=SECRET&u=USERID" | bash
// as its container command. This endpoint renders the full unattended build:
// ssh + pixi + AVTR-1 + TensorRT engines (~25 min on a 4090) + our mods
// (bundled base64) + turn.env (keys from app_settings) + the client's OWN
// Cloudflare tunnel token (from live_client_config) + watchdog + auto-boot
// sshd wrapper + stock avatar registration. When it finishes, the client's
// subdomain serves /avatars and the studio works. Idempotent: safe to re-run.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = await getSetting<string>("livehost_box_secret");
  if (!secret || url.searchParams.get("s") !== secret) {
    return new NextResponse("forbidden", { status: 403 });
  }
  const userId = url.searchParams.get("u") || "";
  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("live_client_config")
    .select("tunnel_token, vast_instance_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cfg?.tunnel_token) {
    return new NextResponse("no tunnel_token for user", { status: 404 });
  }

  const s = await getSettings([
    "livehost_hf_token",
    "livehost_minimax_key",
    "livehost_turn_key_id",
    "livehost_turn_key_token",
    "or_key",
    "novita_api_key",
    "livehost_ssh_pubkey",
  ]);
  const sshPub = s["livehost_ssh_pubkey"] || "";
  const hf = s["livehost_hf_token"] || "";
  const minimax = s["livehost_minimax_key"] || "";
  const turnId = s["livehost_turn_key_id"] || "";
  const turnTok = s["livehost_turn_key_token"] || "";
  const orKey = typeof s["or_key"] === "object" ? s["or_key"]?.key || "" : s["or_key"] || "";
  const novitaKey = s["novita_api_key"] || "";
  const origin = `${url.protocol}//${url.host}`;

  const script = `#!/bin/bash
# PeningLab Livehost — unattended GPU box build. Idempotent.
set -x
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y --no-install-recommends \\
  openssh-server git curl tmux ca-certificates xz-utils
mkdir -p /run/sshd /root/.ssh /workspace
chmod 700 /root/.ssh
grep -qF '${sshPub}' /root/.ssh/authorized_keys 2>/dev/null || echo '${sshPub}' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
[ -f /workspace/.build_done ] && BUILD_DONE=1 || BUILD_DONE=0

# ---- secrets / env ----
cat > /workspace/turn.env <<'ENVEOF'
export CLOUDFLARE_TURN_KEY_ID=${turnId}
export CLOUDFLARE_TURN_KEY_TOKEN=${turnTok}
export MINIMAX_API_KEY=${minimax}
export OPENROUTER_API_KEY=${orKey}
export OPENROUTER_MODEL=openai/gpt-4.1
export NOVITA_API_KEY=${novitaKey}
export LIVEHOST_CONFIG_URL=${origin}/api/livehost/engine-config
export LIVEHOST_BOX_SECRET=${secret}
ENVEOF
printf '%s' '${cfg.tunnel_token}' > /workspace/cf_tunnel_token
printf '%s' '${hf}' > /root/hf_token
chmod 600 /workspace/turn.env /workspace/cf_tunnel_token /root/hf_token

# instance id for the on-box watchdog (filled by provisioner)
cat > /workspace/novita.env <<'NVEOF'
export NOVITA_API_KEY=${novitaKey}
export NOVITA_INSTANCE_ID=${cfg.vast_instance_id || "SET_ME"}
NVEOF

# ---- cloudflared ----
if [ ! -x /usr/local/bin/cloudflared ]; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi

# ---- AVTR-1 build (skipped when already done) ----
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
  # trim caches so a 60GB rootfs sleeps inside Novita's free tier
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
# slow-ICE tolerance (sessions crash at 5s otherwise)
sed -i "s/ready_timeout: float = 5.0/ready_timeout: float = 30.0/" $B/event_bus.py || true

# ---- box scripts ----
cat > /workspace/start_streamer.sh <<'SSEOF'
#!/bin/bash
cd /workspace/avtr-1
export PATH="$HOME/.pixi/bin:$PATH"
. /workspace/turn.env
export AVTR1_LOCAL_STORAGE=/workspace/avtr1_storage
export STREAMER_HOST=0.0.0.0 STREAMER_PORT=8000 RENDERER_PORT=8001
exec pixi run interactive-demo
SSEOF
cat > /workspace/idle_watchdog.sh <<'WDEOF'
#!/bin/bash
. /workspace/novita.env
IDLE=0
while true; do
  sleep 60
  active=$(curl -s -m 5 http://localhost:8000/active | grep -c 'true')
  ka=0
  if [ -f /workspace/keepalive ]; then
    age=$(( $(date +%s) - $(stat -c %Y /workspace/keepalive 2>/dev/null || echo 0) ))
    [ "$age" -lt 150 ] && ka=1
  fi
  if [ "$active" = "1" ] || [ "$ka" = "1" ]; then IDLE=0; else IDLE=$((IDLE+1)); fi
  if [ "$IDLE" -ge 8 ]; then
    curl -s -X POST "https://api.novita.ai/gpu-instance/openapi/v1/gpu/instance/stop" \\
      -H "Authorization: Bearer $NOVITA_API_KEY" -H "Content-Type: application/json" \\
      -d "{\\"instanceId\\":\\"$NOVITA_INSTANCE_ID\\"}"
    IDLE=0
  fi
done
WDEOF
cat > /workspace/boot.sh <<'BTEOF'
#!/bin/bash
tmux kill-session -t avtr 2>/dev/null
tmux kill-session -t tunnel 2>/dev/null
tmux kill-session -t watchdog 2>/dev/null
TOKEN=$(cat /workspace/cf_tunnel_token)
tmux new-session -d -s avtr "/workspace/start_streamer.sh > /workspace/streamer.log 2>&1"
tmux new-session -d -s tunnel "/usr/local/bin/cloudflared tunnel run --token \${TOKEN} > /workspace/tunnel.log 2>&1"
echo booted
BTEOF
chmod +x /workspace/start_streamer.sh /workspace/idle_watchdog.sh /workspace/boot.sh

# ---- auto-boot on every instance start: wrap sshd ----
if [ ! -f /usr/sbin/sshd.real ]; then
  mv /usr/sbin/sshd /usr/sbin/sshd.real
  printf '#!/bin/bash\\n( sleep 5; bash /workspace/boot.sh ) > /workspace/autoboot.log 2>&1 &\\nexec /usr/sbin/sshd.real "\$@"\\n' > /usr/sbin/sshd
  chmod +x /usr/sbin/sshd
fi

# ---- boot now + register stock avatars ----
bash /workspace/boot.sh
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
echo PROVISION_COMPLETE > /workspace/provision_status.txt

# ---- keep container alive with sshd ----
exec /usr/sbin/sshd -D
`;

  return new NextResponse(script, {
    headers: { "content-type": "text/x-shellscript" },
  });
}
