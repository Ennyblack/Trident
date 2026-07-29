# Event Topic Filtering Optimization Specification

## Overview

This specification details architectural optimizations for event topic filtering within the Trident indexer streamer pipeline (`crates/indexer/src/streamer/mod.rs` and `crates/indexer/src/rpc/mod.rs`).

---

## Architectural Analysis

### Server-Side Pushdown vs. Local In-Memory Scanning

Topic filtering within Trident operates at two distinct pipeline stages:

1. **RPC Server-Side Pushdown (`crates/indexer/src/rpc/mod.rs`)**:
   - Event filtering parameters are converted into Soroban RPC `EventFilter` objects.
   - Filtering is executed at the RPC node level, reducing payload size transferred over network interfaces.

2. **Streamer In-Memory Evaluation (`crates/indexer/src/streamer/mod.rs`)**:
   - For complex, multi-topic logic (e.g. wildcards, regex patterns, or combined contract address filters), the streamer performs in-memory topic matching.
   - The linear scan $O(N \cdot M)$ over topic arrays is optimized by building an indexed hash lookup table ($O(1)$ constant time lookup).

---

## Technical Design of Indexed Topic Lookup

```rust
use std::collections::HashSet;

pub struct TopicMatcher {
    exact_topics: HashSet<String>,
}

impl TopicMatcher {
    pub fn new(topics: Vec<String>) -> Self {
        let exact_topics = topics.into_iter().collect();
        Self { exact_topics }
    }

    #[inline]
    pub fn matches(&self, topic: &str) -> bool {
        self.exact_topics.contains(topic)
    }
}
```

---

## Verification & Benchmarks

Run benchmarks to evaluate filtering performance:

```bash
cargo bench --package trident-indexer --bench topic_filtering
```
