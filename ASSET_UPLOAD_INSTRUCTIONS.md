# Visual Asset Upload Instructions

Please upload the visual assets into the matching folders in the project:

- Logos: `assets/logos/`
- Character images: `assets/characters/`
- UI icons and interface graphics: `assets/ui/`

Please use clear lowercase filenames with hyphens, for example:

- `assets/logos/company-logo.svg`
- `assets/characters/runner-blue.png`
- `assets/ui/play-button.svg`

Preferred formats are `.svg`, `.png`, `.jpg`, or `.webp`. Avoid spaces and special characters in filenames.

After adding the files:

```bash
git add assets/
git commit -m "Add visual assets"
git push
```

Then let the team know which files were added and their exact paths so they can reference them in the HTML or JavaScript, for example:

```html
<img src="assets/logos/company-logo.svg" alt="Company logo">
```

```javascript
const characterImage = "assets/characters/runner-blue.png";
```
