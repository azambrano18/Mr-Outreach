'use client';

import type { Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  Eraser,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Minus,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { ImageUploadButton } from './image-upload-button';

const FONT_FAMILIES = [
  { label: 'Predeterminada', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Courier New', value: '"Courier New", monospace' },
];

const FONT_SIZES = [
  { label: 'Tamaño', value: '' },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '24', value: '24px' },
  { label: '32', value: '32px' },
];

function ToolbarButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`rounded p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-brand-100 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

export function EditorToolbar({
  editor,
  htmlSourceMode,
  onToggleHtmlSourceMode,
}: {
  editor: Editor | null;
  htmlSourceMode: boolean;
  onToggleHtmlSourceMode: () => void;
}) {
  if (!editor) return null;

  function setLink(): void {
    const previousUrl = editor!.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL del enlace', previousUrl ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor!.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor!.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-t-md border border-b-0 border-slate-300 bg-slate-50 p-1.5">
      <select
        disabled={htmlSourceMode}
        onChange={(event) => {
          const value = event.target.value;
          if (value) {
            editor.chain().focus().setFontFamily(value).run();
          } else {
            editor.chain().focus().unsetFontFamily().run();
          }
        }}
        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs disabled:opacity-40"
        defaultValue=""
        aria-label="Tipo de letra"
      >
        {FONT_FAMILIES.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>

      <select
        disabled={htmlSourceMode}
        onChange={(event) => {
          const value = event.target.value;
          if (value) {
            editor.chain().focus().setFontSize(value).run();
          } else {
            editor.chain().focus().unsetFontSize().run();
          }
        }}
        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs disabled:opacity-40"
        defaultValue=""
        aria-label="Tamaño de fuente"
      >
        {FONT_SIZES.map((size) => (
          <option key={size.value} value={size.value}>
            {size.label}
          </option>
        ))}
      </select>

      <div className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />

      <ToolbarButton
        label="Negrita"
        active={editor.isActive('bold')}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Cursiva"
        active={editor.isActive('italic')}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Subrayado"
        active={editor.isActive('underline')}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Tachado"
        active={editor.isActive('strike')}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <label className="flex items-center gap-1 px-1" title="Color de texto">
        <span className="sr-only">Color de texto</span>
        <input
          type="color"
          disabled={htmlSourceMode}
          onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
          className="h-6 w-6 cursor-pointer rounded border border-slate-300 disabled:opacity-40"
        />
      </label>
      <label className="flex items-center gap-1 px-1" title="Color de fondo">
        <span className="sr-only">Color de fondo</span>
        <input
          type="color"
          disabled={htmlSourceMode}
          onChange={(event) =>
            editor.chain().focus().toggleHighlight({ color: event.target.value }).run()
          }
          className="h-6 w-6 cursor-pointer rounded border border-slate-300 disabled:opacity-40"
        />
      </label>

      <div className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />

      <ToolbarButton
        label="Alinear a la izquierda"
        active={editor.isActive({ textAlign: 'left' })}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Centrar"
        active={editor.isActive({ textAlign: 'center' })}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Alinear a la derecha"
        active={editor.isActive({ textAlign: 'right' })}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Justificar"
        active={editor.isActive({ textAlign: 'justify' })}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
      >
        <AlignJustify className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />

      <ToolbarButton
        label="Lista con viñetas"
        active={editor.isActive('bulletList')}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Lista numerada"
        active={editor.isActive('orderedList')}
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />

      <ToolbarButton
        label="Insertar enlace"
        active={editor.isActive('link')}
        disabled={htmlSourceMode}
        onClick={setLink}
      >
        <Link2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Quitar enlace"
        disabled={htmlSourceMode || !editor.isActive('link')}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        <Link2Off className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Insertar separador"
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus className="h-4 w-4" />
      </ToolbarButton>

      <div className={htmlSourceMode ? 'pointer-events-none opacity-40' : ''}>
        <ImageUploadButton
          onUploaded={(url) => editor.chain().focus().setImage({ src: url }).run()}
        />
      </div>

      <div className="mx-1 h-5 w-px bg-slate-300" aria-hidden="true" />

      <ToolbarButton
        label="Deshacer"
        disabled={htmlSourceMode || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Rehacer"
        disabled={htmlSourceMode || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Limpiar formato"
        disabled={htmlSourceMode}
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      >
        <Eraser className="h-4 w-4" />
      </ToolbarButton>

      <div className="ml-auto">
        <ToolbarButton
          label={htmlSourceMode ? 'Vista visual' : 'Ver HTML'}
          active={htmlSourceMode}
          disabled={false}
          onClick={onToggleHtmlSourceMode}
        >
          <Code2 className="h-4 w-4" />
        </ToolbarButton>
      </div>
    </div>
  );
}
