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
  onSubmit: (history: string[]) => void;
}

export function CareerHistoryDialog({ open, onSubmit }: Props) {
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
        <div className="space-y-3 py-2">
          {jobs.map((job, i) => (
            <Textarea
              key={i}
              placeholder={`e.g. Senior Engineer`}
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
          <Button onClick={() => onSubmit(jobs.filter((j) => j.trim()))} disabled={!canSubmit}>
            Explore my constellation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
