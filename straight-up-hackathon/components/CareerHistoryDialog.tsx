"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_JOBS = 5;

interface Props {
  open: boolean;
  loading?: boolean;
  profileCaptured?: boolean;
  onSubmit: (history: string[]) => void;
  onStartGuidedChat: () => void;
}

export function CareerHistoryDialog({
  open,
  loading = false,
  profileCaptured = false,
  onSubmit,
  onStartGuidedChat,
}: Props) {
  const [jobs, setJobs] = useState<string[]>([""]);

  function updateJob(index: number, value: string) {
    setJobs((prev) => prev.map((j, i) => (i === index ? value : j)));
  }

  function addJob() {
    setJobs((prev) => [...prev, ""]);
  }

  const canSubmit = jobs.some((j) => j.trim());

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Your Career History</DialogTitle>
          <DialogDescription>
            Enter each role you&apos;ve held and we&apos;ll map your trajectory.
          </DialogDescription>
        </DialogHeader>
        {profileCaptured && (
          <div className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-100">
            Guided intake complete. Your profile is saved and ready for the next planning step.
          </div>
        )}
        <div className="space-y-3 py-2">
          {jobs.map((job, i) => (
            <Textarea
              key={i}
              placeholder={`e.g Software Engineer`}
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
          <Button variant="outline" onClick={onStartGuidedChat} disabled={loading}>
            Guided profile chat
          </Button>
          <Button onClick={() => onSubmit(jobs.filter((j) => j.trim()))} disabled={!canSubmit || loading}>
            {loading ? "Mapping your trajectory…" : "Explore my constellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
