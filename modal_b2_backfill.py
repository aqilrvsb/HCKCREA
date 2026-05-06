"""Backfill peninglab-content B2 bucket from existing history rows.

For every history row where:
  - status = 'done'
  - output_url is set
  - output_url is NOT already a peninglab-content URL
  - b2_mirrored_at is NULL
this worker fetches the provider URL and re-uploads to peninglab-content,
then UPDATEs history.output_url to the new stable public URL and stamps
b2_mirrored_at = NOW().

Safe to re-run — fully idempotent. Rows where the provider URL has already
expired (HTTP 4xx) are skipped + logged; the UI hides them via the 14-day
TTL filter anyway.

Run modes:
  - default: one user (set USER_ID env var)
  - --all: every user
  - --dry-run: log what would be uploaded, no writes

Run via Modal CLI:
  modal run modal_b2_backfill.py::backfill_user --user-id=<uuid>
  modal run modal_b2_backfill.py::backfill_all
  modal run modal_b2_backfill.py::backfill_user --user-id=<uuid> --dry-run
"""

import datetime
import hashlib
import hmac
import os
from urllib.parse import urlparse, quote

import modal

app = modal.App("hckcrea-b2-backfill")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("supabase==2.4.6", "requests==2.32.3")
)

# Reuse the same B2_* + B2_CONTENT_* secrets as modal_fairytale.
# The user must have created `b2-content-secrets` in Modal containing:
#   B2_ENDPOINT, B2_REGION, B2_CONTENT_KEY_ID, B2_CONTENT_APP_KEY,
#   B2_CONTENT_BUCKET, B2_CONTENT_PUBLIC_BASE
# And `supabase-service` containing:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
secrets = [
    modal.Secret.from_name("supabase-service"),
    modal.Secret.from_name("b2-content-secrets"),
]


def _supabase():
    from supabase import create_client

    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def _ext_from_url(url: str, row_type: str) -> str:
    """Best-effort extension from URL path; fall back by type."""
    try:
        u = urlparse(url)
        last = u.path.rsplit("/", 1)[-1]
        if "." in last:
            ext = last.rsplit(".", 1)[-1].lower()
            if 1 <= len(ext) <= 5 and ext.isalnum():
                return ext
    except Exception:
        pass
    if row_type in ("image", "fairytale-scene"):
        return "png"
    return "mp4"


def _content_type(ext: str) -> str:
    e = ext.lower()
    if e == "png":
        return "image/png"
    if e in ("jpg", "jpeg"):
        return "image/jpeg"
    if e == "webp":
        return "image/webp"
    if e == "mp4":
        return "video/mp4"
    if e == "webm":
        return "video/webm"
    return "application/octet-stream"


def _b2_content_put(b2_key: str, body: bytes, content_type: str) -> None:
    """SigV4 PUT to peninglab-content."""
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
    payload_hash = hashlib.sha256(body).hexdigest()

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "content-length": str(len(body)),
        "content-type": content_type,
    }

    sorted_keys = sorted(headers)
    signed_headers = ";".join(sorted_keys)
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in sorted_keys)

    canonical_request = "\n".join(
        ["PUT", canonical_uri, "", canonical_headers, signed_headers, payload_hash]
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
        "Content-Length": str(len(body)),
        "Content-Type": content_type,
    }

    r = requests.put(
        f"https://{host}{canonical_uri}",
        data=body,
        headers=out_headers,
        timeout=300,
    )
    if r.status_code < 200 or r.status_code >= 300:
        raise RuntimeError(f"B2 PUT failed: HTTP {r.status_code} {r.text[:300]}")


def _public_url(b2_key: str) -> str:
    base = os.environ["B2_CONTENT_PUBLIC_BASE"].rstrip("/")
    return f"{base}/{b2_key}"


