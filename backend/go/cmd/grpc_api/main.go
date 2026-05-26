// Package grpc_api - gRPC API Server
package main

import (
	"fmt"
	"net"
	"google.golang.org/grpc"
)

type Server struct {
	UnimplementedAPIServer
}

func (s *Server) GetUser(req *UserRequest) (*UserResponse, error) {
	return &UserResponse{UserId: req.UserId, Username: "user"}, nil
}

func main() {
	lis, _ := net.Listen("tcp", ":50051")
	server := grpc.NewServer()
	RegisterAPIServer(server, &Server{})
	server.Serve(lis)
	fmt.Println("gRPC on :50051")
}