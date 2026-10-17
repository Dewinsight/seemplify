export default function ResultPrintStyles() {
  return <style>{`@media print {
    body * { visibility: hidden; }
    .appraisal-print, .appraisal-print * { visibility: visible; color: #111 !important; background: white !important; box-shadow: none !important; }
    .appraisal-print { position: absolute; left: 0; top: 0; width: 100%; padding: 12mm; box-sizing: border-box; }
    .appraisal-print .no-print { display: none !important; }
    .appraisal-print .result-row { break-inside: avoid; }
    @page { margin: 12mm; }
  }`}</style>;
}
