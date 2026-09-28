import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { MessageCircle, Send, X } from "lucide-react";

type Action = {
  label: string;
  href: "/signup" | "/login" | "#top" | "#questions";
};
type Message = { role: "guide" | "visitor"; text: string; action?: Action };

const suggestions = [
  "How do I create a patient account?",
  "Where is the clinic queue?",
  "I already have an account",
];

function answer(question: string): Omit<Message, "role"> {
  const text = question.toLowerCase();

  if (
    /\b(id number|password|phone number|email address|medical record|diagnosis|allergies|medication)\b/.test(
      text,
    )
  ) {
    return {
      text: "Please don't share personal, login, or medical details here. I can't look up accounts or records. Use the secure account pages or contact your clinic for help.",
    };
  }
  if (
    /\b(account|sign up|signup|register)\b/.test(text) ||
    /\bcreate\b.{0,24}\bpatient account\b/.test(text)
  ) {
    return {
      text: "You can create a patient account on the secure sign-up page. Please enter your details there, not in this chat.",
      action: { label: "Create patient account", href: "/signup" },
    };
  }
  if (
    /\b(sign in|log in|login|forgot password|existing account)\b/.test(text)
  ) {
    return {
      text: "Use the sign-in page to access your patient account.",
      action: { label: "Go to sign in", href: "/login" },
    };
  }
  if (/\b(queue|waiting|wait time|busy|clinic)\b/.test(text)) {
    return {
      text: "The live public queue is near the top of this homepage. Choose a clinic to view its current queue summary.",
      action: { label: "View clinic queue", href: "#top" },
    };
  }
  if (/\b(question|faq|privacy|homepage|page|where|find)\b/.test(text)) {
    return {
      text: "Browse the Questions section on this homepage for information about Zennith, queues, and privacy.",
      action: { label: "Browse questions", href: "#questions" },
    };
  }
  return {
    text: "I can only help you navigate this homepage or find patient sign-up and sign-in. I can't give medical advice, access the app, look up accounts, or view records.",
  };
}

export function LandingPatientAssistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "guide",
      text: "Hi, I'm the Zennith page guide. I can help you find patient sign-up, sign-in, the public queue, and information on this homepage. Please don't share personal or medical details.",
    },
  ]);

  const ask = (value: string) => {
    const question = value.trim();
    if (!question) return;
    setMessages((current) => [
      ...current,
      { role: "visitor", text: question },
      { role: "guide", ...answer(question) },
    ]);
    setDraft("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    ask(draft);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      <section
        id="patient-page-guide"
        aria-label="Zennith patient page guide"
        className={`${open ? "flex" : "hidden"} h-[min(34rem,calc(100dvh-7rem))] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-[oklch(0.84_0.025_195)] bg-white shadow-2xl`}
      >
        <header className="flex items-center gap-3 bg-[oklch(0.18_0.06_260)] px-4 py-3 text-white">
          <span className="grid size-9 place-items-center rounded-md bg-[oklch(0.76_0.12_175)] text-[oklch(0.18_0.06_260)]">
            <MessageCircle size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Patient page guide</h2>
            <p className="text-xs text-white/70">Homepage only</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
            className="grid size-9 place-items-center rounded-md hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </header>
        <div
          className="flex-1 space-y-3 overflow-y-auto bg-[oklch(0.975_0.012_190)] p-4"
          role="log"
          aria-live="polite"
        >
          {messages.map((message, index) => (
            <div
              key={`${index}-${message.role}`}
              className={`flex ${message.role === "visitor" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[88%] rounded-lg px-3 py-2.5 text-sm leading-relaxed ${message.role === "visitor" ? "bg-[oklch(0.22_0.07_260)] text-white" : "border border-[oklch(0.88_0.02_195)] bg-white text-[oklch(0.22_0.04_255)]"}`}
              >
                <p>{message.text}</p>
                {message.action &&
                  (message.action.href.startsWith("/") ? (
                    <Link
                      to={message.action.href}
                      onClick={() => setOpen(false)}
                      className="mt-2 inline-block text-xs font-semibold underline underline-offset-2"
                    >
                      {message.action.label}
                    </Link>
                  ) : (
                    <a
                      href={message.action.href}
                      className="mt-2 inline-block text-xs font-semibold underline underline-offset-2"
                    >
                      {message.action.label}
                    </a>
                  ))}
              </div>
            </div>
          ))}
          {messages.length === 1 && (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => ask(item)}
                  className="rounded-md border border-[oklch(0.82_0.03_190)] bg-white px-2.5 py-2 text-left text-xs hover:bg-[oklch(0.95_0.02_180)]"
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
        <form
          onSubmit={submit}
          className="flex gap-2 border-t border-[oklch(0.88_0.02_195)] bg-white p-3"
        >
          <label htmlFor="patient-guide-input" className="sr-only">
            Ask about the homepage
          </label>
          <input
            id="patient-guide-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={240}
            autoComplete="off"
            placeholder="Ask about this page"
            className="h-10 min-w-0 flex-1 rounded-md border border-[oklch(0.84_0.02_195)] px-3 text-sm outline-none focus:border-[oklch(0.48_0.11_175)] focus:ring-2 focus:ring-[oklch(0.48_0.11_175)]/20"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send question"
            className="grid size-10 shrink-0 place-items-center rounded-md bg-[oklch(0.22_0.07_260)] text-white hover:bg-[oklch(0.3_0.08_260)] disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </form>
        <p className="bg-white px-4 pb-3 text-[10px] leading-relaxed text-[oklch(0.5_0.025_250)]">
          Messages stay in this tab; they are not sent to a service or saved.
          Don't enter personal or medical information.
        </p>
      </section>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="patient-page-guide"
        aria-label={
          open ? "Close patient page guide" : "Open patient page guide"
        }
        className="grid size-14 place-items-center rounded-full bg-[oklch(0.22_0.07_260)] text-white shadow-lg ring-1 ring-white/80 transition hover:-translate-y-0.5 hover:bg-[oklch(0.3_0.08_260)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[oklch(0.48_0.11_175)]"
      >
        {open ? <X size={21} /> : <MessageCircle size={22} />}
      </button>
    </div>
  );
}
