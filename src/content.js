import JSZip from 'jszip';

let campanionToken = null;
let isDownloading = false;
let shouldCancel = false;
let observerStarted = false;

// Helper to check and register the token
function checkAndRegisterToken() {
  if (campanionToken) return true;

  const token = document.documentElement.getAttribute('data-campanion-token');
  if (token) {
    console.log("Campanion Extension (content.js): Token found directly on HTML element attribute.");
    campanionToken = token;
    setupObserver();
    return true;
  }
  return false;
}

// Listen for the custom event carrying the token on the shared document object.
// Live-intercepted tokens (from actual XHR/fetch calls the page makes) are always
// authoritative and must overwrite whatever was previously scanned from localStorage,
// since a cached/stale token can otherwise get stuck in campanionToken forever and
// cause every API call to 401 despite a working token being available.
document.addEventListener('CAMPANION_TOKEN_FOUND', (event) => {
  console.log("Campanion Extension (content.js): CAMPANION_TOKEN_FOUND event heard on document. Token retrieved:", !!event.detail);
  if (event.detail) {
    campanionToken = event.detail;
    if (!observerStarted) {
      console.log("Campanion Extension (content.js): Token set from event. Initializing observer...");
      setupObserver();
    }
  }
});

// Initialize token checking
if (!checkAndRegisterToken()) {
  console.log("Campanion Extension (content.js): Token not found on page load. Sending request to main world and starting fallback poll...");
  document.dispatchEvent(new CustomEvent('CAMPANION_TOKEN_REQUEST'));
  
  // Fallback poll
  const poll = setInterval(() => {
    if (checkAndRegisterToken()) {
      console.log("Campanion Extension (content.js): Token found during polling. Stopping fallback poll.");
      clearInterval(poll);
    }
  }, 1000);
  
  setTimeout(() => clearInterval(poll), 10000);
}

