"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { AdvisorCitation } from "@/lib/chat"

type SourcesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  citations: AdvisorCitation[]
}

function extractYear(publishDate: string) {
  const match = publishDate.match(/\d{4}/)
  return match ? match[0] : "n.d."
}

function formatApa(citation: AdvisorCitation) {
  const publisher = citation.publisher ?? "Unknown publisher"
  const year = extractYear(citation.publishDate)
  const title = citation.title.replace(/\.+$/, "")
  const medium =
    citation.sourceType === "mom_pdf" ? " [PDF]" : ""
  const pageRef = citation.pageRef ? `, ${citation.pageRef}` : ""
  return `${publisher}. (${year}). ${title}${medium}${pageRef}.`
}

export function SourcesDialog({
  open,
  onOpenChange,
  citations,
}: SourcesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-w-2xl gap-0 border-white/10 bg-slate-950 p-0 text-white">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <p className="text-[11px] font-medium tracking-[0.22em] text-sky-200/70 uppercase">
            Sources
          </p>
          <DialogTitle className="mt-2 text-2xl font-semibold text-white">
            Citations for this node
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-slate-300">
            APA-formatted references used while reasoning the indicators above.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-6 py-5">
          {citations.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300">
              No external sources were cited for this node. The indicators were
              derived from the deterministic age baseline and the model&apos;s
              general clinical / labour-market knowledge.
            </p>
          ) : (
            citations.map((citation) => {
              const apa = formatApa(citation)
              return (
                <div
                  key={citation.id}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-4"
                >
                  <p className="text-[11px] font-medium tracking-[0.22em] text-sky-100/75 uppercase">
                    {citation.sourceType === "curated"
                      ? "Curated source"
                      : "MOM PDF snippet"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white">{apa}</p>
                  {citation.url ? (
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block truncate text-xs text-sky-300 hover:text-sky-200 hover:underline"
                    >
                      {citation.url}
                    </a>
                  ) : null}
                  {citation.excerpt ? (
                    <p className="mt-3 text-xs leading-5 text-slate-300">
                      &ldquo;{citation.excerpt}&rdquo;
                    </p>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
