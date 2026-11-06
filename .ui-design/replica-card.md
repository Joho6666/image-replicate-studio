# Replica card: Pinterest -> 图片复刻 Studio (existing redesign, mode D)

template_name: Pinterest search-results grid (logged-out view)
primary_url: https://www.pinterest.com/search/pins/?q=korean%20street%20style%20photography
page_type: image-first tool UI (gallery of generated photos, not a landing page)
viewport observed: ~849 px wide pane; login modal covered most of the page, so only the header and the first row of pins were visible.

## Measured in the browser (DOM, computed styles)
- body text #211922, font stack starts with "Pin Sans" then system sans
- buttons: height 48 px, radius 16 px; neutral button fill rgb(229,229,224) (#e5e5e0); primary fill #e60023
- grid gap between pins: 16 px; pin column width about 259 px at this viewport; images keep their own aspect ratios (heights 388 / 460 / 561 for the same width)
- header height 80 px, transparent over white

## Estimated from the screenshot (not measured)
- pin corner radius about 16 px; no borders or shadows on pins; metadata under pins is minimal
- selected/active state is a solid dark pill

## Unknown (login wall)
- hover overlay details, pin detail page, board pages, dark mode

## Rules for the Studio (each bound to a region)
1. Gallery: masonry columns, 16 px gap, images at their natural aspect ratio, 16 px radius, no card border. (region: #gallery .cards)
2. Chrome hides until needed: stars, select box and action buttons appear as an overlay on hover (always visible on touch). (region: .card .body)
3. Neutral UI, one accent: white page, #211922 ink, #e5e5e0 neutral pills, #e60023 only for the primary action and focus of attention. (tokens)
4. Tabs and project rows are pills; the active one is a solid dark pill. (region: #tabs, #projects)
5. QA result is a small chip on the image corner, not a text line under it. (region: .qa-chip)
6. Job groups lose their boxes: a quiet caption row, then the grid. (region: .job)
7. Mobile: sidebar becomes a horizontal chip row; masonry drops to 2 columns. (media query)

## Adaptation boundary
No Pinterest brand assets, logo, wordmark or copy. Only layout principles and neutral tokens. All Studio behaviour, routes and class hooks used by app.js stay unchanged.
