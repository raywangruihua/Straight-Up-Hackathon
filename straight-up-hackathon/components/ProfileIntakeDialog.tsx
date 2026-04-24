"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import ChatPanel from "@/components/ChatPanel"
import { Button } from "@/components/ui/button"
import type { UserProfile } from "@/lib/chat"

type ProfileIntakeDialogProps = {
  open: boolean
  onBack: () => void
  onProfileCaptured: (profile: UserProfile) => void
}

export function ProfileIntakeDialog({
  open,
  onBack,
  onProfileCaptured,
}: ProfileIntakeDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="dark max-w-2xl gap-0 border-white/10 bg-slate-950 p-0 text-white"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <p className="text-[11px] font-medium tracking-[0.22em] text-sky-200/70 uppercase">
            Guided intake
          </p>
          <DialogTitle className="mt-2 text-2xl font-semibold text-white">
            Tell us about where you are now
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-6 text-slate-300">
            Use the chat to capture age, current job, and family intent in a
            structured profile.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pt-4 pb-6">
          <div className="mb-4 flex justify-end">
            <Button
              variant="outline"
              onClick={onBack}
              className="h-10 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-medium text-slate-100 hover:bg-white/10"
            >
              Back to career history
            </Button>
          </div>
          <ChatPanel
            compact
            onProfileChange={(profile) => {
              if (profile) {
                onProfileCaptured(profile)
              }
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
