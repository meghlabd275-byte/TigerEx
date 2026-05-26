package main

import (
	"fmt"
	"time"
)

// Dataset sensitivity
type Sensitivity string

const (
	SensitivityPublic Sensitivity = "public"
	SensitivityInternal Sensitivity = "internal"
	SensitivityConfidential Sensitivity = "confidential"
	SensitivityRestricted Sensitivity = "restricted"
)

// Dataset
type Dataset struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Description string   `json:"description"`
	Owner     string     `json:"owner"`
	Sensitivity Sensitivity `json:"sensitivity"`
	PIIFields []string `json:"piiFields"`
	Retention int       `json:"retentionDays"`
	Schema   string    `json:"schema"`
	Location string    `json:"location"`
	CreatedAt int64     `json:"createdAt"`
}

// Lineage edge
type LineageEdge struct {
	FromDataset string `json:"fromDataset"`
	ToDataset  string `json:"toDataset"`
	Transform string `json:"transform"`
}

// Enterprise data platform
type EnterpriseDataPlatform struct {
	Datasets map[string]*Dataset
	Lineage  []LineageEdge
	PIITags map[string][]string
}

// New creates platform
func NewEnterpriseDataPlatform() *EnterpriseDataPlatform {
	return &EnterpriseDataPlatform{
		Datasets: make(map[string]*Dataset),
		Lineage: make([]LineageEdge, 0),
		PIITags: make(map[string][]string),
	}
}

// Register dataset
func (p *EnterpriseDataPlatform) RegisterDataset(name, desc, owner, schema, location string, sensitivity Sensitivity, piiFields []string, retention int) *Dataset {
	id := fmt.Sprintf("DS-%d", time.Now().UnixNano())
	
	ds := &Dataset{
		ID: id,
		Name: name,
		Description: desc,
		Owner: owner,
		Sensitivity: sensitivity,
		PIIFields: piiFields,
		Retention: retention,
		Schema: schema,
		Location: location,
		CreatedAt: time.Now().UnixMilli(),
	}
	
	p.Datasets[id] = ds
	
	// Auto-tag PII
	if len(piiFields) > 0 {
		p.PIITags[id] = piiFields
	}
	
	return ds
}

// Add lineage
func (p *EnterpriseDataPlatform) AddLineage(fromDS, toDS, transform string) {
	p.Lineage = append(p.Lineage, LineageEdge{
		FromDataset: fromDS,
		ToDataset: toDS,
		Transform: transform,
	})
}

// Get PII datasets
func (p *EnterpriseDataPlatform) GetPIIDatasets() []*Dataset {
	var result []*Dataset
	for _, ds := range p.Datasets {
		if len(ds.PIIFields) > 0 {
			result = append(result, ds)
		}
	}
	return result
}

func main() {
	platform := NewEnterpriseDataPlatform()
	
	// Register dataset
	ds := platform.RegisterDataset(
		"UserTransactions",
		"User transaction history",
		"admin",
		"{userId, amount, timestamp}",
		"s3://data/transactions",
		SensitivityConfidential,
		[]string{"userId", "email"},
		365,
	)
	fmt.Printf("Dataset: %s\n", ds.Name)
	
	// Get PII
	pii := platform.GetPIIDatasets()
	fmt.Printf("PII Datasets: %d\n", len(pii))
}