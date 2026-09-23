# Context budget and trigger clashes

Type: task
Status: open
Blocked by:

## Question

Every installed skill's description sits in the agent's context, and similar descriptions compete for activation. `scilla check` and the picker should show the total description size (chars and approximate tokens), warn past a budget, and flag pairs of skills whose descriptions overlap heavily (e.g. `grill-me` vs `grilling`). Start with a cheap offline heuristic (normalised token overlap / Jaccard on name and description), not embeddings.
