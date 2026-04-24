"use client"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { FamilyIntent, ProfileDraft } from "@/lib/chat"

const MAX_JOBS = 5
const FAMILY_INTENT_OPTIONS: { value: FamilyIntent; label: string }[] = [
  { value: "soon", label: "Soon" },
  { value: "later", label: "Later" },
  { value: "unsure", label: "Unsure" },
  { value: "no", label: "No" },
]

const EYEBROW_CLASS =
  "text-[11px] font-medium tracking-[0.22em] text-sky-200/70 uppercase"
const PRIMARY_CTA_CLASS =
  "h-10 rounded-xl bg-sky-300 px-4 text-sm font-semibold text-slate-950 hover:bg-sky-200 disabled:bg-slate-600 disabled:text-slate-300"
const SECONDARY_CTA_CLASS =
  "h-10 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-slate-100 hover:bg-white/10"

interface Props {
  open: boolean
  loading?: boolean
  profileDraft: ProfileDraft
  profileCaptured?: boolean
  onProfileDraftChange: (profile: ProfileDraft) => void
  onSubmit: (payload: { history: string[]; profile: ProfileDraft }) => void
  onStartGuidedChat: () => void
}

export function CareerHistoryDialog({
  open,
  loading = false,
  profileDraft,
  profileCaptured = false,
  onProfileDraftChange,
  onSubmit,
  onStartGuidedChat,
}: Props) {
  const [jobs, setJobs] = useState<string[]>([""])

  function updateJob(index: number, value: string) {
    setJobs((prev) => prev.map((j, i) => (i === index ? value : j)))
  }

  function addJob() {
    setJobs((prev) => [...prev, ""])
  }

  const canSubmit =
    jobs.some((j) => j.trim()) || Boolean(profileDraft.currentJob.trim())
  const selectedFamilyIntent = profileDraft.familyIntent ?? ""

  return (
    <Dialog open={open}>
      <DialogContent
        className="dark max-w-lg gap-0 border-white/10 bg-slate-950 p-0 text-white sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <p className={EYEBROW_CLASS}>Career history</p>
          <DialogTitle className="mt-2 text-2xl font-semibold text-white">
            Map your path
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-slate-300">
            Capture your profile and recent roles so we can anchor a more
            contextual trajectory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          {profileCaptured && (
            <div className="rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50">
              Guided intake complete. You can review or edit the same profile
              here before building the trajectory.
            </div>
          )}

          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-5">
            <div className="space-y-2">
              <Label htmlFor="age" className="text-slate-200">
                Age
              </Label>
              <Input
                id="age"
                type="number"
                min={0}
                placeholder="e.g. 29"
                value={profileDraft.age ?? ""}
                onChange={(event) =>
                  onProfileDraftChange({
                    ...profileDraft,
                    age: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current-job" className="text-slate-200">
                Current job
              </Label>
              <Input
                id="current-job"
                placeholder="e.g. Software Engineer"
                value={profileDraft.currentJob}
                onChange={(event) =>
                  onProfileDraftChange({
                    ...profileDraft,
                    currentJob: event.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="family-intent" className="text-slate-200">
                Family planning intent
              </Label>
              <select
                id="family-intent"
                value={selectedFamilyIntent}
                onChange={(event) =>
                  onProfileDraftChange({
                    ...profileDraft,
                    familyIntent: event.target.value
                      ? (event.target.value as FamilyIntent)
                      : null,
                  })
                }
                className="flex h-9 w-full rounded-md border border-white/15 bg-white/5 px-3 py-1 text-sm text-white outline-none transition-[color,box-shadow] focus-visible:border-sky-300/50 focus-visible:ring-3 focus-visible:ring-sky-300/20"
              >
                <option value="" className="bg-slate-900 text-slate-300">
                  Select an option
                </option>
                {FAMILY_INTENT_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    className="bg-slate-900 text-white"
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className={EYEBROW_CLASS}>Recent roles</p>
            <p className="text-sm leading-6 text-slate-300">
              Add your recent roles so we can anchor the trajectory on your
              actual path.
            </p>
            {jobs.map((job, i) => (
              <Textarea
                key={i}
                placeholder="e.g. Software Engineer"
                rows={2}
                value={job}
                onChange={(e) => updateJob(i, e.target.value)}
              />
            ))}
            {jobs.length < MAX_JOBS && (
              <Button
                variant="outline"
                onClick={addJob}
                className={`${SECONDARY_CTA_CLASS} w-full`}
              >
                + Add job
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-white/10 px-6 py-4">
          <Button
            variant="outline"
            onClick={onStartGuidedChat}
            disabled={loading}
            className={SECONDARY_CTA_CLASS}
          >
            Guided chat
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                history: jobs.filter((j) => j.trim()),
                profile: profileDraft,
              })
            }
            disabled={!canSubmit || loading}
            className={PRIMARY_CTA_CLASS}
          >
            {loading
              ? "Mapping your trajectory..."
              : "Explore my constellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
