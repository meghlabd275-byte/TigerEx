// =============================================================================
// TIGEREX LANGUAGE OWNERSHIP MATRIX
// Internationalization (i18n) and localization management
// Built with Go for high-load worldwide distributed systems
// =============================================================================

package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// =============================================================================
// TYPES
// =============================================================================

// Language represents a supported language
type Language struct {
	Code         string   `json:"code"` // en, zh, ja, ko, etc.
	Name         string   `json:"name"`
	NativeName   string   `json:"nativeName"`
	Direction    string   `json:"direction"` // ltr, rtl
	Status       string   `json:"status"` // active, beta, pending
	Completeness float64  `json:"completeness"` // 0-100%
	LastUpdated  time.Time `json:"lastUpdated"`
}

// TranslationKey represents a translation key
type TranslationKey struct {
	Key         string   `json:"key"`
	Description string   `json:"description"`
	Context     string   `json:"context"`
	Category    string   `json:"category"` // auth, trading, wallet, etc.
}

// Translation represents a translation
type Translation struct {
	LanguageCode string    `json:"languageCode"`
	Key          string    `json:"key"`
	Value        string    `json:"value"`
	Status       string    `json:"status"` // approved, pending, needs_review
	UpdatedAt    time.Time `json:"updatedAt"`
	UpdatedBy    string    `json:"updatedBy"`
}

// Translator represents a translator
type Translator struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Email       string   `json:"email"`
	Languages   []string `json:"languages"` // Language codes
	Role        string   `json:"role"` // TRANSLATOR, REVIEWER, MANAGER
	Status      string   `json:"status"` // active, inactive
	JoinedAt    time.Time `json:"joinedAt"`
}

// TranslationRequest represents translation request
type TranslationRequest struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	FromLang    string    `json:"fromLang"`
	ToLang      string    `json:"toLang"`
	Status      string    `json:"status"` // pending, in_progress, completed
	Priority    string    `json:"priority"` // low, medium, high, urgent
	RequestedBy string    `json:"requestedBy"`
	AssignedTo  string    `json:"assignedTo"`
	DueDate     *time.Time `json:"dueDate"`
	CompletedAt *time.Time `json:"completedAt"`
	CreatedAt   time.Time `json:"createdAt"`
}

// =============================================================================
// I18N SERVICE
// =============================================================================

// I18NService handles internationalization
type I18NService struct {
	mu              sync.RWMutex
	languages       map[string]*Language
	translationKeys map[string]*TranslationKey
	translations    map[string]map[string]*Translation // lang -> key -> translation
	translators     map[string]*Translator
	requests        map[string]*TranslationRequest
}

// NewI18NService creates new i18n service
func NewI18NService() *I18NService {
	svc := &I18NService{
		languages:       make(map[string]*Language),
		translationKeys: make(map[string]*TranslationKey),
		translations:    make(map[string]map[string]*Translation),
		translators:     make(map[string]*Translator),
		requests:        make(map[string]*TranslationRequest),
	}
	
	// Initialize languages
	svc.initLanguages()
	
	// Initialize translation keys
	svc.initTranslationKeys()
	
	return svc
}

func (s *I18NService) initLanguages() {
	languages := []*Language{
		{Code: "en", Name: "English", NativeName: "English", Direction: "ltr", Status: "active", Completeness: 100.0, LastUpdated: time.Now()},
		{Code: "zh", Name: "Chinese", NativeName: "中文", Direction: "ltr", Status: "active", Completeness: 98.5, LastUpdated: time.Now()},
		{Code: "ja", Name: "Japanese", NativeName: "日本語", Direction: "ltr", Status: "active", Completeness: 95.0, LastUpdated: time.Now()},
		{Code: "ko", Name: "Korean", NativeName: "한국어", Direction: "ltr", Status: "active", Completeness: 94.0, LastUpdated: time.Now()},
		{Code: "es", Name: "Spanish", NativeName: "Español", Direction: "ltr", Status: "active", Completeness: 92.0, LastUpdated: time.Now()},
		{Code: "pt", Name: "Portuguese", NativeName: "Português", Direction: "ltr", Status: "active", Completeness: 90.0, LastUpdated: time.Now()},
		{Code: "fr", Name: "French", NativeName: "Français", Direction: "ltr", Status: "active", Completeness: 88.0, LastUpdated: time.Now()},
		{Code: "de", Name: "German", NativeName: "Deutsch", Direction: "ltr", Status: "active", Completeness: 85.0, LastUpdated: time.Now()},
		{Code: "ru", Name: "Russian", NativeName: "Русский", Direction: "ltr", Status: "active", Completeness: 80.0, LastUpdated: time.Now()},
		{Code: "ar", Name: "Arabic", NativeName: "العربية", Direction: "rtl", Status: "beta", Completeness: 75.0, LastUpdated: time.Now()},
		{Code: "hi", Name: "Hindi", NativeName: "हिन्दी", Direction: "ltr", Status: "beta", Completeness: 70.0, LastUpdated: time.Now()},
		{Code: "th", Name: "Thai", NativeName: "ไทย", Direction: "ltr", Status: "pending", Completeness: 60.0, LastUpdated: time.Now()},
		{Code: "vi", Name: "Vietnamese", NativeName: "Tiếng Việt", Direction: "ltr", Status: "pending", Completeness: 55.0, LastUpdated: time.Now()},
		{Code: "id", Name: "Indonesian", NativeName: "Bahasa Indonesia", Direction: "ltr", Status: "pending", Completeness: 50.0, LastUpdated: time.Now()},
		{Code: "tr", Name: "Turkish", NativeName: "Türkçe", Direction: "ltr", Status: "pending", Completeness: 45.0, LastUpdated: time.Now()},
	}
	
	for _, lang := range languages {
		s.languages[lang.Code] = lang
		s.translations[lang.Code] = make(map[string]*Translation)
	}
}

