export type AIInterviewVoiceAvatarInput = {
  id?: string | null;
  voiceId?: string | null;
  name?: string | null;
  displayName?: string | null;
  avatarTone?: string | null;
  tier?: string | null;
} | null | undefined;

export type AIInterviewVoiceAvatarProfile = {
  src: string;
  label: string;
  tone: "emerald" | "blue" | "slate" | "cyan" | "violet" | "indigo" | "rose" | "amber" | "orange" | "purple";
};

const DEFAULT_AVATAR: AIInterviewVoiceAvatarProfile = {
  src: "/ai-voice-avatars/default.png",
  label: "AI interviewer",
  tone: "emerald"
};

const AVATARS_BY_KEY: Record<string, AIInterviewVoiceAvatarProfile> = {
  "en-us-jennymultilingualneural": { src: "/ai-voice-avatars/jenny.png", label: "Jenny", tone: "emerald" },
  jenny: { src: "/ai-voice-avatars/jenny.png", label: "Jenny", tone: "emerald" },
  "en-us-arianeural": { src: "/ai-voice-avatars/aria.png", label: "Aria", tone: "blue" },
  aria: { src: "/ai-voice-avatars/aria.png", label: "Aria", tone: "blue" },
  "en-us-guyneural": { src: "/ai-voice-avatars/guy.png", label: "Guy", tone: "slate" },
  guy: { src: "/ai-voice-avatars/guy.png", label: "Guy", tone: "slate" },
  "en-us-andrewmultilingualneural": { src: "/ai-voice-avatars/andrew.png", label: "Andrew", tone: "cyan" },
  andrew: { src: "/ai-voice-avatars/andrew.png", label: "Andrew", tone: "cyan" },
  "en-us-ava:dragonhdlatestneural": { src: "/ai-voice-avatars/ava-hd.png", label: "Ava HD", tone: "violet" },
  "ava hd": { src: "/ai-voice-avatars/ava-hd.png", label: "Ava HD", tone: "violet" },
  "en-us-andrew:dragonhdlatestneural": { src: "/ai-voice-avatars/andrew-hd.png", label: "Andrew HD", tone: "indigo" },
  "andrew hd": { src: "/ai-voice-avatars/andrew-hd.png", label: "Andrew HD", tone: "indigo" },
  "en-us-emma:dragonhdlatestneural": { src: "/ai-voice-avatars/emma-hd.png", label: "Emma HD", tone: "rose" },
  "emma hd": { src: "/ai-voice-avatars/emma-hd.png", label: "Emma HD", tone: "rose" },
  "en-us-jasper:mai-voice-1": { src: "/ai-voice-avatars/jasper-mai.png", label: "Jasper MAI", tone: "cyan" },
  "jasper mai": { src: "/ai-voice-avatars/jasper-mai.png", label: "Jasper MAI", tone: "cyan" },
  "en-us-june:mai-voice-1": { src: "/ai-voice-avatars/june-mai.png", label: "June MAI", tone: "amber" },
  "june mai": { src: "/ai-voice-avatars/june-mai.png", label: "June MAI", tone: "amber" },
  "en-us-grant:mai-voice-1": { src: "/ai-voice-avatars/grant-mai.png", label: "Grant MAI", tone: "orange" },
  "grant mai": { src: "/ai-voice-avatars/grant-mai.png", label: "Grant MAI", tone: "orange" },
  "en-us-iris:mai-voice-1": { src: "/ai-voice-avatars/iris-mai.png", label: "Iris MAI", tone: "purple" },
  "iris mai": { src: "/ai-voice-avatars/iris-mai.png", label: "Iris MAI", tone: "purple" },
  "en-us-reed:mai-voice-1": { src: "/ai-voice-avatars/reed-mai.png", label: "Reed MAI", tone: "slate" },
  "reed mai": { src: "/ai-voice-avatars/reed-mai.png", label: "Reed MAI", tone: "slate" },
  "en-us-joy:mai-voice-1": { src: "/ai-voice-avatars/joy-mai.png", label: "Joy MAI", tone: "rose" },
  "joy mai": { src: "/ai-voice-avatars/joy-mai.png", label: "Joy MAI", tone: "rose" }
};

function normalizeKey(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

export function getAIInterviewVoiceInitials(voice?: AIInterviewVoiceAvatarInput) {
  const name = voice?.name || voice?.displayName || "AI";
  return name.slice(0, 2).toUpperCase();
}

export function getAIInterviewVoiceAvatar(voice?: AIInterviewVoiceAvatarInput): AIInterviewVoiceAvatarProfile {
  const direct = AVATARS_BY_KEY[normalizeKey(voice?.id)] || AVATARS_BY_KEY[normalizeKey(voice?.voiceId)];
  if (direct) return direct;

  const displayName = normalizeKey(voice?.displayName);
  if (displayName && AVATARS_BY_KEY[displayName]) return AVATARS_BY_KEY[displayName];

  const name = normalizeKey(voice?.name);
  if (name && AVATARS_BY_KEY[name]) return AVATARS_BY_KEY[name];

  return {
    ...DEFAULT_AVATAR,
    label: voice?.displayName || voice?.name || DEFAULT_AVATAR.label
  };
}