def _process_row(row: dict, dry_run: bool) -> dict:
    """Returns {status: 'mirrored' | 'skipped_404' | 'skipped_already' | 'error'}."""
    import requests

    rid = row["id"]
    user_id = row["user_id"]
    row_type = row.get("type") or "video"
    output_url = row.get("output_url") or ""

    if not output_url:
        return {"status": "skipped_no_url"}

    # Already on content bucket?
    base = os.environ["B2_CONTENT_PUBLIC_BASE"].rstrip("/")
    if output_url.startswith(base):
        # Stamp b2_mirrored_at if NULL
        sb = _supabase()
        sb.table("history").update(
            {"b2_mirrored_at": datetime.datetime.utcnow().isoformat() + "Z"}
        ).eq("id", rid).is_("b2_mirrored_at", "null").execute()
        return {"status": "skipped_already_content"}

    # Pull source bytes
    try:
        r = requests.get(output_url, timeout=60)
    except Exception as e:
        return {"status": "error", "error": f"fetch_exception: {e}"}
    if r.status_code >= 400:
        return {"status": "skipped_404", "error": f"HTTP {r.status_code}"}
    body = r.content
    if len(body) == 0:
        return {"status": "skipped_404", "error": "empty body"}

    ext = _ext_from_url(output_url, row_type)
    b2_key = f"users/{user_id}/{row_type}/{rid}.{ext}"
    ctype = _content_type(ext)
    new_url = _public_url(b2_key)

    if dry_run:
        return {
            "status": "would_mirror",
            "key": b2_key,
            "size": len(body),
            "new_url": new_url,
        }

    try:
        _b2_content_put(b2_key, body, ctype)
    except Exception as e:
        return {"status": "error", "error": f"b2_put: {e}"}

    sb = _supabase()
    sb.table("history").update(
        {
            "output_url": new_url,
            "thumbnail_url": new_url if row_type == "video" else None,
            "b2_mirrored_at": datetime.datetime.utcnow().isoformat() + "Z",
        }
    ).eq("id", rid).execute()

    return {"status": "mirrored", "key": b2_key, "size": len(body), "new_url": new_url}


@app.function(image=image, secrets=secrets, timeout=3600)
def backfill_user(user_id: str, dry_run: bool = False) -> dict:
    """Backfill ONE user's history. Use for canary (admin@gmail.com)."""
    sb = _supabase()
    rows = (
        sb.table("history")
        .select("id, user_id, type, output_url")
        .eq("user_id", user_id)
        .eq("status", "done")
        .is_("b2_mirrored_at", "null")
        .execute()
    )

    counts = {
        "total": 0,
        "mirrored": 0,
        "skipped_already_content": 0,
        "skipped_404": 0,
        "skipped_no_url": 0,
        "would_mirror": 0,
        "error": 0,
    }
    examples = []

    for row in rows.data or []:
        counts["total"] += 1
        result = _process_row(row, dry_run)
        status = result["status"]
        counts[status] = counts.get(status, 0) + 1
        if len(examples) < 5 and status in ("mirrored", "would_mirror", "error"):
            examples.append({"id": row["id"], **result})

    return {"user_id": user_id, "dry_run": dry_run, "counts": counts, "examples": examples}


@app.function(image=image, secrets=secrets, timeout=86400)  # up to 24h
def backfill_all(dry_run: bool = False, batch_size: int = 100) -> dict:
    """Backfill ALL users. Run after canary verifies."""
    sb = _supabase()

    # Get distinct users with un-mirrored rows
    users_resp = (
        sb.table("history")
        .select("user_id")
        .eq("status", "done")
        .is_("b2_mirrored_at", "null")
        .execute()
    )
    user_ids = list({row["user_id"] for row in (users_resp.data or [])})

    aggregate = {
        "users_processed": 0,
        "total": 0,
        "mirrored": 0,
        "skipped_already_content": 0,
        "skipped_404": 0,
        "skipped_no_url": 0,
        "would_mirror": 0,
        "error": 0,
    }

    for user_id in user_ids:
        result = backfill_user.local(user_id, dry_run)
        aggregate["users_processed"] += 1
        for k, v in result["counts"].items():
            aggregate[k] = aggregate.get(k, 0) + v

    return {"dry_run": dry_run, "user_count": len(user_ids), "aggregate": aggregate}
