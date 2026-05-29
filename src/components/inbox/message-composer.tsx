"use client";

import { useState, useRef, useCallback, KeyboardEvent, useEffect } from "react";
import { Send, LayoutTemplate, ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReplyQuote } from "./reply-quote";
import { toast } from "sonner";

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void | Promise<void>;
  onSendMedia?: (
    file: File,
    caption?: string,
    replyToId?: string,
  ) => void | Promise<void>;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [imageDraft, setImageDraft] = useState<{
    file: File;
    previewUrl: string;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const clearImageDraft = useCallback(() => {
    setImageDraft((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  useEffect(() => {
    return () => {
      if (imageDraft) URL.revokeObjectURL(imageDraft.previewUrl);
    };
  }, [imageDraft]);

  const setDraftImage = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are supported");
      return;
    }
    setImageDraft((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return {
        file,
        previewUrl: URL.createObjectURL(file),
      };
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (sending || sessionExpired) return;

    const trimmed = text.trim();
    const hasImage = !!imageDraft;
    if (!trimmed && !hasImage) return;

    setSending(true);
    try {
      if (imageDraft) {
        if (!onSendMedia) {
          toast.error("Image sending is not available");
          return;
        }
        await onSendMedia(imageDraft.file, trimmed || undefined, replyTo?.id);
        clearImageDraft();
      } else {
        await onSend(trimmed, replyTo?.id);
      }

      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [
    sending,
    sessionExpired,
    text,
    imageDraft,
    onSend,
    onSendMedia,
    replyTo?.id,
    clearImageDraft,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  const handlePickImageClick = useCallback(() => {
    if (sessionExpired || sending) return;
    fileInputRef.current?.click();
  }, [sessionExpired, sending]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setDraftImage(file);
    },
    [setDraftImage],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            setDraftImage(file);
          }
          break;
        }
      }
    },
    [setDraftImage],
  );

  // Used by the parent to scope sends; keep it referenced so lint doesn't
  // suggest removing the prop while keeping the public interface stable.
  void conversationId;

  return (
    <div className="border-t border-slate-800 bg-slate-900 p-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}

      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            24-hour session expired. Use a template to re-engage.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            Templates
          </Button>
        </div>
      )}

      {imageDraft && (
        <div className="mb-2 rounded-lg border border-slate-700 bg-slate-800/70 p-2">
          <div className="flex items-start gap-2">
            <img
              src={imageDraft.previewUrl}
              alt="Selected image preview"
              className="h-16 w-16 rounded-md object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-slate-300">
                {imageDraft.file.name || "clipboard-image"}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {Math.max(1, Math.round(imageDraft.file.size / 1024))} KB
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-400 hover:text-white"
              onClick={clearImageDraft}
              title="Remove image"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white"
          onClick={onOpenTemplates}
          title="Send template"
        >
          <LayoutTemplate className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-slate-400 hover:text-white disabled:opacity-40"
          disabled={sessionExpired || sending}
          onClick={handlePickImageClick}
          title="Attach image"
        >
          <ImagePlus className="h-4 w-4" />
        </Button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            sessionExpired
              ? "Session expired - use a template"
              : imageDraft
                ? "Add an optional caption..."
                : "Type a message... (Shift+Enter for new line)"
          }
          disabled={sessionExpired}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
            sessionExpired && "cursor-not-allowed opacity-50"
          )}
        />

        <Button
          size="sm"
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
          disabled={(!text.trim() && !imageDraft) || sessionExpired || sending}
          onClick={() => {
            void handleSend();
          }}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <p className="mt-1 pl-[88px] text-[10px] text-slate-600">
        Type &apos;/&apos; for quick replies, or paste an image
      </p>
    </div>
  );
}

