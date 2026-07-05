## DOM Structure Analysis: Campanionap.com Photo Album

Based on my inspection of the album page (Chosatonga Main Full Week 1), here's a comprehensive description of the page's DOM structure for your extension developer:

**Page Organization & Image Discovery:**
The album displays 113 photos in a responsive grid layout. All photo links are present in the DOM at page load (not infinite scroll or pagination), which simplifies the implementation. Each image is wrapped in an `<a>` tag with `href` attributes pointing to API endpoints following the pattern: `https://api.campanionapp.com/v1/photos/{PHOTO_ID}/standard?clientid=1291`. The filename is stored in the link's text content as a generic element (e.g., "2026.07.01 Chos Olympiads-01.jpg").

**Key CSS Selectors for Implementation:**
- **Image links:** `a[href*="api.campanionapp.com/v1/photos"]` – This selector will reliably match all image download links
- **Grid container:** The photos are arranged in a responsive grid (likely 3 columns on desktop) using CSS Grid or Flexbox
- **Each photo element:** Each image is contained within a container that includes the link and associated buttons for actions like "Make Album Cover," "Rotate," and "Delete"

**Important Considerations for the Downloader:**
1. **No lazy loading:** All image links are already in the DOM when the page loads, so you don't need to trigger scrolling to reveal hidden links. However, scrolling to the bottom ensures the page is fully rendered and validates that all 113 photos are present before starting downloads.
2. **Filename extraction:** The filename is accessible from the link's inner text (the generic element inside the `<a>` tag), making it straightforward to preserve original filenames in the zip.
3. **API endpoint pattern:** The URLs follow a predictable structure with `/standard` quality and a `clientid` parameter that remains constant across links.
4. **Album metadata:** The page header contains metadata like album title ("Chosatonga Main Full Week 1"), photo count (113 photos), and date (July 5, 2026) that could be useful for naming the output zip file or creating a manifest.

This structure is very downloader-friendly—extract all `<a>` tags matching the photo URL pattern, collect their hrefs and text content, download from those URLs, and zip them together with the original filenames intact.
