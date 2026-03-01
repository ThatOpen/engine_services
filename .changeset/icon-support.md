---
"thatopen-services": minor
---

Add icon support for items (apps, components, files).

**Library:** New `uploadItemIcon`, `getItemIcon`, and `removeItemIcon` methods on `EngineServicesClient` for managing item icons via the `PUT/GET/DELETE /api/item/:id/icon` endpoints. Accepts PNG, WebP, and ICO images up to 512 KB.

**CLI:** `thatopen publish --icon <path>` uploads an icon after publishing. The icon path is saved to `.thatopen` config so subsequent publishes reuse it automatically.
