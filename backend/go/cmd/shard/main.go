// Package shard - Database Sharding
package main

import (
	"fmt"
	"hash/fnv"
)

type Shard struct {
	ID, RangeStart, RangeEnd int
	Data map[string]interface{}
}

type Sharding struct {
	shards []*Shard
	numShards int
}

func New(num int) *Sharding {
	s := &Sharding{numShards: num, shards: make([]*Shard, num)}
	for i := 0; i < num; i++ {
		s.shards[i] = &Shard{ID: i, Data: make(map[string]interface{})}
	}
	return s
}

func (sh *Sharding) GetShard(key string) *Shard {
	h := fnv.New32a()
	h.Write([]byte(key))
	return sh.shards[int(h.Sum32())%sh.numShards]
}

func (sh *Sharding) Put(key string, val interface{}) {
	shard := sh.GetShard(key)
	shard.Data[key] = val
}

func main() {
	s := New(4)
	s.Put("user1", "data")
	fmt.Println("Sharded")
}