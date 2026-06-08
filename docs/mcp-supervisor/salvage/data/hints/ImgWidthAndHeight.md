An `<img>` tag is missing `width` and/or `height` attributes. This causes layout shift (CLS) as the browser doesn't know the image dimensions until it loads.

**How to fix:**

Add explicit `width` and `height` attributes to all `<img>` tags:

```html
<!-- WRONG -->
<img src="{{ image_url }}" alt="Product">

<!-- CORRECT -->
<img src="{{ image_url }}" alt="Product" width="300" height="200">
```

**For responsive images**, use CSS to override dimensions while keeping the aspect ratio hint:

```html
<img src="{{ image_url }}" alt="Product" width="300" height="200"
     style="width: 100%; height: auto;">
```

**Why this matters:**
- Improves Core Web Vitals (Cumulative Layout Shift)
- Better user experience — no content jumping as images load
- Required for good Lighthouse scores