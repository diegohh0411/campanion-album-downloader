// Background service worker to handle image fetches bypassing CORS restrictions.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_IMAGE') {
    const { url, token } = message;

    fetch(url, {
      credentials: 'include',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.arrayBuffer();
      })
      .then(buffer => {
        // Convert ArrayBuffer to an array of bytes for safest cross-context transfer
        const bytes = Array.from(new Uint8Array(buffer));
        sendResponse({ success: true, bytes });
      })
      .catch(error => {
        console.error('Fetch error in background:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // Keep message channel open for async response
  }
});
