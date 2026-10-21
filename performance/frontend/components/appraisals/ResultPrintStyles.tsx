export default function ResultPrintStyles() {
  return <style>{`@media print {
    body * { visibility: hidden; }
    .appraisal-print, .appraisal-print * { visibility: visible; color: #111 !important; background: white !important; box-shadow: none !important; }
    .appraisal-print { position: absolute; left: 0; top: 0; width: 100%; padding: 12mm; box-sizing: border-box; }
    .appraisal-print.appraisal-result-print { padding: 4mm; border: 0 !important; border-radius: 0 !important; }
    .appraisal-print .no-print { display: none !important; }
    .appraisal-print .result-row { break-inside: avoid; }
    .appraisal-print { --suite-accent: #0066cc; --suite-surface: #fff; --suite-surface-muted: #e5e7eb; --suite-muted: #62636b; --suite-line: #dcdde3; --suite-line-strong: #858791; --suite-warning: #925700; }
    .appraisal-print .report-chart { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .appraisal-print .report-analysis-section .MuiCollapse-root,
    .appraisal-print .report-record-section .MuiCollapse-root { height: auto !important; min-height: 0 !important; overflow: visible !important; visibility: visible !important; }
    .appraisal-print .report-analysis-section .MuiAccordionSummary-expandIconWrapper,
    .appraisal-print .report-record-section .MuiAccordionSummary-expandIconWrapper { display: none !important; }
    .appraisal-print .report-chart { break-inside: avoid; }
    .appraisal-print .report-text-preview { display: block !important; -webkit-line-clamp: unset !important; overflow: visible !important; }
    .appraisal-print figure { break-inside: auto; }
    .appraisal-print h1, .appraisal-print h2, .appraisal-print h3 { break-after: avoid; }
    @page { margin: 12mm; }
  }`}</style>;
}
