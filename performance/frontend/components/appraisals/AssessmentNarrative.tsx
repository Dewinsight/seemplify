'use client';
import { Fragment } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { citedText } from '@/lib/assessment-presentation';

function emphasis(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>);
}
function Passage({ text, onSources }: { text: string; onSources: (refs: string[]) => void }) {
  const passage = citedText(text);
  return <><Typography component="div" className="assessment-passage" sx={{ whiteSpace: 'pre-line', lineHeight: 1.75 }}>{emphasis(passage.text)}</Typography>
    {!!passage.refs.length && <Button size="small" color="inherit" onClick={() => onSources(passage.refs)} aria-label={`View ${passage.refs.length} source${passage.refs.length === 1 ? '' : 's'} for: ${passage.text.slice(0, 70)}`} sx={{ px: .5, mt: .25, color: 'primary.main' }}>View sources ({passage.refs.length})</Button>}
  </>;
}
export default function AssessmentNarrative({ content, onSources }: { content: string; onSources: (refs: string[]) => void }) {
  const blocks = content.split(/\n\s*\n/).filter(block => block.trim());
  return <Stack spacing={2} sx={{ maxWidth: '76ch', overflowWrap: 'anywhere' }}>{blocks.map((block, index) => {
    const lines = block.split('\n');
    if (lines.every(line => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line))) {
      const ordered = /^\s*\d+[.)]/.test(lines[0]);
      return <Box key={index} component={ordered ? 'ol' : 'ul'} sx={{ pl: 2.5, m: 0, '& li + li': { mt: 1.5 } }}>{lines.map((line, position) => <Box component="li" key={position}><Passage text={line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')} onSources={onSources} /></Box>)}</Box>;
    }
    return <Box key={index}><Passage text={block} onSources={onSources} /></Box>;
  })}</Stack>;
}
