"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  Eye,
  Code2,
  LayoutTemplate,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  Pencil,
  Check,
  Bold,
  Italic,
  Underline,
  Heading2,
  Pilcrow,
  List,
  ListOrdered,
  Link2,
  Undo2,
  Redo2
} from 'lucide-react';
import { Button } from './button';
import { Label } from './label';
import { Textarea } from './textarea';
import { Input } from './input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import {
  EMAIL_TEMPLATE_PRESETS,
  EMAIL_TEMPLATE_VARIABLES,
  DEFAULT_EMAIL_TEMPLATE_PRESET_ID
} from '@/lib/emailTemplatePresets';
import type { EmailTemplatePreset } from '@/lib/emailTemplatePresets';

export interface EmailTemplateVariable {
  token: string;
  label: string;
  example?: string;
}

interface EmailTemplateDesignerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  helperText?: string;
  previewData?: Record<string, string | number | boolean | null | undefined>;
  presets?: EmailTemplatePreset[];
  variables?: Array<string | EmailTemplateVariable>;
  defaultPresetId?: string;
  contentPresetId?: string;
}

const CUSTOM_PRESET_ID = '__custom_email_template__';

type BuilderBlockType = 'hero' | 'text' | 'details' | 'button' | 'divider' | 'signature';

interface BuilderBlock {
  id: string;
  type: BuilderBlockType;
  condition?: '' | 'meetingLink' | 'notes' | 'candidateCurrentRole' | 'candidateExperience';
  title?: string;
  subtitle?: string;
  content?: string;
  buttonText?: string;
  buttonUrl?: string;
  signoff?: string;
  signer?: string;
  organization?: string;
}

interface PreviewComponent {
  id: string;
  name: string;
  html: string;
  isDefault?: boolean;
}

const PREVIEW_COMPONENT_DRAG_TYPE = 'application/x-smarthr-email-component-html';

const DEFAULT_PREVIEW_COMPONENTS: PreviewComponent[] = [
  {
    id: 'default-text-block',
    name: 'Text Block',
    html: '<p style="margin: 0 0 14px 0;">Add your text here.</p>',
    isDefault: true
  },
  {
    id: 'default-highlight-card',
    name: 'Highlight Card',
    html: `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:0 0 14px 0;">
        <p style="margin:0;font-weight:700;">Section Title</p>
        <p style="margin:8px 0 0 0;">Describe this part of the interview message.</p>
      </div>
    `,
    isDefault: true
  },
  {
    id: 'default-details-card',
    name: 'Interview Details',
    html: `
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:14px;">
        <p style="margin:0 0 10px 0;font-weight:700;">Interview Details</p>
        <p style="margin:0 0 8px 0;"><strong>Date:</strong> {{interviewDate}}</p>
        <p style="margin:0 0 8px 0;"><strong>Time:</strong> {{interviewTime}}</p>
        <p style="margin:0 0 8px 0;"><strong>Duration:</strong> {{duration}} minutes</p>
        <p style="margin:0;"><strong>Format:</strong> {{interviewType}}</p>
      </div>
    `,
    isDefault: true
  },
  {
    id: 'default-cta-button',
    name: 'CTA Button',
    html: `
      <p style="margin:14px 0;">
        <a href="{{meetingLink}}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;">
          Join Interview
        </a>
      </p>
    `,
    isDefault: true
  }
];

const PREVIEW_FALLBACK_DATA: Record<string, string> = {
  candidateName: 'Jane Doe',
  candidateFirstName: 'Jane',
  candidateLastName: 'Doe',
  candidateEmail: 'jane.doe@example.com',
  jobTitle: 'Senior Product Designer',
  jobLink: 'https://smarthr.aiinnigeria.com/public/jobs/1234567890abcdef',
  jobDetailsPdfAttached: 'true',
  interviewDate: 'Tuesday, February 24, 2026',
  interviewTime: '10:00 AM EST',
  duration: '60',
  interviewType: 'Video Call',
  meetingLink: 'https://teams.microsoft.com/l/meetup-join/example',
  notes: 'Please have your portfolio ready for screen sharing.',
  interviewerName: 'Michael Adams',
  organizationName: 'Example Organization',
  applicationDate: '21 July 2026',
  previousStageName: 'Phone screen',
  nextStageName: 'Technical interview',
  stageDescription: 'A 45-minute video interview with the hiring team.',
  stage: 'Technical interview',
  feedback: 'Thank you for the time and care you invested in the process.',
  jobLocation: 'London or remote',
  contactEmail: 'hiring@example.com',
  companyLogo: ''
};

