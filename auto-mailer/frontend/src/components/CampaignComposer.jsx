import React, { useState, useCallback } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Send,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import campaignsAPI from '../api/campaigns';
import Button from './ui/Button';

const normalizeVar = (h) => String(h || '').trim().toLowerCase().replace(/\s+/g, '_');

const CampaignComposer = () => {
  const [step, setStep] = useState(1);
  const [csvContent, setCsvContent] = useState('');
  const [csvFile, setCsvFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const [subjectTemplate, setSubjectTemplate] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');
  const [emailField, setEmailField] = useState('email');
  const [nameField, setNameField] = useState('name');
  const [isParsing, setIsParsing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState(null);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvContent(ev.target?.result || '');
    };
    reader.readAsText(file);
  }, []);

  const handleParseCsv = async () => {
    if (!csvContent.trim()) {
      setError('Please upload or paste CSV content');
      return;
    }
    try {
      setIsParsing(true);
      setError(null);
      const res = await campaignsAPI.parseCsv(csvContent);
      if (res.success) {
        setParsed(res.data);
        const headers = res.data.headers || [];
        const emailCol = headers.find((h) => /email/i.test(String(h)));
        const nameCol = headers.find((h) => /name/i.test(String(h)) && !/email/i.test(String(h)));
        if (emailCol) setEmailField(emailCol);
        if (nameCol) setNameField(nameCol);
        setStep(2);
      } else {
        setError(res.message || 'Failed to parse CSV');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to parse CSV');
    } finally {
      setIsParsing(false);
    }
  };

  const handleSendCampaign = async () => {
    if (!parsed?.rows?.length) {
      setError('No recipients to send to');
      return;
    }
    if (!subjectTemplate.trim()) {
      setError('Subject is required');
      return;
    }
    if (!bodyTemplate.trim()) {
      setError('Email body is required');
      return;
    }
    try {
      setIsSending(true);
      setError(null);
      setResult(null);
      const res = await campaignsAPI.sendCampaign({
        recipients: parsed.rows,
        subjectTemplate,
        bodyTemplate,
        emailField,
        nameField,
      });
      if (res.success) {
        setResult(res.data);
        setStep(3);
      } else {
        setError(res.message || 'Failed to send campaign');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to send campaign');
    } finally {
      setIsSending(false);
    }
  };

  const reset = () => {
    setStep(1);
    setParsed(null);
    setCsvContent('');
    setCsvFile(null);
    setSubjectTemplate('');
    setBodyTemplate('');
    setResult(null);
    setError(null);
  };

  const headers = parsed?.headers || [];
  const preview = parsed?.preview || [];
  const totalRecipients = parsed?.totalRecipients || 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                    step >= s ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {s}
                </div>
                {s < 3 && <ChevronRight className="h-4 w-4 text-gray-300" />}
              </React.Fragment>
            ))}
            <span className="ml-3 text-sm text-gray-600">
              {step === 1 && 'Import CSV'}
              {step === 2 && 'Compose & Map'}
              {step === 3 && 'Results'}
            </span>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Step 1: CSV Import */}
          {step === 1 && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary-600" />
                Import Recipients from CSV
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Upload a CSV file with columns like email, name, first_name, etc. Use{' '}
                <code className="bg-gray-100 px-1 rounded">{'{{variable}}'}</code> in your templates
                to personalize.
              </p>
              <div className="space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Upload CSV</span>
                  <div className="mt-2 flex items-center gap-3">
                    <label className="btn-primary cursor-pointer inline-flex items-center gap-2 px-4 py-2 rounded-lg">
                      <Upload className="h-4 w-4" />
                      Choose file
                      <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </label>
                    {csvFile && (
                      <span className="text-sm text-gray-600">{csvFile.name}</span>
                    )}
                  </div>
                </label>
                <div>
                  <span className="text-sm font-medium text-gray-700">Or paste CSV content</span>
                  <textarea
                    className="input-field mt-2 h-32 font-mono text-sm"
                    placeholder="email,name,first_name&#10;john@example.com,John Doe,John&#10;jane@example.com,Jane Smith,Jane"
                    value={csvContent}
                    onChange={(e) => setCsvContent(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleParseCsv}
                  loading={isParsing}
                  disabled={!csvContent.trim() || isParsing}
                >
                  Parse CSV
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Compose & Map */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Field Mapping</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Map your CSV columns. Use these variable names in your subject and body:{' '}
                  <code className="bg-gray-100 px-1 rounded">
                    {headers.map((h) => `{{${normalizeVar(h)}}}`).join(', ')}
                  </code>
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email column
                    </label>
                    <select
                      className="input-field"
                      value={emailField}
                      onChange={(e) => setEmailField(e.target.value)}
                    >
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name column (optional)
                    </label>
                    <select
                      className="input-field"
                      value={nameField}
                      onChange={(e) => setNameField(e.target.value)}
                    >
                      <option value="">—</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-sm font-medium text-gray-700">Preview ({preview.length} of {totalRecipients} rows)</span>
                  <div className="mt-2 overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {headers.map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-gray-700">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            {headers.map((h) => (
                              <td key={h} className="px-3 py-2 text-gray-600">
                                {row[h] ?? '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="card p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Template</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="Hi {{first_name}}, quick update"
                      value={subjectTemplate}
                      onChange={(e) => setSubjectTemplate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Body (HTML or plain text)
                    </label>
                    <textarea
                      className="input-field h-48 font-mono text-sm"
                      placeholder={`Hi {{first_name}},\n\nThis is a personalized message for {{email}}.\n\nBest regards`}
                      value={bodyTemplate}
                      onChange={(e) => setBodyTemplate(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  onClick={handleSendCampaign}
                  loading={isSending}
                  disabled={isSending}
                  className="flex items-center gap-2"
                >
                  {isSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send to {totalRecipients} recipients
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Results */}
          {step === 3 && result && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Campaign Complete
              </h3>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-700">{result.sent}</div>
                  <div className="text-sm text-green-600">Sent</div>
                </div>
                <div className="bg-red-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-red-700">{result.failed}</div>
                  <div className="text-sm text-red-600">Failed</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-gray-700">{result.total}</div>
                  <div className="text-sm text-gray-600">Total</div>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div className="mb-4">
                  <span className="text-sm font-medium text-gray-700">Sample errors</span>
                  <ul className="mt-2 space-y-1 text-sm text-red-600">
                    {result.errors.slice(0, 5).map((e, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        {e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-sm text-gray-600 mb-4">
                Emails were sent in batches of 5 with random delays to reduce blocking risk.
              </p>
              <Button onClick={reset}>Start new campaign</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CampaignComposer;
