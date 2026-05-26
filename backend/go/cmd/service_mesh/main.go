// Package service_mesh provides service mesh coordination.
// Migrated from TypeScript to Go for microservices orchestration.
package main

import (
	"fmt"
	"sync"
	"time"
)

// Service in mesh
type MeshService struct {
	ID          string  `json:"id"`
	Name       string  `json:"name"`
	Address   string  `json:"address"`
	Port      int     `json:"port"`
	Version   string  `json:"version"`
	Health    string  `json:"health"` // healthy, unhealthy
	Weight   int     `json:"weight"` // for load balancing
	Status    string  `json:"status"` // active
}

// Service discovery
type Discovery struct {
	ServiceName string  `json:"serviceName"`
	Instances  []*MeshService `json:"instances"`
}

// Load balancer result
type LBResult struct {
	ServiceID string `json:"serviceId"`
	Address  string `json:"address"`
}

// Store
type ServiceMeshStore struct {
	mu        sync.RWMutex
	services  map[string]*Discovery
	registry map[string]*MeshService
}

var (
	meshStore = &ServiceMeshStore{
		services: make(map[string]*Discovery),
		registry: make(map[string]*MeshService),
	}
)

// Register service
func Register(serviceName, address string, port int, version string) *MeshService {
	service := &MeshService{
		ID: fmt.Sprintf("svc_%d", time.Now().UnixNano()),
		Name: serviceName,
		Address: address,
		Port: port,
		Version: version,
		Health: "healthy",
		Weight: 100,
		Status: "active",
	}

	meshStore.mu.Lock()
	defer meshStore.mu.Unlock()

	// Add to discovery
	if disc, ok := meshStore.services[serviceName]; ok {
		disc.Instances = append(disc.Instances, service)
	} else {
		meshStore.services[serviceName] = &Discovery{
			ServiceName: serviceName,
			Instances: []*MeshService{service},
		}
	}

	meshStore.registry[service.ID] = service

	return service
}

// Deregister service
func Deregister(serviceID string) error {
	meshStore.mu.Lock()
	defer meshStore.mu.Unlock()

	service, ok := meshStore.registry[serviceID]
	if !ok {
		return fmt.Errorf("service not found")
	}

	service.Status = "inactive"

	return nil
}

// Discover services
func Discover(serviceName string) []*MeshService {
	meshStore.mu.RLock()
	defer meshStore.mu.RUnlock()

	if disc, ok := meshStore.services[serviceName]; ok {
		return disc.Instances
	}

	return nil
}

// Health check
func HealthCheck(serviceID string, health string) error {
	meshStore.mu.Lock()
	defer meshStore.mu.Unlock()

	if service, ok := meshStore.registry[serviceID]; ok {
		service.Health = health
		return nil
	}

	return fmt.Errorf("service not found")
}

// Round robin load balance
func RoundRobin(serviceName string) (*LBResult, error) {
	instances := Discover(serviceName)
	
	if len(instances) == 0 {
		return nil, fmt.Errorf("no instances found")
	}

	// Simple round robin
	static rr_index int
	instance := instances[rr_index%len(instances)]

	return &LBResult{
		ServiceID: instance.ID,
		Address: fmt.Sprintf("%s:%d", instance.Address, instance.Port),
	}, nil
}

// Least connections load balance
func LeastConnections(serviceName string) (*LBResult, error) {
	instances := Discover(serviceName)
	
	if len(instances) == 0 {
		return nil, fmt.Errorf("no instances found")
	}

	// Select least loaded healthy instance
	var best *MeshService
	var minWeight int = 999999

	for _, inst := range instances {
		if inst.Health == "healthy" && inst.Weight < minWeight {
			best = inst
			minWeight = inst.Weight
		}
	}

	if best == nil {
		return nil, fmt.Errorf("no healthy instances")
	}

	return &LBResult{
		ServiceID: best.ID,
		Address: fmt.Sprintf("%s:%d", best.Address, best.Port),
	}, nil
}

func main() {
	fmt.Println("Service Mesh initialized")

	// Register services
	Register("auth", "10.0.1.1", 8080, "v1")
	Register("auth", "10.0.1.2", 8080, "v1")
	Register("order", "10.0.2.1", 8081, "v1")

	// Discover
	authInstances := Discover("auth")
	fmt.Printf("Auth instances: %d\n", len(authInstances))

	// Load balance
	lb, _ := RoundRobin("auth")
	fmt.Printf("LB: %s\n", lb.Address)
}