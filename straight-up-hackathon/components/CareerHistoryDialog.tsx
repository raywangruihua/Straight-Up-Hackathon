"use client"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Your Career History</DialogTitle>
          <DialogDescription>
            Capture your profile and recent roles in one place, then we&apos;ll
            map a more contextual trajectory.
          </DialogDescription>
        </DialogHeader>
        {profileCaptured && (
          <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
            Guided intake complete. You can review or edit the same profile here
            before building the trajectory.
          </div>
        )}
        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/10 px-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="age">Age</Label>
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
            <Label htmlFor="current-job">Current job</Label>
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
            <Label htmlFor="family-intent">Family planning intent</Label>
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
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="">Select an option</option>
              {FAMILY_INTENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-3 py-2">
          <div className="text-sm text-muted-foreground">
            Add your recent roles so we can anchor the trajectory on your actual
            path.
          </div>
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
            <Button variant="outline" onClick={addJob} className="w-full">
              + Add job
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onStartGuidedChat}
            disabled={loading}
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
