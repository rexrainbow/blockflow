# AABB exterior feedback routing

Each pair uses identical block geometry and ELK layout. Only layout.feedbackRouting changes.
outer computes the active block AABB, expands by margin, checks top/bottom candidates, and chooses by bends then length.
Main exterior segment passes through two AABB corners; endpoint elbows preserve output/input directions.
Blocked endpoint access preserves the ELK route with routingInfo.reason=outer-access-blocked. It never moves a block.
Widths and heights exclude SVG margins. Output normalization may uniformly translate the graph.

| Case | Routing | Feedback bends | Feedback length | Total bends | Width | Height |
| --- | --- | --- | --- | --- | --- | --- |
| feedback | elk | 4 | 1728 | 10 | 1174.5 | 516.25 |
| feedback | outer | 4 | 1766 | 10 | 1194.5 | 526.25 |
| stress | elk | 4 | 1696 | 10 | 1174.5 | 651.25 |
| stress | outer | 4 | 1756 | 10 | 1194.5 | 661.25 |

## Paired diagrams

- [feedback](feedback-comparison.svg)
- [stress](stress-comparison.svg)