const looksLikeHtml = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const createBlock = (type: BuilderBlockType): BuilderBlock => {
  const id = `${type}-${Math.random().toString(36).slice(2, 10)}`;

  if (type === 'hero') {
    return {
      id,
      type,
      title: 'Interview Invitation',
      subtitle: '{{organizationName}}'
    };
  }

  if (type === 'text') {
    return {
      id,
      type,
      content: "We're pleased to invite you for an interview for the {{jobTitle}} role."
    };
  }

  if (type === 'details') {
    return {
      id,
      type,
      title: 'Interview Details'
    };
  }

  if (type === 'button') {
    return {
      id,
      type,
      condition: 'meetingLink',
      buttonText: 'Join Interview',
      buttonUrl: '{{meetingLink}}'
    };
  }

  if (type === 'divider') {
    return { id, type };
  }

  return {
    id,
    type: 'signature',
    signoff: 'Best regards,',
    signer: '{{interviewerName}}',
    organization: '{{organizationName}}'
  };
};

const createDefaultBuilderBlocks = (): BuilderBlock[] => [
  createBlock('hero'),
  {
    id: `greeting-${Math.random().toString(36).slice(2, 10)}`,
    type: 'text',
    content: 'Hello {{candidateName}},'
  },
  createBlock('text'),
  createBlock('details'),
  createBlock('button'),
  {
    id: `notes-${Math.random().toString(36).slice(2, 10)}`,
    type: 'text',
    condition: 'notes',
    content: 'Additional Notes:\n{{notes}}'
  },
  createBlock('signature')
];

const withCondition = (html: string, condition?: BuilderBlock['condition']) => {
  if (!condition) {
    return html;
  }
  return `{{#if ${condition}}}\n${html}\n{{/if}}`;
};

const multilineToHtml = (value?: string) =>
  escapeHtml(value || '')
    .replace(/\n/g, '<br>');

const renderBuilderBlock = (block: BuilderBlock): string => {
  if (block.type === 'hero') {
    const html = `
      <div style="background: #111827; color: #ffffff; padding: 22px;">
        <h2 style="margin: 0; font-size: 24px;">${multilineToHtml(block.title || 'Interview Invitation')}</h2>
        <p style="margin: 6px 0 0 0; color: #d1d5db;">${multilineToHtml(block.subtitle || '{{organizationName}}')}</p>
      </div>
    `;
    return withCondition(html, block.condition);
  }

  if (block.type === 'text') {
    const html = `<p style="margin: 0 0 14px 0;">${multilineToHtml(block.content)}</p>`;
    return withCondition(html, block.condition);
  }

  if (block.type === 'details') {
    const html = `
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 14px;">
        <p style="margin: 0 0 10px 0; font-weight: 700;">${multilineToHtml(block.title || 'Interview Details')}</p>
        <p style="margin: 0 0 8px 0;"><strong>Date:</strong> {{interviewDate}}</p>
        <p style="margin: 0 0 8px 0;"><strong>Time:</strong> {{interviewTime}}</p>
        <p style="margin: 0 0 8px 0;"><strong>Duration:</strong> {{duration}} minutes</p>
        <p style="margin: 0;"><strong>Format:</strong> {{interviewType}}</p>
      </div>
    `;
    return withCondition(html, block.condition);
  }

  if (block.type === 'button') {
    const html = `
      <div style="margin: 0 0 16px 0;">
        <a href="${escapeHtml(block.buttonUrl || '{{meetingLink}}')}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600;">
          ${escapeHtml(block.buttonText || 'Join Interview')}
        </a>
      </div>
    `;
    return withCondition(html, block.condition);
  }

  if (block.type === 'divider') {
    const html = '<hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 18px 0;" />';
    return withCondition(html, block.condition);
  }

  const html = `
    <p style="margin: 18px 0 0 0;">
      ${multilineToHtml(block.signoff || 'Best regards,')}<br>
      ${multilineToHtml(block.signer || '{{interviewerName}}')}<br>
      ${multilineToHtml(block.organization || '{{organizationName}}')}
    </p>
  `;
  return withCondition(html, block.condition);
};

const generateBuilderTemplate = (blocks: BuilderBlock[]): string => {
  const renderedBlocks = blocks.map(renderBuilderBlock).join('\n');
  return `<div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
  <div style="padding: 24px; color: #111827;">
    ${renderedBlocks}
  </div>
</div>`;
};

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");

const stripHtmlToText = (value: string) =>
  decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

const getFirstMatchText = (template: string, pattern: RegExp) => {
  const match = template.match(pattern);
  if (!match || !match[1]) {
    return '';
  }
  return stripHtmlToText(match[1]);
};

