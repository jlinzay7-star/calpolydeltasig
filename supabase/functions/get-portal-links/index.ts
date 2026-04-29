// Supabase Edge Function — get-portal-links
// Returns the portal's link list, but ONLY if the request carries a valid JWT.
// This is what prevents scraping: the link URLs never ship in the client HTML.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const ALLOWED_ORIGINS = [
  "https://calpolydeltasigmapi.netlify.app",
  "https://calpolydeltasig.netlify.app",
  "https://calpolydeltasig.com",
  "https://www.calpolydeltasig.com",
  "http://localhost:8080",
  "http://localhost:3000",
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
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

  // ---- Gate: require a valid session JWT ----
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...headers, "content-type": "application/json" },
    });
  }
  try {
    const key = await getJwtKey();
    await verify(token, key);
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...headers, "content-type": "application/json" },
    });
  }

  // ---- Load links ----
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await supabase
    .from("portal_links")
    .select("label,description,url,icon,sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...headers, "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ links: data || [] }), {
    status: 200,
    headers: {
      ...headers,
      "content-type": "application/json",
      "Cache-Control": "no-store",
    },
  });
});
