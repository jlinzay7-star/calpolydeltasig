// Supabase Edge Function — verify-password
// Runs on Deno. Called by the frontend when a brother enters the portal password.
// Responsibilities:
//   1. Rate-limit (5 failed attempts per IP per 15 min)
//   2. Compare submitted password against the bcrypt hash in portal_access
//   3. Log the attempt (success or failure)
//   4. On success, return a signed JWT (24-hour expiry) + httpOnly cookie

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const ALLOWED_ORIGINS = [
  "https://calpolydeltasigmapi.netlify.app",
  "https://calpolydeltasig.netlify.app",
  "https://calpolydeltasig.com",
  "https://www.calpolydeltasig.com",
  // Local dev
  "http://localhost:8080",
  "http://localhost:3000",
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

async function getJwtKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("JWT_SECRET");
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET env var must be set and at least 32 chars");
  }
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...headers, "content-type": "application/json" },
    });
  }

  try {
    const { password } = await req.json();
    if (typeof password !== "string" || password.length === 0 || password.length > 200) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...headers, "content-type": "application/json" },
      });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Rate limit: 5 failed attempts per IP per 15 min ----
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count: recentFailures } = await supabase
      .from("auth_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .eq("success", false)
      .gt("attempted_at", fifteenMinAgo);

    if ((recentFailures ?? 0) >= 5) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Try again in 15 minutes." }),
        { status: 429, headers: { ...headers, "content-type": "application/json" } },
      );
    }

    // ---- Load stored hash ----
    const { data: access, error: accessErr } = await supabase
      .from("portal_access")
      .select("password_hash")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (accessErr || !access) {
      console.error("portal_access read failed", accessErr);
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...headers, "content-type": "application/json" },
      });
    }

    // ---- Compare ----
    // NOTE: use compareSync, NOT compare. The async compare() in deno.land/x/bcrypt@0.4.1
    // tries to spawn a Web Worker, which is not available in Supabase Edge Runtime
    // (throws "Worker is not defined"). compareSync runs in-line — fine for our load
    // (one comparison per login attempt at cost 12 ≈ 100ms blocking).
    const ok = bcrypt.compareSync(password, access.password_hash);

    // Log attempt (fire-and-forget, non-blocking)
    supabase.from("auth_attempts").insert({ ip_address: ip, success: ok }).then();

    if (!ok) {
      return new Response(JSON.stringify({ error: "Incorrect password" }), {
        status: 401,
        headers: { ...headers, "content-type": "application/json" },
      });
    }

    // ---- Issue JWT ----
    const key = await getJwtKey();
    const token = await create(
      { alg: "HS256", typ: "JWT" },
      {
        sub: "portal",
        exp: getNumericDate(24 * 60 * 60), // 24 hours
        iat: getNumericDate(0),
      },
      key,
    );

    return new Response(JSON.stringify({ token, expiresIn: 24 * 60 * 60 }), {
      status: 200,
      headers: {
        ...headers,
        "content-type": "application/json",
        // Also set a Secure, SameSite=Strict cookie as a belt-and-suspenders defense.
        "Set-Cookie": `dsp_portal=${token}; Path=/; Max-Age=${24 * 60 * 60}; SameSite=Strict; Secure; HttpOnly`,
      },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...headers, "content-type": "application/json" },
    });
  }
});
