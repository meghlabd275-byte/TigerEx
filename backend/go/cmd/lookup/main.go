// Package lookup - DNS Lookup
package main

import (
	"fmt"
	"net"
)

func Lookup(host string) ([]string, error) {
	ips, err := net.LookupHost(host)
	if err != nil {
		return nil, err
	}
	return ips, nil
}

func ReverseLookup(ip string) (string, error) {
	names, err := net.LookupAddr(ip)
	if err != nil {
		return "", err
	}
	return names[0], nil
}

func main() {
	ips, _ := Lookup("google.com")
	fmt.Println(ips)
}