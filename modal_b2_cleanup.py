"""Daily cron — prune unsaved B2 files past 14 days.

Calls the history_unsaved_past_ttl() RPC (added in migration 0030),
deletes each returned row's B2 object from peninglab-content, and
clears b2_mirrored_at to mark the cleanup as idempotent (so re-runs
don't try to re-delete the same key).

Does NOT delete the history row itself — UI already hides it via the
14-day TTL filter.

Schedule: every day at 19:00 UTC (03:00 MYT — Malaysia low traffic).
"""

import datetime
import hashlib
import hmac
import os
from urllib.parse import urlparse, quote

import modal

app = modal.App("hckcrea-b2-cleanup")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("supabase==2.4.6", "requests==2.32.3")
)

secrets = [
    modal.Secret.from_name("fairytale-secrets"),
    modal.Secret.from_name("b2-content-secrets"),
]


def _supabase():
    from supabase import create_client

    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def _b2_content_delete(b2_key: str) -> None:
    """SigV4 DELETE on peninglab-content."""
    import requests

    endpoint = os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_REGION", "us-east-005")
    access_key = os.environ["B2_CONTENT_KEY_ID"]
    secret_key = os.environ["B2_CONTENT_APP_KEY"]
    bucket = os.environ["B2_CONTENT_BUCKET"]

    endpoint_host = urlparse(endpoint).netloc
    host = f"{bucket}.{endpoint_host}"
    canonical_uri = "/" + quote(b2_key, safe="/")

    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(b"").hexdigest()

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }

    sorted_keys = sorted(headers)
    signed_headers = ";".join(sorted_keys)
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in sorted_keys)

    canonical_request = "\n".join(
        ["DELETE", canonical_uri, "", canonical_headers, signed_headers, payload_hash]
    )
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )

    def _hmac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k_date = _hmac(("AWS4" + secret_key).encode(), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, "s3")
    k_signing = _hmac(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    out_headers = {
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": auth,
        "Host": host,
    }

    r = requests.delete(
        f"https://{host}{canonical_uri}",
        headers=out_headers,
        timeout=60,
    )
    # B2 returns 204 on success, 404 if already gone (still treat as success)
    if r.status_code not in (200, 204, 404):
        raise RuntimeError(f"B2 DELETE failed: HTTP {r.status_code} {r.text[:200]}")


def _key_from_content_url(url: str) -> str | None:
    base = os.environ["B2_CONTENT_PUBLIC_BASE"].rstrip("/") + "/"
    if not url.startswith(base):
        return None
    return url[len(base) :]


@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Cron("0 19 * * *"),  # 19:00 UTC = 03:00 MYT
    timeout=3600,
)
def cleanup_unsaved_past_ttl(dry_run: bool = False) -> dict:
    """Daily prune. Returns counts."""
    sb = _supabase()

    rows = sb.rpc("history_unsaved_past_ttl").execute()

    counts = {
        "total": 0,
        "deleted": 0,
        "skipped_no_key": 0,
        "would_delete": 0,
        "error": 0,
    }
    examples = []

    for row in rows.data or []:
        counts["total"] += 1
        rid = row["id"]
        key = _key_from_content_url(row.get("output_url") or "")
        if not key:
            counts["skipped_no_key"] += 1
            continue

        if dry_run:
            counts["would_delete"] += 1
            if len(examples) < 5:
                examples.append({"id": rid, "key": key})
            continue

        try:
            _b2_content_delete(key)
            sb.table("history").update({"b2_mirrored_at": None}).eq("id", rid).execute()
            counts["deleted"] += 1
            if len(examples) < 5:
                examples.append({"id": rid, "key": key, "deleted": True})
        except Exception as e:
            counts["error"] += 1
            if len(examples) < 5:
                examples.append({"id": rid, "key": key, "error": str(e)[:200]})

    return {"dry_run": dry_run, "counts": counts, "examples": examples}
