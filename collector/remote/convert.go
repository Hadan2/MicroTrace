package remote

import (
	"microtrace/collector/model"
	pb "microtrace/collector/model/pb"
)

func eventToPB(e model.Event) *pb.TelemetryEvent {
	return &pb.TelemetryEvent{
		Type:      e.Type,
		Pid:       e.PID,
		Comm:      e.Comm,
		Saddr:     e.SAddr,
		Daddr:     e.DAddr,
		Dport:     uint32(e.DPort),
		LatencyUs: e.LatencyUs,
		JitterUs:  e.JitterUs,
	}
}

func eventFromPB(e *pb.TelemetryEvent) model.Event {
	return model.Event{
		Type:      e.GetType(),
		PID:       e.GetPid(),
		Comm:      e.GetComm(),
		SAddr:     e.GetSaddr(),
		DAddr:     e.GetDaddr(),
		DPort:     uint16(e.GetDport()),
		LatencyUs: e.GetLatencyUs(),
		JitterUs:  e.GetJitterUs(),
	}
}

func resourceToPB(r model.ResourceSnapshot) *pb.TelemetryResource {
	return &pb.TelemetryResource{
		ServiceName:      r.ServiceName,
		TimestampMs:      r.TimestampMs,
		CpuPct:           r.CPUPct,
		CpuThrottlePct:   r.CPUThrottlePct,
		MemCurrentBytes:  r.MemCurrentBytes,
		MemLimitBytes:    r.MemLimitBytes,
		MemPressurePct:   r.MemPressurePct,
		IoReadBytesPerS:  r.IOReadBytesPerS,
		IoWriteBytesPerS: r.IOWriteBytesPerS,
		IoWaitPct:        r.IOWaitPct,
		OomKillCount:     r.OOMKillCount,
		PsiMemSomePct:    r.PSIMemSomePct,
		PsiMemFullPct:    r.PSIMemFullPct,
	}
}

func resourceFromPB(r *pb.TelemetryResource) model.ResourceSnapshot {
	return model.ResourceSnapshot{
		ServiceName:      r.GetServiceName(),
		TimestampMs:      r.GetTimestampMs(),
		CPUPct:           r.GetCpuPct(),
		CPUThrottlePct:   r.GetCpuThrottlePct(),
		MemCurrentBytes:  r.GetMemCurrentBytes(),
		MemLimitBytes:    r.GetMemLimitBytes(),
		MemPressurePct:   r.GetMemPressurePct(),
		IOReadBytesPerS:  r.GetIoReadBytesPerS(),
		IOWriteBytesPerS: r.GetIoWriteBytesPerS(),
		IOWaitPct:        r.GetIoWaitPct(),
		OOMKillCount:     r.GetOomKillCount(),
		PSIMemSomePct:    r.GetPsiMemSomePct(),
		PSIMemFullPct:    r.GetPsiMemFullPct(),
	}
}
