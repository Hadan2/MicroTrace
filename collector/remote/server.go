package remote

import (
	"context"
	"errors"
	"io"
	"log"
	"net"

	"google.golang.org/grpc"
	"microtrace/collector/model"
	pb "microtrace/collector/model/pb"
)

// Server receives telemetry from edge collectors and exposes it as local
// channels so the existing stats pipeline can consume it unchanged.
type Server struct {
	pb.UnimplementedTelemetryServiceServer

	grpcServer *grpc.Server
	eventCh    chan model.Event
	resourceCh chan model.ResourceSnapshot
}

func NewServer() *Server {
	return &Server{
		grpcServer: grpc.NewServer(),
		eventCh:    make(chan model.Event, 4096),
		resourceCh: make(chan model.ResourceSnapshot, 256),
	}
}

func (s *Server) Start(ctx context.Context, addr string) error {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}

	pb.RegisterTelemetryServiceServer(s.grpcServer, s)

	go func() {
		<-ctx.Done()
		s.grpcServer.GracefulStop()
		close(s.eventCh)
		close(s.resourceCh)
	}()

	go func() {
		log.Printf("[remote] gRPC telemetry 서버 시작: %s", addr)
		if err := s.grpcServer.Serve(lis); err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			log.Printf("[remote] gRPC telemetry 서버 오류: %v", err)
		}
	}()

	return nil
}

func (s *Server) Events() <-chan model.Event {
	return s.eventCh
}

func (s *Server) Resources() <-chan model.ResourceSnapshot {
	return s.resourceCh
}

func (s *Server) StreamEvents(stream pb.TelemetryService_StreamEventsServer) error {
	var count uint64
	for {
		msg, err := stream.Recv()
		if err == io.EOF {
			log.Printf("[remote] event stream 종료: %d개 수신", count)
			return stream.SendAndClose(&pb.StreamAck{Received: count})
		}
		if err != nil {
			return err
		}

		select {
		case s.eventCh <- eventFromPB(msg):
			count++
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

func (s *Server) StreamResources(stream pb.TelemetryService_StreamResourcesServer) error {
	var count uint64
	for {
		msg, err := stream.Recv()
		if err == io.EOF {
			log.Printf("[remote] resource stream 종료: %d개 수신", count)
			return stream.SendAndClose(&pb.StreamAck{Received: count})
		}
		if err != nil {
			return err
		}

		select {
		case s.resourceCh <- resourceFromPB(msg):
			count++
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}
