/**
 * TemplatePreview — what future invoices from this vendor will be read with.
 * Updates live from pending assignments; when a template already exists it
 * shows the version being replaced.
 */
import { Check, Layers } from "@/components/icons";
import { MAPPING_FIELDS, type OcrWord, type VendorTemplate } from "@/lib/ap/types";
import { buildAnchorSpec, describeMapping } from "@/lib/ap/mapping";
import type { AssignmentsByField } from "./use-draft-mapping";
import { Section, SectionHeader, InfoBanner } from "./primitives";

export function TemplatePreview({
  template,
  assignments,
  words,
}: {
  template: VendorTemplate | undefined;
  assignments: AssignmentsByField;
  words: OcrWord[] | undefined;
}) {
  const pendingLines = MAPPING_FIELDS.filter((field) => assignments[field]).map((field) => {
    const assignment = assignments[field]!;
    const spec = buildAnchorSpec(words ?? [], field, assignment.zone, assignment.anchor);
    return describeMapping(field, spec, assignment.zone);
  });

  return (
    <Section>
      <SectionHeader
        title="Template preview"
        icon={<Layers className="size-3.5" />}
        hint={
          template
            ? `v${template.version} · saved ${new Date(template.updatedAt).toLocaleDateString()}`
            : "new"
        }
      />
      <div className="space-y-1.5 p-4 text-xs text-muted-foreground">
        {pendingLines.length === 0 ? (
          <p>No fields mapped yet — what you map here is what future invoices will be read with.</p>
        ) : (
          pendingLines.map((line, index) => (
            <p key={index} className="flex items-start gap-1.5">
              <Check className="mt-0.5 size-3 shrink-0 text-success-foreground" />
              <span>{line}</span>
            </p>
          ))
        )}
        {template && pendingLines.length > 0 && (
          <InfoBanner variant="warning">
            This vendor already has a template (v{template.version}). Confirming updates it — the
            previous version stays in the audit trail.
          </InfoBanner>
        )}
      </div>
    </Section>
  );
}
