import { createAuthClient } from "./account-core.mjs";

const config = window.__BOBAKS_AUTH_CONFIG__ ?? {};
const hasConfig = Boolean(
  String(config.supabaseUrl ?? "").trim() &&
  String(config.publishableKey ?? "").trim()
);

let auth = null;

if (hasConfig) {
  try {
    auth = createAuthClient({
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey
    });

    auth.onAuthStateChange((event, session) => {
      window.dispatchEvent(new CustomEvent("bobaks:auth-state", {
        detail: {
          event,
          userId: session?.user?.id ?? null
        }
      }));
    });
  } catch (error) {
    console.error("Bobaks authentication initialization failed:", error);
  }
}

window.__BOBAKS_AUTH__ = auth;

window.dispatchEvent(new CustomEvent("bobaks:auth-ready", {
  detail: {
    available: Boolean(auth)
  }
}));

export function getBobaksAuth() {
  return window.__BOBAKS_AUTH__ ?? null;
}
