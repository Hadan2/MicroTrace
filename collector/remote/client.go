package remote

import (
	"context"
	"log"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"microtrace/collector/model"
	pb "microtrace/collector/model/pb"
)

// Client sends local edge telemetry to the central collector.
type Client struct {
	conn *grpc.ClientConn
	api  pb.TelemetryServiceClient
}

func NewClient(addr string) (*Client, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}

	c := &Client{
		conn: conn,
		api:  pb.NewTelemetryServiceClient(conn),
	}

	log.Printf("[remote] central collector 연결 준비: %s", addr)
	return c, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) SendEvents(ctx context.Context, events <-chan model.Event) error {
	stream, err := c.api.StreamEvents(ctx)
	if err != nil {
		return err
	}

	var count uint64
	for {
		select {
		case e, ok := <-events:
			if !ok {
				ack, err := stream.CloseAndRecv()
				if err != nil {
					return err
				}
				log.Printf("[remote] event stream 전송 완료: sent=%d ack=%d", count, ack.GetReceived())
				return nil
			}
			if err := stream.Send(eventToPB(e)); err != nil {
				return err
			}
			count++

		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (c *Client) SendResources(ctx context.Context, resources <-chan model.ResourceSnapshot) error {
	stream, err := c.api.StreamResources(ctx)
	if err != nil {
		return err
	}

	var count uint64
	for {
		select {
		case r, ok := <-resources:
			if !ok {
				ack, err := stream.CloseAndRecv()
				if err != nil {
					return err
				}
				log.Printf("[remote] resource stream 전송 완료: sent=%d ack=%d", count, ack.GetReceived())
				return nil
			}
			if err := stream.Send(resourceToPB(r)); err != nil {
				return err
			}
			count++

		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
