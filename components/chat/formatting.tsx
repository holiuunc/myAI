import type { DisplayMessage } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { preprocessLaTeX, renderCitations } from "@/utilities/formatting";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

export function Formatting({ message }: { message: DisplayMessage }) {
  const processedContent = preprocessLaTeX(message.content);
  const components = {
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    code: ({ children, className, node, ...rest }: any) => {
      const match = /language-(\w+)/.exec(className || "");
      return match ? (
        <SyntaxHighlighter
          {...rest}
          PreTag="div"
          className="rounded-xl"
          // biome-ignore lint/correctness/noChildrenProp: <explanation>
          children={String(children).replace(/\n$/, "")}
          language={match[1]}
        />
      ) : (
        <code {...rest} className={className}>
          {children}
        </code>
      );
    },
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    p: ({ node, children, ...props }: { node: any; children: React.ReactNode; [key: string]: any }) => {
      const parentIsP = node.parent?.tagName === 'p';
      const Component = parentIsP ? 'div' : 'p';
      return <Component {...props}>{children}</Component>;
    },
    strong: ({ children }: { children: React.ReactNode }) => {
      return (
        <span className="font-bold">
          {renderCitations(children, message.citations)}
        </span>
      );
    },
    li: ({ children }: { children: React.ReactNode }) => {
      return renderCitations(children, message.citations);
    },
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      components={components as any}
      className="gap-3 flex flex-col"
    >
      {processedContent}
    </ReactMarkdown>
  );
}
