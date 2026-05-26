// Package stream - Stream Processor
package main

import (
	"fmt"
)

type Processor struct {
	ch chan interface{}
	done chan bool
}

func New() *Processor {
	return &Processor{
		ch: make(chan interface{}, 100),
		done: make(chan bool),
	}
}

func (p *Processor) Process(fn func(interface{})) {
	for {
		select {
		case msg := <-p.ch:
			fn(msg)
		case <-p.done:
			return
		}
	}
}

func (p *Processor) Submit(msg interface{}) {
	p.ch <- msg
}

func (p *Processor) Stop() {
	p.done <- true
}

func main() {
	p := New()
	go p.Process(func(m interface{}) { fmt.Println("Processed:", m) })
	p.Submit("hello")
	p.Stop()
}