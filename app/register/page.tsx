import { redirect } from "next/navigation";

// Self-serve registration is disabled — accounts are auto-created on
// successful checkout. Funnel any direct hits to the checkout section.
export default function RegisterPage() {
  redirect("/#checkout");
}
