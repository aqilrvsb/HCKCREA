"""
modal_b2_restore.py — one-shot restore for peninglab-content bucket.

Finds every delete-marker (the "(hidden)" 0-byte rows in B2's UI that
the old `hckcrea-b2-cleanup` cron created when it pruned files) and
deletes them. Removing a delete-marker exposes the previous version
as the current live one — effectively restoring the file.

Usage:
    PYTHONIOENCODING=utf-8 py -m modal run modal_b2_restore.py

The function runs on Modal so it picks up the b2-content-secrets
Modal Secret (B2_CONTENT_ENDPOINT / KEY_ID / APP_KEY / BUCKET) without
needing any local config.

Safety:
  • Only DELETE_MARKER versions are touched. Regular versions are never
    deleted by this script.
  • Per-key: deletes EVERY delete marker on that key (if multiple
    hide-rehide cycles happened, all markers are removed).
  • Dry-run first: invoke with --dry-run to see what would be deleted
    without changing anything.

Last-tested:
  • boto3 1.34 against B2 S3-compatible API us-east-005
"""

import os
import sys
import modal

app = modal.App("hckcrea-b2-restore")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("boto3==1.34.131")
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("b2-content-secrets")],
    timeout=60 * 30,  # 30 min — enough for tens of thousands of objects
)
def restore_all_hidden(dry_run: bool = False) -> dict:
    import boto3
    from botocore.config import Config

    # The b2-content-secrets Modal Secret stores the endpoint as B2_ENDPOINT
    # (shared with the main B2 setup) and the bucket-scoped credentials as
    # B2_CONTENT_KEY_ID / B2_CONTENT_APP_KEY. Bucket name is B2_CONTENT_BUCKET.
    endpoint = os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_REGION", "us-east-005")
    access_key = os.environ["B2_CONTENT_KEY_ID"]
    secret_key = os.environ["B2_CONTENT_APP_KEY"]
    bucket = os.environ.get("B2_CONTENT_BUCKET", "peninglab-content")

    # We only do LIST + DELETE here (no PUT) so the checksum flags that
    # the main b2.ts upload path needs are not required.
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=Config(signature_version="s3v4"),
    )

    print(f"[restore] bucket={bucket} endpoint={endpoint}")
    print(f"[restore] dry_run={dry_run}")

    # Paginate through ALL object versions (which includes delete markers
    # as a separate DeleteMarkers field per page).
    paginator = client.get_paginator("list_object_versions")

    total_markers = 0
    deleted = 0
    failures = 0
    sample_keys = []

    for page in paginator.paginate(Bucket=bucket):
        markers = page.get("DeleteMarkers", []) or []
        for m in markers:
            total_markers += 1
            key = m["Key"]
            version_id = m["VersionId"]
            is_latest = m.get("IsLatest", False)
            if len(sample_keys) < 10:
                sample_keys.append(key)

            if dry_run:
                continue

            # Delete this specific delete-marker version. B2 treats this
                        # the same as S3: removing a delete marker makes the
            # previous version current again.
            try:
                client.delete_object(
                    Bucket=bucket,
                    Key=key,
                    VersionId=version_id,
                )
                deleted += 1
                if deleted % 100 == 0:
                    print(f"[restore] progress: {deleted} markers deleted")
            except Exception as e:
                failures += 1
                if failures <= 5:
                    print(f"[restore] failed to delete {key} v={version_id}: {e}")

    print(f"\n[restore] DONE")
    print(f"  total delete markers found: {total_markers}")
    print(f"  deleted: {deleted}")
    print(f"  failures: {failures}")
    print(f"  sample keys touched: {sample_keys[:5]}")

    return {
        "ok": True,
        "bucket": bucket,
        "dry_run": dry_run,
        "total_markers": total_markers,
        "deleted": deleted,
        "failures": failures,
    }


@app.local_entrypoint()
def main(dry_run: bool = False):
    """Run from CLI: `modal run modal_b2_restore.py` or
    `modal run modal_b2_restore.py --dry-run`."""
    result = restore_all_hidden.remote(dry_run=dry_run)
    print(f"\nResult: {result}")
