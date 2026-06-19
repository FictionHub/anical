// Shared helpers for the push-* functions.

// Stable, filesystem-safe Blobs key derived from a push subscription endpoint.
export function keyFor(endpoint) {
  let h = 0;
  for (let i = 0; i < endpoint.length; i++) h = (h * 31 + endpoint.charCodeAt(i)) >>> 0;
  const tail = endpoint.slice(-24).replace(/[^a-zA-Z0-9]/g, "");
  return "sub-" + h.toString(36) + "-" + tail;
}
