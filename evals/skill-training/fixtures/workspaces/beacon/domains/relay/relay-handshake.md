---
type: runbook
title: Relay handshake
permalink: relay-handshake
tags:
- relay
- protocol
status: stable
recorded_at: 2026-10-17
generated: { by: process:crystalline-cli, at: 2026-10-17T11:03:07.488795+00:00 }
---

How a client joins the relay.

- [fact] The client sends a hello to the relay and the relay asks the auth service to check the token #relay
- [fact] The auth service answers the relay with a verdict and the relay then sends the client a ready message #relay
- [convention] The client sends no data before it has received the ready message #relay
