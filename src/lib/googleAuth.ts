// Sign in with Google via Google Identity Services.
// Activates when VITE_GOOGLE_CLIENT_ID is set (see .env.example); the button
// is hidden entirely until then, so nothing on the page looks dead.
import type { Session } from "./auth";

interface CredentialResponse { credential: string }

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: { client_id: string; callback: (r: CredentialResponse) => void }) => void;
          renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
export const googleEnabled = GOOGLE_CLIENT_ID.length > 0;

let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't load Google sign-in."));
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

function decodeSession(jwt: string): Session {
  const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return { email: String(payload.email ?? ""), name: String(payload.name ?? payload.given_name ?? "") };
}

/** Render the official Google button into `el`; calls onSession on success. */
export async function mountGoogleButton(el: HTMLElement, onSession: (s: Session) => void): Promise<void> {
  if (!googleEnabled) return;
  await loadGis();
  window.google!.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (r) => onSession(decodeSession(r.credential)),
  });
  window.google!.accounts.id.renderButton(el, {
    theme: "outline",
    size: "large",
    shape: "pill",
    width: 320,
    text: "continue_with",
  });
}
