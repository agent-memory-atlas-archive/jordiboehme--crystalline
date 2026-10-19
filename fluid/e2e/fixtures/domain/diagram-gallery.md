---
type: guide
title: Diagram Gallery
permalink: diagram-gallery
tags:
- smoke
status: current
recorded_at: 2026-02-04
timestamp: 2026-02-04T12:00:00+00:00
description: One diagram of every type the editor offers, plus a git graph.
---

# Diagram Gallery

One fence per diagram type, so the browser smoke can check that each one
renders in light, dark, on a phone and on paper.

## Flowchart

```mermaid
flowchart TD
    A[First step] --> B[Next step]
```

## Sequence

```mermaid
sequenceDiagram
    participant caller as Caller
    participant service as Service
    caller->>service: Request
    service-->>caller: Reply
```

## State

```mermaid
stateDiagram-v2
    state "First" as s1
    state "Second" as s2
    [*] --> s1
    s1 --> s2 : event
    s2 --> [*]
```

## Class

```mermaid
classDiagram
    class order["Order"] {
        +String reference
        +total() float
    }
    class item["Item"]
    order --> item
```

## Entity relationship

```mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
```

## Gantt

```mermaid
gantt
    title Plan
    dateFormat YYYY-MM-DD
    section Delivery
        First task :a1, 2026-01-06, 7d
        Second task :after a1, 5d
```

## Pie

```mermaid
pie title Share
    "First slice" : 60
    "Second slice" : 40
```

## Timeline

```mermaid
timeline
    title Milestones
    2026 Q1 : Kickoff
    2026 Q2 : Launch
```

## User journey

```mermaid
journey
    title First visit
    section Sign up
        Find the site: 5: Visitor
        Create an account: 3: Visitor
```

## Quadrant chart

```mermaid
quadrantChart
    title Priorities
    x-axis Low effort --> High effort
    y-axis Low impact --> High impact
    quadrant-1 Do now
    quadrant-2 Schedule
    quadrant-3 Drop
    quadrant-4 Delegate
    First idea: [0.7, 0.8]
```

## Mindmap

```mermaid
mindmap
    root((Central idea))
        First branch
            A detail
        Second branch
```

## C4 context

```mermaid
C4Context
    title System context
    Person(customer, "Customer", "A person with an account")
    System(platform, "Platform", "Does the work")
    Rel(customer, platform, "Uses")
```

## Requirement

```mermaid
requirementDiagram
    requirement first_requirement {
        id: 1
        text: The system shall do the thing
        risk: medium
        verifymethod: test
    }
    element first_check {
        type: simulation
    }
    first_check - satisfies -> first_requirement
```

## Architecture

```mermaid
architecture-beta
    group platform(cloud)[Platform]
    service api(server)[API] in platform
    service store(database)[Store] in platform
    api:R -- L:store
```

## XY chart

```mermaid
xychart-beta
    title "Monthly total"
    x-axis [jan, feb, mar]
    y-axis "Amount" 0 --> 100
    bar [30, 50, 80]
    line [20, 60, 70]
```

## Radar

```mermaid
radar-beta
    title Team skills
    axis s["Speed"], q["Quality"], c["Cost"]
    curve now["Today"]{70, 80, 60}
```

## Git graph

```mermaid
gitGraph
    commit id: "first"
    branch feature
    checkout feature
    commit id: "second"
    checkout main
    merge feature
    commit id: "third"
```
