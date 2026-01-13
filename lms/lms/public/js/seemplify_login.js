/**
 * Seemplify Login Button for Frappe LMS
 * 
 * Adds a "Login with Seemplify" button to the login page
 * and handles OAuth2 flow initiation.
 */

frappe.ready(function() {
  // Only run on login page
  if (window.location.pathname !== '/login') {
    return;
  }

  // Wait for login form to be ready
  const checkAndAddButton = () => {
    const loginBox = document.querySelector('.login-content');
    const loginForm = document.querySelector('form[data-login-form]') || document.querySelector('.page-card form');
    
    if (!loginBox && !loginForm) {
      setTimeout(checkAndAddButton, 100);
      return;
    }

    // Check if button already exists
    if (document.querySelector('.seemplify-login-btn')) {
      return;
    }

    // Create the Seemplify login button
    const seemplifyBtn = document.createElement('div');
    seemplifyBtn.className = 'seemplify-login-container';
    seemplifyBtn.innerHTML = `
      <div class="login-divider">
        <span>or</span>
      </div>
      <button type="button" class="btn btn-default btn-block seemplify-login-btn" onclick="window.loginWithSeemplify()">
        <span class="seemplify-logo">
          <svg viewBox="0 0 100 100" width="20" height="20">
            <defs>
              <linearGradient id="seemplifyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#3b82f6" />
                <stop offset="50%" stop-color="#8b5cf6" />
                <stop offset="100%" stop-color="#ec4899" />
              </linearGradient>
            </defs>
            <path d="M 65 25 Q 75 25 75 35 Q 75 45 65 45 Q 50 50 35 55 Q 25 55 25 65 Q 25 75 35 75"
              stroke="url(#seemplifyGradient)" stroke-width="8" fill="none" stroke-linecap="round"
              stroke-linejoin="round" />
            <circle cx="65" cy="25" r="5" fill="#3b82f6" />
            <circle cx="50" cy="50" r="5" fill="#8b5cf6" />
            <circle cx="35" cy="75" r="5" fill="#ec4899" />
          </svg>
        </span>
        <span class="btn-text">Login with Seemplify</span>
      </button>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .seemplify-login-container {
        margin-top: 20px;
        text-align: center;
      }

      .login-divider {
        display: flex;
        align-items: center;
        margin: 24px 0 16px;
        color: var(--text-muted);
        font-size: 13px;
      }

      .login-divider::before,
      .login-divider::after {
        content: '';
        flex: 1;
        border-bottom: 1px solid var(--border-color);
      }

      .login-divider span {
        padding: 0 16px;
      }

      .seemplify-login-btn {
        display: flex !important;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 12px 24px !important;
        font-size: 15px !important;
        font-weight: 500;
        border: 1px solid var(--border-color) !important;
        border-radius: 8px !important;
        background: var(--bg-color) !important;
        color: var(--text-color) !important;
        transition: all 0.2s ease;
        width: 100%;
      }

      .seemplify-login-btn:hover {
        border-color: #8b5cf6 !important;
        background: rgba(139, 92, 246, 0.05) !important;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.15);
      }

      .seemplify-logo {
        display: flex;
        align-items: center;
      }

      .btn-text {
        font-weight: 500;
      }

      /* Dark mode adjustments */
      [data-theme="dark"] .seemplify-login-btn {
        border-color: var(--border-color) !important;
        background: var(--control-bg) !important;
      }

      [data-theme="dark"] .seemplify-login-btn:hover {
        border-color: #8b5cf6 !important;
        background: rgba(139, 92, 246, 0.1) !important;
      }
    `;

    document.head.appendChild(style);

    // Insert button after the login form or in login box
    const insertTarget = loginForm || loginBox;
    if (insertTarget) {
      insertTarget.parentNode.insertBefore(seemplifyBtn, insertTarget.nextSibling);
    }
  };

  checkAndAddButton();
});

/**
 * Initiate OAuth2 login with Seemplify
 */
window.loginWithSeemplify = function() {
  const btn = document.querySelector('.seemplify-login-btn');
  const btnText = btn.querySelector('.btn-text');
  const originalText = btnText.textContent;
  
  // Show loading state
  btn.disabled = true;
  btnText.textContent = 'Redirecting...';
  
  // Redirect to Seemplify OAuth
  // Frappe handles the OAuth flow via Social Login Key
  const authUrl = '/api/method/frappe.integrations.oauth2_logins.login_via_oauth2?' + 
    new URLSearchParams({
      provider: 'seemplify',
      redirect_to: window.location.pathname !== '/login' ? window.location.pathname : '/lms'
    }).toString();
  
  window.location.href = authUrl;
};

// Also handle if there's a provider parameter in the URL (for direct OAuth start)
frappe.ready(function() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('provider') === 'seemplify') {
    window.loginWithSeemplify();
  }
});
