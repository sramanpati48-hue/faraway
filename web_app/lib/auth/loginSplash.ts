/** Session keys for the post-login handshake splash (HomeSplashIntro). */
export const LOGIN_SPLASH_PENDING_KEY = "nyaya_login_splash_pending";
export const LOGIN_SPLASH_SEEN_KEY = "nyaya_home_splash_seen";
const LOGIN_SPLASH_SHOWING_KEY = "nyaya_login_splash_showing";

/** Call after a fresh sign-in / sign-up — not on session bootstrap or page reload. */
export function queueLoginSplashForRole(_role?: string | null) {
  try {
    sessionStorage.setItem(LOGIN_SPLASH_PENDING_KEY, "1");
    sessionStorage.removeItem(LOGIN_SPLASH_SEEN_KEY);
    sessionStorage.removeItem(LOGIN_SPLASH_SHOWING_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * True when a login just queued the splash, or the splash is mid-flight (Strict Mode remount).
 * Clears the pending flag on first read.
 */
export function shouldPlayLoginSplash(): boolean {
  try {
    if (sessionStorage.getItem(LOGIN_SPLASH_SEEN_KEY) === "1") return false;
    if (sessionStorage.getItem(LOGIN_SPLASH_SHOWING_KEY) === "1") return true;
    if (sessionStorage.getItem(LOGIN_SPLASH_PENDING_KEY) === "1") {
      sessionStorage.removeItem(LOGIN_SPLASH_PENDING_KEY);
      sessionStorage.setItem(LOGIN_SPLASH_SHOWING_KEY, "1");
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function markLoginSplashSeen() {
  try {
    sessionStorage.setItem(LOGIN_SPLASH_SEEN_KEY, "1");
    sessionStorage.removeItem(LOGIN_SPLASH_SHOWING_KEY);
  } catch {
    /* ignore */
  }
}
