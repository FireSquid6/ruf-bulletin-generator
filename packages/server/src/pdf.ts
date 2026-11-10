import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { renderPdf, type Block, type Spec } from "@ruf/generator";
import type { Database } from "./db";
import type { createAuth } from "./auth";
import { bulletin } from "./schema";
import type { Composition } from "./drafts";

type Area = "cover" | "flow";
type Location = { area: Area; index: number; type: string };
class PdfError extends Error {
  constructor(message: string, readonly block: Location) { super(message); }
}
class PdfGenerationError extends Error {}

// The persisted composition describes reading order, not PDFKit columns or pages.
function toSpec(composition: Composition, date: string): Spec {
  const convert = (area: Area): Block[] => composition[area].map((block, index) => {
    const location = { area, index, type: block.type };
    const fail = (reason: string): never => { throw new PdfError(`${area === "cover" ? "Cover" : "Reading order"} block ${index + 1} (${block.type}): ${reason}`, location); };
    switch (block.type) {
      case "heading":
        if (typeof block.title !== "string" || !block.title.trim()) return fail("Enter heading text.");
        return { type: "heading", text: block.title };
      case "text":
        if (typeof block.text !== "string" || !block.text.trim()) return fail("Enter text.");
        return { type: "text", text: block.text };
      case "scripture":
        if (block.role !== "sermon" && block.role !== "reading") return fail("Choose Sermon passage or Scripture reading.");
        if (typeof block.reference !== "string" || !block.reference.trim() || typeof block.text !== "string" || !block.text.trim()) return fail("Enter a reference and passage text.");
        return { type: "scripture", label: block.role === "sermon" ? "Sermon Passage" : "Scripture Reading", reference: block.reference, text: block.text };
      case "announcements": {
        if (block.title !== undefined && typeof block.title !== "string") return fail("Enter a valid announcement heading.");
        if (!Array.isArray(block.items)) return fail("Announcement items must be a list.");
        const items = block.items.map((item, itemIndex) => {
          if (!item || typeof item !== "object" || item.title !== undefined && typeof item.title !== "string" || item.text !== undefined && typeof item.text !== "string" || !`${item.title ?? ""}${item.text ?? ""}`.trim()) {
            return fail(`Announcement item ${itemIndex + 1} needs a title or text.`);
          }
          return { title: item.title ?? "", text: item.text ?? "" };
        });
        return { type: "announcements", title: block.title || "Announcements", items };
      }
      case "qr": return fail("QR images and their captions/sizes are not supported in basic PDF generation yet. Your draft is unchanged.");
      case "song": return fail("Song references are not supported in basic PDF generation yet. Your draft is unchanged.");
      case "image": case "branding": return fail("Images are not supported in basic PDF generation yet. Your draft is unchanged.");
      case "contacts": return fail("Contact names and details are not supported in basic PDF generation yet. Your draft is unchanged.");
      case "spacer": return fail("Spacer blocks are not supported in basic PDF generation yet. Your draft is unchanged.");
      default: return fail("This block is not supported in basic PDF generation yet. Your draft is unchanged.");
    }
  });
  return {
    metadata: { title: `RUF Bulletin — ${date}`, subject: `Gathering on ${date}`, date },
    cover: [...convert("cover"), { type: "heading", style: "right", text: new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) }],
    flow: convert("flow"),
  };
}

async function renderDatedPdf(composition: Composition, date: string): Promise<Buffer> {
  const spec = toSpec(composition, date);
  try { return await renderPdf(spec); }
  catch (error) {
    // The folded layout can only contain three reading-order panels and one cover.
    // Locate the first prefix that fails to fit at the generator's minimum scale.
    const message = error instanceof Error ? error.message : "PDF generation failed";
    if (message.includes("does not fit")) {
      for (const area of ["cover", "flow"] as const) {
        for (let index = 0; index < spec[area]!.length; index++) {
          const prefix = { ...spec, [area]: spec[area]!.slice(0, index + 1), ...(area === "cover" ? { flow: [] } : {}) };
          try { await renderPdf(prefix); }
          catch (failure) {
            if (failure instanceof Error && failure.message.includes("does not fit")) {
              const locationIndex = area === "cover" ? Math.min(index, composition.cover.length - 1) : index;
              const type = composition[area][locationIndex]?.type ?? "date";
              throw new PdfError(`${area === "cover" ? "Cover" : "Reading order"} block ${locationIndex + 1} (${type}) does not fit on the folded A4 sheet${area === "cover" && index !== locationIndex ? " alongside the gathering date" : ""}. Shorten or move this content.`, { area, index: locationIndex, type });
            }
            throw failure;
          }
        }
      }
    }
    // An aggregate fit failure may not have a uniquely attributable block.
    // It is still a generation error, never a server crash or a partial PDF.
    if (message.includes("does not fit")) {
      throw new PdfGenerationError("Bulletin content does not fit on the folded A4 sheet. Shorten or rearrange the cover and reading-order blocks.");
    }
    throw error;
  }
}

export function pdfRoutes(db: Database, auth: ReturnType<typeof createAuth>) {
  return new Elysia({ prefix: "/api/bulletins" })
    .get("/:id/pdf", async ({ request, params, query, set }) => {
      if (!await auth.api.getSession({ headers: request.headers })) { set.status = 401; return { error: "Sign in required" }; }
      const [row] = await db.select().from(bulletin).where(eq(bulletin.id, params.id));
      if (!row) { set.status = 404; return { error: "Bulletin not found" }; }
      try {
        const bytes = await renderDatedPdf(JSON.parse(row.composition) as Composition, row.gatheringDate);
        return new Response(new Uint8Array(bytes), { headers: {
          "content-type": "application/pdf",
          "content-disposition": `${query.download === "1" ? "attachment" : "inline"}; filename="ruf-bulletin-${row.gatheringDate}.pdf"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        } });
      } catch (error) {
        if (!(error instanceof PdfError || error instanceof PdfGenerationError)) throw error;
        set.status = 422;
        return { error: error.message, ...(error instanceof PdfError ? { block: error.block } : {}) };
      }
    }, { query: t.Object({ download: t.Optional(t.String()) }) });
}
