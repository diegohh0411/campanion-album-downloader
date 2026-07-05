(function() {
  console.log("Campanion Extension (inject.js): Main-world script injected successfully.");

  // Intercept XMLHttpRequest to capture the active Authorization header
  try {
    const rawSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
      if (header && header.toLowerCase() === 'authorization' && value && value.startsWith('Bearer ')) {
        const token = value.substring(7).trim();
        if (token && token.startsWith('eyJ')) {
          console.log("Campanion Extension (inject.js): Intercepted active XHR Authorization token! Length: " + token.length);
          document.documentElement.setAttribute('data-campanion-token', token);
          document.dispatchEvent(new CustomEvent('CAMPANION_TOKEN_FOUND', { detail: token }));
        }
      }
      return rawSetRequestHeader.apply(this, arguments);
    };
    console.log("Campanion Extension (inject.js): XHR interceptor established.");
  } catch (e) {
    console.error("Campanion Extension (inject.js): Failed to establish XHR interceptor:", e);
  }

  // Intercept window.fetch to capture the active Authorization header
  try {
    const rawFetch = window.fetch;
    window.fetch = async function(resource, config) {
      if (config && config.headers) {
        let authHeader = null;
        if (config.headers instanceof Headers) {
          authHeader = config.headers.get('authorization');
        } else if (typeof config.headers === 'object') {
          authHeader = config.headers['Authorization'] || config.headers['authorization'];
        }
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7).trim();
          if (token && token.startsWith('eyJ')) {
            console.log("Campanion Extension (inject.js): Intercepted active Fetch Authorization token! Length: " + token.length);
            document.documentElement.setAttribute('data-campanion-token', token);
            document.dispatchEvent(new CustomEvent('CAMPANION_TOKEN_FOUND', { detail: token }));
          }
        }
      }
      return rawFetch.apply(this, arguments);
    };
    console.log("Campanion Extension (inject.js): Fetch interceptor established.");
  } catch (e) {
    console.error("Campanion Extension (inject.js): Failed to establish Fetch interceptor:", e);
  }

  function getAndSendToken() {
    console.log("Campanion Extension (inject.js): Attempting to retrieve token from localStorage...");
    
    // Dump all localStorage and sessionStorage keys to find where the real token resides
    console.log("Campanion Extension (inject.js): === START STORAGE DIAGNOSTIC DUMP ===");
    console.log("LocalStorage Keys:");
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || "";
      console.log(`  [LS] Key: "${k}" | Length: ${v.length} | Prefix: ${v.substring(0, 60)}`);
    }
    console.log("SessionStorage Keys:");
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      const v = sessionStorage.getItem(k) || "";
      console.log(`  [SS] Key: "${k}" | Length: ${v.length} | Prefix: ${v.substring(0, 60)}`);
      
      if (k === "__authsession__") {
        try {
          const parsed = JSON.parse(v);
          console.log("Campanion Extension (inject.js): __authsession__ root keys:", Object.keys(parsed));
          if (parsed.client) console.log("Campanion Extension (inject.js): __authsession__.client keys:", Object.keys(parsed.client));
          if (parsed.user) console.log("Campanion Extension (inject.js): __authsession__.user keys:", Object.keys(parsed.user));
          if (parsed.token || parsed.accessToken || parsed.access_token) {
            console.log("Campanion Extension (inject.js): Found flat token in __authsession__.");
          }
        } catch (e) {
          console.error("Campanion Extension (inject.js): Error parsing __authsession__ JSON:", e);
        }
      }
    }
    console.log("Campanion Extension (inject.js): === END STORAGE DIAGNOSTIC DUMP ===");

    // Helper to clean quotes and extract JWT
    function cleanToken(rawVal) {
      if (!rawVal || typeof rawVal !== 'string') return null;
      let val = rawVal.trim();
      
      // Strip outer double quotes if present (common when saved with JSON.stringify)
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).trim();
      }
      
      // Check if it's a JSON object
      if (val.startsWith('{') || val.startsWith('[')) {
        try {
          const parsed = JSON.parse(val);
          // Prioritize access token (nested under body, then flat), only then id_token
          val = (parsed.body && (parsed.body.accessToken || parsed.body.access_token)) ||
                parsed.accessToken || 
                parsed.access_token || 
                parsed.token || 
                (parsed.body && parsed.body.id_token) ||
                parsed.id_token || 
                parsed.value || 
                val;
                
          // Clean quotes again from the extracted inner value
          if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
            val = val.slice(1, -1).trim();
          }
        } catch (e) {
          console.error("Campanion Extension (inject.js): Failed parsing JSON token:", e);
        }
      }
      
      return val;
    }

    // 1. Try key for the campanion-specific token
    let token = localStorage.getItem('8bb546547d7743fb6f8bda27e1fe68e91776f199');
    if (token) {
      token = cleanToken(token);
      // If it's the ConfigCat cache (not a JWT starting with eyJ), don't use it
      if (token && !token.startsWith('eyJ')) {
        console.log("Campanion Extension (inject.js): Key '8bb546547d7743fb6f8bda27e1fe68e91776f199' does not contain a JWT. Discarding.");
        token = null;
      }
    }
    
    // 1. Explicitly check for the Auth0 key matching api.campanionapp.com (holds access token)
    const apiAuth0Key = Object.keys(localStorage).find(k => 
      k.startsWith('@@auth0spajs@@') && k.includes('https://api.campanionapp.com')
    );
    
    if (apiAuth0Key) {
      console.log(`Campanion Extension (inject.js): Targeting API-specific Auth0 key: "${apiAuth0Key}"`);
      try {
        const rawVal = localStorage.getItem(apiAuth0Key);
        const data = JSON.parse(rawVal);
        const accToken = data.body?.access_token || data.body?.accessToken || data.access_token || data.accessToken;
        token = cleanToken(accToken);
        if (token && token.startsWith('eyJ')) {
          console.log("Campanion Extension (inject.js): Successfully retrieved access token from targeted key.");
        } else {
          token = null;
        }
      } catch (e) {
        console.error("Campanion Extension (inject.js): Error parsing targeted API key:", e);
      }
    }
    
    // 2. Scan Pass 1: Scan all localStorage keys looking ONLY for access tokens (nested or flat)
    if (!token) {
      console.log("Campanion Extension (inject.js): Targeted key search failed. Scan Pass 1: Searching all localStorage keys for access tokens...");
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const rawVal = localStorage.getItem(key);
        if (rawVal && rawVal.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(rawVal);
            const accToken = (parsed.body && (parsed.body.accessToken || parsed.body.access_token)) ||
                              parsed.accessToken || parsed.access_token || parsed.token;
            if (accToken && typeof accToken === 'string') {
              const cleaned = cleanToken(accToken);
              if (cleaned && cleaned.startsWith('eyJ') && cleaned.split('.').length >= 3) {
                console.log(`Campanion Extension (inject.js): Automatically detected valid Access Token in key '${key}'.`);
                token = cleaned;
                break;
              }
            }
          } catch (e) {}
        }
      }
    }

    // 3. Scan Pass 2 (fallback): Scan all localStorage keys for ANY valid JWT (e.g. id_token)
    if (!token) {
      console.log("Campanion Extension (inject.js): Scan Pass 1 failed. Scan Pass 2: Scanning for any valid JWT...");
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const rawVal = localStorage.getItem(key);
        const cleaned = cleanToken(rawVal);
        if (cleaned && cleaned.startsWith('eyJ') && cleaned.split('.').length >= 3) {
          console.log(`Campanion Extension (inject.js): Automatically detected general JWT token in key '${key}'.`);
          token = cleaned;
          break;
        }
      }
    }

    // 4. Scan Pass 3: SessionStorage access tokens
    if (!token) {
      console.log("Campanion Extension (inject.js): Scanning all sessionStorage keys for an access token...");
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const rawVal = sessionStorage.getItem(key);
        if (rawVal && rawVal.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(rawVal);
            const accToken = (parsed.body && (parsed.body.accessToken || parsed.body.access_token)) ||
                              parsed.accessToken || parsed.access_token || parsed.token;
            if (accToken && typeof accToken === 'string') {
              const cleaned = cleanToken(accToken);
              if (cleaned && cleaned.startsWith('eyJ') && cleaned.split('.').length >= 3) {
                console.log(`Campanion Extension (inject.js): Automatically detected valid Access Token in sessionStorage key '${key}'.`);
                token = cleaned;
                break;
              }
            }
          } catch (e) {}
        }
      }
    }

    // 5. Try explicit Auth0 key fallback (as last resort)
    if (!token) {
      console.log("Campanion Extension (inject.js): Checking Auth0 storage explicitly...");
      const auth0Key = Object.keys(localStorage).find(key => key.startsWith('@@auth0spajs@@'));
      if (auth0Key) {
        try {
          const data = JSON.parse(localStorage.getItem(auth0Key));
          token = cleanToken(data.body?.access_token || data.access_token || data.id_token);
          if (token) {
            console.log("Campanion Extension (inject.js): Extracted token from Auth0 storage.");
          }
        } catch (e) {
          console.error("Campanion Extension (inject.js): Error parsing Auth0 JSON:", e);
        }
      }
    }
    
    if (token) {
      console.log("Campanion Extension (inject.js): Token validated (Prefix: " + token.substring(0, 10) + "...). Length: " + token.length);
      document.documentElement.setAttribute('data-campanion-token', token);
      document.dispatchEvent(new CustomEvent('CAMPANION_TOKEN_FOUND', { detail: token }));
      return true;
    }
    
    console.warn("Campanion Extension (inject.js): No valid token found in localStorage.");
    return false;
  }

  // Listen for request events from content.js (in case it loaded late)
  document.addEventListener('CAMPANION_TOKEN_REQUEST', () => {
    console.log("Campanion Extension (inject.js): Token request event received from content script.");
    getAndSendToken();
  });

  // Attempt to read token immediately
  if (!getAndSendToken()) {
    console.log("Campanion Extension (inject.js): Token not found immediately. Starting polling...");
    const interval = setInterval(() => {
      if (getAndSendToken()) {
        console.log("Campanion Extension (inject.js): Token retrieved during polling. Stopping poll.");
        clearInterval(interval);
      }
    }, 1000);
    
    // Stop polling after 15 seconds
    setTimeout(() => {
      console.log("Campanion Extension (inject.js): Polling timeout reached.");
      clearInterval(interval);
    }, 15000);
  }
})();
