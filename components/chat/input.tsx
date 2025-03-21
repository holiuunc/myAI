"use client";

import * as React from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  input: string;
  isLoading: boolean;
  disabled?: boolean;
}

export default function ChatInput({
  handleInputChange,
  handleSubmit,
  input,
  isLoading,
  disabled = false,
}: ChatInputProps) {
  return (
    <div className="fixed bottom-0 w-full p-4 bg-background border-t">
      <form onSubmit={handleSubmit} className="max-w-screen-xl mx-auto flex gap-2">
        <input
          type="text"
          value={input}
          onChange={handleInputChange}
          placeholder={disabled ? "Sign in to start chatting..." : "Type a message..."}
          className="flex-1 p-2 rounded-md border bg-background focus:outline-none focus:ring-2"
          disabled={disabled || isLoading}
        />
        <Button type="submit" disabled={disabled || isLoading || !input.trim()}>
          <SendHorizontal className="h-4 w-4" />
          <span className="sr-only">Send message</span>
        </Button>
      </form>
    </div>
  );
}
