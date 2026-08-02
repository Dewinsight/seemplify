const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Authentication was cancelled or denied.",
  account_exists: "An account with this email already exists. Please sign in instead.",
  account_not_found: "No account was found for that email address.",
  interaction_required: "Please sign in to continue.",
  invalid_password: "The password you entered is incorrect.",
  invalid_request: "The authentication request was invalid. Please try again.",
  login_failed: "Sign in failed. Please try again.",
  oidc_callback_failed: "We could not complete sign in. Please try again.",
  session_expired: "Your session expired. Please try again.",
  signup_failed: "Sign up failed. Please try again.",
  user_already_exists: "An account with this email already exists. Please sign in instead.",
  user_exists: "An account with this email already exists. Please sign in instead.",
};

const safeDecode = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const humanizeErrorCode = (value: string) => {
  const normalized = value.replace(/[+_]+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export const getAuthErrorMessage = (
  error: string | null | undefined,
  errorDescription?: string | null
) => {
  const decodedError = safeDecode(error).trim();
  const decodedDescription = safeDecode(errorDescription).trim();

  if (decodedDescription) {
    return decodedDescription;
  }

  if (!decodedError) {
    return "";
  }

  return AUTH_ERROR_MESSAGES[decodedError] ?? humanizeErrorCode(decodedError);
};

export const clearAuthErrorParamsFromUrl = () => {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const hadErrorParams =
    url.searchParams.has("error") || url.searchParams.has("error_description");

  if (!hadErrorParams) {
    return;
  }

  url.searchParams.delete("error");
  url.searchParams.delete("error_description");

  const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", cleanUrl || url.pathname);
};
