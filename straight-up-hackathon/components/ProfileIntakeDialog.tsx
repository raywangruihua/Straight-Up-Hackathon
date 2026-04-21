"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import ChatPanel from "@/components/ChatPanel";
import { Button } from "@/components/ui/button";
import type { UserProfile } from "@/lib/chat";

type ProfileIntakeDialogProps = {
  open: boolean;
  onBack: () => void;
  onProfileCaptured: (profile: UserProfile) => void;
};

export function ProfileIntakeDialog({
  open,
  onBack,
  onProfileCaptured,
}: ProfileIntakeDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        className="max-w-2xl border-white/10 bg-slate-950 p-0 text-white"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle>Guided profile intake</DialogTitle>
          <DialogDescription className="text-slate-300">
            Use the chat to capture age, current job, and family intent in a structured profile.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6 pt-4">
          <div className="mb-4 flex justify-end">
            <Button variant="outline" onClick={onBack}>
              Back to career history
            </Button>
          </div>
          <ChatPanel
            compact
            onProfileChange={(profile) => {
              if (profile) {
                onProfileCaptured(profile);
              }
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
