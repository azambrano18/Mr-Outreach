'use client';

import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import TiptapImage from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import { sanitizeRichTextHtml } from '../../lib/sanitize-html-client';
import { FontSize } from './font-size-extension';
import { EditorToolbar } from './toolbar';
import { EditorVariable, VariableInsertMenu } from './variable-insert-menu';

export function RichTextEditor({
  value,
  onChange,
  editable = true,
  placeholder,
  variables,
}: {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  placeholder?: string;
  variables?: EditorVariable[];
}) {
  const [htmlSourceMode, setHtmlSourceMode] = useState(false);
  const [sourceDraft, setSourceDraft] = useState(value);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['paragraph'] }),
      Link.configure({ openOnClick: false, autolink: false }),
      TiptapImage.configure({ inline: false }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Escribe el contenido…',
      }),
    ],
    content: value,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: updatedEditor }) => onChange(updatedEditor.getHTML()),
    editorProps: {
      attributes: {
        class: 'prose-signature min-h-[140px] px-3 py-2 text-sm focus:outline-none',
      },
    },
  });

  // Resyncs the editor when `value` changes for reasons other than typing
  // (e.g. the parent resets it after a save, or switches which version is
  // active) — setContent's second argument (false) skips re-emitting
  // onUpdate, avoiding an infinite loop.
  useEffect(() => {
    if (editor && !htmlSourceMode && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  function toggleHtmlSourceMode(): void {
    if (!htmlSourceMode) {
      setSourceDraft(editor?.getHTML() ?? value);
      setHtmlSourceMode(true);
      return;
    }
    const sanitized = sanitizeRichTextHtml(sourceDraft);
    editor?.commands.setContent(sanitized, false);
    onChange(sanitized);
    setHtmlSourceMode(false);
  }

  function insertVariable(key: string): void {
    editor?.chain().focus().insertContent(`{${key}}`).run();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-md border border-slate-300">
        <EditorToolbar
          editor={editor}
          htmlSourceMode={htmlSourceMode}
          onToggleHtmlSourceMode={toggleHtmlSourceMode}
        />
        {htmlSourceMode ? (
          <textarea
            value={sourceDraft}
            onChange={(event) => setSourceDraft(event.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full border-0 px-3 py-2 font-mono text-xs outline-none"
            aria-label="Código HTML del contenido"
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
      {editable && !htmlSourceMode && variables && variables.length > 0 && (
        <VariableInsertMenu variables={variables} onInsert={insertVariable} />
      )}
    </div>
  );
}
