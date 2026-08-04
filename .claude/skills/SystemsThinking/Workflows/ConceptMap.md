# ConceptMap Workflow — SystemsThinking

## Purpose

Build a **concept map** — a visual network of entities and their labeled relationships — to understand a domain's structure. Unlike causal loop diagrams (which model *dynamics*), concept maps model *relationships* and *semantics*. Use them when you're trying to understand "what are the things, and how are they connected?"

Concept maps come from Joseph Novak's work on meaningful learning (Cornell, 1972). The key invariant: every link is a **labeled proposition**, not just an arrow.

## Invocation

- "Concept map"
- "Map the entities"
- "Relationship map"
- "Novak-style mapping"
- Early-stage domain exploration, onboarding docs, architecture overviews, knowledge capture

**Not for:** dynamic behavior (use CausalLoop), incident causation (use RootCauseAnalysis), hierarchical decomposition (use an outline or tree).

## The Structure

```
[CONCEPT A]  ──"contains"──▶  [CONCEPT B]
    │
    │"interacts with"
    ▼
[CONCEPT C]  ──"depends on"──▶  [CONCEPT D]
```

**Components:**
- **Concepts** — nodes, usually nouns or noun phrases, enclosed in boxes
- **Links** — labeled edges, describing the relationship between concepts
- **Propositions** — concept + link + concept reads as a short statement: "Concept A contains Concept B"
- **Cross-links** — links between concepts in different parts of the map, revealing non-obvious connections (these are often the most valuable insights)
- **Hierarchy** — most general concepts at top, specifics at bottom (not strictly required but helpful)

## Execution

A done map fills the output block below and answers one focus question. The probes and tests:

**Focus question.** Every map answers one specific question — without it the map is a disorganized bag of concepts. "How does authentication flow through our platform?" works; "What is authentication?" (too broad) and "Show me the auth architecture" (not a question) don't.

**Concepts.** 10-30 nouns or noun phrases at roughly the same abstraction level (don't mix "cloud computing" with "HTTP header"), each concrete enough to have relationships ("good architecture" is too vague). Re-noun any verbs — "Deployment," not "deploying."

**Hierarchy.** Arrange general (top) to specific (bottom); this gives the map spatial structure. No hierarchy emerging is a signal — either the concepts are all one level (flat map is fine) or you're missing organizing concepts to add.

**Labeled links.** Every link is a labeled proposition that reads as a valid statement concept-link-concept ("User session [uses] JWT token"). An unlabeled arrow is just "somehow related" — the label is the entire value. Common labels:

```
"contains", "has", "is a", "is part of"
"uses", "depends on", "requires"
"produces", "creates", "results in"
"triggers", "responds to", "listens for"
"reads from", "writes to"
"authenticates", "authorizes", "validates"
"owns", "manages", "monitors"
"extends", "overrides", "implements"
"precedes", "follows", "parallels"
```

**Cross-links.** Links between different regions of the map — the highest-value output. They reveal non-obvious dependencies and interactions invisible from the hierarchy (e.g. "database connection pool" [feeds back into] "request timeout policy" — pool exhaustion affects timeout behavior). A map with no cross-links usually missed the interesting relationships.

**Review.** Answer the focus question aloud walking the map; check every proposition reads as a grammatical statement, no concept is an orphan, and granularity is 10-30 concepts.

## Rendering

Concept maps benefit enormously from visual rendering.

Ask for a Mermaid concept map: the focus question as a title, the concepts as
nodes, every link carrying its label, and the cross-links drawn distinctly.

Mermaid or graphviz both work. Mermaid renders inline in most editors; graphviz produces higher-quality static images.

## Output

```
📊 CONCEPT MAP: [topic]

FOCUS QUESTION: [...]

CONCEPTS (general → specific):
- [C1], [C2], ..., [Cn]

HIERARCHY:
  [C1]
    ├─ [C2]
    │   └─ [C5]
    └─ [C3]
        └─ [C6]

PROPOSITIONS (concept → [link] → concept):
- [C1] → [contains] → [C2]
- [C2] → [uses] → [C5]
- ...

CROSS-LINKS:
- [C5] → [feeds back into] → [C3] — reveals non-obvious dependency
- [C6] → [validates through] → [C2] — hidden validation path

KEY INSIGHTS:
- [Insight from cross-link 1]
- [Insight from cross-link 2]
```

## Worked Example — a deploy pipeline

```
FOCUS QUESTION: What are the parts of our deploy pipeline, and how do they interact?

CONCEPTS (general → specific):
- Deploy pipeline (root)
- Source control, CI, Artifact registry, Environments, Observability
- Pull request, Merge queue, Build, Test suite, Image
- Staging, Production, Canary
- Metrics, Alerts, Error tracking, Rollback

PROPOSITIONS:
- Deploy pipeline → [starts at] → Pull request
- Pull request → [gated by] → Test suite
- Merge queue → [serializes] → Merges to main
- CI → [produces] → Image
- Image → [stored in] → Artifact registry
- Staging → [pulls] → Image
- Canary → [receives] → 5% of production traffic
- Observability → [watches] → Canary
- Alerts → [trigger] → Rollback

CROSS-LINKS:
- Error tracking → [blocks promotion of] → Canary  (quality gate, not a pipeline stage)
- Rollback → [redeploys a previous] → Image  (only works while the registry retains it)
- Test suite → [runs again in] → Staging  (the same suite appears at two points)

INSIGHTS:
- Rollback depends on artifact retention. The retention policy is a deploy-safety
  control that nobody thinks of as one.
- The test suite appears twice. If the two runs use different data, "passed in CI"
  and "passed in staging" are not the same claim.
- Observability only watches the canary. A failure that appears after full rollout
  has no automatic path back to Rollback.
```

## Common Mistakes

- **Unlabeled arrows.** An unlabeled arrow is just "somehow related." The label is the entire value.
- **Too many concepts.** Over 30-50 and the map is unreadable. Split into sub-maps by region.
- **Mixed abstraction levels.** "System" and "semicolon" in the same map is confusing. Keep concepts roughly homogeneous in scale.
- **Missing cross-links.** The hierarchy is the scaffolding; cross-links are the insight. A map without cross-links usually missed the interesting relationships.
- **Trying to show causation.** If arrows mean "causes," you want a CausalLoop diagram, not a concept map.
- **Concepts that are verbs.** "Running," "processing," "deploying" are activities, not concepts. Re-noun them: "Deployment," "Processing step."

## When to Use vs. Other Diagrams

| Goal | Diagram |
|------|---------|
| Understand *what things are* and *how they relate* | **Concept Map** |
| Understand *how behavior is generated over time* | CausalLoop |
| Understand *why something happened* | RCA (Fishbone, 5 Whys) |
| Model *hierarchical decomposition* | Tree / outline |
| Model *sequential steps* | Flowchart |
| Model *state transitions* | State diagram |

## Integration

- Feeds **Iceberg** — Layer 3 (structure) often benefits from a concept map of the actors and relationships
- Feeds **CausalLoop** — concepts and relationships from the map inform variables and arrows
- Render as Mermaid, Graphviz, or d2 if a picture helps

## Attribution

Joseph D. Novak, concept map methodology developed at Cornell University (1972), building on David Ausubel's theory of meaningful learning. Canonical reference: *Learning How to Learn* (Novak & Gowin, 1984). Modern software: CmapTools (IHMC), Miro, d2, Mermaid.
