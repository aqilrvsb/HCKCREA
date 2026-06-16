"use client";

import Swal from "sweetalert2";

// Themed delete/confirm dialog (dark UI, red confirm). Returns true if the
// user confirmed. Use for any destructive action in the Livehost dashboard.
export async function confirmDelete(
  title = "Padam?",
  text = "Tindakan ini tidak boleh dibatalkan.",
): Promise<boolean> {
  const res = await Swal.fire({
    title,
    text,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Ya, padam",
    cancelButtonText: "Batal",
    confirmButtonColor: "#ef4444",
    cancelButtonColor: "#374151",
    reverseButtons: true,
    focusCancel: true,
    background: "#0f0f12",
    color: "#f3f4f8",
  });
  return res.isConfirmed;
}
