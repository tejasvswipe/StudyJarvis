import { trpc } from "@/lib/trpc";
import { startLogin } from "@/const";
import { useAuth } from "@/_core/hooks/useAuth";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2,
  LogOut,
  Mic,
  MicOff,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScheduleItem } from "../../../drizzle/schema";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
type ScheduleCategory = ScheduleItem["category"];
type ScheduleStatus = "upcoming" | "completed";

type EventForm = {
  title: string;
  category: ScheduleCategory;
  startAt: string;
  endAt: string;
  description: string;
};

const CATEGORY_INFO: Record<ScheduleCategory, { label: string; color: string; symbol: string }> = {
  class: { label: "Class", color: "sage", symbol: "CL" },
  assignment: { label: "Assignment", color: "clay", symbol: "AS" },
  exam: { label: "Exam", color: "rose", symbol: "EX" },
  reminder: { label: "Reminder", color: "gold", symbol: "RM" },
};

const PROMPTS = [
  "Explain a tough topic in simple steps",
  "Help me plan a focused study session",
  "What should I work on next?",
];

function toLocalInputValue(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function dateLabel(date: Date) {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const offset = Math.round((dateStart - todayStart) / 86_400_000);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return formatDate(date);
}

function initialEventForm(): EventForm {
  const nextHour = new Date();
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  return {
    title: "",
    category: "assignment",
    startAt: toLocalInputValue(nextHour),
    endAt: "",
    description: "",
  };
}

function speak(text: string, onSpeakingChange: (speaking: boolean) => void = () => {}) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    toast.error("Spoken playback is not available in this browser.");
    onSpeakingChange(false);
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/[#*_`]/g, ""));
  utterance.rate = 1.02;
  utterance.onstart = () => onSpeakingChange(true);
  utterance.onend = () => onSpeakingChange(false);
  utterance.onerror = event => {
    onSpeakingChange(false);
    if (event.error !== "canceled" && event.error !== "interrupted") toast.error("Spoken playback was blocked. Check your browser audio settings or switch to text mode.");
  };
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);
}

function SignInScreen({ name }: { name: string }) {
  return (
    <main className="study-app sign-in-app">
      <div className="sign-in-card">
        <div className="brand-lockup"><span className="brand-mark"><BookOpen size={19} /></span><span>studyjarvis</span></div>
        <div className="sign-in-art"><span className="art-star star-one">✳</span><span className="art-star star-two">·</span><span className="art-book"><BookOpen size={54} strokeWidth={1.4} /></span></div>
        <p className="eyebrow">YOUR PERSONAL STUDY DESK</p>
        <h1>A little more focus.<br /><em>A lot more you.</em></h1>
        <p className="sign-in-copy">Sign in to speak things through, get unstuck on a topic, and keep your classes, deadlines, and reminders together in one calm place.</p>
        <button className="primary-button sign-in-button" onClick={startLogin}>Continue with Manus <ArrowUpRight size={16} /></button>
        <p className="privacy-note">Your schedule is private to your signed-in account.</p>
        <span className="greeting-name">Made for {name}</span>
      </div>
    </main>
  );
}