// 2. SPA Observer: Periodically check if we are on an album page and inject the download button
function setupObserver() {
  if (observerStarted) return;
  observerStarted = true;
  console.log("Campanion Extension (content.js): MutationObserver started checking for page elements.");
  const observer = new MutationObserver(() => {
    const titleElement = document.querySelector('[data-testid="header-title"]');
    const existingButton = document.querySelector('#campanion-zip-downloader-btn');
    
    if (titleElement) {
      if (!existingButton) {
        console.log("Campanion Extension (content.js): Header title element found. Injecting button...");
        injectDownloadButton(titleElement);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// 3. Inject "Download ZIP" Button
function injectDownloadButton(titleElement) {
  const button = document.createElement('button');
  button.id = 'campanion-zip-downloader-btn';
  button.className = 'campanion-btn-zip-download';
  button.innerHTML = `
    <span class="btn-zip-text">Download</span>
  `;
  
  // Try to find the "ADD PHOTOS" button to align next to it on the right side
  const addPhotosBtn = Array.from(document.querySelectorAll('button')).find(btn => 
    btn.textContent.trim().toUpperCase() === 'ADD PHOTOS'
  );
  
  if (addPhotosBtn) {
    console.log("Campanion Extension (content.js): Found 'ADD PHOTOS' button. Injecting downloader sibling.");
    addPhotosBtn.parentNode.insertBefore(button, addPhotosBtn);
  } else {
    console.log("Campanion Extension (content.js): 'ADD PHOTOS' button not found. Appending next to title.");
    // Append to the header title's parent container
    titleElement.parentElement.appendChild(button);
  }
  
  button.addEventListener('click', handleDownloadClick);
}

// 4. Extract Album Details
function getAlbumDetails() {
  const links = document.querySelectorAll('[data-testid="gallery-photo"] a[href*="/v1/photos/"]');
  if (links.length === 0) return null;
  
  // Extract clientid from the first link
  const firstLink = links[0].getAttribute('href');
  const urlParams = new URLSearchParams(firstLink.split('?')[1]);
  const clientId = urlParams.get('clientid');
  
  // Extract albumId from path or hash
  let albumId = null;
  const urlString = window.location.pathname + window.location.hash;
  const pathMatch = urlString.match(/\/(?:albums?|photo-albums?|gallery)\/(\d+)/i);
  if (pathMatch) {
    albumId = pathMatch[1];
  }
  
  return { clientId, albumId };
}

// 5. Gather photo information from the DOM
function getDOMPhotos() {
  const domPhotoMap = {};
  document.querySelectorAll('[data-testid="gallery-photo"]').forEach(card => {
    const link = card.querySelector('a[href*="/v1/photos/"]');
    const textNode = card.querySelector('p.chakra-text');
    if (link && textNode) {
      const href = link.getAttribute('href');
      const match = href.match(/\/photos\/(\d+)\/standard/);
      if (match) {
        const photoId = match[1];
        domPhotoMap[photoId] = textNode.textContent.trim();
      }
    }
  });
  return domPhotoMap;
}

// 5b. Auto-scroll the album so every lazy-loaded photo mounts into the DOM.
// Scrolls to the bottom repeatedly, waiting for new photos to render, and stops once
// the rendered count stays stable across several consecutive passes (or a hard cap is
// hit, to guard against runaway loops). Restores the original scroll position when done.
async function autoScrollToLoadAll(modal) {
  const countPhotos = () => document.querySelectorAll('[data-testid="gallery-photo"]').length;
  const originalScrollY = window.scrollY;

  let lastCount = countPhotos();
  let stablePasses = 0;
  const maxPasses = 200;          // hard safety cap
  const requiredStablePasses = 4; // stop after this many passes with no growth

  for (let pass = 0; pass < maxPasses && !shouldCancel; pass++) {
    // Scroll the last photo into view (works whether the scroll container is the
    // window or an inner element) and also nudge the window to the bottom.
    const cards = document.querySelectorAll('[data-testid="gallery-photo"]');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'end' });
    window.scrollTo(0, document.body.scrollHeight);

    // Give the virtualized grid time to mount the next batch.
    await new Promise(res => setTimeout(res, 450));

    const current = countPhotos();
    updateProgressModal(modal, `Loading album… ${current} photos found (scrolling)`, 0);

    if (current > lastCount) {
      lastCount = current;
      stablePasses = 0;
    } else {
      stablePasses++;
      if (stablePasses >= requiredStablePasses) break;
    }
  }

  window.scrollTo(0, originalScrollY);
  console.log(`Campanion Extension (content.js): Auto-scroll complete. ${lastCount} photos rendered.`);
}

// 6. Handle the full download-and-zip flow
async function handleDownloadClick() {
  if (isDownloading) return;
  
  const details = getAlbumDetails();
  if (!details || !details.clientId) {
    alert('Could not detect photo album metadata on this page. Please wait for the page to load.');
    return;
  }

  isDownloading = true;
  shouldCancel = false;
  
  const albumTitle = document.querySelector('[data-testid="header-title"]')?.textContent?.trim() || 'Album';
  const domPhotos = getDOMPhotos();
  
  // Show progress modal
  const modal = createProgressModal(albumTitle);
  document.body.appendChild(modal);

  try {
    // The album grid is lazy-loaded: only ~100 photos render initially and the rest
    // mount as you scroll. Auto-scroll to the bottom until the rendered count stops
    // growing, forcing every photo into the DOM before we collect. We deliberately do
    // NOT call the /v1/photos list endpoint (it has proven unreliable: 401s /
    // never-terminating pagination). Image bytes are still fetched from the per-photo
    // /standard URL via background.js using the same token the page uses.
    await autoScrollToLoadAll(modal);

    if (shouldCancel) {
      cleanupDownload(modal);
      return;
    }

    const allDomPhotos = getDOMPhotos();
    const photosList = Object.keys(allDomPhotos).map(id => ({
      id,
      fileName: allDomPhotos[id]
    }));
    console.log(`Campanion Extension (content.js): Collected ${photosList.length} photos from the DOM.`);

    if (shouldCancel) {
      cleanupDownload(modal);
      return;
    }

    if (photosList.length === 0) {
      throw new Error('No photos found in this album.');
    }

    const zip = new JSZip();
    const downloadTasks = [];
    
    updateProgressModal(modal, `Downloading 0 / ${photosList.length} images...`, 0);

    // Create pooled queue tasks
    photosList.forEach((photo, index) => {
      const photoId = photo.id;
      const fileName = photo.fileName || photo.name || domPhotos[photoId] || `Photo-${index + 1}.jpg`;
      const downloadUrl = `https://api.campanionapp.com/v1/photos/${photoId}/standard?clientid=${details.clientId}`;
      
      downloadTasks.push(async () => {
        if (shouldCancel) return;
        
        // Fetch bytes with exponential backoff retry logic
        const fileBytes = await fetchImageWithRetry(downloadUrl, campanionToken);
        if (fileBytes && !shouldCancel) {
          zip.file(fileName, new Uint8Array(fileBytes));
        }
      });
    });

    // Run queue with a concurrency limit of 5 downloads
    await runWithConcurrency(downloadTasks, 5, (completed) => {
      updateProgressModal(
        modal,
        `Downloading ${completed} / ${photosList.length} images...`,
        (completed / photosList.length) * 100
      );
    });

    if (shouldCancel) {
      cleanupDownload(modal);
      return;
    }

    // Zip and trigger native download
    updateProgressModal(modal, 'Generating ZIP package (this may take a few moments)...', 100);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    updateProgressModal(modal, 'Saving album to disk...', 100);
    triggerBlobDownload(zipBlob, `${albumTitle}.zip`);
    
    // Delay dismissal briefly for polished UX
    setTimeout(() => {
      cleanupDownload(modal);
    }, 1500);

  } catch (error) {
    console.error(error);
    alert(`Download failed: ${error.message}`);
    cleanupDownload(modal);
  }
}

// 7. Robust image fetcher with background delegation & retry mechanics
async function fetchImageWithRetry(url, token, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    if (shouldCancel) return null;
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url, token }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response.bytes);
          } else {
            reject(new Error(response ? response.error : 'Unknown background error'));
          }
        });
      });
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(res => setTimeout(res, delay * Math.pow(2, i))); // exponential backoff
    }
  }
}

