package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
)

// ============================================================================
// EXPORT SERVICE - Go Implementation
// CSV/JSON export for TigerEx
// ============================================================================

// Exporter handles data export
type Exporter struct{}

// NewExporter creates a new exporter
func NewExporter() *Exporter {
	return &Exporter{}
}

// ToCSV exports data to CSV
func (e *Exporter) ToCSV(data []map[string]interface{}, path string) error {
	if len(data) == 0 {
		return fmt.Errorf("no data to export")
	}

	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Get field names from first record
	var fields []string
	for k := range data[0] {
		fields = append(fields, k)
	}
	writer.Write(fields)

	// Write rows
	for _, row := range data {
		var record []string
		for _, field := range fields {
			record = append(record, fmt.Sprintf("%v", row[field]))
		}
		writer.Write(record)
	}

	return nil
}

// ToJSON exports data to JSON
func (e *Exporter) ToJSON(data interface{}, path string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(data)
}

// ToCSVString exports to CSV string
func (e *Exporter) ToCSVString(data []map[string]interface{}) (string, error) {
	if len(data) == 0 {
		return "", nil
	}

	var fields []string
	for k := range data[0] {
		fields = append(fields, k)
	}

	var rows [][]string
	rows = append(rows, fields)

	for _, row := range data {
		var record []string
		for _, field := range fields {
			record = append(record, fmt.Sprintf("%v", row[field]))
		}
		rows = append(rows, record)
	}

	var result string
	for _, row := range rows {
		for i, col := range row {
			if i > 0 {
				result += ","
			}
			result += col
		}
		result += "\n"
	}

	return result, nil
}

// ToJSONString exports to JSON string
func (e *Exporter) ToJSONString(data interface{}) (string, error) {
	b, err := json.MarshalIndent(data, "", "  ")
	return string(b), err
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

func main() {
	e := NewExporter()

	data := []map[string]interface{}{
		{"name": "Alice", "age": 30},
		{"name": "Bob", "age": 25},
	}

	// Export to CSV string
	csvStr, _ := e.ToCSVString(data)
	fmt.Printf("CSV:\n%s\n", csvStr)

	// Export to JSON string  
	jsonStr, _ := e.ToJSONString(data)
	fmt.Printf("JSON:\n%s\n", jsonStr)
}