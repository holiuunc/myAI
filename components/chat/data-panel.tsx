"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2 } from "lucide-react";
import type { UploadedDocument } from "@/types";
import { FileUploader } from "./file-uploader";

interface DataPanelProps {
  documents: UploadedDocument[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  refreshDocuments: () => void;
}

export function DataPanel({ documents, onUpload, onDelete, refreshDocuments }: DataPanelProps) {
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      await onUpload(file);
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="data-panel w-[300px] h-full border-l bg-background">
      <div className="p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-semibold">Your Documents</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={refreshDocuments}
              className="h-8 w-8"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          
          <FileUploader onUpload={handleUpload} isUploading={isUploading} />

          <div className="space-y-2 mt-4">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="group flex items-center justify-between py-2"
              >
                <div className="flex items-center space-x-2 min-w-0 flex-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" title={doc.title}>
                      {doc.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(doc.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(doc.id)}
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
} 