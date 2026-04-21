export type FamilyIntent = "soon" | "later" | "unsure" | "no";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type UserProfile = {
  age: number;
  currentJob: string;
  familyIntent: FamilyIntent;
};

export type ChatResponse = {
  reply: string;
  profile: UserProfile | null;
  complete: boolean;
};
