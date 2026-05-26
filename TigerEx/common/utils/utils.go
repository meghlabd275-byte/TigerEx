package common

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Date/time helpers
func Now() int64 {
	return time.Now().UnixMilli()
}

func Timestamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func ParseDate(dateStr string) (time.Time, error) {
	return time.Parse(time.RFC3339, dateStr)
}

func AddDays(t time.Time, days int) time.Time {
	return t.AddDate(0, 0, days)
}

func AddHours(t time.Time, hours int) time.Time {
	return t.Add(time.Duration(hours) * time.Hour)
}

// Number helpers
func Round(num float64, decimals int) float64 {
	factor := math.Pow10(decimals)
	return math.Round(num*factor) / factor
}

func Floor(num float64, decimals int) float64 {
	factor := math.Pow10(decimals)
	return math.Floor(num*factor) / factor
}

func Ceil(num float64, decimals int) float64 {
	factor := math.Pow10(decimals)
	return math.Ceil(num*factor) / factor
}

// Format helpers
func FormatCurrency(amount float64, decimals int) string {
	return fmt.Sprintf("%.*f", decimals, amount)
}

func FormatPercent(value float64, decimals int) string {
	return fmt.Sprintf("%.*f%%", decimals, value*100)
}

func FormatAddress(address string, start int, end int) string {
	if len(address) < start+end {
		return address
	}
	return fmt.Sprintf("%s...%s", address[:start], address[len(address)-end:])
}

// Array helpers
func Chunk[T any](array []T, size int) [][]T {
	if size <= 0 {
		size = 1
	}
	result := make([][]T, 0)
	for i := 0; i < len(array); i += size {
		end := i + size
		if end > len(array) {
			end = len(array)
		}
		result = append(result, array[i:end])
	}
	return result
}

func Unique[T comparable](array []T) []T {
	seen := make(map[T]bool)
	result := make([]T, 0)
	for _, v := range array {
		if !seen[v] {
			seen[v] = true
			result = append(result, v)
		}
	}
	return result
}

func GroupBy[T any](array []T, keyFunc func(T) string) map[string][]T {
	result := make(map[string][]T)
	for _, item := range array {
		key := keyFunc(item)
		result[key] = append(result[key], item)
	}
	return result
}

// Object helpers
func DeepClone[T any](obj T) T {
	return obj
}

func DeepMerge[T any](target, source T) T {
	return source
}

func Pick[T any, K any](obj map[K]T, keys []K) map[K]T {
	result := make(map[K]T)
	for _, key := range keys {
		if val, ok := obj[key]; ok {
			result[key] = val
		}
	}
	return result
}

func Omit[T any, K comparable](obj map[K]T, keys []K) map[K]T {
	result := make(map[K]T)
	keySet := make(map[K]bool)
	for _, key := range keys {
		keySet[key] = true
	}
	for k, v := range obj {
		if !keySet[k] {
			result[k] = v
		}
	}
	return result
}

// String helpers
func Slugify(text string) string {
	text = strings.ToLower(text)
	text = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			return r
		}
		return -1
	}, text)
	text = strings.ReplaceAll(text, "--", "-")
	return strings.Trim(text, "-")
}

func Capitalize(text string) string {
	if len(text) == 0 {
		return text
	}
	return strings.ToUpper(text[:1]) + text[1:]
}

func Truncate(text string, length int) string {
	if len(text) <= length {
		return text
	}
	return text[:length] + "..."
}

// Delay helper
func Delay(ms int) {
	time.Sleep(time.Duration(ms) * time.Millisecond
}