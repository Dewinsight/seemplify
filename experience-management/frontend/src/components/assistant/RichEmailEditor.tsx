import { useEffect, useRef, useState, type ReactNode } from 'react';
import CharacterCount from '@tiptap/extension-character-count';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold, Italic, Link2, List, ListOrdered, Quote, Redo2, RemoveFormatting, Strikethrough,
  Undo2, Unlink
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function emailBodyToHtml(value: string) {
  const body = String(value || '').trim();
  if (!body) return '<p></p>';
  if (/<(?:p|br|strong|em|s|ul|ol|li|blockquote|a)\b[^>]*>/iu.test(body)) return body;
  return body.split(/\n{2,}/u).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, '<br>')}</p>`).join('');
}

export function emailBodyToPlainText(value: string) {
  const body = String(value || '');
  if (!/<[a-z][\s\S]*>/iu.test(body)) return body.replace(/\r\n?/gu, '\n').trim();
  const document = new DOMParser().parseFromString(body, 'text/html');
  document.querySelectorAll('br').forEach((element) => element.replaceWith('\n'));
  document.querySelectorAll('p,div,blockquote,li').forEach((element) => element.append('\n'));
  return (document.body.textContent || '').replace(/\n{3,}/gu, '\n\n').trim();
}

function ToolbarButton({ editor, label, active = false, disabled = false, onClick, children }: {
  editor: Editor; label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return <button
    type="button"
    className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35', active && 'bg-secondary text-secondary-foreground')}
    aria-label={label}
    aria-pressed={active}
    disabled={disabled || !editor.isEditable}
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
  >{children}</button>;
}

export function RichEmailEditor({ id, value, onChange, disabled = false, maxLength = 12_000, placeholder = 'Write your reply…' }: {
  id: string; value: string; onChange: (value: string) => void; disabled?: boolean; maxLength?: number; placeholder?: string;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const latestValue = useRef(value);
  latestValue.current = value;
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: emailBodyToHtml(value),
    extensions: [
      StarterKit.configure({ codeBlock: false, heading: false, horizontalRule: false, link: false }),
      CharacterCount.configure({ limit: maxLength }),
      Link.configure({ autolink: true, defaultProtocol: 'https', openOnClick: false, protocols: ['http', 'https', 'mailto'] }),
      Placeholder.configure({ placeholder })
    ],
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-label': 'Reply',
        'aria-multiline': 'true',
        class: 'tiptap min-h-52 px-4 py-3 text-sm leading-6 outline-none'
      }
    },
    onCreate: ({ editor: current }) => {
      current.commands.setContent(emailBodyToHtml(latestValue.current), { emitUpdate: false });
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML())
  });

  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);
  useEffect(() => {
    if (!editor) return;
    const next = emailBodyToHtml(value);
    if (editor.getHTML() !== next) editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return <div className="min-h-64 animate-pulse rounded-md border bg-muted/25" />;
  const currentEditor = editor;
  const characters = editor.storage.characterCount.characters();

  function openLink() {
    setLinkUrl(currentEditor.getAttributes('link').href || '');
    setLinkOpen(true);
  }

  function applyLink() {
    const next = linkUrl.trim();
    if (!next) currentEditor.chain().focus().extendMarkRange('link').unsetLink().run();
    else currentEditor.chain().focus().extendMarkRange('link').setLink({ href: next }).run();
    setLinkOpen(false);
  }

  return <div className={cn('email-editor overflow-hidden rounded-md border bg-background focus-within:border-ring focus-within:ring-1 focus-within:ring-ring', disabled && 'bg-muted/20')}>
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto border-b bg-muted/20 px-2 py-1" role="toolbar" aria-label="Reply formatting">
      <ToolbarButton editor={editor} label="Undo" disabled={!editor.can().chain().focus().undo().run()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton editor={editor} label="Redo" disabled={!editor.can().chain().focus().redo().run()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></ToolbarButton>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <ToolbarButton editor={editor} label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton editor={editor} label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton editor={editor} label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough className="h-4 w-4" /></ToolbarButton>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <ToolbarButton editor={editor} label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton editor={editor} label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton editor={editor} label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton editor={editor} label="Add or edit link" active={editor.isActive('link')} onClick={openLink}><Link2 className="h-4 w-4" /></ToolbarButton>
      <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <ToolbarButton editor={editor} label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting className="h-4 w-4" /></ToolbarButton>
    </div>
    {linkOpen && <div className="flex flex-col gap-2 border-b bg-card px-3 py-2 sm:flex-row sm:items-center">
      <Input aria-label="Link address" className="h-8 flex-1 text-xs" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyLink(); } if (event.key === 'Escape') setLinkOpen(false); }} placeholder="https://example.com or mailto:name@example.com" autoFocus />
      <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}><Unlink />Remove</Button><Button type="button" size="sm" onClick={applyLink}>Apply link</Button></div>
    </div>}
    <EditorContent editor={editor} />
    <div className="flex items-center justify-between border-t bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground"><span>Rich-text email · formatting is preserved when sent</span><span className={cn(characters > maxLength * 0.9 && 'text-amber-700')}>{characters.toLocaleString()} / {maxLength.toLocaleString()}</span></div>
  </div>;
}
