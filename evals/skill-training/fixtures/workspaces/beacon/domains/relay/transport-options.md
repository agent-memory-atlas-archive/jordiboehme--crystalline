---
type: reference
title: Transport options
permalink: transport-options
tags:
- relay
- transport
status: stable
recorded_at: 2026-10-17
generated: { by: process:crystalline-cli, at: 2026-10-17T11:22:32.021226+00:00 }
---

The three ways to carry relay traffic.

- [fact] WebSocket keeps one open connection and is the default for browsers, verdict recommended #relay
- [fact] Long polling works behind every proxy but costs a request per message, verdict fallback only #relay
- [fact] gRPC streams are the fastest and need HTTP/2 end to end, verdict only inside the data centre #relay
