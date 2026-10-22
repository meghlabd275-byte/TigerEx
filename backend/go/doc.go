// Package backend is the TigerEx Go backend module root.
//
// Runnable services live in cmd/*; reusable libraries live in internal/* and
// services/*. The root package itself only holds module-level documentation.
//
// The legacy/ directory holds an earlier, unreferenced generation of this
// backend that duplicated the services in this module and shipped clients for
// third-party exchanges. It is quarantined, not wired into any binary, and must
// not be depended upon: TigerEx runs its own matching engine, order books and
// custody rather than routing to another venue.
package backend
