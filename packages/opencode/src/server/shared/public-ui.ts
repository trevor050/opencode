// Static UI assets the browser fetches without app-managed credentials, e.g.
// the manifest link in <head>. These bypass auth so the page can install/render
// the manifest icons even when a server password is configured.
export const PUBLIC_UI_PATHS = new Set<string>([
  "/site.webmanifest",
  "/web-app-manifest-192x192.png",
  "/web-app-manifest-512x512.png",
  "/ulm/credentials",
])

export function isPublicUIPath(method: string, pathname: string) {
  if (method === "GET" && PUBLIC_UI_PATHS.has(pathname)) return true
  if (/^\/ulm\/operation\/[^/]+\/credentials$/.test(pathname)) return method === "GET" || method === "POST"
  if (/^\/ulm\/operation\/[^/]+\/credentials\/submit$/.test(pathname)) return method === "POST"
  if (/^\/ulm\/operation\/[^/]+\/credentials\/[^/]+$/.test(pathname)) return method === "DELETE"
  return false
}
