import { useEffect, useRef, useState } from "react";
import {
  isChatConfigured,
  subscribeChat,
  sendChat,
  pruneChat,
  fetchName,
  saveName,
  chatTime,
} from "../lib/chat";

export default function ChatPanel() {
  const [name, setName] = useState(fetchName);
  const [draftName, setDraftName] = useState("");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [fatal, setFatal] = useState(false);
  const listRef = useRef(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (!isChatConfigured) return;
    let unsub = null;
    let alive = true;

    subscribeChat(
      (list) => {
        if (!alive) return;
        const before = listRef.current;
        setMessages(list);
        if (before) stickToBottom.current = true;
      },
      () => alive && setFatal(true)
    ).then((off) => {
      if (!alive) off?.();
      else unsub = off;
    });

    pruneChat().catch(() => {});

    const interval = setInterval(() => {
      pruneChat().catch(() => {});
    }, 90_000);

    return () => {
      alive = false;
      unsub?.();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (stickToBottom.current || nearBottom) {
      el.scrollTop = el.scrollHeight;
      stickToBottom.current = false;
    }
  }, [messages]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  };

  const submit = async (e) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || !name.trim() || sending) return;
    setSending(true);
    try {
      await sendChat(name, clean);
      setText("");
      stickToBottom.current = true;
    } catch {
      setFatal(true);
    } finally {
      setSending(false);
    }
  };

  const setNameNow = (e) => {
    e.preventDefault();
    const clean = draftName.trim().slice(0, 24);
    if (!clean) return;
    saveName(clean);
    setName(clean);
  };

  if (!isChatConfigured) {
    return (
      <section className="game-card chat-card">
        <div className="chat-head">
          <h2 className="gc-title">Racket chat</h2>
          <span className="pill idle">SOON</span>
        </div>
        <p className="hint">The trash-talking lounge opens with launch.</p>
      </section>
    );
  }

  const listEmpty = messages.length === 0;

  return (
    <section className="game-card chat-card">
      <div className="chat-head">
        <h2 className="gc-title">Racket chat</h2>
        <span className="pill live">LIVE</span>
      </div>

      <p className="chat-desc">Trash talk at your own risk. Messages expire after 20 minutes.</p>

      {fatal && (
        <p className="hint chat-offline">Chat is offline right now. Refresh to retry.</p>
      )}

      {!name ? (
        <form className="chat-name" onSubmit={setNameNow}>
          <input
            className="chat-input"
            value={draftName}
            maxLength={24}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Pick a name to join"
          />
          <button className="btn btn-primary" type="submit" disabled={!draftName.trim()}>
            Join
          </button>
        </form>
      ) : (
        <>
          <div className="chat-meta">
            <span>
              Talking as <span className="mono chat-name">{name}</span>
            </span>
            <button
              type="button"
              className="chat-change"
              onClick={() => {
                saveName("");
                setName("");
              }}
            >
              change
            </button>
          </div>

          <div className="chat-list" ref={listRef} onScroll={handleScroll}>
            {listEmpty ? (
              <p className="hint chat-empty">No smoke yet. Say something bold.</p>
            ) : (
              messages.map((m) => (
                <div className="chat-msg" key={m.key}>
                  <span className="mono chat-who">{m.name}</span>
                  <span className="chat-time">{chatTime(m.ts)}</span>
                  <span className="chat-body">{m.text}</span>
                </div>
              ))
            )}
          </div>

          <form className="chat-compose" onSubmit={submit}>
            <input
              className="chat-input"
              value={text}
              maxLength={240}
              onChange={(e) => setText(e.target.value)}
              placeholder="Throw some shade…"
            />
            <button className="btn btn-primary" type="submit" disabled={!text.trim() || sending}>
              {sending ? "…" : "Send"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}