// Package analyze - Log Analysis
package main

import (
	"fmt"
	"regexp"
	"strings"
)

type Analyzer struct{}

func (a *Analyzer) ParseLog(line string) map[string]string {
	re := regexp.MustCompile(`(\w+)=(\S+)`)
	matches := re.FindAllStringSubmatch(line, -1)
	result := make(map[string]string)
	for _, m := range matches {
		if len(m) == 3 {
			result[m[1]] = m[2]
		}
	}
	return result
}

func (a *Analyzer) DetectAnomaly(line string) bool {
	anomalies := []string{"error", "fail", "timeout"}
	lower := strings.ToLower(line)
	for _, w := range anomalies {
		if strings.Contains(lower, w) {
			return true
		}
	}
	return false
}

func main() {
	a := Analyzer{}
	fmt.Println(a.ParseLog("level=info msg=test"))
	fmt.Println(a.DetectAnomaly("Connection failed"))
}