"use client";

import { Trash2, LogIn, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CHAT_HEADER, CLEAR_BUTTON_TEXT } from "@/configuration/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface ChatHeaderProps {
  clearMessages: () => void;
  user: { id: string; email: string } | null;
  onLoginClick: () => void;
  onLogoutClick: () => Promise<void>;
}

export default function ChatHeader({ 
  clearMessages, 
  user,
  onLoginClick,
  onLogoutClick
}: ChatHeaderProps) {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b h-16 shadow-sm">
      <div className="container mx-auto px-4 h-full flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Link href="/">
            <h1 className="text-xl font-bold">{CHAT_HEADER}</h1>
          </Link>
        </div>
        <div className="flex items-center space-x-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={clearMessages}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{CLEAR_BUTTON_TEXT}</TooltipContent>
          </Tooltip>

          {user ? (
            <>
              <div className="mr-2 text-sm text-gray-600">
                <span className="opacity-70">Signed in as:</span> {user.email}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={onLogoutClick}>
                    <LogOut className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sign out</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={onLoginClick}>
                  <LogIn className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sign in</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  );
}