const inferBuilderBlocksFromTemplate = (template: string): BuilderBlock[] => {
  if (!template || !template.trim()) {
    return createDefaultBuilderBlocks();
  }

  const blocks: BuilderBlock[] = [];
  const paragraphMatches = Array.from(template.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi));
  const paragraphTexts = paragraphMatches
    .map(match => stripHtmlToText(match[1] || ''))
    .filter(Boolean);

  const heroTitle = getFirstMatchText(template, /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  blocks.push(
    heroTitle
      ? {
          id: `hero-${Math.random().toString(36).slice(2, 10)}`,
          type: 'hero',
          title: heroTitle,
          subtitle: '{{organizationName}}'
        }
      : createBlock('hero')
  );

  const greeting =
    paragraphTexts.find(text => /\{\{candidateName\}\}/i.test(text)) ||
    paragraphTexts.find(text => /^(hello|hi|dear)\b/i.test(text)) ||
    'Hello {{candidateName}},';
  blocks.push({
    id: `greeting-${Math.random().toString(36).slice(2, 10)}`,
    type: 'text',
    content: greeting
  });

  const roleText =
    paragraphTexts.find(text => /\{\{jobTitle\}\}/i.test(text) && text !== greeting) ||
    paragraphTexts.find(text => /(interview|position|role)/i.test(text) && text !== greeting) ||
    "We're pleased to invite you for an interview for the {{jobTitle}} role.";
  blocks.push({
    id: `intro-${Math.random().toString(36).slice(2, 10)}`,
    type: 'text',
    content: roleText
  });

  if (
    template.includes('{{interviewDate}}') ||
    template.includes('{{interviewTime}}') ||
    template.includes('{{duration}}') ||
    template.includes('{{interviewType}}')
  ) {
    blocks.push(createBlock('details'));
  }

  if (template.includes('{{meetingLink}}') || /join (interview|meeting)|open meeting link/i.test(template)) {
    const anchorText = getFirstMatchText(template, /<a[^>]*>([\s\S]*?)<\/a>/i);
    blocks.push({
      id: `button-${Math.random().toString(36).slice(2, 10)}`,
      type: 'button',
      condition: 'meetingLink',
      buttonText: anchorText || 'Join Interview',
      buttonUrl: '{{meetingLink}}'
    });
  }

  if (template.includes('{{notes}}') || /additional notes|notes/i.test(template)) {
    blocks.push({
      id: `notes-${Math.random().toString(36).slice(2, 10)}`,
      type: 'text',
      condition: 'notes',
      content: 'Additional Notes:\n{{notes}}'
    });
  }

  blocks.push({
    id: `signature-${Math.random().toString(36).slice(2, 10)}`,
    type: 'signature',
    signoff: 'Best regards,',
    signer: '{{interviewerName}}',
    organization: '{{organizationName}}'
  });

  return blocks;
};

const templateToBuilderBlocks = (template: string): BuilderBlock[] => {
  if (!template || !template.trim()) {
    return createDefaultBuilderBlocks();
  }
  return inferBuilderBlocksFromTemplate(template);
};

const buildPreviewData = (
  previewData?: Record<string, string | number | boolean | null | undefined>
) => {
  const merged: Record<string, string> = { ...PREVIEW_FALLBACK_DATA };

  if (!previewData) {
    return merged;
  }

  Object.entries(previewData).forEach(([key, rawValue]) => {
    if (rawValue === null || rawValue === undefined) {
      merged[key] = '';
      return;
    }
    merged[key] = String(rawValue);
  });

  return merged;
};

const renderTemplatePreview = (
  template: string,
  previewData?: Record<string, string | number | boolean | null | undefined>
) => {
  const resolvedPreviewData = buildPreviewData(previewData);
  let rendered = template;

  rendered = rendered.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/gi, (_match, variable, block) => {
    const value = resolvedPreviewData[variable];
    return value && value.trim() ? block : '';
  });

  rendered = rendered.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, variable) => resolvedPreviewData[variable] || '');

  if (looksLikeHtml(rendered)) {
    return DOMPurify.sanitize(rendered);
  }

  return DOMPurify.sanitize(`<div style="white-space: pre-line;">${escapeHtml(rendered)}</div>`);
};

