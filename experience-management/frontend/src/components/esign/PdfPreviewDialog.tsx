import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface PdfPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  previewUrl: string;
  downloadUrl: string;
}

export function PdfPreviewDialog({ open, onOpenChange, name, previewUrl, downloadUrl }: PdfPreviewDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-4 sm:p-5">
      <DialogHeader className="min-w-0 pr-12">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0"><DialogTitle className="truncate" title={name}>{name}</DialogTitle><DialogDescription>Review the signed PDF without leaving this page.</DialogDescription></div>
          <Button variant="outline" size="sm" className="shrink-0" asChild><a href={downloadUrl}><Download />Download</a></Button>
        </div>
      </DialogHeader>
      <div className="min-h-0 overflow-hidden rounded-md border bg-muted/20">
        <iframe className="h-full min-h-[420px] w-full bg-white" src={previewUrl} title={`Preview ${name}`} />
      </div>
    </DialogContent>
  </Dialog>;
}
