/**
 * Security headers, and the Content-Security-Policy nonce, for every response.
 *
 * The CSP is built around a per-request nonce. Next.js reads the
 * `Content-Security-Policy` request header, extracts the nonce and stamps it
 * onto the framework's own inline bootstrap scripts, and the root layout stamps
 * the same nonce onto the theme bootstrap script. With `strict-dynamic` present
 * and a nonce supplied, a browser ignores the host allowlist for scripts, so an
 * injected `<script>` from a compromised data source has no nonce and therefore
 * nothing to execute under. That is what makes an XSS payload inert rather than
 * merely unlikely.
 *
 * The previous policy allowed `script-src 'unsafe-inline'`, which lets any
 * injected inline script run and negates most of the XSS protection a CSP is
 * there to provide. `style-src` keeps `unsafe-inline` because Tailwind and Next
 * inject style attributes and style tags at runtime, and styles cannot
 * exfiltrate a session the way scripts can.
 */

import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/security/csp";

const isProduction = process.env.NODE_ENV === "production";

export function middleware(request: NextRequest): NextResponse {
  // 16 random bytes: enough entropy that a nonce cannot be guessed or reused.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = buildCsp(nonce, {
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    production: isProduction,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads this request header to apply the nonce to its own script tags.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (isProduction) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }
  return response;
}

export const config = {
  // Everything except Next's immutable static assets, which carry no user data
  // and are never documents a script could be injected into.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