// 8. Queue coordinator with concurrency constraint
async function runWithConcurrency(tasks, limit, onProgress) {
  let active = 0;
  let completed = 0;
  const queue = [...tasks];
  
  return new Promise((resolve) => {
    if (queue.length === 0) {
      resolve();
      return;
    }

    function runNext() {
      if (shouldCancel || (queue.length === 0 && active === 0)) {
        resolve();
        return;
      }
      
      while (active < limit && queue.length > 0 && !shouldCancel) {
        const task = queue.shift();
        active++;
        
        task().then(() => {
          active--;
          completed++;
          onProgress(completed);
          runNext();
        }).catch((err) => {
          console.error('Queue task failed:', err);
          active--;
          completed++;
          onProgress(completed);
          runNext();
        });
      }
    }
    
    runNext();
  });
}

// 9. UI Components and Utilities
function createProgressModal(albumTitle) {
  const overlay = document.createElement('div');
  overlay.id = 'campanion-downloader-modal-overlay';
  overlay.className = 'campanion-modal-overlay';
  
  overlay.innerHTML = `
    <div class="campanion-modal-card">
      <h3 class="modal-title">Downloading Album</h3>
      <p class="modal-album-name">${albumTitle}</p>
      <div class="modal-status-text">Initializing...</div>
      <div class="modal-progress-bar-container">
        <div class="modal-progress-bar-fill" style="width: 0%"></div>
      </div>
      <button class="modal-cancel-btn" id="campanion-modal-cancel">Cancel</button>
    </div>
  `;
  
  overlay.querySelector('#campanion-modal-cancel').addEventListener('click', () => {
    shouldCancel = true;
    overlay.querySelector('.modal-status-text').textContent = 'Cancelling download...';
  });
  
  return overlay;
}

function updateProgressModal(modal, statusText, percentage) {
  if (!modal) return;
  const textEl = modal.querySelector('.modal-status-text');
  const fillEl = modal.querySelector('.modal-progress-bar-fill');
  
  if (textEl) textEl.textContent = statusText;
  if (fillEl) fillEl.style.width = `${percentage}%`;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function cleanupDownload(modal) {
  if (modal && modal.parentNode) {
    modal.parentNode.removeChild(modal);
  }
  isDownloading = false;
  shouldCancel = false;
}

async function exchangeAuth0Token(auth0Token) {
  try {
    console.log("Campanion Extension (content.js): Calling POST /v1/auth/exchange to swap Auth0 token for Campanion API token...");
    const response = await fetch('https://api.campanionapp.com/v1/auth/exchange', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${auth0Token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log("Campanion Extension (content.js): Token exchange successful! Response keys:", Object.keys(data));
      return data.token || data.accessToken || data.access_token || data.jwt;
    } else {
      console.error(`Campanion Extension (content.js): Token exchange failed with HTTP ${response.status}:`, await response.text());
    }
  } catch (error) {
    console.error("Campanion Extension (content.js): Error during token exchange:", error);
  }
  return null;
}
