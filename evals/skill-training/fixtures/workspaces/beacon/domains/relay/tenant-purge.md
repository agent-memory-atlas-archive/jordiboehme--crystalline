---
type: runbook
title: Tenant purge
permalink: tenant-purge
tags:
- relay
- purge
status: stable
recorded_at: 2026-10-17
generated: { by: process:crystalline-cli, at: 2026-10-17T11:22:32.009242+00:00 }
---

Removing a tenant from the relay for good.

- [fact] The purge deletes the tenant, its queues and every backup of them #relay
- [risk] A purge cannot be undone and the backups are gone with it #relay
- [convention] Export the tenant before a purge #relay