const HANDLEBARS_TOKEN_PATTERN = /(\{\{#if\s+\w+\}\}|\{\{\/if\}\}|\{\{\s*\w+\s*\}\})/g;
const HANDLEBARS_TOKEN_FULL_PATTERN = /^(\{\{#if\s+\w+\}\}|\{\{\/if\}\}|\{\{\s*\w+\s*\}\})$/;
const HANDLEBARS_IF_OPEN_PATTERN = /^\{\{#if\s+(\w+)\}\}$/;

const sanitizeEditablePreviewHtml = (html: string) =>
  DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-hb-token', 'contenteditable', 'target', 'rel']
  });

const tokenDisplayLabel = (token: string) => {
  const trimmed = token.trim();
  const ifMatch = trimmed.match(HANDLEBARS_IF_OPEN_PATTERN);
  if (ifMatch) {
    return `IF ${ifMatch[1]}`;
  }
  if (trimmed === '{{/if}}') {
    return 'END IF';
  }
  return trimmed;
};

const createHandlebarsTokenChip = (doc: Document, token: string) => {
  const chip = doc.createElement('span');
  chip.setAttribute('data-hb-token', token);
  chip.setAttribute('contenteditable', 'false');
  chip.setAttribute(
    'style',
    'display:inline-block;margin:0 2px;padding:2px 8px;border-radius:999px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;font-size:12px;line-height:18px;vertical-align:baseline;'
  );
  chip.textContent = tokenDisplayLabel(token);
  return chip;
};

const templateToEditablePreview = (template: string) => {
  const html = looksLikeHtml(template)
    ? template
    : `<div style="white-space: pre-line;">${escapeHtml(template)}</div>`;

  const sanitized = sanitizeEditablePreviewHtml(html);
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="preview-root">${sanitized}</div>`, 'text/html');
  const root = doc.getElementById('preview-root');
  if (!root) {
    return sanitized;
  }

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  textNodes.forEach(node => {
    const text = node.nodeValue || '';
    if (!HANDLEBARS_TOKEN_PATTERN.test(text)) {
      HANDLEBARS_TOKEN_PATTERN.lastIndex = 0;
      return;
    }
    HANDLEBARS_TOKEN_PATTERN.lastIndex = 0;

    const parts = text.split(HANDLEBARS_TOKEN_PATTERN).filter(Boolean);
    const fragment = doc.createDocumentFragment();

    parts.forEach(part => {
      if (HANDLEBARS_TOKEN_FULL_PATTERN.test(part.trim())) {
        fragment.appendChild(createHandlebarsTokenChip(doc, part));
      } else {
        fragment.appendChild(doc.createTextNode(part));
      }
    });

    node.parentNode?.replaceChild(fragment, node);
  });

  return sanitizeEditablePreviewHtml(root.innerHTML);
};

const normalizeHandlebarsTokensInElement = (root: HTMLElement) => {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const current = walker.currentNode as Text;
    if (current.parentElement?.closest('[data-hb-token]')) {
      continue;
    }
    textNodes.push(current);
  }

  textNodes.forEach(node => {
    const text = node.nodeValue || '';
    if (!HANDLEBARS_TOKEN_PATTERN.test(text)) {
      HANDLEBARS_TOKEN_PATTERN.lastIndex = 0;
      return;
    }
    HANDLEBARS_TOKEN_PATTERN.lastIndex = 0;

    const parts = text.split(HANDLEBARS_TOKEN_PATTERN).filter(Boolean);
    const fragment = doc.createDocumentFragment();

    parts.forEach(part => {
      if (HANDLEBARS_TOKEN_FULL_PATTERN.test(part.trim())) {
        fragment.appendChild(createHandlebarsTokenChip(doc, part));
      } else {
        fragment.appendChild(doc.createTextNode(part));
      }
    });

    node.parentNode?.replaceChild(fragment, node);
  });
};

const editablePreviewToTemplate = (editableRoot: HTMLElement) => {
  const clone = editableRoot.cloneNode(true) as HTMLElement;

  clone.querySelectorAll<HTMLElement>('[data-hb-token]').forEach(node => {
    const token = node.getAttribute('data-hb-token') || '';
    node.replaceWith(document.createTextNode(token));
  });

  return DOMPurify.sanitize(clone.innerHTML);
};

export function EmailTemplateDesigner({
  value,
  onChange,
  label = 'Email Template',
  helperText,
  previewData,
  presets,
  variables,
  defaultPresetId,
  contentPresetId
}: EmailTemplateDesignerProps) {
  const resolvedPresets = useMemo(
    () => (presets && presets.length > 0 ? presets : EMAIL_TEMPLATE_PRESETS),
    [presets]
  );
  const resolvedVariableOptions = useMemo<EmailTemplateVariable[]>(
    () =>
      (variables && variables.length > 0 ? variables : EMAIL_TEMPLATE_VARIABLES).map(variable =>
        typeof variable === 'string'
          ? { token: variable, label: variable.replace(/[{}]/g, '') }
          : variable
      ),
    [variables]
  );
  const resolvedVariables = useMemo(
    () => resolvedVariableOptions.map(variable => variable.token),
    [resolvedVariableOptions]
  );
  const resolvedContentPresetId = useMemo(() => {
    if (contentPresetId && resolvedPresets.some((preset) => preset.id === contentPresetId)) {
      return contentPresetId;
    }

    const normalizedValue = (value || '').trim().replace(/\r\n/g, '\n');
    const matchingPreset = resolvedPresets.find(
      (preset) => preset.content.trim().replace(/\r\n/g, '\n') === normalizedValue
    );
    if (matchingPreset) {
      return matchingPreset.id;
    }

    const requestedDefault = defaultPresetId || DEFAULT_EMAIL_TEMPLATE_PRESET_ID;
    if (!normalizedValue && resolvedPresets.some((preset) => preset.id === requestedDefault)) {
      return requestedDefault;
    }
    return CUSTOM_PRESET_ID;
  }, [contentPresetId, defaultPresetId, resolvedPresets, value]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('preview');
  const [builderBlocks, setBuilderBlocks] = useState<BuilderBlock[]>(() => templateToBuilderBlocks(value || ''));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const lastBuilderAppliedTemplateRef = useRef<string | null>(null);
  const previewEditorRef = useRef<HTMLDivElement | null>(null);
  const [isPreviewEditing, setIsPreviewEditing] = useState(false);
  const [previewEditorSeedHtml, setPreviewEditorSeedHtml] = useState('');
  const [previewDraftHtml, setPreviewDraftHtml] = useState('');
  const [previewDirty, setPreviewDirty] = useState(false);
  const [previewLinkUrl, setPreviewLinkUrl] = useState('');
  const [previewVariableToInsert, setPreviewVariableToInsert] = useState(
    resolvedVariables[0] || '{{candidateName}}'
  );
  const [previewDropActive, setPreviewDropActive] = useState(false);
  const [previewCustomComponentName, setPreviewCustomComponentName] = useState('');
  const [previewCustomComponentHtml, setPreviewCustomComponentHtml] = useState('');
  const [previewCustomComponents, setPreviewCustomComponents] = useState<PreviewComponent[]>([]);
  const previewDraftSourceValueRef = useRef(value || '');

  const previewComponentLibrary = useMemo(
    () => [...DEFAULT_PREVIEW_COMPONENTS, ...previewCustomComponents],
    [previewCustomComponents]
  );

  const previewHtml = useMemo(() => renderTemplatePreview(value || '', previewData), [value, previewData]);
  const builderPreviewHtml = useMemo(
    () => DOMPurify.sanitize(generateBuilderTemplate(builderBlocks)),
    [builderBlocks]
  );
  const supportsInterviewDetails = useMemo(
    () =>
      resolvedVariables.some((variable) =>
        ['{{interviewDate}}', '{{interviewTime}}', '{{duration}}', '{{interviewType}}'].includes(variable)
      ),
    [resolvedVariables]
  );

  const applyBuilderTemplate = () => {
    const generated = generateBuilderTemplate(builderBlocks);
    lastBuilderAppliedTemplateRef.current = generated;
    onChange(generated);
    setIsPreviewEditing(false);
    setPreviewDirty(false);
    setPreviewDropActive(false);
    setActiveTab('preview');
  };

  const insertVariableAtCursor = (variable: string) => {
    const editor = textareaRef.current;
    if (!editor) {
      onChange(`${value}${variable}`);
      return;
    }

    const start = editor.selectionStart ?? value.length;
    const end = editor.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}${variable}${value.slice(end)}`;
    onChange(nextValue);

    window.requestAnimationFrame(() => {
      editor.focus();
      const nextCursor = start + variable.length;
      editor.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const applyPreset = (presetId: string) => {
    const preset = resolvedPresets.find(item => item.id === presetId);
    if (!preset) {
      return;
    }

    lastBuilderAppliedTemplateRef.current = null;
    setBuilderBlocks(templateToBuilderBlocks(preset.content));
    onChange(preset.content);
    setIsPreviewEditing(false);
    setPreviewDirty(false);
    setPreviewDropActive(false);
  };

  useEffect(() => {
    const normalizedValue = value || '';
    if (normalizedValue === (lastBuilderAppliedTemplateRef.current || '')) {
      return;
    }

    setBuilderBlocks(templateToBuilderBlocks(normalizedValue));
  }, [value]);

  useEffect(() => {
    if (!resolvedVariables.includes(previewVariableToInsert)) {
      setPreviewVariableToInsert(resolvedVariables[0] || '{{candidateName}}');
    }
  }, [previewVariableToInsert, resolvedVariables]);

  const addBuilderBlock = (type: BuilderBlockType) => {
    setBuilderBlocks(prev => [...prev, createBlock(type)]);
  };

  const updateBuilderBlock = (id: string, patch: Partial<BuilderBlock>) => {
    setBuilderBlocks(prev =>
      prev.map(block => (block.id === id ? { ...block, ...patch } : block))
    );
  };

  const removeBuilderBlock = (id: string) => {
    setBuilderBlocks(prev => prev.filter(block => block.id !== id));
  };

  const moveBuilderBlock = (id: string, direction: -1 | 1) => {
    setBuilderBlocks(prev => {
      const index = prev.findIndex(block => block.id === id);
      if (index < 0) return prev;
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const reorderBuilderBlocks = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setBuilderBlocks(prev => {
      const sourceIndex = prev.findIndex(block => block.id === fromId);
      const targetIndex = prev.findIndex(block => block.id === toId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const focusPreviewEditor = () => {
    if (!previewEditorRef.current) {
      return false;
    }
    previewEditorRef.current.focus();
    return true;
  };

  const beginPreviewEditing = () => {
    const seed = templateToEditablePreview(value || '');
    previewDraftSourceValueRef.current = value || '';
    setPreviewEditorSeedHtml(seed);
    setPreviewDraftHtml(seed);
    setIsPreviewEditing(true);
    setPreviewDirty(false);
    setPreviewLinkUrl('');
    setPreviewDropActive(false);
    setActiveTab('preview');
    window.requestAnimationFrame(() => {
      previewEditorRef.current?.focus();
    });
  };

  const cancelPreviewEditing = () => {
    setIsPreviewEditing(false);
    setPreviewDirty(false);
    setPreviewLinkUrl('');
    setPreviewDropActive(false);
  };

  const savePreviewEditing = () => {
    if (!previewEditorRef.current) {
      return;
    }
    const nextTemplate = editablePreviewToTemplate(previewEditorRef.current);
    lastBuilderAppliedTemplateRef.current = null;
    previewDraftSourceValueRef.current = nextTemplate;
    onChange(nextTemplate);
    setPreviewDraftHtml(templateToEditablePreview(nextTemplate));
    setIsPreviewEditing(false);
    setPreviewDirty(false);
    setPreviewLinkUrl('');
    setPreviewDropActive(false);
  };

  const handleTabChange = (tab: 'editor' | 'preview') => {
    if (isPreviewEditing && activeTab === 'preview' && tab !== 'preview' && previewEditorRef.current) {
      setPreviewDraftHtml(previewEditorRef.current.innerHTML);
    }
    setActiveTab(tab);
  };

  useEffect(() => {
    if (!isPreviewEditing || activeTab !== 'preview' || !previewEditorRef.current) {
      return;
    }
    previewEditorRef.current.innerHTML = previewDraftHtml || previewEditorSeedHtml;
  }, [activeTab, isPreviewEditing]);

  useEffect(() => {
    if (!isPreviewEditing) {
      return;
    }
    const normalizedValue = value || '';
    if (normalizedValue === previewDraftSourceValueRef.current) {
      return;
    }
    const synced = templateToEditablePreview(normalizedValue);
    previewDraftSourceValueRef.current = normalizedValue;
    setPreviewEditorSeedHtml(synced);
    setPreviewDraftHtml(synced);
    setPreviewDirty(false);
    if (activeTab === 'preview') {
      window.requestAnimationFrame(() => {
        if (previewEditorRef.current) {
          previewEditorRef.current.innerHTML = synced;
        }
      });
    }
  }, [value, activeTab, isPreviewEditing]);

  const executePreviewCommand = (command: string, commandValue?: string) => {
    if (!focusPreviewEditor()) {
      return;
    }
    document.execCommand(command, false, commandValue);
    if (previewEditorRef.current) {
      setPreviewDraftHtml(previewEditorRef.current.innerHTML);
    }
    setPreviewDirty(true);
  };

  const insertPreviewHtml = (html: string) => {
    if (!focusPreviewEditor()) {
      return;
    }

    const safeHtml = sanitizeEditablePreviewHtml(html);
    const inserted = document.execCommand('insertHTML', false, safeHtml);
    if (!inserted && previewEditorRef.current) {
      const selection = window.getSelection();
      if (!selection) return;

      let range: Range;
      if (selection.rangeCount > 0) {
        range = selection.getRangeAt(0);
      } else {
        range = document.createRange();
        range.selectNodeContents(previewEditorRef.current);
        range.collapse(false);
      }

      if (!previewEditorRef.current.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(previewEditorRef.current);
        range.collapse(false);
      }

      range.deleteContents();
      const fragment = range.createContextualFragment(safeHtml);
      const lastNode = fragment.lastChild;
      range.insertNode(fragment);
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    if (previewEditorRef.current) {
      normalizeHandlebarsTokensInElement(previewEditorRef.current);
      setPreviewDraftHtml(previewEditorRef.current.innerHTML);
    }

    setPreviewDirty(true);
  };

  const applyPreviewLink = () => {
    const trimmedLink = previewLinkUrl.trim();
    if (!trimmedLink) {
      return;
    }
    executePreviewCommand('createLink', trimmedLink);
    setPreviewLinkUrl('');
  };

  const insertPreviewVariable = (variable: string) => {
    const editor = previewEditorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const chip = createHandlebarsTokenChip(document, variable);
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      editor.appendChild(chip);
    } else {
      let range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }

      range.deleteContents();
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    setPreviewDirty(true);
    setPreviewDraftHtml(editor.innerHTML);
  };

  const insertPreviewSection = (section: 'text' | 'details' | 'button') => {
    if (section === 'text') {
      insertPreviewHtml('<p style="margin: 0 0 14px 0;">Add your section content here.</p>');
      return;
    }

    if (section === 'details') {
      if (supportsInterviewDetails) {
        insertPreviewHtml(`
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 14px;">
            <p style="margin: 0 0 10px 0; font-weight: 700;">Interview Details</p>
            <p style="margin: 0 0 8px 0;"><strong>Date:</strong> {{interviewDate}}</p>
            <p style="margin: 0 0 8px 0;"><strong>Time:</strong> {{interviewTime}}</p>
            <p style="margin: 0 0 8px 0;"><strong>Duration:</strong> {{duration}} minutes</p>
            <p style="margin: 0;"><strong>Format:</strong> {{interviewType}}</p>
          </div>
        `);
      } else {
        insertPreviewHtml(`
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 14px;">
            <p style="margin: 0 0 10px 0; font-weight: 700;">Application Details</p>
            <p style="margin: 0 0 8px 0;"><strong>Candidate:</strong> {{candidateName}}</p>
            <p style="margin: 0 0 8px 0;"><strong>Role:</strong> {{jobTitle}}</p>
            {{#if nextStageName}}
            <p style="margin: 0;"><strong>Next Stage:</strong> {{nextStageName}}</p>
            {{/if}}
          </div>
        `);
      }
      return;
    }

    insertPreviewHtml(`
      <p style="margin: 14px 0;">
        <a href="{{meetingLink}}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-weight: 600;">
          Join Interview
        </a>
      </p>
    `);
  };

  const addCustomPreviewComponent = () => {
    const name = previewCustomComponentName.trim();
    const html = previewCustomComponentHtml.trim();
    if (!name || !html) {
      return;
    }

    const sanitizedHtml = sanitizeEditablePreviewHtml(html);
    if (!sanitizedHtml.trim()) {
      return;
    }

    const nextComponent: PreviewComponent = {
      id: `custom-${Math.random().toString(36).slice(2, 10)}`,
      name,
      html: sanitizedHtml
    };

    setPreviewCustomComponents(prev => [...prev, nextComponent]);
    setPreviewCustomComponentName('');
    setPreviewCustomComponentHtml('');
  };

  const removeCustomPreviewComponent = (id: string) => {
    setPreviewCustomComponents(prev => prev.filter(component => component.id !== id));
  };

  const handlePreviewComponentDragStart = (event: React.DragEvent<HTMLDivElement>, component: PreviewComponent) => {
    event.dataTransfer.setData(PREVIEW_COMPONENT_DRAG_TYPE, component.html);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const placeCaretInPreviewByPoint = (x: number, y: number) => {
    if (!previewEditorRef.current) {
      return;
    }

    const docAny = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };

    let range: Range | null = null;
    if (docAny.caretRangeFromPoint) {
      range = docAny.caretRangeFromPoint(x, y);
    } else if (docAny.caretPositionFromPoint) {
      const caretPosition = docAny.caretPositionFromPoint(x, y);
      if (caretPosition) {
        range = document.createRange();
        range.setStart(caretPosition.offsetNode, caretPosition.offset);
        range.collapse(true);
      }
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    if (!range || !previewEditorRef.current.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(previewEditorRef.current);
      range.collapse(false);
    }

    selection.removeAllRanges();
    selection.addRange(range);
  };

  const handlePreviewEditorDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setPreviewDropActive(true);
  };

  const handlePreviewEditorDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPreviewDropActive(false);

    const componentHtml = event.dataTransfer.getData(PREVIEW_COMPONENT_DRAG_TYPE);
    if (!componentHtml) {
      return;
    }

    placeCaretInPreviewByPoint(event.clientX, event.clientY);
    insertPreviewHtml(componentHtml);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Label>{label}</Label>
        <div className="w-full sm:w-auto">
          <Select
            value={resolvedContentPresetId}
            onValueChange={(nextPresetId) => {
              applyPreset(nextPresetId);
            }}
          >
            <SelectTrigger className="w-full sm:w-[220px]" aria-label="Template style">
              <SelectValue placeholder="Choose preset" />
            </SelectTrigger>
            <SelectContent>
              {resolvedContentPresetId === CUSTOM_PRESET_ID && (
                <SelectItem value={CUSTOM_PRESET_ID} disabled>
                  Custom content
                </SelectItem>
              )}
              {resolvedPresets.map(preset => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {helperText || 'Use a preset, then customize HTML and variables to match your brand. HTML is sanitized server-side before sending.'}
      </p>

      <Tabs value={activeTab} onValueChange={v => handleTabChange(v as 'editor' | 'preview')} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="editor">
            <Code2 className="h-4 w-4 mr-2" />
            HTML Editor
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye className="h-4 w-4 mr-2" />
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="space-y-3 mt-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {resolvedVariableOptions.map(variable => (
              <Button
                key={variable.token}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => insertVariableAtCursor(variable.token)}
                className="h-auto min-h-10 justify-start px-3 py-2 text-left"
                title={variable.example ? `Example: ${variable.example}` : variable.token}
              >
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{variable.label}</span>
                  <code className="block truncate text-[11px] font-normal text-muted-foreground">{variable.token}</code>
                </span>
              </Button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Supports Handlebars blocks like <code>{'{{#if meetingLink}}...{{/if}}'}</code>.
          </p>

          <Textarea
            ref={textareaRef}
            value={value}
            onChange={event => onChange(event.target.value)}
            rows={14}
            className="font-mono text-xs"
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-3 flex flex-col gap-3">
          <div className="order-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {isPreviewEditing
                ? 'Preview edit mode: click content directly to edit. Use toolbar controls for formatting and sections.'
                : 'Preview mode: rendered with live values when available. Switch to edit mode to make visual, click-to-edit changes.'}
            </p>
            {!isPreviewEditing ? (
              <Button type="button" variant="outline" onClick={beginPreviewEditing}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit Preview
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={cancelPreviewEditing}>
                  Cancel
                </Button>
                <Button type="button" onClick={savePreviewEditing}>
                  <Check className="h-4 w-4 mr-2" />
                  Apply Preview Edits
                </Button>
              </div>
            )}
          </div>

          {isPreviewEditing && (
            <div className="order-3 space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('bold')}>
                  <Bold className="h-3.5 w-3.5 mr-1" />
                  Bold
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('italic')}>
                  <Italic className="h-3.5 w-3.5 mr-1" />
                  Italic
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('underline')}>
                  <Underline className="h-3.5 w-3.5 mr-1" />
                  Underline
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('formatBlock', '<h2>')}>
                  <Heading2 className="h-3.5 w-3.5 mr-1" />
                  Heading
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('formatBlock', '<p>')}>
                  <Pilcrow className="h-3.5 w-3.5 mr-1" />
                  Paragraph
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('insertUnorderedList')}>
                  <List className="h-3.5 w-3.5 mr-1" />
                  Bullets
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('insertOrderedList')}>
                  <ListOrdered className="h-3.5 w-3.5 mr-1" />
                  Numbered
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('undo')}>
                  <Undo2 className="h-3.5 w-3.5 mr-1" />
                  Undo
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => executePreviewCommand('redo')}>
                  <Redo2 className="h-3.5 w-3.5 mr-1" />
                  Redo
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Select value={previewVariableToInsert} onValueChange={setPreviewVariableToInsert}>
                  <SelectTrigger className="h-8 w-[220px] text-xs">
                    <SelectValue placeholder="Select variable" />
                  </SelectTrigger>
                  <SelectContent>
                    {resolvedVariableOptions.map(variable => (
                      <SelectItem key={variable.token} value={variable.token}>
                        {variable.label} - {variable.token}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="font-mono text-xs"
                  onClick={() => insertPreviewVariable(previewVariableToInsert)}
                >
                  Insert Variable
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => insertPreviewSection('text')}>
                  Add Text Section
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => insertPreviewSection('details')}>
                  Add Details Card
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => insertPreviewSection('button')}>
                  Add CTA Button
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Input
                  value={previewLinkUrl}
                  onChange={event => setPreviewLinkUrl(event.target.value)}
                  placeholder="https://example.com"
                  className="h-8 max-w-sm text-xs"
                />
                <Button type="button" size="sm" variant="outline" onClick={applyPreviewLink}>
                  <Link2 className="h-3.5 w-3.5 mr-1" />
                  Apply Link
                </Button>
              </div>

              <details className="border-t pt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Sections and reusable components
                </summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Drag components into the preview canvas or click insert.</p>
                    <div className="max-h-56 space-y-2 overflow-auto pr-1">
                      {previewComponentLibrary.map(component => (
                        <div
                          key={component.id}
                          draggable
                          onDragStart={event => handlePreviewComponentDragStart(event, component)}
                          className="cursor-grab rounded-md border bg-background px-3 py-2 text-xs active:cursor-grabbing"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate font-medium">{component.name}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => insertPreviewHtml(component.html)}
                              >
                                Insert
                              </Button>
                              {!component.isDefault && (
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-red-600"
                                  onClick={() => removeCustomPreviewComponent(component.id)}
                                  aria-label={`Delete ${component.name}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Create reusable custom component</p>
                    <Input
                      value={previewCustomComponentName}
                      onChange={event => setPreviewCustomComponentName(event.target.value)}
                      placeholder="Component name (e.g. Reminder Card)"
                      className="h-8 text-xs"
                    />
                    <Textarea
                      value={previewCustomComponentHtml}
                      onChange={event => setPreviewCustomComponentHtml(event.target.value)}
                      placeholder="<div>Custom HTML block...</div>"
                      rows={5}
                      className="font-mono text-xs"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={addCustomPreviewComponent}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Save Component
                      </Button>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}

          <div className="order-2 min-h-[220px] rounded-md border bg-white p-4">
            {isPreviewEditing ? (
              <div
                ref={previewEditorRef}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Editable email preview"
                aria-multiline="true"
                onInput={() => {
                  setPreviewDirty(true);
                  if (previewEditorRef.current) {
                    setPreviewDraftHtml(previewEditorRef.current.innerHTML);
                  }
                }}
                onDragEnter={() => setPreviewDropActive(true)}
                onDragOver={handlePreviewEditorDragOver}
                onDrop={handlePreviewEditorDrop}
                onDragLeave={event => {
                  const nextTarget = event.relatedTarget as Node | null;
                  if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                    setPreviewDropActive(false);
                  }
                }}
                className={`min-h-[188px] max-h-[520px] overflow-auto text-sm leading-6 outline-none transition-colors ${
                  previewDropActive ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''
                }`}
              />
            ) : (
              <div
                className="max-h-[520px] overflow-auto"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}
          </div>

          {isPreviewEditing && (
            <p className="order-4 text-xs text-muted-foreground">
              Locked variable chips preserve placeholders while editing.
              {previewDirty ? ' You have unsaved preview edits.' : ' No unsaved preview edits.'}
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
