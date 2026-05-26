// Package api_versioning provides API versioning services.
// Migrated from TypeScript to Go for API version management.
package main

import (
	"fmt"
	"sync"
	"time"
)

// API version
type APIVersion struct {
	Version  string  `json:"version"`
	Status   string  `json:"status"` // active, deprecated, sunset
	Released int64   `json:"released"`
	SunsetDate int64 `json:"sunsetDate"`
}

// Endpoint version
type EndpointVersion struct {
	Path     string  `json:"path"`
	Version string  `json:"version"`
	Handler string  `json:"handler"`
}

// Deprecation notice
type DeprecationNotice struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	Date   int64   `json:"date"`
	Message string `json:"message"`
}

// Store
type VersionStore struct {
	mu      sync.RWMutex
	versions map[string]*APIVersion
	endpoints map[string]*EndpointVersion
}

var (
	verStore = &VersionStore{
		versions: make(map[string]*APIVersion),
		endpoints: make(map[string]*EndpointVersion),
	}
)

// Initialize versions
func init() {
	versions := []*APIVersion{
		{Version: "v1", Status: "deprecated", Released: time.Now().UnixMilli() - 31536000000, SunsetDate: time.Now().UnixMilli() + 15552000000},
		{Version: "v2", Status: "active", Released: time.Now().UnixMilli() - 15552000000, SunsetDate: 0},
		{Version: "v3", Status: "active", Released: time.Now().UnixMilli(), SunsetDate: 0},
	}

	verStore.mu.Lock()
	defer verStore.mu.Unlock()

	for _, v := range versions {
		verStore.versions[v.Version] = v
	}
}

// Get version status
func GetVersionStatus(version string) (string, bool) {
	verStore.mu.RLock()
	defer verStore.mu.RUnlock()

	v, ok := verStore.versions[version]
	return v.Status, ok
}

// Is deprecated
func IsDeprecated(version string) bool {
	status, _ := GetVersionStatus(version)
	return status == "deprecated"
}

// Get deprecation notice
func GetDeprecationNotice(version string) *DeprecationNotice {
	verStore.mu.RLock()
	defer verStore.mu.RUnlock()

	if v, ok := verStore.versions[version]; ok {
		if v.Status == "deprecated" {
			return &DeprecationNotice{
				Version: version,
				URL: "/docs/migration",
				Date: v.SunsetDate,
				Message: fmt.Sprintf("API v%s is deprecated. Please migrate to v2+", version),
			}
		}
	}

	return nil
}

// List versions
func ListVersions(status string) []*APIVersion {
	verStore.mu.RLock()
	defer verStore.mu.RUnlock()

	var result []*APIVersion
	for _, v := range verStore.versions {
		if status == "" || v.Status == status {
			result = append(result, v)
		}
	}

	return result
}

// Migrate endpoint
func MigrateEndpoint(path, fromVersion, toVersion, handler string) error {
	key := fmt.Sprintf("%s:%s", path, toVersion)

	ev := &EndpointVersion{
		Path: path,
		Version: toVersion,
		Handler: handler,
	}

	verStore.mu.Lock()
	defer verStore.mu.Unlock()
	verStore.endpoints[key] = ev

	return nil
}

func main() {
	fmt.Println("API Versioning service initialized")

	// Versions
	fmt.Println("Available versions:")
	for _, v := range ListVersions("") {
		fmt.Printf("  %s: %s\n", v.Version, v.Status)
	}

	// Check deprecation
	notice := GetDeprecationNotice("v1")
	if notice != nil {
		fmt.Printf("Deprecation: %s\n", notice.Message)
	}
}