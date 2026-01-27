# Auth Guard Browser Test Guide

**Date:** January 27, 2026  
**Purpose:** Test automatic redirect to login when token expires or user is not authenticated

---

## 🧪 TEST SCENARIOS

### Test 1: Expired Token - API Call

**Steps:**
1. Navigate to `https://time.seemplifyai.com/dashboard` (while logged in)
2. Open browser DevTools (F12) → Console tab
3. Run this command to simulate expired token:
   ```javascript
   // Clear the token
   localStorage.removeItem('access_token');
   
   // Make an API call that will fail
   fetch('https://api-time.seemplifyai.com/api/clock/status', {
     headers: {
       'Authorization': 'Bearer invalid-token'
     }
   }).catch(err => console.log('Expected error:', err));
   ```

**Expected Result:**
- API call returns 401
- Axios interceptor catches the error
- Automatic redirect to `/login?redirect=/dashboard`
- Token cleared from localStorage

---

### Test 2: No Token on Page Load

**Steps:**
1. Open browser DevTools (F12) → Application tab → Local Storage
2. Clear `access_token` from localStorage
3. Navigate to `https://time.seemplifyai.com/dashboard`
4. Or refresh the current page

**Expected Result:**
- `AuthContext` detects no token
- Immediate redirect to `/login?redirect=/dashboard`
- Page shows login screen
- After login, redirects back to `/dashboard`

---

### Test 3: Invalid Token Validation

**Steps:**
1. While logged in, open DevTools Console
2. Set an invalid token:
   ```javascript
   localStorage.setItem('access_token', 'invalid-token-12345');
   ```
3. Refresh the page (F5)

**Expected Result:**
- `AuthContext` tries to validate token with `/auth/me`
- API returns 401
- Token cleared from localStorage
- Redirect to `/login?redirect=/dashboard`

---

### Test 4: Public Routes (No Redirect)

**Steps:**
1. Clear localStorage token
2. Navigate to `https://time.seemplifyai.com/login`
3. Navigate to `https://time.seemplifyai.com/oidc/callback`

**Expected Result:**
- No redirect happens
- Login page loads normally
- OIDC callback page loads normally

---

### Test 5: Redirect URL Preservation

**Steps:**
1. Clear localStorage token
2. Navigate to `https://time.seemplifyai.com/reports`
3. Should redirect to `/login?redirect=/reports`
4. Check URL bar - should see `?redirect=/reports`
5. Log in
6. After successful login

**Expected Result:**
- Redirected back to `/reports` (original destination)
- Not redirected to default `/dashboard`

---

### Test 6: API Error During Active Session

**Steps:**
1. Log in normally
2. Navigate to dashboard
3. Open DevTools Console
4. Simulate token expiration:
   ```javascript
   // Wait a moment, then clear token
   setTimeout(() => {
     localStorage.removeItem('access_token');
     // Try to make an API call
     fetch('https://api-time.seemplifyai.com/api/clock/status')
       .then(r => r.json())
       .catch(err => console.log('Error:', err));
   }, 2000);
   ```

**Expected Result:**
- API call fails with 401
- Axios interceptor catches error
- Automatic redirect to login
- Original page path preserved in redirect URL

---

## 🔍 VERIFICATION CHECKLIST

### Console Checks
- [ ] No redirect loops (check console for repeated redirects)
- [ ] Auth errors logged: "Authentication error - redirecting to login"
- [ ] No errors when on public routes

### Network Checks (DevTools → Network tab)
- [ ] 401 responses trigger redirect
- [ ] `/auth/me` call fails when token invalid
- [ ] Redirect happens before other API calls complete

### URL Checks
- [ ] Redirect URL preserved: `/login?redirect=/original-path`
- [ ] After login, redirects to original path
- [ ] Public routes don't have redirect query param

### Behavior Checks
- [ ] Loading spinner shows while checking auth
- [ ] No flash of protected content before redirect
- [ ] Token cleared from localStorage before redirect
- [ ] Can log in successfully after redirect

---

## 🐛 TROUBLESHOOTING

### Issue: Redirect Loop
**Symptoms:** Page keeps redirecting between login and dashboard

**Fix:**
- Check `isRedirecting` flag is working
- Verify public route detection
- Check console for errors

### Issue: Not Redirecting
**Symptoms:** Page shows error instead of redirecting

**Fix:**
- Check axios interceptor is registered
- Verify `authGuard.ts` is imported correctly
- Check network tab for 401 responses

### Issue: Redirect URL Not Preserved
**Symptoms:** Always redirects to `/dashboard` after login

**Fix:**
- Check `redirect` query parameter in URL
- Verify login page reads query param
- Check OIDC callback handles redirect

---

## 📝 TEST RESULTS TEMPLATE

```
Test Date: __________
Browser: __________
URL: __________

Test 1 - Expired Token: [ ] Pass [ ] Fail
Test 2 - No Token: [ ] Pass [ ] Fail
Test 3 - Invalid Token: [ ] Pass [ ] Fail
Test 4 - Public Routes: [ ] Pass [ ] Fail
Test 5 - Redirect URL: [ ] Pass [ ] Fail
Test 6 - API Error: [ ] Pass [ ] Fail

Notes:
_________________________________
_________________________________
```

---

## ✅ SUCCESS CRITERIA

All tests pass if:
1. ✅ Automatic redirect happens on 401/403 errors
2. ✅ No redirect loops occur
3. ✅ Public routes load without redirect
4. ✅ Redirect URL is preserved and used after login
5. ✅ Token is cleared before redirect
6. ✅ Loading states work correctly
7. ✅ No console errors (except expected auth errors)

---

**Ready for testing!** Follow the test scenarios above to verify auth guard functionality.
