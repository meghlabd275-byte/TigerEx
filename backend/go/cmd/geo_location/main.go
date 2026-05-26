// Package geo_location provides geolocation services.
// Migrated from TypeScript to Go for geographic lookup.
package main

import (
	"fmt"
	"sync"
)

// Country info
type Country struct {
	Code     string  `json:"code"`
	Name    string  `json:"name"`
	Currency string `json:"currency"`
	Language string  `json:"language"`
}

// Region location
type GeoLocation struct {
	Country   string  `json:"country"`
	Region    string  `json:"region"`
	City     string  `json:"city"`
	Timezone string  `json:"timezone"`
	ISP      string  `json:"isp"`
}

// Store
type GeoStore struct {
	mu  sync.RWMutex
	countries map[string]*Country
}

var (
	geoStore = &GeoStore{
		countries: make(map[string]*Country),
	}
)

// Initialize countries
func init() {
	countries := []*Country{
		{Code: "US", Name: "United States", Currency: "USD", Language: "en"},
		{Code: "GB", Name: "United Kingdom", Currency: "GBP", Language: "en"},
		{Code: "JP", Name: "Japan", Currency: "JPY", Language: "ja"},
		{Code: "CN", Name: "China", Currency: "CNY", Language: "zh"},
		{Code: "DE", Name: "Germany", Currency: "EUR", Language: "de"},
		{Code: "KR", Name: "South Korea", Currency: "KRW", Language: "ko"},
		{Code: "SG", Name: "Singapore", Currency: "SGD", Language: "en"},
		{Code: "AU", Name: "Australia", Currency: "AUD", Language: "en"},
	}

	geoStore.mu.Lock()
	defer geoStore.mu.Unlock()

	for _, c := range countries {
		geoStore.countries[c.Code] = c
	}
}

// Lookup by IP
func LookupByIP(ip string) *GeoLocation {
	// Simplified lookup
	return &GeoLocation{
		Country: "US",
		Region: "California",
		City: "San Francisco",
		Timezone: "America/Los_Angeles",
		ISP: "Cloud Provider",
	}
}

// Get country
func GetCountry(code string) (*Country, bool) {
	geoStore.mu.RLock()
	defer geoStore.mu.RUnlock()

	country, ok := geoStore.countries[code]
	return country, ok
}

// Supported currencies
func GetSupportedCurrencies() []string {
	return []string{"USD", "EUR", "GBP", "JPY", "CNY", "KRW", "SGD", "AUD"}
}

// Format location
func FormatLocation(loc *GeoLocation) string {
	return fmt.Sprintf("%s, %s, %s", loc.City, loc.Region, loc.Country)
}

func main() {
	fmt.Println("Geo Location service initialized")

	// Lookup
	loc := LookupByIP("8.8.8.8")
	fmt.Printf("Location: %s\n", FormatLocation(loc))

	// Countries
	us, _ := GetCountry("US")
	fmt.Printf("Country: %s (%s)\n", us.Name, us.Currency)
}