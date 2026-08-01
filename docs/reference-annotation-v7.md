# Reference Annotation v7

Status: active focused bibliography contract (`deskreview_reference_annotation_v7`).

The bounded bibliography response returns each complete reference in printed
order with three provider-authored fields: `id`, `printed_label`, and `text`.
`printed_label` preserves an explicit visible numeric prefix such as `1`,
`1.`, or `[1]`, and remains empty for unnumbered author-year bibliographies.

The label is passed unchanged to the bounded relation stage. Numeric citation
styles are mapped strictly by printed labels; topical similarity must not add
or substitute references. Author-year styles continue to use the complete
reference and citation text.