export default function Home() {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const scheduleQuery = trpc.schedule.list.useQuery(undefined, { enabled: auth.isAuthenticated, refetchOnWindowFocus: true });
  const chatMutation = trpc.assistant.chat.useMutation();
  const transcribeMutation = trpc.voice.transcribe.useMutation();
  const createMutation = trpc.schedule.create.useMutation();
  const updateMutation = trpc.schedule.update.useMutation();
  const removeMutation = trpc.schedule.remove.useMutation();
  const completeMutation = trpc.schedule.complete.useMutation();

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [activeScheduleTab, setActiveScheduleTab] = useState<ScheduleStatus>("upcoming");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ScheduleItem | null>(null);
  const [eventForm, setEventForm] = useState<EventForm>(initialEventForm);
  const [conversationMode, setConversationMode] = useState<"voice" | "text">("voice");
  const [recording, setRecording] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatMessages, chatMutation.isPending]);

  useEffect(() => () => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const items = scheduleQuery.data ?? [];
  const orderedItems = useMemo(() => [...items].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()), [items]);
  const visibleItems = orderedItems.filter(item => activeScheduleTab === "upcoming" ? item.status === "scheduled" : item.status === "completed");
  const scheduledItems = orderedItems.filter(item => item.status === "scheduled");
  const todayCount = scheduledItems.filter(item => {
    const now = new Date();
    return item.startAt.getFullYear() === now.getFullYear() && item.startAt.getMonth() === now.getMonth() && item.startAt.getDate() === now.getDate();
  }).length;
  const nextItem = scheduledItems.find(item => item.startAt.getTime() >= Date.now()) ?? scheduledItems[0];
  const firstName = auth.user?.name?.trim().split(/\s+/)[0] || "Student";
  const latestAssistantReply = [...chatMessages].reverse().find(message => message.role === "assistant");
  const voiceStatus = recording ? "Listening to you" : transcribeMutation.isPending ? "Preparing your voice message" : chatMutation.isPending ? "Thinking it through" : speaking ? "Jarvis is speaking" : "Ready when you are";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayString = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  const sendMessage = async (value = draft) => {
    const content = value.trim();
    if (!content || chatMutation.isPending) return;
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content };
    const nextMessages = [...chatMessages, userMessage].slice(-20);
    setChatMessages(nextMessages);
    setDraft("");
    try {
      const response = await chatMutation.mutateAsync({
        messages: nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        timezone,
      });
      const reply: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: response.reply };
      setChatMessages(current => [...current, reply]);
      if (response.scheduleChanged) await utils.schedule.list.invalidate();
      if (voiceReplies) speak(response.reply, setSpeaking);
    } catch (error) {
      console.error("Study Jarvis chat failed", error);
      const message = error instanceof Error ? error.message : "Please try that again.";
      toast.error(message);
      const failureReply = "I couldn't reach the assistant just now. Please try again in a moment.";
      setChatMessages(current => [...current, { id: crypto.randomUUID(), role: "assistant", content: failureReply }]);
      if (voiceReplies) speak(failureReply, setSpeaking);
    }
  };

  const openNewEvent = () => {
    setEditingItem(null);
    setEventForm(initialEventForm());
    setEditorOpen(true);
  };

  const openEditEvent = (item: ScheduleItem) => {
    setEditingItem(item);
    setEventForm({
      title: item.title,
      category: item.category,
      startAt: toLocalInputValue(item.startAt),
      endAt: item.endAt ? toLocalInputValue(item.endAt) : "",
      description: item.description ?? "",
    });
    setEditorOpen(true);
  };

  const saveEvent = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!eventForm.title.trim() || !eventForm.startAt) return;
    const startAt = new Date(eventForm.startAt);
    const endAt = eventForm.endAt ? new Date(eventForm.endAt) : null;
    if (endAt && endAt.getTime() <= startAt.getTime()) {
      toast.error("The end time must be after the start time.");
      return;
    }
    const payload = {
      title: eventForm.title.trim(),
      category: eventForm.category,
      description: eventForm.description.trim() || null,
      startAt: startAt.toISOString(),
      endAt: endAt?.toISOString() ?? null,
    };
    setScheduleSaving(true);
    try {
      if (editingItem) await updateMutation.mutateAsync({ id: editingItem.id, ...payload });
      else await createMutation.mutateAsync(payload);
      await utils.schedule.list.invalidate();
      setEditorOpen(false);
      toast.success(editingItem ? "Schedule item updated." : "Added to your schedule.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save that schedule item.");
    } finally {
      setScheduleSaving(false);
    }
  };

  const toggleComplete = async (item: ScheduleItem) => {
    try {
      await completeMutation.mutateAsync({ id: item.id, completed: item.status !== "completed" });
      await utils.schedule.list.invalidate();
      toast.success(item.status === "completed" ? "Moved back to upcoming." : "Marked complete. Nice work.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update that item.");
    }
  };

  const deleteEvent = async (item: ScheduleItem) => {
    if (!window.confirm(`Remove “${item.title}” from your schedule?`)) return;
    try {
      await removeMutation.mutateAsync({ id: item.id });
      await utils.schedule.list.invalidate();
      toast.success("Schedule item removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove that item.");
    }
  };

  const transcribeBlob = async (blob: Blob) => {
    if (blob.size > 12 * 1024 * 1024) {
      toast.error("That recording is too large. Try a shorter voice request.");
      return;
    }
    if (blob.size < 1200) {
      toast.error("I didn't catch enough speech. Tap the microphone and try again.");
      return;
    }
    const mimeType = blob.type.split(";")[0].toLowerCase();
    if (!["audio/webm", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav", "audio/ogg", "audio/x-m4a"].includes(mimeType)) {
      toast.error("This browser recorded an unsupported audio format. Try another supported browser or switch to text mode.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Couldn't read the recording. Please try again.");
    reader.onload = async () => {
      try {
        const dataUrl = String(reader.result ?? "");
        const audioBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const result = await transcribeMutation.mutateAsync({ audioBase64, mimeType: blob.type });
        const transcript = result.text.trim();
        if (!transcript) {
          toast.info("I didn't catch any words. Tap the microphone and try again.");
          return;
        }
        void sendMessage(transcript);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "I couldn't understand that recording. Please try again or switch to text mode.");
      }
    };
    reader.readAsDataURL(blob);
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Voice recording isn't supported here. Check microphone access or switch to text mode.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      let recordingFailed = false;
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => {
        recordingFailed = true;
        setRecording(false);
        if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        toast.error("Recording stopped unexpectedly. Please try again.");
      };
      recorder.onstop = () => {
        if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (recordingFailed) {
          chunksRef.current = [];
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        void transcribeBlob(blob);
      };
      recorder.start(250);
      setRecording(true);
      stopTimerRef.current = window.setTimeout(() => {
        stopTimerRef.current = null;
        if (recorder.state === "recording") {
          recorder.stop();
          toast.info("Voice capture stopped after 60 seconds.");
        }
      }, 60_000);
    } catch (error) {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      console.warn("Microphone permission or recording error", error);
      toast.error("Microphone access was unavailable. Check your browser permission or switch to text mode.");
    }
  };

  const stopRecording = () => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const stopSpeaking = () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  if (auth.loading) {
    return <main className="study-app loading-app"><div className="loading-brand"><span className="brand-mark"><BookOpen size={18} /></span>studyjarvis</div><div className="loading-note"><Loader2 size={19} className="spin" /> Opening your study desk…</div></main>;
  }
  if (!auth.isAuthenticated) return <SignInScreen name="your next big idea" />;

  return (
    <main className="study-app">
      <div className="study-topbar">
        <a href="/" className="brand-lockup" aria-label="Study Jarvis home">
          <span className="brand-mark"><BookOpen size={18} strokeWidth={1.9} /></span>
          <span>studyjarvis</span><span className="brand-period">.</span>
        </a>
        <div className="topbar-actions">
          <span className="topbar-date"><CalendarDays size={15} />{todayString}</span>
          <div className="topbar-divider" />
          <span className="account-chip"><span className="account-avatar">{firstName.slice(0, 1).toUpperCase()}</span>{firstName}</span>
          <button className="icon-button logout-button" aria-label="Sign out" title="Sign out" onClick={() => void auth.logout()}><LogOut size={16} /></button>
        </div>
      </div>

      <section className="desk-intro">
        <div>
          <p className="eyebrow"><span className="eyebrow-line" /> YOUR STUDY DESK, IN GOOD COMPANY</p>
          <h1>Good to see you, {firstName}<span className="intro-period">.</span></h1>
          <p className="intro-subtitle">One place to think out loud, get unstuck, and keep your week in view.</p>
        </div>
        <div className="intro-note"><span className="note-scribble">✳</span><span>Make room for<br /><em>one good next step.</em></span></div>
      </section>

      <section className="study-workspace">
        <section className="assistant-panel paper-panel" aria-label="Study Jarvis assistant">
          <div className="panel-heading assistant-heading">
            <div className="assistant-title-wrap">
              <div className="assistant-avatar"><Sparkles size={18} /></div>
              <div><h2>Talk with Jarvis</h2><p>Speak naturally. Replies are spoken aloud.</p></div>
            </div>
            <button className={`quiet-toggle ${voiceReplies ? "is-on" : ""}`} onClick={() => { const next = !voiceReplies; setVoiceReplies(next); if (!next) stopSpeaking(); }} title={voiceReplies ? "Mute spoken assistant replies" : "Enable spoken assistant replies"} aria-pressed={voiceReplies}>
              <Volume2 size={15} /><span>{voiceReplies ? "Voice replies on" : "Voice replies off"}</span>
            </button>
          </div>

          <div className="chat-area" aria-live="polite">
            {conversationMode === "voice" ? (
              <div className={`voice-stage ${recording ? "is-listening" : speaking ? "is-speaking" : ""}`}>
                <div className={`voice-orb ${recording ? "is-listening" : speaking ? "is-speaking" : ""}`} aria-hidden="true">
                  {recording ? <Mic size={25} /> : speaking ? <Volume2 size={25} /> : chatMutation.isPending || transcribeMutation.isPending ? <Loader2 size={25} className="spin" /> : <Sparkles size={25} />}
                </div>
                <p className="voice-status" aria-live="polite">{voiceStatus}</p>
                <p className="voice-instructions">{recording ? "Say what you need, then stop to send it." : "Tap to speak. Your request is sent automatically, and Jarvis speaks the reply."}</p>
                <div className="voice-controls">
                  <button type="button" className={`voice-talk-button ${recording ? "recording" : ""}`} onClick={() => { if (recording) stopRecording(); else { if (speaking) stopSpeaking(); void startRecording(); } }} disabled={transcribeMutation.isPending || chatMutation.isPending} aria-label={recording ? "Stop recording and send voice request" : speaking ? "Interrupt and speak to Study Jarvis" : "Start speaking to Study Jarvis"}>
                    {recording ? <MicOff size={19} /> : <Mic size={19} />}<span>{recording ? "Stop & send" : speaking ? "Interrupt & talk" : "Tap to talk"}</span>
                  </button>
                  {speaking ? <button type="button" className="voice-utility-button" onClick={stopSpeaking}><Volume2 size={15} /> Stop reply</button> : latestAssistantReply && voiceReplies ? <button type="button" className="voice-utility-button" onClick={() => speak(latestAssistantReply.content, setSpeaking)}><Volume2 size={15} /> Repeat reply</button> : null}
                </div>
                <div className="voice-mode-links">
                  <button type="button" onClick={() => setConversationMode("text")} disabled={recording || transcribeMutation.isPending || chatMutation.isPending}><Pencil size={13} /> Use text instead</button>
                  <span>Voice input is sent after you stop recording.</span>
                </div>
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="chat-empty-state">
                <div className="empty-orbit"><span className="orbit-dot" /><Sparkles size={22} /></div>
                <p className="empty-kicker">A clear mind starts somewhere</p>
                <h3>What's on your mind?</h3>
                <p className="empty-copy">Bring a tricky topic, a big question, or the plan you haven't quite figured out yet.</p>
                <div className="prompt-chips">
                  {PROMPTS.map(prompt => <button key={prompt} className="prompt-chip" disabled={chatMutation.isPending} onClick={() => void sendMessage(prompt)}>{prompt}<ArrowUpRight size={13} /></button>)}
                </div>
              </div>
            ) : (
              <div className="message-stack">
                {chatMessages.map(message => (
                  <article key={message.id} className={`chat-message ${message.role}`}>
                    {message.role === "assistant" && <div className="message-avatar"><Sparkles size={14} /></div>}
                    <div className="message-content">
                      {message.role === "assistant" ? <div className="markdown-copy"><Streamdown>{message.content}</Streamdown></div> : <p>{message.content}</p>}
                      {message.role === "assistant" && <button className="read-aloud-button" onClick={() => speak(message.content)} aria-label="Read answer aloud"><Volume2 size={13} /> Read aloud</button>}
                    </div>
                    {message.role === "user" && <div className="user-message-avatar">{firstName.slice(0, 1).toUpperCase()}</div>}
                  </article>
                ))}
                {chatMutation.isPending && <div className="typing-row"><div className="message-avatar"><Sparkles size={14} /></div><div className="typing-bubble"><span /><span /><span /></div><span className="thinking-label">Thinking it through</span></div>}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {conversationMode === "text" && <form className="composer" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
            <label className="sr-only" htmlFor="assistant-input">Message Study Jarvis</label>
            <textarea
              id="assistant-input"
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }}
              placeholder="Ask a question, or tell me what to add to your schedule…"
              rows={2}
              disabled={chatMutation.isPending || transcribeMutation.isPending}
            />
            <div className="composer-toolbar">
              <button type="button" className="text-mode-switch" onClick={() => setConversationMode("voice")}><Mic size={13} /> Switch to voice</button>
              <div className="composer-actions">
                <button type="submit" className="send-button" disabled={!draft.trim() || chatMutation.isPending || transcribeMutation.isPending} aria-label="Send message">
                  {chatMutation.isPending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}<span>Send</span>
                </button>
              </div>
            </div>
          </form>}
          <div className="assistant-footnote"><span className="footnote-spark">✳</span> {conversationMode === "voice" ? "Tap to talk; stop to send. Jarvis speaks replies automatically." : "Text mode is available whenever you need it."} <span className="footnote-separator">·</span> AI can make mistakes.</div>
        </section>

        <aside className="schedule-panel paper-panel" aria-label="Personal schedule">
          <div className="panel-heading schedule-heading">
            <div><p className="eyebrow schedule-eyebrow"><span className="eyebrow-line" /> YOUR WEEK, AT A GLANCE</p><h2>Plan &amp; reminders</h2></div>
            <button className="add-event-button" onClick={openNewEvent}><Plus size={16} /><span>Add</span></button>
          </div>
          <div className="schedule-summary">
            <div className="summary-date"><span className="summary-day">{new Date().getDate().toString().padStart(2, "0")}</span><span><strong>{new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date())}</strong><small>{todayCount === 0 ? "A little breathing room" : `${todayCount} item${todayCount === 1 ? "" : "s"} today`}</small></span></div>
            <div className="next-up-note"><Clock3 size={14} /><span>{nextItem ? <>Next up: <strong>{nextItem.title}</strong></> : "Nothing scheduled yet"}</span></div>
          </div>
          <div className="schedule-tabs" role="tablist" aria-label="Schedule filter">
            <button className={activeScheduleTab === "upcoming" ? "active" : ""} role="tab" aria-selected={activeScheduleTab === "upcoming"} onClick={() => setActiveScheduleTab("upcoming")}>Upcoming <span>{scheduledItems.length}</span></button>
            <button className={activeScheduleTab === "completed" ? "active" : ""} role="tab" aria-selected={activeScheduleTab === "completed"} onClick={() => setActiveScheduleTab("completed")}>Completed</button>
          </div>
          <div className="schedule-list">
            {scheduleQuery.isLoading ? <div className="schedule-loading"><Loader2 size={18} className="spin" />Gathering your schedule…</div> : scheduleQuery.error ? (
              <div className="schedule-empty"><CalendarDays size={22} /><p>Couldn't load your schedule.</p><button onClick={() => void scheduleQuery.refetch()}>Try again</button></div>
            ) : visibleItems.length === 0 ? (
              <div className="schedule-empty"><span className="empty-calendar"><CalendarDays size={21} /></span><h3>{activeScheduleTab === "upcoming" ? "A clean page." : "Nothing checked off yet."}</h3><p>{activeScheduleTab === "upcoming" ? "Add a class, deadline, exam, or reminder to get started." : "When you finish something, mark it complete and it'll land here."}</p>{activeScheduleTab === "upcoming" && <button className="empty-add-button" onClick={openNewEvent}><Plus size={14} /> Add your first item</button>}</div>
            ) : visibleItems.map(item => <ScheduleCard key={item.id} item={item} onToggle={() => void toggleComplete(item)} onEdit={() => openEditEvent(item)} onDelete={() => void deleteEvent(item)} />)}
          </div>
          <div className="schedule-footer"><span className="save-dot" /> Saved to your personal schedule <span className="schedule-footer-sep">·</span> Private to your account</div>
        </aside>
      </section>

      <footer className="study-footer"><span>STUDYJARVIS</span><span>Less overwhelm. More understanding.</span><span>Built for the next thing you're learning <span className="footer-star">✳</span></span></footer>

      {editorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditorOpen(false); }}>
          <section className="event-editor" role="dialog" aria-modal="true" aria-labelledby="event-editor-title">
            <div className="editor-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> KEEP IT ON YOUR RADAR</p><h2 id="event-editor-title">{editingItem ? "Edit schedule item" : "Add to your schedule"}</h2></div><button className="icon-button close-editor" onClick={() => setEditorOpen(false)} aria-label="Close"><X size={18} /></button></div>
            <form onSubmit={event => void saveEvent(event)} className="event-form">
              <label className="form-field"><span>What is it?</span><input autoFocus maxLength={180} value={eventForm.title} onChange={event => setEventForm(current => ({ ...current, title: event.target.value }))} placeholder="e.g. Biology lab, essay draft…" required /></label>
              <fieldset className="form-field category-field"><legend>Type</legend><div className="category-options">{(Object.keys(CATEGORY_INFO) as ScheduleCategory[]).map(category => <button type="button" key={category} className={`category-option ${CATEGORY_INFO[category].color} ${eventForm.category === category ? "selected" : ""}`} onClick={() => setEventForm(current => ({ ...current, category }))}><span className="category-symbol">{CATEGORY_INFO[category].symbol}</span>{CATEGORY_INFO[category].label}</button>)}</div></fieldset>
              <div className="date-fields"><label className="form-field"><span>Starts</span><input type="datetime-local" value={eventForm.startAt} onChange={event => setEventForm(current => ({ ...current, startAt: event.target.value }))} required /></label><label className="form-field"><span>Ends <small>(optional)</small></span><input type="datetime-local" value={eventForm.endAt} onChange={event => setEventForm(current => ({ ...current, endAt: event.target.value }))} /></label></div>
              <label className="form-field"><span>Notes <small>(optional)</small></span><textarea rows={3} maxLength={2000} value={eventForm.description} onChange={event => setEventForm(current => ({ ...current, description: event.target.value }))} placeholder="A detail you'll want to remember…" /></label>
              <div className="editor-actions"><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>Cancel</button><button type="submit" className="primary-button" disabled={scheduleSaving}>{scheduleSaving ? <><Loader2 size={15} className="spin" /> Saving…</> : <><Check size={15} /> {editingItem ? "Save changes" : "Add to schedule"}</>}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function ScheduleCard({ item, onToggle, onEdit, onDelete }: { item: ScheduleItem; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const info = CATEGORY_INFO[item.category];
  const completed = item.status === "completed";
  return (
    <article className={`schedule-item ${completed ? "is-complete" : ""}`}>
      <button className={`complete-control ${completed ? "checked" : ""}`} onClick={onToggle} aria-label={completed ? `Reopen ${item.title}` : `Mark ${item.title} complete`}>
        {completed ? <CheckCircle2 size={19} /> : <Circle size={19} />}
      </button>
      <div className="event-time-rail"><span>{formatTime(item.startAt)}</span><i /></div>
      <div className="event-card-main">
        <div className="event-meta"><span className={`event-type ${info.color}`}>{info.label}</span><span className="event-day">{dateLabel(item.startAt)}</span></div>
        <h3>{item.title}</h3>
        {item.description && <p className="event-description">{item.description}</p>}
        {item.endAt && <p className="event-endtime">Until {formatTime(item.endAt)}</p>}
        <div className="event-actions"><button onClick={onEdit} aria-label={`Edit ${item.title}`} title="Edit"><Pencil size={13} /></button><button onClick={onDelete} aria-label={`Delete ${item.title}`} title="Delete"><Trash2 size={13} /></button></div>
      </div>
    </article>
  );
}
