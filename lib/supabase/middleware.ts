import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPage = path === "/login" || path === "/register";
  const isProtected = path.startsWith("/dashboard") || path.startsWith("/admin");

  // Affiliate cookie capture — when a visitor lands with ?ref=<code> and
  // doesn't already have the cookie set, stash it for 30 days. /checkout
  // reads peninglab_ref at signup time and stamps it on the payment row.
  // We set the cookie BEFORE the protected-route guards return so the
  // attribution survives a redirect to /login.
  const refParam = request.nextUrl.searchParams.get("ref");
  if (
    refParam &&
    /^[A-Z0-9]{4,16}$/.test(refParam) &&
    !request.cookies.get("peninglab_ref")
  ) {
    supabaseResponse.cookies.set("peninglab_ref", refParam, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      sameSite: "lax",
      httpOnly: false, // client JS can read for UI display if needed
    });
  }

  if (!user && isProtected) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Deactivated user check — kick them out + sign out
  if (user && isProtected) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (profile && profile.is_active === false) {
      await supabase.auth.signOut();
      const url = new URL("/login", request.url);
      url.searchParams.set("error", "account_deactivated");
      return NextResponse.redirect(url);
    }

    // /admin requires admin flag
    if (path.startsWith("/admin") && !profile?.is_admin) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  if (user && isAuthPage) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}
