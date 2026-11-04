# Placement comparison

All cases use RIGHT, identical ports, spacing and random seed; only placement changes.
Main-path alignment is measured on A, B, C, D. Spreads are max(Y) - min(Y); smaller means closer alignment.
Width/height exclude the 20px SVG margin. Wire length is Manhattan length summed per edge; shared segments count once per edge.
Bends count direction changes within each edge section, ignoring zero-length segments and collinear continuation.
These are observations, not guarantees of optimality or exact alignment.

| Case | Placement | Width | Height | Top Y spread | Center Y spread | Bends | Wire length |
| --- | --- | --- | --- | --- | --- | --- | --- |
| placement-branch | default | 1152 | 505 | 230 | 230 | 6 | 1215 |
| placement-branch | relaxed | 1152 | 505 | 230 | 230 | 8 | 1215 |
| placement-branch | simple | 1152 | 362 | 103 | 103 | 14 | 1245.5 |
| placement-feedback | default | 1174.5 | 516.25 | 230 | 230 | 10 | 2943 |
| placement-feedback | relaxed | 1174.5 | 516.25 | 230 | 230 | 12 | 2876 |
| placement-feedback | simple | 1174.5 | 373.25 | 103.5 | 103.5 | 24 | 2783 |
| placement-stress | default | 1174.5 | 651.25 | 120 | 108 | 10 | 2902 |
| placement-stress | relaxed | 1174.5 | 651.25 | 187 | 175 | 12 | 2835 |
| placement-stress | simple | 1174.5 | 456.25 | 176.5 | 200.5 | 24 | 3040 |

## Diagrams

- [placement-branch comparison](placement-branch-comparison.svg)
- [placement-feedback comparison](placement-feedback-comparison.svg)
- [placement-stress comparison](placement-stress-comparison.svg)