func (s *I18NService) initTranslationKeys() {
	keys := []struct {
		Key         string
		Description string
		Category    string
	}{
		{"auth.login", "Login button text", "auth"},
		{"auth.register", "Register button text", "auth"},
		{"auth.logout", "Logout button text", "auth"},
		{"auth.forgot_password", "Forgot password link", "auth"},
		{"trading.buy", "Buy button", "trading"},
		{"trading.sell", "Sell button", "trading"},
		{"trading.limit", "Limit order type", "trading"},
		{"trading.market", "Market order type", "trading"},
		{"wallet.balance", "Wallet balance", "wallet"},
		{"wallet.deposit", "Deposit button", "wallet"},
		{"wallet.withdraw", "Withdraw button", "wallet"},
		{"wallet.transfer", "Transfer button", "wallet"},
		{"nav.home", "Home navigation", "navigation"},
		{"nav.markets", "Markets navigation", "navigation"},
		{"nav.wallet", "Wallet navigation", "navigation"},
		{"nav.profile", "Profile navigation", "navigation"},
		{"error.network", "Network error message", "error"},
		{"error.server", "Server error message", "error"},
		{"error.auth", "Authentication error", "error"},
	}
	
	for _, k := range keys {
		s.translationKeys[k.Key] = &TranslationKey{
			Key:         k.Key,
			Description: k.Description,
			Category:    k.Category,
		}
	}
}

func (s *I18NService) GetLanguages() []*Language {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	result := make([]*Language, 0)
	for _, lang := range s.languages {
		result = append(result, lang)
	}
	return result
}

func (s *I18NService) GetLanguage(code string) (*Language, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	if lang, ok := s.languages[code]; ok {
		return lang, nil
	}
	return nil, fmt.Errorf("language not found: %s", code)
}

func (s *I18NService) GetTranslations(langCode string) (map[string]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	if _, ok := s.languages[langCode]; !ok {
		return nil, fmt.Errorf("language not found: %s", langCode)
	}
	
	result := make(map[string]string)
	for key, trans := range s.translations[langCode] {
		result[key] = trans.Value
	}
	
	return result, nil
}

func (s *I18NService) AddTranslation(langCode, key, value, updatedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	if _, ok := s.languages[langCode]; !ok {
		return fmt.Errorf("language not found: %s", langCode)
	}
	
	translation := &Translation{
		LanguageCode: langCode,
		Key:          key,
		Value:        value,
		Status:       "approved",
		UpdatedAt:    time.Now(),
		UpdatedBy:    updatedBy,
	}
	
	s.translations[langCode][key] = translation
	
	// Update completeness
	completed := len(s.translations[langCode])
	total := len(s.translationKeys)
	s.languages[langCode].Completeness = float64(completed) / float64(total) * 100
	
	return nil
}

func (s *I18NService) GetTranslationKeys(category string) []*TranslationKey {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	var result []*TranslationKey
	for _, key := range s.translationKeys {
		if category == "" || key.Category == category {
			result = append(result, key)
		}
	}
	return result
}

func (s *I18NService) GetCompletenessReport() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	report := make(map[string]interface{})
	for code, lang := range s.languages {
		report[code] = map[string]string{
			"name":         lang.Name,
			"nativeName":   lang.NativeName,
			"status":       lang.Status,
			"completeness": fmt.Sprintf("%.1f%%", lang.Completeness),
		}
	}
	
	return report
}

func (s *I18NService) ExportTranslations() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	
	data := map[string]map[string]string{}
	for langCode, trans := range s.translations {
		data[langCode] = make(map[string]string)
		for key, t := range trans {
			data[langCode][key] = t.Value
		}
	}
	
	jsonData, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", err
	}
	
	return string(jsonData), nil
}

// =============================================================================
// MAIN
// =============================================================================

func main() {
	fmt.Println("TigerEx Language Ownership Matrix (i18n)")
	fmt.Println("=====================================")
	
	i18n := NewI18NService()
	
	// Get languages
	languages := i18n.GetLanguages()
	fmt.Printf("\nSupported Languages: %d\n", len(languages))
	for _, lang := range languages {
		if lang.Status == "active" {
			fmt.Printf("  %s (%s): %s - %.1f%%\n", lang.Code, lang.NativeName, lang.Status, lang.Completeness)
		}
	}
	
	// Get translation keys by category
	keys := i18n.GetTranslationKeys("auth")
	fmt.Printf("\nTranslation Keys (auth): %d\n", len(keys))
	for _, k := range keys {
		fmt.Printf("  - %s: %s\n", k.Key, k.Description)
	}
	
	// Add translation
	err := i18n.AddTranslation("zh", "auth.login", "登录", "translator1")
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	}
	
	// Get translations
	translations, _ := i18n.GetTranslations("zh")
	fmt.Printf("\nChinese Translations: %d\n", len(translations))
	
	// Completeness report
	report := i18n.GetCompletenessReport()
	fmt.Printf("\nCompleteness Report:\n")
	for code, info := range report {
		m := info.(map[string]string)
		fmt.Printf("  %s: %s\n", code, m["completeness"])
	}
	
	// Export
	export, _ := i18n.ExportTranslations()
	fmt.Printf("\nExport (first 200 chars): %s...\n", export[:200])
}
