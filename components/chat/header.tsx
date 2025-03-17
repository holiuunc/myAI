"use client";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { User } from "@supabase/supabase-js";

interface ChatHeaderProps {
  clearMessages: () => void;
  user: User | null;
  onLoginClick: () => void;
  onLogoutClick: () => void;
}

export default function ChatHeader({
  clearMessages,
  user,
  onLoginClick,
  onLogoutClick,
}: ChatHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-14 bg-background/80 backdrop-blur-sm border-b">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">myDucky</h1>
      </div>
      <div className="flex items-center gap-2">
        {user && (
          <span className="text-sm text-muted-foreground">
            {user.email}
          </span>
        )}
        <ThemeToggle />
        <Button
          variant="ghost"
          onClick={clearMessages}
          className="text-xs"
        >
          Clear Chat
        </Button>
        {user ? (
          <Button
            variant="ghost"
            onClick={onLogoutClick}
            className="text-xs"
          >
            Sign Out
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={onLoginClick}
            className="text-xs"
          >
            Sign In
          </Button>
        )}
      </div>
    </header>
  );
}