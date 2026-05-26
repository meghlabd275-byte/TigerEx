// Package config - Config Management
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type Config struct {
	AppName string `json:"appName"`
	Port int `json:"port"`
	DB struct {
		Host string `json:"host"`
		Port int `json:"port"`
	} `json:"db"`
	Redis struct {
		Host string `json:"host"`
		Port int `json:"port"`
	} `json:"redis"`
	LogLevel string `json:"logLevel"`
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func Save(cfg *Config, path string) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func main() {
	cfg := &Config{
		AppName: "TigerEx",
		Port: 8080,
	}
	cfg.DB.Host = "localhost"
	cfg.DB.Port = 5432
	cfg.Redis.Host = "localhost"
	cfg.Redis.Port = 6379
	cfg.LogLevel = "info"

	Save(cfg, "config.json")
	fmt.Println("Config saved")

	loaded, _ := Load("config.json")
	fmt.Printf("Loaded: %s on :%d\n", loaded.AppName, loaded.Port)
}