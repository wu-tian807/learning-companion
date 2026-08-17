import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';

import { normalizeConversationMarkdown } from './conversation-text';

export function ConversationMarkdown({ text }: { readonly text: string }) {
  return (
    <div className="select-text space-y-2 break-words [&_p]:whitespace-pre-wrap [&_strong]:font-semibold [&_strong]:text-white [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/25 [&_pre]:p-3 [&_code]:font-mono [&_code]:text-[0.9em] [&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizeConversationMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}
