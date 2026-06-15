---
"@thatopen/services": minor
---

CLI: auto-configure `.npmrc` for private beta packages.

`thatopen create --beta` (and `thatopen login` inside a beta project) now fetch
read-only npm credentials from the platform and write a project `.npmrc`, so
`npm install` of the private `@thatopen-platform/*-beta` packages just works for
Founding members — no manual token setup. Adds
`EngineServicesClient.getNpmCredentials()` and exports the `NpmCredentials` type.
